# Project Agent Memory

This directory is the project-owned memory layer for Agent Web Manager.

It intentionally follows the agentic-stack style: memory lives inside the
project under `.agent/memory/`, so it can travel with the project instead of
being locked inside the local backend runtime database.

Layer files:

- `working/memories.jsonl` — short-lived continuity and active task context.
- `episodic/memories.jsonl` — prior cases, failures, and task episodes.
- `semantic/memories.jsonl` — durable project facts and decisions.
- `procedural/memories.jsonl` — conventions, rules, and repeated workflows.
- `personal/memories.jsonl` — user/project preferences.
- `review/memories.jsonl` — system-captured candidates awaiting confirmation.

The backend still mirrors these files into `.data/backend/awm.db` for fast
querying and UI aggregation, but these JSONL files are the portable project
artifact.
