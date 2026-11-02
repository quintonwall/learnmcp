# Walkthrough: send your first SMS with Twilio, learning as you go

This assumes you have never used Twilio. You don't need to know any skill names — describe
what you want, and learnmcp tells Claude which Twilio skills and docs tools are still
unused so it reaches for them. Each step below shows a prompt you can paste, what Claude
should do, and the badge it earns.

New to learnmcp? Install it first — see the [README](README.md).

The Twilio Developer Kit plugin gives Claude two things, and the cartridge tracks both:

- the **Twilio docs MCP server** (`twilio-docs`) — `twilio__search` and `twilio__retrieve`, a
  read-only, no-auth way to look up Twilio's API.
- **skills** from [twilio/ai](https://github.com/twilio/ai) — setup, planning, per-product
  guidance and production guardrails.

Badges are awarded for **using** those skills and tools, not for the app you end up with.
A Twilio app written from memory earns nothing, which is why the prompts below ask Claude to
look things up and plan first.

---

## Setup

```bash
/plugin install twilio-developer-kit@twilio
```

Restart Claude Code. learnmcp switches on the `twilio` track by itself when it sees the
plugin, the `twilio` package, or a `TWILIO_ACCOUNT_SID` env var.

## Step 0 — Get a Twilio account (5 minutes, in your browser)

Claude can't sign you up, so do this part yourself.

1. Create a free trial account at [twilio.com/try-twilio](https://www.twilio.com/try-twilio).
2. In the [Console](https://console.twilio.com), copy your **Account SID** and **Auth
   Token** from the dashboard.
3. Get a Twilio phone number (the trial walks you through it). This is the number your
   texts come *from*.
4. Verify your own mobile number under **Phone Numbers → Verified Caller IDs**.

A trial account can only text numbers you have verified, and each message starts with
"Sent from your Twilio trial account". Both go away when you upgrade. If you skip step 4,
sending fails with error 21608.

Put the values in a `.env` file in your project, and make sure `.env` is in `.gitignore`:

```
TWILIO_ACCOUNT_SID=ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
TWILIO_AUTH_TOKEN=your_auth_token
TWILIO_FROM_NUMBER=+15551234567
```

Phone numbers must be in **E.164** format: `+`, country code, number, no spaces —
`+14155550123`.

## Step 1 — Plan before you code (bronze)

> I want a small web app where I type a phone number and a message and it sends an SMS with
> Twilio. I'm new to Twilio. Before writing code, check what Twilio skills and docs are
> available, tell me which Twilio product fits, and walk me through what I need.

Claude should run an advisor skill such as `twilio-messaging-channel-advisor` or
`twilio-messaging-overview`, and confirm plain SMS is the right fit.

Earns **Planner**.

## Step 2 — Check your account is ready (bronze)

> Check that my Twilio setup is ready to send: credentials, sender number, and trial
> limits.

Claude should run `twilio-account-setup` (or `twilio-numbers-senders`).

Earns **Ready to Send**.

## Step 3 — Look the API up, don't guess (bronze)

> Search the Twilio docs for the operation that sends an SMS, then retrieve its full schema
> before you write the call.

Claude calls `twilio__search`, then `twilio__retrieve` for the exact parameters. For SMS
that is the Messages resource: `To`, `From` (or a Messaging Service), and `Body`.

Earns **Searcher** and **Schema Reader**. Doing both earns **Careful Integrator**.

## Step 4 — Build the sender (silver)

> Build the app: a page with a phone number box, a message box and a Send button, and a
> server endpoint that sends the text using my credentials from `.env`. Use the Twilio
> messaging skill.

Claude should run `twilio-send-message`. The server-side core is short:

```js
import twilio from "twilio";

const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);

const message = await client.messages.create({
  to: "+14155550123", // a number you verified in step 0
  from: process.env.TWILIO_FROM_NUMBER,
  body: "Hello from my first Twilio app",
});

console.log(message.sid, message.status); // "SM…" and "queued"
```

Keep this on the server. Never put the Auth Token in browser code — anyone could read it
and send texts on your account.

Earns **Messenger**.

## Step 5 — Send one for real, and check it arrived

> Send a test message to my verified number, then tell me whether it was delivered.

`queued` only means Twilio accepted the request. Delivery is a later status (`sent`,
`delivered`, or `undelivered`). If it never shows up, ask:

> My message didn't arrive. Find out why using Twilio's tooling.

Claude should use `twilio-debugging-observability`, which reads the error code and explains
it (for example 21608: the number isn't verified on a trial account).

Earns **Debugger**.

## Step 6 — Make it safe to leave running (silver)

> Review this app for security: how I store credentials, and anything an attacker could
> abuse. Use any relevant Twilio skills.

Claude should run `twilio-security-hardening` and `twilio-security-api-auth`. Two things to
expect it to find:

- Use an **API key**, not the Auth Token. An API key can be revoked on its own without
  touching your whole account.
- A public "send a text" endpoint can be abused to run up your bill (SMS pumping). It
  needs rate limiting and a geo-permission check.

Earns **Hardened** and **Scoped Credentials**.

> Add retries and delivery-status tracking, using Twilio's reliability guidance.

Earns **Dependable** (`twilio-reliability-patterns`). Receiving the status callback itself
(`twilio-messaging-webhooks`) earns **Listener**.

## Step 7 — Before you text real people (gold)

Texting people in the US from a normal phone number needs carrier registration (A2P 10DLC),
or the messages get filtered. A trial account texting yourself doesn't need it; a launch
does.

> I want to text real customers in the US. What do I have to register and what rules apply?

Claude should run `twilio-compliance-onboarding` and `twilio-compliance-traffic`.

Earns **Compliant**.

---

## Don't know what to ask? Use these

| You say | What it does |
|---|---|
| `/learnmcp:learn` | Shows the next unearned objective and the skill that completes it |
| `/learnmcp:progress` | What you've completed so far on each track |
| "Use any relevant Twilio skills and the Twilio docs tools at each stage" | Added to any prompt, makes Claude look for skills itself |

learnmcp also tells Claude about your next open objective when you submit a prompt, once per
objective per session, so the right skill is often used without you asking. It's a hint,
not a guarantee: Claude can still skip a skill that doesn't fit, so if a badge doesn't
arrive, ask for the skill by name.

## Beyond SMS

- **Verification codes** — `twilio-verify-send-otp` → **Verifier**. Don't hand-roll one-time
  codes over SMS.
- **Validate numbers first** — `twilio-lookup-phone-intelligence` → **Number Sleuth**
- **Voice** — `twilio-voice-outbound-calls`, `twilio-voice-twiml` → **Caller**
- **Email** — `twilio-email-send` and the SendGrid skills → **Mailer**
- **Workflows** — Studio, TaskRouter, Conversations → **Orchestrator**
- **AI agents** — `twilio-ai-agent-architect` → **Agent Builder** (gold)
- **Search the API 15 times** → **Docs Regular** (gold)

## How detection works

Skill use is detected as a command invocation, with or without the plugin prefix
(`twilio-developer-kit:twilio-send-message` and `twilio-send-message` both count). MCP tool
use is detected from the `twilio-docs` server under either its manual name or its
plugin-prefixed name.

The cartridge lives at [cartridges/twilio/twilio.json](cartridges/twilio/twilio.json).
