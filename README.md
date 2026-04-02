# Agent Web Manager

Unified multi-backend agent console built from a Kimi-style web UI base.

## What it does

- **Backend server**: runs locally next to installed agent CLIs and exposes a unified session/chat API.
- **Frontend server**: serves the Agent Web Manager UI, stores backend registrations, aggregates sessions, and proxies websocket/chat traffic.
- **Providers**: Codex, Claude Code, and Kimi CLI.
- **Multi-server**: one frontend can connect to multiple backend servers.

## Current architecture

- `apps/backend` — provider adapter server
- `apps/frontend` — Agent Web Manager React UI
- `apps/frontend-server` — registry + aggregation/proxy server
- `packages/shared` — shared types and helpers

## Current provider integration model

- Session context is currently preserved by the manager layer and re-injected into each provider turn.
- This means **session context is maintained in this app**, but **provider-native session resume/fork semantics are not yet fully implemented**.
- Codex and Claude Code are currently integrated through local CLI subprocess execution.

## Current provider defaults

Observed local defaults on this machine:

- **Codex**
  - model: `gpt-5.4`
  - reasoning effort: `high`
- **Claude Code**
  - model fallback used by this app: `claude-sonnet-4-6`
  - effort fallback used by this app: `medium`

## Run

```bash
npm install
npm run build --workspaces

# terminal 1
npm run start:backend

# terminal 2
npm run start:frontend-server
```

Open the frontend at:

```bash
http://127.0.0.1:3000
```

If you want LAN access, set explicit host/ports, for example:

```bash
AWM_BACKEND_HOST=0.0.0.0 AWM_BACKEND_PORT=18887 npm run start:backend
AWM_FRONTEND_HOST=0.0.0.0 AWM_FRONTEND_PORT=13000 AWM_DEFAULT_BACKEND_URL=http://127.0.0.1:18887 npm run start:frontend-server
```

## Environment variables

### Backend

- `AWM_BACKEND_HOST`
- `AWM_BACKEND_PORT`
- `AWM_BACKEND_DATA_DIR`
- `AWM_CODEX_COMMAND`
- `AWM_CODEX_ARGS_JSON`
- `AWM_CLAUDE_COMMAND`
- `AWM_CLAUDE_ARGS_JSON`
- `AWM_KIMI_COMMAND`
- `AWM_KIMI_ARGS_JSON`

Default command templates:

- Codex:
  - `codex exec --skip-git-repo-check --dangerously-bypass-approvals-and-sandbox "$PROMPT"`
- Claude:
  - `claude -p --dangerously-skip-permissions "$PROMPT"`
- Kimi:
  - `kimi --print --prompt "$PROMPT"`

### Frontend server

- `AWM_FRONTEND_HOST`
- `AWM_FRONTEND_PORT`
- `AWM_FRONTEND_DATA_DIR`
- `AWM_FRONTEND_STATIC_DIR`
- `AWM_DEFAULT_BACKEND_URL`

## UI behavior

- The chat footer reuses the original Kimi-style model control area.
- Session-scoped provider options currently supported in the UI:
  - Codex: model / effort / thinking
  - Claude Code: model / effort
  - Kimi: thinking
- Slash menu discovery now includes locally installed Codex skills and Claude plugin commands/skills.

## Verification

```bash
npm run lint --workspaces
npm run typecheck --workspaces
npm run test --workspaces
npm run build --workspaces
```

## Additional recorded work

See [`docs/next-steps.md`](./docs/next-steps.md) for follow-up items and recommended next implementation targets.

## Upstream references

This project was built with direct reference to the following upstream repositories:

- Kimi CLI Web UI base:
  - https://github.com/MoonshotAI/kimi-cli
- OpenAI Codex CLI:
  - https://github.com/openai/codex
- Anthropic Claude Code:
  - https://github.com/anthropics/claude-code

Agent Web Manager is an independent integration layer and is **not** an official product of MoonshotAI, OpenAI, or Anthropic.
