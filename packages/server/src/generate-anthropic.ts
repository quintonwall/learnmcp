import type { Complete, FetchText } from "./generate.js";

/**
 * Real implementations of the generation boundaries: fetch docs over HTTP and
 * complete a prompt with Claude. Kept out of generate.ts so the pipeline core stays
 * dependency-free and testable with fakes.
 */

/** Fetch a URL and reduce it to plain-ish text for the LLM (strips tags/scripts). */
export const httpFetchText: FetchText = async (url: string): Promise<string> => {
  const res = await fetch(url, { headers: { "user-agent": "learnmcp/0.1 (+cartridge-generator)" } });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  const html = await res.text();
  const ctype = res.headers.get("content-type") ?? "";
  if (ctype.includes("text/html")) {
    return html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/\s+/g, " ")
      .trim();
  }
  return html; // markdown, llms.txt, plain text — use as-is
};

export interface AnthropicCompleteOptions {
  apiKey?: string;
  model?: string;
  maxTokens?: number;
}

/**
 * Build a Complete backed by Claude. The SDK is imported dynamically so it's only a
 * hard requirement when cartridge generation is actually used, not for the whole server.
 */
export function createAnthropicComplete(opts: AnthropicCompleteOptions = {}): Complete {
  const model = opts.model ?? "claude-opus-4-8";
  const maxTokens = opts.maxTokens ?? 16000;
  return async (prompt: string): Promise<string> => {
    const { default: Anthropic } = await import("@anthropic-ai/sdk");
    const client = new Anthropic(opts.apiKey ? { apiKey: opts.apiKey } : {});
    const response = await client.messages.create({
      model,
      max_tokens: maxTokens,
      messages: [{ role: "user", content: prompt }],
    });
    return response.content
      .filter((b): b is Extract<typeof b, { type: "text" }> => b.type === "text")
      .map((b) => b.text)
      .join("");
  };
}
