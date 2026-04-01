# Clair

An autonomous AI agent that lives in your terminal. Drives Claude Code as its brain, talks to you via [Cast](https://cast.claudecodecurious.com), runs scheduled tasks, and manages its own state.

Built in TypeScript on Bun, replicating the 5-layer KAIROS architecture from Claude Code.

## How it works

Clair spawns Claude Code as a subprocess and keeps it alive with a tick loop. Between ticks, Claude controls her own pacing via a Sleep tool — sleeping longer when idle, waking instantly when you message her on Cast. She detects whether you're watching the terminal and adjusts: collaborative when focused, fully autonomous when you walk away.

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
│  │ prompts   │  │ persist   │  │  │             │ │ │
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
│  │ Status bar    │                                   │
│  └──────────────┘                                   │
└─────────────────────────────────────────────────────┘
```

## Prerequisites

- [Bun](https://bun.sh) 1.3+
- [Claude Code](https://docs.anthropic.com/en/docs/claude-code) CLI installed and authenticated
- A [Cast](https://cast.claudecodecurious.com) account with an API token (for channel integration)

## Setup

```bash
git clone https://github.com/jonthebeef/clair.git
cd clair
bun install
```

Create a Cast API config at `~/.clair-castrc`:

```json
{
  "apiUrl": "https://cast.claudecodecurious.com/api/v1",
  "token": "your-cast-api-token"
}
```

## Usage

```bash
bun run start                          # launch clair
bun run start -- --skip-permissions    # skip permission checks (dangerous)
bun run start -- --no-cast             # run without Cast integration
bun run start -- --model sonnet        # use a specific model
bun run start -- --config ./my.json    # custom config file
```

### CLI flags

| Flag | Description |
|------|-------------|
| `-h, --help` | Show help |
| `-v, --version` | Show version |
| `-m, --model <model>` | Claude model (default: from config) |
| `-c, --config <path>` | Config file path (default: `~/.clair/config.json`) |
| `--skip-permissions` | Skip permission checks |
| `--no-cast` | Disable Cast channel integration |
| `--new-session` | Start fresh instead of resuming previous session |

## Configuration

Config lives at `~/.clair/config.json` (created on first run):

```json
{
  "tickIntervalMs": 30000,
  "cast": {
    "branches": ["clair-private"],
    "pollIntervalMs": 3000,
    "privateBranch": "clair-private",
    "forwardProactive": true,
    "mentionOnlyBranches": [],
    "username": "clair"
  },
  "scheduler": {
    "maxJobs": 50
  },
  "triggers": {
    "enabled": false,
    "port": 4117
  }
}
```

| Setting | Description |
|---------|-------------|
| `tickIntervalMs` | Default tick interval (ms). Claude adjusts this via Sleep. |
| `cast.branches` | Which Cast branches to monitor |
| `cast.pollIntervalMs` | How often to poll Cast for new messages |
| `cast.privateBranch` | Private branch for direct comms and permission codes |
| `cast.forwardProactive` | Auto-post Clair's text responses to Cast |
| `cast.mentionOnlyBranches` | Branches where Clair only responds to @mentions |
| `cast.username` | Clair's Cast username for @mention detection |
| `scheduler.maxJobs` | Max concurrent scheduled tasks |
| `triggers.enabled` | Enable webhook trigger server |
| `triggers.port` | Port for trigger server (default: 4117) |
| `triggers.secret` | Optional shared secret for webhook auth |

## Architecture

| Layer | Directory | Description |
|-------|-----------|-------------|
| Tick Engine | `src/engine/` | Conversation driver, tick loop, message queue, terminal focus detection |
| Scheduler | `src/scheduler/` | Cron-based task scheduling with durable persistence |
| Channels | `src/channels/` | Channel protocol, permission code generation, permission relay |
| Cast | `src/cast/` | Cast MCP server (stdio), API-based polling, outbound tools |
| Terminal UI | `src/ui/` | Structured output formatting, persistent status bar |
| Config | `src/config/` | Settings and system prompts |

### Key features

- **Sleep tool** — Claude controls her own tick pacing via MCP. Idle = 5-10 min sleeps. Active = 30s.
- **Cast integration** — bidirectional messaging. Post, reply, react, read, search. Push notifications on your phone.
- **Terminal focus detection** — macOS `lsappinfo` checks if your terminal is frontmost. Away = autonomous. Watching = collaborative.
- **Permission relay** — dangerous actions post a 5-letter approval code to Cast. Reply "yes tbxkq" from your phone.
- **Status bar** — persistent bottom-of-terminal line showing mode, focus, Cast connection, last activity.
- **Cron scheduler** — durable tasks that survive restarts. Standard 5-field cron expressions. Claude can create tasks via MCP tools.
- **Cast forwarding** — Clair's text responses auto-post to your private Cast branch.
- **Session persistence** — conversation survives restarts via Claude Code's `--resume`. Session ID saved to `~/.clair/session.json`.
- **Cost tracking** — token usage and dollar cost displayed in the status bar. Summary on shutdown.
- **Remote triggers** — HTTP webhook server accepts POST requests to inject prompts. Wire up GitHub Actions, Cast webhooks, etc.
- **Multi-branch** — monitor multiple Cast branches. @mention filtering on public branches.

### Remote triggers

Enable in config (`"triggers": { "enabled": true }`), then POST to inject prompts:

```bash
curl -X POST http://localhost:4117/trigger \
  -H "Content-Type: application/json" \
  -d '{"prompt": "deploy failed — check logs", "source": "github"}'
```

With auth: set `triggers.secret` in config, then pass `Authorization: Bearer <secret>` header.

## Tests

```bash
bun test
```

Tests live next to source files: `foo.test.ts` beside `foo.ts`.

## License

MIT
