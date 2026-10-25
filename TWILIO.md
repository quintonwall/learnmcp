# Walkthrough: learning Twilio with learnmcp

A sample path from zero to a production-ready Twilio integration, using the official
**Twilio Developer Kit** plugin. The example project: "text a verification code at signup,
then send order updates."

New to learnmcp? Install it first — see the [README](README.md).

The plugin installs two things, and the cartridge tracks both:

- the **Twilio MCP server** (`twilio-docs`) — `twilio__search` and `twilio__retrieve`, a
  read-only, no-auth way to look up Twilio's API. It's in public beta.
- **skills** from [twilio/ai](https://github.com/twilio/ai) — procedural knowledge for
  setup, planning, individual products, and production guardrails.

---

## Setup

```bash
/plugin install twilio-developer-kit@twilio
```

Or add only the MCP server:

```bash
claude mcp add --transport http twilio-docs https://mcp.twilio.com/docs
```

Restart Claude Code. learnmcp detects the `twilio` track on its own — from the MCP server,
a `twilio-developer-kit:*` command, the `twilio` dependency, or a `TWILIO_ACCOUNT_SID` env
var.

---

## 1. Plan before you build (bronze)

> I want to add phone verification and order notifications to my app.

The advisor skills (`twilio-identity-verification-advisor`, `twilio-messaging-overview`)
steer you to Verify for the code and SMS for notifications, rather than a hand-rolled OTP.

Earns **Planner**.

## 2. Set up the account and credentials (bronze)

`twilio-account-setup` and `twilio-iam-auth-setup` cover the account, a sender, and auth.
Create an **API key** rather than using your master Auth Token — it can be scoped and
revoked on its own.

Earns **Ready to Send** and **Scoped Credentials**.

## 3. Look the API up, don't guess (bronze)

Claude calls `twilio__search` to find the right operation, then `twilio__retrieve` for its
exact parameters and response shape.

Earns **Searcher** and **Schema Reader**. Doing both, in order, earns **Careful
Integrator**.

## 4. Build the features (silver)

| Skill | Builds | Badge |
|---|---|---|
| `twilio-verify-send-otp` | signup verification | **Verifier** |
| `twilio-sms-send-message` | order notifications | **Messenger** |
| `twilio-lookup-phone-intelligence` | number validation before sending | **Number Sleuth** (bronze) |

## 5. Handle callbacks (silver)

`twilio-webhook-architecture` covers delivery status callbacks, signature validation, and
idempotency.

Earns **Listener**.

## 6. Harden for production (silver → gold)

| Skill | Covers | Badge |
|---|---|---|
| `twilio-security-hardening` | secrets, webhook validation, least privilege | **Hardened** |
| `twilio-reliability-patterns` | retries, idempotency, status tracking | **Dependable** |
| `twilio-compliance-traffic` | A2P 10DLC, opt-out handling | **Compliant** (gold) |

Compliance is the step most often skipped. Carriers filter unregistered traffic, so do it
before launch, not after messages start disappearing.

## 7. Debug when something breaks (silver)

A message shows as undelivered. `twilio-debugging-observability` explains the error code.

Earns **Debugger**.

---

## Beyond the basics

- **Voice** — `twilio-voice-outbound-calls`, `twilio-voice-twiml`,
  `twilio-voice-conversation-relay` → **Caller**
- **Email** — `twilio-email-send` and the SendGrid skills → **Mailer**
- **Workflows** — Studio, TaskRouter, Conversations → **Orchestrator**
- **AI agents** — `twilio-ai-agent-architect`, `twilio-agent-connect` → **Agent Builder**
  (gold)
- **Search the API 15 times** → **Docs Regular** (gold)

You don't have to follow this order. Ask what's next at any point and learnmcp suggests
whichever objective is still open.

## How detection works

Skill use is detected as a command invocation, with or without the plugin prefix
(`twilio-developer-kit:twilio-sms-send-message` and `twilio-sms-send-message` both count).
MCP tool use is detected from the `twilio-docs` server under either its manual name or its
plugin-prefixed name.

The cartridge lives at [cartridges/twilio/twilio.json](cartridges/twilio/twilio.json).
