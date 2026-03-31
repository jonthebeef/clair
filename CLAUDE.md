# Clair

Autonomous AI agent — KAIROS clone. Bun/TypeScript.

## Dev commands
- `bun run start` — launch clair
- `bun test` — run tests

## Architecture
- `src/engine/` — conversation driver, tick loop, message queue
- `src/scheduler/` — cron-based task scheduling
- `src/channels/` — MCP host for channel servers
- `src/cast/` — Cast channel MCP server (wraps Cast CLI)
- `src/ui/` — terminal display
- `src/config/` — settings and system prompts

## Conventions
- No classes unless necessary — prefer functions and plain objects
- Types in the same file unless shared across modules
- Tests next to source: `foo.test.ts` beside `foo.ts`
