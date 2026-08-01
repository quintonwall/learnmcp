import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import {
  CartridgeRegistry,
  CloudStore,
  IdentityStore,
  createMcpServer,
  syncGithubCartridges,
  type Learner,
} from "@learnmcp/server";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

/**
 * The hosted learnmcp MCP server.
 *
 * Stateless by design: every request resolves a learner from its bearer token, hydrates
 * that learner's progress from Supabase, serves the call, and flushes what changed. That
 * makes it safe on serverless, where no two requests are guaranteed the same instance.
 *
 * Identity is anonymous-first — a request with no token mints a learner and returns the
 * token in a response header, so nobody has to create an account before earning a badge.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Declared here rather than in vercel.json: a `functions` glob is resolved relative to the
// Vercel root directory, which doesn't line up with a Next app nested in a workspace.
export const maxDuration = 30;

const SUPABASE_URL = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const WEB_URL = process.env.NEXT_PUBLIC_WEB_URL ?? "https://learnmcp.ai";

/** Header the client reads once to persist its anonymous identity. */
const TOKEN_HEADER = "x-learnmcp-token";

/**
 * Cartridges are read from GitHub, cached on the instance's local disk, and reused across
 * warm invocations. A cold start refetches; a merged PR therefore goes live within one
 * instance lifetime without a redeploy.
 */
let cartridgeCache: { dir: string; registry: CartridgeRegistry; loadedAt: number } | undefined;
const CARTRIDGE_TTL_MS = 5 * 60 * 1000;

async function getRegistry(): Promise<CartridgeRegistry> {
  const fresh = cartridgeCache && Date.now() - cartridgeCache.loadedAt < CARTRIDGE_TTL_MS;
  if (cartridgeCache && fresh) return cartridgeCache.registry;

  const dir = cartridgeCache?.dir ?? mkdtempSync(path.join(tmpdir(), "learnmcp-cartridges-"));
  try {
    await syncGithubCartridges(dir, {});
  } catch (err) {
    // Rate-limited or offline: fall through and serve whatever is already cached. An
    // empty cache means no cartridges, which the tools report honestly.
    console.error(`[learnmcp] cartridge refresh failed: ${(err as Error).message}`);
  }

  const registry = cartridgeCache?.registry ?? new CartridgeRegistry({ sources: [dir] });
  await registry.load();
  cartridgeCache = { dir, registry, loadedAt: Date.now() };
  return registry;
}

function bearer(req: Request): string | undefined {
  const auth = req.headers.get("authorization");
  if (auth?.toLowerCase().startsWith("bearer ")) return auth.slice(7).trim();
  return req.headers.get(TOKEN_HEADER) ?? undefined;
}

async function handle(req: Request): Promise<Response> {
  if (!SUPABASE_URL || !SERVICE_KEY) {
    return Response.json(
      { error: "learnmcp server is not configured (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY)" },
      { status: 503 },
    );
  }

  const identity = new IdentityStore({ url: SUPABASE_URL, key: SERVICE_KEY });
  let learner: Learner;
  let issuedToken: string | undefined;
  try {
    const resolved = await identity.resolve(bearer(req));
    learner = resolved.learner;
    issuedToken = resolved.issued;
  } catch (err) {
    return Response.json({ error: `identity unavailable: ${(err as Error).message}` }, { status: 503 });
  }

  const store = new CloudStore({ url: SUPABASE_URL, key: SERVICE_KEY });
  await store.hydrate(learner.id);

  const registry = await getRegistry();
  const server = createMcpServer({
    registry,
    store,
    // Progress belongs to the learner, not a project path — that's what the board ranks.
    defaultScope: learner.id,
    cloud: { identity, learner, issuedToken, webUrl: WEB_URL },
  });

  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined, // stateless: no session to carry between invocations
    // Return a complete JSON body instead of an SSE stream. On serverless the stream
    // variant hands back a Response whose body is still being written, so tearing the
    // server down after `handleRequest` resolves truncates it to nothing — a 200 with an
    // empty body. JSON mode resolves only once the response is fully formed.
    enableJsonResponse: true,
  });
  await server.connect(transport);

  let response: Response;
  try {
    response = await transport.handleRequest(req);
  } finally {
    // Persist before the invocation can be frozen. Failing to flush loses progress, so it
    // is logged loudly rather than swallowed — but it must not turn a good tool call into
    // an HTTP error the client can't interpret.
    try {
      await store.flush();
    } catch (err) {
      console.error(`[learnmcp] flush failed for learner ${learner.id}: ${(err as Error).message}`);
    }
    await server.close().catch(() => {});
  }

  if (issuedToken) {
    const headers = new Headers(response.headers);
    headers.set(TOKEN_HEADER, issuedToken);
    headers.set("access-control-expose-headers", TOKEN_HEADER);
    response = new Response(response.body, { status: response.status, headers });
  }
  return response;
}

export const POST = handle;
export const GET = handle;
export const DELETE = handle;
