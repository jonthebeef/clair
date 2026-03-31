# Clair — Open KAIROS Clone

## What is this

An autonomous AI agent that lives in your terminal, drives Claude Code as its brain, talks to you via Cast, runs scheduled tasks, and manages its own state. Built in TypeScript on Bun, replicating the 5-layer KAIROS architecture from the Claude Code source.

## Architecture Overview

```
┌─────────────────────────────────────────────────────┐
│  clair (Bun CLI)                                    │
│                                                     │
│  ┌──────────┐  ┌───────────┐  ┌──────────────────┐ │
│  │ Tick Loop │  │ Scheduler │  │ MCP Host         │ │
│  │ (layer 1) │  │ (layer 2) │  │ (layer 3)        │ │
│  │           │  │           │  │  ┌─────────────┐ │ │
│  │ injects   │  │ cron +    │  │  │ Cast Channel│ │ │
│  │ <tick>    │  │ durable   │  │  │ MCP Server  │ │ │
│  │ prompts   │  │ persist   │  │  │ (cast CLI)  │ │ │
│  └─────┬─────┘  └─────┬─────┘  │  └──────┬──────┘ │ │
│        │               │       │         │        │ │
│        │               │       └─────────┼────────┘ │
│        ▼               ▼                 ▼          │
│  ┌──────────────────────────────────────────────┐   │
│  │  Conversation Engine                          │   │
│  │  drives `claude` subprocess via stdin/stdout   │   │
│  │  routes ticks, channel messages, cron wakes    │   │
│  └──────────────────────────────────────────────┘   │
│        │                                            │
│        ▼                                            │
│  ┌──────────────┐                                   │
│  │ Terminal UI   │                                   │
│  │ (layer 5)     │                                   │
│  │ Brief/status  │                                   │
│  └──────────────┘                                   │
└─────────────────────────────────────────────────────┘
```

## Layer 1: Autonomous Loop (Tick Engine)

The heartbeat. Injects `<tick>` prompts into the Claude Code subprocess on an interval.

- **Tick format**: `<tick>2026-03-31T14:30:00</tick>` (local time)
- **Pacing**: Claude calls a `Sleep` command to set the next wake interval. Default tick every 30s, but Claude can say "wake me in 5 minutes"
- **Terminal focus**: detect if the terminal is focused (via SIGWINCH or similar). Inject `terminalFocus: true/false` into tick context. Unfocused = fully autonomous, focused = collaborative
- **Wake triggers**: tick timer expires, channel message arrives, cron job fires — any of these interrupt sleep
- **Queue**: messages from channels and cron land in a priority queue. `priority: 'next'` jumps ahead of the next tick

### Key patterns from CC source
- Multiple ticks can batch — Claude processes the latest
- "If you have nothing to do, you MUST call Sleep" — prevents token waste
- First wake-up: greet and ask for direction, don't start exploring unprompted

## Layer 2: Scheduler (Cron)

Durable cron-based task scheduling.

- **Persistence**: `~/.clair/scheduled_tasks.json` — survives restarts
- **Cron expressions**: standard 5-field cron, local timezone
- **Jitter**: random offset (1-30s) to avoid thundering herd on API
- **Max jobs**: cap at 50 concurrent scheduled tasks
- **Execution**: when a cron fires, inject the task prompt into the conversation queue as a user message
- **Session vs durable**: some tasks are session-only (die when clair stops), others persist

### Interface
```typescript
type ScheduledTask = {
  id: string
  cron: string           // "*/5 * * * *"
  prompt: string         // what to inject when it fires
  durable: boolean       // persist across restarts
  createdAt: string
  lastRun?: string
  nextRun: string
}
```

## Layer 3: Channels (Cast Integration)

A Cast Channel MCP Server that speaks the KAIROS channel protocol. Runs as a child process connected via stdio (JSON-RPC, standard MCP transport).

### Inbound (Cast → Clair)
- MCP server polls Cast CLI on an interval (`cast read` or equivalent)
- New posts/replies on configured branches → `notifications/claude/channel`
- Content wrapped in XML: `<channel source="cast:main" branch="clair-private" author="jon">message</channel>`
- Claude sees it as a user message, wakes from sleep

### Outbound (Clair → Cast)
MCP tools exposed to Claude:

| Tool | Description |
|------|-------------|
| `cast_post` | Post to a branch |
| `cast_reply` | Reply to a thread |
| `cast_react` | React to a post |
| `cast_read` | Read recent posts from a branch |
| `cast_search` | Search across branches |

### Permission Relay
- When Claude needs approval (e.g., "allow Write to production.yaml?"), Clair posts to the private branch with a 5-letter code
- You reply on Cast: "yes tbxkq"
- MCP server parses the reply, emits `notifications/claude/channel/permission`
- 5-letter alphabet: a-z minus 'l', profanity-filtered

### Multi-branch
- Configure which branches to monitor in `~/.clair/config.json`
- Private branch for direct agent comms (push notifications to your phone)
- Optional: monitor other branches, respond when mentioned

### Cast MCP Server capabilities declaration
```json
{
  "experimental": {
    "claude/channel": {},
    "claude/channel/permission": {}
  }
}
```

## Layer 4: Remote Triggers

Deferred — this layer in CC uses the claude.ai `/v1/code/triggers` API which requires server-side infrastructure. For v1 of Clair, the local cron scheduler (layer 2) covers the use case. Remote triggers can be added later if we want to fire tasks from external webhooks (GitHub Actions, Cast webhooks, etc.).

## Layer 5: Terminal UI (Brief Mode)

Claude communicates through a `SendUserMessage` tool rather than raw stdout.

- **Normal replies**: `status: 'normal'` — responding to something you said
- **Proactive updates**: `status: 'proactive'` — agent-initiated (task finished, blocker found, needs input)
- **Terminal display**: show brief messages prominently, collapse tool call details
- **Cast forwarding**: proactive messages also post to the Cast private branch (so you get push notifications on your phone even when away from the terminal)

## Project Structure

```
clair/
├── src/
│   ├── index.ts              # entry point, CLI arg parsing
│   ├── engine/
│   │   ├── conversation.ts   # drives claude subprocess
│   │   ├── tick.ts           # tick loop + sleep management
│   │   ├── queue.ts          # priority message queue
│   │   └── focus.ts          # terminal focus detection
│   ├── scheduler/
│   │   ├── cron.ts           # cron parser + scheduler
│   │   ├── persistence.ts    # durable task storage
│   │   └── types.ts
│   ├── channels/
│   │   ├── host.ts           # MCP host (spawns channel servers)
│   │   ├── protocol.ts       # channel notification types
│   │   └── permissions.ts    # 5-letter code generation + matching
│   ├── cast/
│   │   ├── server.ts         # Cast Channel MCP Server (stdio)
│   │   ├── poller.ts         # polls Cast CLI for new messages
│   │   ├── tools.ts          # cast_post, cast_reply, etc.
│   │   └── types.ts
│   ├── ui/
│   │   ├── terminal.ts       # brief mode display
│   │   └── status.ts         # status line
│   └── config/
│       ├── settings.ts       # ~/.clair/config.json
│       └── prompts.ts        # system prompts (proactive, brief)
├── docs/
│   └── plans/
├── package.json
├── tsconfig.json
├── bunfig.toml
└── CLAUDE.md
```

## Config

```json
// ~/.clair/config.json
{
  "tickIntervalMs": 30000,
  "cast": {
    "branches": ["clair-private"],
    "pollIntervalMs": 5000,
    "privateBranch": "clair-private",
    "forwardProactive": true
  },
  "scheduler": {
    "maxJobs": 50,
    "tasksFile": "~/.clair/scheduled_tasks.json"
  }
}
```

## System Prompt (Proactive Mode)

Adapted from CC's `getProactiveSection()`:

```
You are Clair, an autonomous agent. You will receive `<tick>` prompts that
keep you alive between turns — treat them as "you're awake, what now?"

Use Sleep to control pacing. Each wake-up costs an API call.
If you have nothing useful to do on a tick, you MUST call Sleep.

Channel messages from Cast arrive as <channel> tags. Reply using the
cast_post or cast_reply tools. The user gets push notifications on Cast.

Terminal focus:
- Unfocused: lean into autonomous action
- Focused: be collaborative, surface choices

Bias toward action. Read files, run commands, make changes.
Keep text output brief — decisions, milestones, blockers only.
```

## Build Order

1. **Engine** — conversation driver + tick loop (the foundation)
2. **Queue** — priority message queue with wake triggers
3. **Cast MCP Server** — inbound polling + outbound tools
4. **Channel Host** — spawn + manage the Cast MCP server process
5. **Scheduler** — cron with durable persistence
6. **Terminal UI** — brief mode display
7. **Permissions** — 5-letter code relay through Cast
8. **Config** — settings file, CLI args
