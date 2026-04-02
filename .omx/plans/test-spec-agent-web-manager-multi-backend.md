# Test Spec: Agent Web Manager Multi-Backend UI

## Verification targets
1. Shared schemas typecheck and validate payloads.
2. Backend server can create/list/delete sessions and stream responses using fixture CLI providers.
3. Frontend server can register multiple backend servers, aggregate sessions, and proxy create/send/stream operations.
4. Frontend app builds successfully against the new API.

## Planned tests
### Backend
- provider adapter unit tests
  - Claude/Kimi stream-json fixture is parsed into assistant deltas/final message
  - Codex stdout fixture is surfaced as streaming text
- session service tests
  - create/list/update/delete session persistence
  - send message transitions status idle -> busy -> idle/error
- backend API integration
  - health endpoint
  - session CRUD
  - websocket stream emits history/status/chat events

### Frontend server
- registry tests
  - add/list/remove backend server configs
- aggregation tests
  - merged sessions include server/provider metadata
  - create session forwards to selected backend
- websocket proxy tests
  - frontend stream endpoint relays target backend events

### Frontend app
- TypeScript build passes
- minimal component test or smoke test for multi-server session labeling if practical

## Commands to run before completion
- install dependencies
- workspace lint
- workspace typecheck
- workspace test
- frontend build
