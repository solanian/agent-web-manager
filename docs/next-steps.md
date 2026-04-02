# Next Steps

## High-priority follow-ups

1. Native provider session continuity
   - Replace transcript re-injection with provider-native resume/session APIs where possible.
   - Codex: evaluate thread/session persistence and structured event replay.
   - Claude Code: evaluate print/stream-json plus resumable session integration.

2. Real provider model discovery
   - Query actual installed/available models instead of static fallback lists.
   - Kimi model list is currently not populated dynamically.
   - Claude aliases (`sonnet`, `opus`) should be normalized or clearly labeled.

3. Provider-native command execution parity
   - The slash-command list is now discoverable, but execution semantics still use local session handlers for `/model`, `/effort`, `/thinking`.
   - Provider/plugin-native command dispatch should be wired more faithfully when possible.

4. Reasoning / thinking panel
   - Add provider-aware reasoning summary display.
   - Prefer summaries over raw chain-of-thought.
   - Codex should use supported reasoning metadata where available.

5. Claude/Codex command filtering
   - Claude command discovery currently includes internal plugin/cache markdown files.
   - Filter hidden/internal phase docs and deduplicate aliases for cleaner UX.

## Medium-priority follow-ups

6. Session-to-session communication
   - Add explicit session handoff/send/share workflow between open sessions.

7. File upload parity
   - Session file upload API is still stubbed in the frontend.
   - Add backend/frontend-server upload endpoint passthrough and UI parity.

8. Fork/resume parity
   - `forkSession` is still stubbed in the frontend/session layer.
   - Implement provider-agnostic fork semantics or native provider resume/fork.

9. Provider-aware defaults in UI
   - Separate "provider default" display from user-overridden values more clearly.
   - Show whether the current session is inheriting defaults or using explicit overrides.

10. Security & auth hardening
   - Add backend auth token enforcement for multi-machine/LAN deployments.
   - Add safer remote-server registration flow.

## Nice-to-have

11. Better branding assets
   - Replace reused Kimi visual assets with fully distinct product assets.

12. E2E browser tests
   - Add Playwright coverage for session creation, slash menu discovery, and provider option updates.
