# PRD: Agent Web Manager Multi-Backend UI

## Summary
Build a web application that keeps Kimi CLI's web UI look-and-feel while adding support for Codex and Claude Code through a unified architecture. The system must be split into a backend server and a frontend server. A single frontend server must connect to multiple backend servers and let users work across all registered servers from one UI.

## Goals
1. Reuse Kimi CLI Web UI structure and styling as the primary frontend baseline.
2. Introduce a backend server that manages local CLI providers via a unified session API.
3. Introduce a frontend server that stores backend registrations, aggregates sessions, and proxies chat/session APIs to multiple backends.
4. Support at least Codex and Claude Code providers, with Kimi support retained or easily pluggable.
5. Make the provider/server visible in the UI during session creation and browsing.

## Non-goals
- Perfect wire-protocol parity with Kimi's native backend internals.
- Full reproduction of every advanced provider-specific tool/reasoning event.
- Cloud deployment automation.

## Users / Stories
### US-001 Backend operator
As a developer, I want to run a local backend server near the CLIs installed on that machine so that a frontend can connect remotely.
- Acceptance:
  - backend server starts independently
  - exposes health + session APIs
  - supports configurable provider command templates

### US-002 Frontend operator
As a developer, I want one frontend server to register multiple backend servers so that I can access sessions from several machines or environments in one UI.
- Acceptance:
  - add/list/remove backend servers
  - aggregate session lists across backends
  - create a session targeting a chosen backend + provider

### US-003 End user chat flow
As a user, I want to chat with Codex or Claude from the Kimi-like interface so that I can use familiar UI across tools.
- Acceptance:
  - select/open/create sessions in the Kimi-derived UI
  - send prompts and receive streamed assistant output
  - session list shows backend server/provider metadata

## Architecture Decision
- Use a TypeScript workspace.
- `backend-server`: Node HTTP + WebSocket service with provider adapters and local JSON persistence.
- `frontend-server`: Node HTTP + WebSocket proxy/aggregator serving the React app and routing API calls to registered backends.
- `frontend`: Kimi-derived React/Vite app adapted to the unified manager schema.
- `shared`: common types/event schema.

## Provider Strategy
- Claude and Kimi: use print/stream-json when available.
- Codex: use a pluggable adapter with default non-interactive command execution and stdout streaming fallback.
- Tests rely on fixture CLIs that emit deterministic events.

## Risks
- Different CLI output formats require adapter-specific parsing.
- Some Kimi UI affordances may need graceful degradation.
- Multi-server websocket proxying needs careful mapping.

## Validation
- automated tests for backend adapters/session streaming and frontend aggregation/proxying
- frontend build and typecheck
- workspace lint/typecheck/test
