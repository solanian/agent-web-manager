# AWM C-1: First Collaboration — Implementation Handoff Spec v1.0

> 본 문서는 AWM v0.4 기획서의 **수직 슬라이스 C-1 ("첫 협업")** 을 다른 에이전트 세션이 이어받아 구현할 수 있도록 작성된 명세서다. v0.4 자체의 모든 기능을 다루지 않고, 첫 협업이 발생하는 데 필요한 최소 표면만 정의한다.
>
> **상위 문서**: `AWM_Orchestration_Spec_v0.4.md`
> **본 문서가 정의하는 것**: 요구사항(FR/NFR), 데이터 스키마, REST/WS API, Adapter Protocol, 사용자 플로우, 상태머신, 구현 순서 및 노트.
> **본 문서가 정의하지 않는 것**: 코드 자체, 파일별 구현, UI 픽셀 디자인.

---

## 0. 메타데이터

- **버전**: 1.0
- **상위 스펙**: AWM Orchestration Spec v0.4
- **슬라이스 ID**: C-1
- **목표**: AWM에서 두 에이전트 세션이 처음으로 협업하는 종단 경로를 동작시킨다. v0.4 thesis(emergent collaboration)의 살아있는 증명물.
- **타겟 사용자**: 본 문서를 입력으로 받은 구현 에이전트(Claude Code, Codex 등) 또는 사람 개발자.

---

## 1. 범위 (Scope)

### 1.1 In Scope — 본 슬라이스가 구현해야 하는 것

| 영역 | 구현 범위 |
|---|---|
| **Project** | 생성 / 조회 / 목록. 필드는 id, name, mission만. 정책·예산 없음. |
| **Workspace** | 폴더 경로 등록 + Project 연결. git worktree·격리 없음. 단순 read-only path. |
| **Session** | 생성 / 메시지 송수신 / 스트리밍 / 상태 전환. Project·Workspace 필수. Plays·Artifacts 없음. |
| **Adapter Protocol** | 본 문서 §6에 정의된 최소 인터페이스. Codex와 Claude Code 어댑터 2개 구현. |
| **Inline Consult** | 세션 안에서 `/?<provider> <question>` 명령 파싱 → Spec 자동 생성 → 미리보기 → 발송 → 응답 인라인 표시. |
| **Link** | kind=consult만. 본 문서 §7에 정의된 상태머신. Spec/Report 페이로드 저장. |
| **자동 to-session 생성** | consult 발송 시 to_session이 없으면 자동으로 빈 세션 생성, Spec을 첫 메시지로 inject. |
| **Graph (minimal)** | 노드(세션) + 간선(링크) 목록 표시. 간선 클릭 시 Spec/Report 내용 패널. 그래프 시각화는 SVG 1차 구현으로 충분. |
| **Persistence** | SQLite 단일 파일 DB. 마이그레이션은 startup time 자동 실행. |

### 1.2 Out of Scope — 본 슬라이스에서 명시적으로 제외

| 영역 | 사유 |
|---|---|
| Plays | C-1에 불필요. Spec은 자동 생성. |
| Session Artifacts | 협업 자체와 직교. |
| Budget Enforcement | 단일 세션 단일 협업이라 의미 없음. |
| Policy / Policy Override | 발송 게이트는 사용자 검토(미리보기)로 충분. |
| Git Worktree, Workspace 격리 | Workspace는 경로만. |
| Watcher Sessions | 자율 트리거 불필요. |
| MCP 통합 | 도구 호출 없이 텍스트만으로 협업 증명. |
| Rollback | 단발 협업이라 불필요. |
| Mobile Inbox, Weekly Retro | UI 영역 외. |
| handoff / review / compare / fork-of 링크 kind | consult 하나만 우선. |
| 다중 clarification round | 1라운드(질문→답변)만 지원. |
| Cost / Token 추적 | metrics 필드는 자리만 잡고 값은 0 허용. |
| 사용자 인증 | owner는 단일 사용자 가정, 'local'로 하드코딩. |
| 다중 동시 사용자 | 단일 사용자 단일 인스턴스. |

### 1.3 Deferred — 다음 슬라이스에서 다룰 항목

- C-2(안전한 단독 작업): Workspace git worktree, Policy, Budget enforcement.
- M4: Plays.
- M5: Session Artifacts.
- M6 후반: handoff / review 링크 kind.
- M7~: Graph 고급 시각화, 시간축 재생.

---

## 2. 사용자 플로우 (Happy Path)

다음 플로우 전체가 동작해야 본 슬라이스가 완료된 것이다.

```
[Step 1] 사용자가 새 Project 생성
  - UI: "+ New Project" 버튼
  - 입력: name="Quadie Refactor", mission="Refactor driving_state_manager for testability"
  - 결과: project_id 발급

[Step 2] Workspace 등록
  - UI: Project Detail 화면 → "Add Workspace"
  - 입력: path="/Users/dennis/quadie"
  - 결과: workspace_id 발급, project에 연결

[Step 3] Codex 세션 시작
  - UI: Project Detail → "New Session"
  - 입력: provider="codex", workspace=quadie, title="Refactor planning", goal="Plan the refactor"
  - 결과: session_id 발급, status=active
  - 백엔드: Adapter.start() 호출, native session 생성, project mission이 system context로 inject

[Step 4] 사용자가 세션에서 Codex와 작업
  - 일반 메시지 송수신, 스트리밍 표시
  - Codex가 코드 분석 응답

[Step 5] 인라인 consult 발사
  - 사용자가 입력창에 "/?claude 이 driving_state_manager 리팩터링 접근에 대해 어떻게 생각해?" 타이핑 후 Enter
  - 프론트엔드: 명령 파싱 → POST /sessions/:id/consult/draft
  - 백엔드: Codex 세션의 직전 N=10 메시지를 자동 요약(간단한 truncate or LLM summary), Spec consult body 생성
  - 응답: 미리보기 Spec markdown 반환

[Step 6] 1초 미리보기
  - UI: 모달 또는 인라인 카드로 Spec 표시 (마크다운 렌더)
  - 키 바인딩: Enter=발송, Esc=편집모드, X=취소
  - 1초 후 자동 포커스이지만 자동 발송은 절대 없음

[Step 7] 발송
  - 사용자 Enter
  - POST /links/:draft_id/send
  - 백엔드:
    a. 새 Claude 세션 자동 생성 (provider=claude, workspace=같은 것, title="Consult from <from_session>")
    b. Adapter(claude).start()
    c. Adapter(claude).inject_spec(spec_markdown)
    d. Link 상태: drafting → awaiting_user_send → sent → in_progress
  - WS 이벤트: link.sent

[Step 8] Claude 응답 생성
  - Claude 세션이 spec을 첫 메시지로 받고 응답 생성 시작
  - WS 이벤트: report.draft_ready (Adapter가 done 시점에 발생)
  - Link 상태: in_progress → report_ready → awaiting_user_merge

[Step 9] 사용자 검토 및 인라인 표시
  - 원본 Codex 세션 화면에 인라인 카드: "Claude 응답 도착 (검토)"
  - 클릭 시 Report markdown 표시
  - "Merge" 클릭 시:
    a. POST /links/:id/merge
    b. Link 상태: awaiting_user_merge → completed
    c. Report 본문이 Codex 세션의 메시지 스트림에 시스템 메시지로 삽입 (작성자: "consult-claude")
    d. Codex 세션은 이 메시지를 정상 컨텍스트로 받아 작업 계속

[Step 10] Graph 확인
  - 사용자가 사이드바 "Graph" 클릭
  - 화면: 노드 2개(Codex 세션, Claude 세션), 간선 1개(consult, completed)
  - 간선 클릭 시 우측 패널에 Spec + Report 마크다운 표시
```

### 2.1 Sad Paths — 처리해야 하는 비정상 케이스

| 케이스 | 동작 |
|---|---|
| `/?<provider>`의 provider가 등록 안 된 어댑터 | 입력창에 빨간 에러 토스트, draft 생성 안 함 |
| Spec 미리보기 단계에서 사용자가 X 취소 | draft Link 삭제, 세션 변화 없음 |
| Adapter.start() 실패 | Link 상태 → cancelled, 사용자에게 에러 표시, 원본 세션 영향 없음 |
| Adapter.inject_spec() 실패 | Link 상태 → cancelled, to_session도 archived |
| Claude가 응답 중 에러 | Link 상태 → cancelled with error_message, to_session 상태 → archived |
| 사용자가 Merge 안 하고 그냥 떠남 | Link는 awaiting_user_merge로 무한 대기. 다음 진입 시 Inbox에 카드 |
| 사용자가 Report Reject | Link 상태 → rejected, 원본 세션에 아무 메시지 삽입 안 됨 |

---

## 3. 기능 요구사항 (Functional Requirements)

### 3.1 Project
- **FR-PRJ-001**: 사용자는 Project를 생성할 수 있다. 필수 필드: name. 선택: mission.
- **FR-PRJ-002**: 사용자는 Project 목록을 조회할 수 있다.
- **FR-PRJ-003**: 사용자는 특정 Project의 상세를 조회할 수 있다 (연결된 workspaces, sessions 포함).
- **FR-PRJ-004**: Project mission은 모든 자식 세션의 시스템 컨텍스트에 자동 주입된다.

### 3.2 Workspace
- **FR-WS-001**: 사용자는 Project에 Workspace(폴더 경로)를 등록할 수 있다.
- **FR-WS-002**: Workspace 경로는 등록 시 존재 확인. 존재하지 않으면 거부.
- **FR-WS-003**: 한 Project에 여러 Workspace 등록 가능.

### 3.3 Session
- **FR-SES-001**: 사용자는 Project + Workspace + Provider + Title을 지정해 Session을 생성할 수 있다.
- **FR-SES-002**: Session 생성 시 백엔드는 해당 Provider Adapter의 `start()`를 호출한다.
- **FR-SES-003**: Session 생성 시 Project mission이 Adapter에 시스템 컨텍스트로 전달된다.
- **FR-SES-004**: 사용자는 Session에 메시지를 보낼 수 있다.
- **FR-SES-005**: Adapter의 모든 이벤트(text_delta, tool_call, ...)는 WebSocket으로 프론트엔드에 스트리밍된다.
- **FR-SES-006**: Session 상태는 §5에 정의된 상태머신을 따른다.
- **FR-SES-007**: Session 메시지 히스토리는 영속화된다 (재접속 시 복원 가능).

### 3.4 Adapter Protocol
- **FR-ADP-001**: 어댑터는 §6에 정의된 인터페이스를 구현해야 한다.
- **FR-ADP-002**: Built-in 어댑터로 Codex와 Claude Code가 제공된다.
- **FR-ADP-003**: 어댑터는 native session API를 우선 사용한다. 불가 시 CLI exec fallback 허용.
- **FR-ADP-004**: 어댑터는 `inject_spec(session_id, spec_markdown)`을 통해 외부 Spec 메시지를 자기 세션에 주입할 수 있어야 한다.
- **FR-ADP-005**: 어댑터는 `request_report(session_id)`를 통해 현재 세션의 응답을 Report markdown 형태로 추출할 수 있어야 한다 (가장 단순한 구현: 마지막 assistant 메시지를 그대로 반환).

### 3.5 Inline Consult
- **FR-IC-001**: Session 입력창에서 `/?<provider> <question>` 형식의 명령은 일반 메시지가 아닌 consult draft 요청으로 파싱된다.
- **FR-IC-002**: provider 값은 등록된 어댑터의 키와 매칭되어야 한다.
- **FR-IC-003**: 백엔드는 Spec consult body를 자동 생성한다. 본문에는 (a) 사용자의 question, (b) 직전 N=10 메시지의 자동 요약(또는 truncate), (c) 현재 워크스페이스 경로, (d) 현재 세션 goal이 포함된다.
- **FR-IC-004**: 자동 생성된 Spec은 사용자에게 미리보기로 노출되며, 사용자 명시적 발송 전에는 to_session이 생성되지 않는다.
- **FR-IC-005**: 사용자는 미리보기에서 발송 / 편집 / 취소를 선택할 수 있다.
- **FR-IC-006**: 자동 발송은 어떤 경우에도 발생하지 않는다.

### 3.6 Link
- **FR-LNK-001**: consult 발송 시 Link 객체가 생성되며, kind=consult, status는 §7 상태머신을 따른다.
- **FR-LNK-002**: to_session_id가 발송 시점에 null이면 백엔드가 자동으로 새 Session을 생성한다.
- **FR-LNK-003**: 생성된 to_session은 from_session과 같은 Workspace를 사용한다.
- **FR-LNK-004**: 발송 직후 Adapter(to).inject_spec(spec.body)가 호출된다.
- **FR-LNK-005**: to_session이 응답을 완료하면(adapter done 이벤트) Report가 자동 생성되어 Link에 attach된다.
- **FR-LNK-006**: Report는 사용자 Merge 전까지 from_session에 노출되지 않는다.
- **FR-LNK-007**: Merge 시 Report 본문이 from_session의 메시지 스트림에 시스템 메시지로 삽입된다.

### 3.7 Graph
- **FR-GRPH-001**: 사용자는 Graph 화면에서 Session(노드)과 Link(간선)를 시각적으로 볼 수 있다.
- **FR-GRPH-002**: 노드 색은 provider를 구분한다.
- **FR-GRPH-003**: 간선 클릭 시 우측 패널에 해당 Link의 Spec과 Report 마크다운이 표시된다.
- **FR-GRPH-004**: 최소 시각화는 SVG 직접 구현 또는 d3-force 같은 단순 라이브러리로 충분.
- **FR-GRPH-005**: Graph는 Project 필터를 지원한다.

---

## 4. 비기능 요구사항 (Non-Functional Requirements)

| ID | 항목 | 요구사항 |
|---|---|---|
| NFR-001 | 응답성 | 메시지 송신 후 첫 token이 도착하기까지 어댑터 자체 지연을 제외하고 200ms 이내. |
| NFR-002 | 스트리밍 안정성 | WS 연결 끊김 시 재접속 후 메시지 인덱스 기반 catchup 가능해야 함. |
| NFR-003 | 영속성 | 프로세스 재시작 후 모든 Project/Workspace/Session/Link/Message가 복원되어야 함. |
| NFR-004 | 동시성 | 단일 사용자 가정. 동시성 보호는 sqlite WAL 모드로 충분. |
| NFR-005 | 에러 가시성 | 모든 Adapter 에러는 사용자에게 토스트로 표시되고 trace에 로깅된다. |
| NFR-006 | 빌드 / 실행 | `npm install && npm run build && npm run start`로 단일 명령 실행 가능해야 한다. |
| NFR-007 | 플랫폼 | macOS, Linux. Windows는 best-effort. |
| NFR-008 | 의존성 | 본 슬라이스에 새 외부 서비스 의존 추가 금지 (DB는 SQLite 파일). |

---

## 5. 데이터 스키마

본 슬라이스에서 영속화되는 모든 객체. SQLite 기준 컬럼 + TypeScript 타입을 함께 명시.

### 5.1 Project

```typescript
interface Project {
  id: string;              // 'prj_' + nanoid(12)
  name: string;            // 1~100자
  mission: string | null;  // markdown, 0~5000자
  created_at: string;      // ISO 8601
  owner: string;           // 'local' (하드코딩)
}
```

```sql
CREATE TABLE projects (
  id           TEXT PRIMARY KEY,
  name         TEXT NOT NULL,
  mission      TEXT,
  created_at   TEXT NOT NULL,
  owner        TEXT NOT NULL DEFAULT 'local'
);
CREATE INDEX idx_projects_owner ON projects(owner);
```

### 5.2 Workspace

```typescript
interface Workspace {
  id: string;              // 'ws_' + nanoid(12)
  project_id: string;
  path: string;            // absolute path
  kind: 'folder';          // 본 슬라이스는 folder만, git은 향후
  created_at: string;
}
```

```sql
CREATE TABLE workspaces (
  id           TEXT PRIMARY KEY,
  project_id   TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  path         TEXT NOT NULL,
  kind         TEXT NOT NULL DEFAULT 'folder',
  created_at   TEXT NOT NULL
);
CREATE INDEX idx_workspaces_project ON workspaces(project_id);
```

### 5.3 Session

```typescript
interface Session {
  id: string;              // 'sess_' + nanoid(12)
  project_id: string;
  workspace_id: string;
  title: string;
  goal: string | null;
  provider: string;        // 'codex' | 'claude' | 'kimi'
  model: string | null;    // adapter가 결정. null이면 adapter 디폴트
  status: SessionStatus;
  adapter_session_id: string | null;  // adapter가 발급한 native session id
  created_at: string;
  updated_at: string;
  owner: string;
}

type SessionStatus =
  | 'starting'                  // adapter.start() 진행 중
  | 'active'                    // 정상
  | 'awaiting_link_response'    // consult 발사 후 응답 대기
  | 'archived'
  | 'failed';
```

```sql
CREATE TABLE sessions (
  id                  TEXT PRIMARY KEY,
  project_id          TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  workspace_id        TEXT NOT NULL REFERENCES workspaces(id),
  title               TEXT NOT NULL,
  goal                TEXT,
  provider            TEXT NOT NULL,
  model               TEXT,
  status              TEXT NOT NULL,
  adapter_session_id  TEXT,
  created_at          TEXT NOT NULL,
  updated_at          TEXT NOT NULL,
  owner               TEXT NOT NULL DEFAULT 'local'
);
CREATE INDEX idx_sessions_project ON sessions(project_id);
CREATE INDEX idx_sessions_status ON sessions(status);
```

### 5.4 Message

```typescript
interface Message {
  id: string;              // 'msg_' + nanoid(12)
  session_id: string;
  seq: number;             // 세션 내 순번 (1부터)
  role: 'user' | 'assistant' | 'system' | 'consult-result';
  content: string;         // markdown
  metadata: Record<string, unknown> | null;  // 어댑터별 부가 정보
  created_at: string;
}
```

```sql
CREATE TABLE messages (
  id           TEXT PRIMARY KEY,
  session_id   TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  seq          INTEGER NOT NULL,
  role         TEXT NOT NULL,
  content      TEXT NOT NULL,
  metadata     TEXT,  -- JSON
  created_at   TEXT NOT NULL,
  UNIQUE(session_id, seq)
);
CREATE INDEX idx_messages_session_seq ON messages(session_id, seq);
```

### 5.5 Link

```typescript
interface Link {
  id: string;              // 'lnk_' + nanoid(12)
  from_session_id: string;
  to_session_id: string | null;       // 발송 시점에 NOT NULL
  kind: 'consult';                    // C-1은 consult만
  status: LinkStatus;
  spec: Spec | null;
  report: Report | null;
  error_message: string | null;
  created_by: 'user' | 'agent';
  created_at: string;
  resolved_at: string | null;
  metrics: {
    tokens_in: number;
    tokens_out: number;
    duration_ms: number;
  };
}

type LinkStatus =
  | 'drafting'              // Spec 작성 중 (auto-generated 직후)
  | 'awaiting_user_send'    // 사용자 미리보기 대기
  | 'sent'                  // 발송 직후
  | 'in_progress'           // to_session이 응답 생성 중
  | 'report_ready'          // Report 도착, 사용자 merge 대기 직전 가공
  | 'awaiting_user_merge'   // 사용자 검토 대기
  | 'completed'
  | 'rejected'
  | 'cancelled';
```

```sql
CREATE TABLE links (
  id                TEXT PRIMARY KEY,
  from_session_id   TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  to_session_id     TEXT REFERENCES sessions(id) ON DELETE SET NULL,
  kind              TEXT NOT NULL,
  status            TEXT NOT NULL,
  spec_json         TEXT,  -- JSON serialized Spec
  report_json       TEXT,  -- JSON serialized Report
  error_message     TEXT,
  created_by        TEXT NOT NULL,
  created_at        TEXT NOT NULL,
  resolved_at       TEXT,
  tokens_in         INTEGER NOT NULL DEFAULT 0,
  tokens_out        INTEGER NOT NULL DEFAULT 0,
  duration_ms       INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_links_from ON links(from_session_id);
CREATE INDEX idx_links_to ON links(to_session_id);
CREATE INDEX idx_links_status ON links(status);
```

### 5.6 Spec / Report (JSON, Link 안에 inline)

```typescript
interface Spec {
  link_id: string;
  kind: 'consult';
  body_markdown: string;       // §3.5 FR-IC-003 기준 자동 생성된 본문
  workspace_refs: Array<{
    path: string;
    revision: string | null;   // C-1은 null 허용 (비-git workspace)
    access: 'read' | 'read-write';
  }>;
  created_at: string;
}

interface Report {
  link_id: string;
  status: 'completed' | 'failed';
  body_markdown: string;       // §6 Adapter.request_report() 결과
  files_changed: Array<{
    path: string;
    revision: string | null;
  }>;
  created_at: string;
}
```

### 5.7 자동 생성되는 Spec body 템플릿

```markdown
## Question
{{user_question}}

## Context (auto-summarized from session)
- Project: {{project_name}}
- Project mission: {{project_mission_truncated_to_500_chars}}
- Workspace: {{workspace_path}}
- Session goal: {{session_goal}}

### Recent activity (last {{N}} messages)
{{summarized_or_truncated_messages}}

## What I need
A short opinion or alternative approach. This is a consult, not a handoff.
You do not need to modify any files.
```

> **구현 노트**: 메시지 요약은 1차적으로 단순 truncate (마지막 N=10 메시지, 각 500자 제한)로 충분. LLM 기반 요약은 향후 개선.

---

## 6. Adapter Protocol

### 6.1 인터페이스

본 슬라이스가 요구하는 어댑터 메서드. 모든 어댑터(Codex, Claude Code, 향후 추가)가 구현해야 한다.

```typescript
interface AdapterStartOptions {
  workspace_path: string;
  system_context: string;        // Project mission이 여기에 들어감
  model?: string;                // null이면 어댑터 디폴트
}

interface AdapterEvent {
  type:
    | 'text_delta'
    | 'message_complete'
    | 'tool_call'
    | 'tool_result'
    | 'error'
    | 'done';
  data: unknown;                 // 타입별 페이로드, §6.2 참조
}

interface ProviderAdapter {
  /** 고유 식별자: 'codex' | 'claude' | 'kimi' | ... */
  readonly key: string;

  /** 어댑터 이름 (UI 표시용) */
  readonly name: string;

  /** 새 native session 시작. 반환값은 어댑터 내부 session id */
  start(opts: AdapterStartOptions): Promise<{ adapter_session_id: string }>;

  /** 메시지 전송. AsyncIterable로 이벤트 스트림 반환 */
  send(adapter_session_id: string, message: string): AsyncIterable<AdapterEvent>;

  /** 외부 Spec markdown을 시스템 메시지로 inject. send와 별개 채널. */
  inject_spec(adapter_session_id: string, spec_markdown: string): AsyncIterable<AdapterEvent>;

  /** 현재 세션의 마지막 응답을 Report markdown으로 추출.
      가장 단순한 구현: 마지막 assistant 메시지 본문 그대로. */
  request_report(adapter_session_id: string): Promise<{ markdown: string }>;

  /** 세션 종료. native session API가 지원하지 않으면 no-op. */
  stop(adapter_session_id: string): Promise<void>;

  /** 어댑터 capability flag */
  readonly capabilities: {
    supports_native_session: boolean;
    supports_streaming: boolean;
    supports_inject_spec: boolean;  // false면 send() 메시지로 fallback
  };
}
```

### 6.2 이벤트 페이로드

```typescript
type AdapterEventData =
  | { type: 'text_delta'; data: { text: string } }
  | { type: 'message_complete'; data: { full_text: string; metadata?: Record<string, unknown> } }
  | { type: 'tool_call'; data: { tool: string; args: Record<string, unknown> } }
  | { type: 'tool_result'; data: { tool: string; result: unknown } }
  | { type: 'error'; data: { message: string; recoverable: boolean } }
  | { type: 'done'; data: { reason: 'stop' | 'length' | 'error' } };
```

### 6.3 Codex 어댑터 구현 노트

- 1차 구현: 기존 AWM apps/backend의 `codex exec --skip-git-repo-check ...` CLI subprocess 방식 유지.
- `start()`: subprocess 실행 없이 internal session id (nanoid)만 발급. 실제 호출은 `send()`에서.
- `send()`: subprocess 실행, stdout 라인 단위 파싱, text_delta로 변환, 종료 시 done 발생.
- `inject_spec()`: 가장 단순한 구현은 send()와 같지만 message를 시스템 프롬프트 prefix로 감싸는 형태:
  ```
  [SYSTEM CONSULT REQUEST]
  The following is a consult request from another agent session via AWM.
  Respond with a focused answer. Do not modify files.

  {{spec_markdown}}
  ```
- `request_report()`: 마지막 done 이벤트 시점에 누적된 full text를 반환.
- `capabilities.supports_native_session`: false (CLI exec 방식이라 매 호출이 새 컨텍스트). 향후 native API 도입 시 true로.

### 6.4 Claude Code 어댑터 구현 노트

- 1차 구현: `claude -p --dangerously-skip-permissions ...` CLI 또는 Claude Code SDK.
- 나머지는 Codex와 동일 패턴.
- `inject_spec()`: 동일한 SYSTEM CONSULT REQUEST 래핑.

### 6.5 Adapter Registry

```typescript
class AdapterRegistry {
  register(adapter: ProviderAdapter): void;
  get(key: string): ProviderAdapter | undefined;
  list(): ProviderAdapter[];
}
```

부팅 시 하드코딩으로 Codex와 Claude Code 어댑터 등록. 외부 어댑터(BYOA)는 본 슬라이스 범위 외.

---

## 7. Link 상태머신

```
   ┌──────────┐  user clicks /?provider
   │ (none)   │ ──────────────────────────┐
   └──────────┘                           ▼
                                  ┌──────────────┐
                                  │  drafting    │  Spec auto-generated
                                  └──────┬───────┘
                                         │ preview ready
                                         ▼
                                  ┌────────────────────┐
                                  │ awaiting_user_send │
                                  └─────┬──────┬───────┘
                            user sends │      │ user cancels
                                       ▼      ▼
                                  ┌────────┐ ┌──────────┐
                                  │  sent  │ │cancelled │
                                  └────┬───┘ └──────────┘
              to_session created,       │
              inject_spec called        ▼
                                  ┌──────────────┐
                                  │ in_progress  │
                                  └──────┬───────┘
                              adapter done│
                                          ▼
                                  ┌──────────────┐
                                  │ report_ready │
                                  └──────┬───────┘
                                         │ report extracted
                                         ▼
                                  ┌─────────────────────┐
                                  │ awaiting_user_merge │
                                  └────┬─────────┬──────┘
                          user merges │         │ user rejects
                                       ▼         ▼
                                  ┌──────────┐ ┌──────────┐
                                  │completed │ │ rejected │
                                  └──────────┘ └──────────┘

  Any state → cancelled (on adapter failure)
```

### 7.1 상태 전환 트리거 매핑

| 전환 | 트리거 | 부수효과 |
|---|---|---|
| (none) → drafting | `POST /sessions/:id/consult/draft` | Spec 자동 생성 |
| drafting → awaiting_user_send | Spec 생성 완료 | 프론트엔드에 미리보기 push |
| awaiting_user_send → sent | `POST /links/:id/send` | to_session 자동 생성 (없으면), Adapter.start() 호출, Adapter.inject_spec() 호출 |
| awaiting_user_send → cancelled | `POST /links/:id/cancel` | Link 삭제 가능 (soft delete) |
| sent → in_progress | inject_spec 후 첫 text_delta 수신 | from_session 상태 → awaiting_link_response |
| in_progress → report_ready | adapter done 이벤트 | request_report() 호출 |
| report_ready → awaiting_user_merge | Report 생성 완료 | 프론트엔드에 알림 push |
| awaiting_user_merge → completed | `POST /links/:id/merge` | from_session에 consult-result 메시지 삽입, from_session 상태 → active |
| awaiting_user_merge → rejected | `POST /links/:id/reject` | from_session 상태 → active, Report는 보존되나 메시지 삽입 안 함 |
| any → cancelled | adapter error | error_message 기록, from_session 상태 → active |

---

## 8. REST API 명세

모든 엔드포인트는 `application/json`. 베이스 경로 `/api/v1`.

### 8.1 Projects

#### POST /api/v1/projects
요청:
```json
{ "name": "Quadie Refactor", "mission": "Refactor driving_state_manager..." }
```
응답 201:
```json
{ "id": "prj_abc123", "name": "Quadie Refactor", "mission": "...", "created_at": "...", "owner": "local" }
```

#### GET /api/v1/projects
응답 200: `{ "projects": [Project, ...] }`

#### GET /api/v1/projects/:id
응답 200:
```json
{
  "project": Project,
  "workspaces": [Workspace, ...],
  "sessions": [Session, ...]
}
```

### 8.2 Workspaces

#### POST /api/v1/projects/:project_id/workspaces
요청: `{ "path": "/Users/dennis/quadie" }`
검증: 경로 존재 확인, 절대경로 강제.
응답 201: Workspace

### 8.3 Sessions

#### POST /api/v1/sessions
요청:
```json
{
  "project_id": "prj_abc123",
  "workspace_id": "ws_xyz",
  "provider": "codex",
  "title": "Refactor planning",
  "goal": "Plan the refactor"
}
```
응답 201: Session (status='starting' 또는 'active')

#### GET /api/v1/sessions/:id
응답: Session + 메시지 목록 (paginated, 디폴트 last 50)

#### GET /api/v1/sessions/:id/messages?after_seq=N
응답: `{ "messages": [Message, ...], "has_more": bool }`

#### POST /api/v1/sessions/:id/messages
요청: `{ "content": "..." }`
동작: Message 영속화 → Adapter.send() 호출 → 이벤트는 WS로 송출.
응답 202:
```json
{ "message_id": "msg_xxx", "stream_subscription": "ws://.../sessions/sess_xxx/stream" }
```

### 8.4 Inline Consult

#### POST /api/v1/sessions/:id/consult/draft
요청:
```json
{
  "provider": "claude",
  "question": "이 접근 어떻게 생각해?"
}
```
동작:
1. provider가 등록된 어댑터인지 검증
2. from_session의 직전 N=10 메시지 + project + workspace + goal로 Spec body 자동 생성
3. Link 객체 생성 (status=drafting → awaiting_user_send)
4. 응답 반환

응답 201:
```json
{
  "link_id": "lnk_abc",
  "spec": {
    "kind": "consult",
    "body_markdown": "## Question\n...",
    "workspace_refs": [{ "path": "...", "revision": null, "access": "read" }]
  },
  "status": "awaiting_user_send"
}
```

#### POST /api/v1/links/:id/spec
사용자가 미리보기에서 Spec 본문을 편집한 경우.
요청: `{ "body_markdown": "..." }`
응답 200: 갱신된 Spec.

#### POST /api/v1/links/:id/send
동작:
1. Link 상태가 awaiting_user_send인지 검증
2. to_session이 null이면 새 Session 생성:
   - project_id, workspace_id는 from_session과 동일
   - provider는 Spec의 provider
   - title은 "Consult from {from_session.title}"
3. Adapter(provider).start() 호출
4. Adapter.inject_spec(spec.body_markdown) 호출 → 비동기로 이벤트 스트림 처리 시작
5. Link 상태 → sent → in_progress (첫 text_delta 도착 시)
6. from_session 상태 → awaiting_link_response

응답 200: 갱신된 Link

#### POST /api/v1/links/:id/cancel
응답 200: status=cancelled로 갱신

#### POST /api/v1/links/:id/merge
요건: 상태 awaiting_user_merge.
동작:
1. Link.report.body_markdown을 from_session에 새 Message로 삽입 (role='consult-result', metadata에 link_id 포함)
2. from_session 상태 → active
3. Link 상태 → completed
응답 200: 갱신된 Link.

#### POST /api/v1/links/:id/reject
응답 200: status=rejected.

### 8.5 Links / Graph 조회

#### GET /api/v1/projects/:id/graph
응답:
```json
{
  "nodes": [
    { "session_id": "sess_a", "title": "...", "provider": "codex", "status": "active" },
    ...
  ],
  "edges": [
    { "link_id": "lnk_x", "from": "sess_a", "to": "sess_b", "kind": "consult", "status": "completed" },
    ...
  ]
}
```

#### GET /api/v1/links/:id
응답: 전체 Link 객체 (Spec/Report 포함).

---

## 9. WebSocket 명세

### 9.1 엔드포인트
`ws://host/api/v1/sessions/:id/stream`

### 9.2 클라이언트 → 서버
- 연결 직후 구독. 옵션 쿼리 `?after_seq=N`으로 catchup 시작점 지정 가능.

### 9.3 서버 → 클라이언트 메시지

```typescript
type ServerEvent =
  | { type: 'message_appended'; message: Message }
  | { type: 'text_delta'; message_id: string; delta: string }
  | { type: 'message_complete'; message_id: string }
  | { type: 'session_status'; status: SessionStatus }
  | { type: 'link_update'; link: Link }   // 이 세션과 관련된 Link 변화
  | { type: 'error'; message: string };
```

### 9.4 catchup
- 클라이언트가 `after_seq=N`으로 재연결하면 서버는 (a) 누락된 메시지를 message_appended로 push, (b) 그 후 라이브 스트림 재개.

---

## 10. 프론트엔드 UI 요구사항 (최소)

본 슬라이스는 픽셀 디자인을 강제하지 않는다. 다음 화면·동작이 동작하면 충분.

### 10.1 Sidebar
- Projects 목록
- "+ New Project"
- 선택된 Project 하위에 Sessions 목록, Graph 탭, "+ New Session"

### 10.2 Project Detail
- name, mission 표시·편집
- Workspaces 섹션, "+ Add Workspace"
- Sessions 섹션 (목록)

### 10.3 Session Detail
- 좌측: 메시지 스트림 (역할별 스타일 구분, system/consult-result는 별도 색)
- 하단: 입력창
  - 일반 메시지 + `/?<provider> ...` 명령 모두 받음
  - 명령 파싱은 클라이언트에서 1차 검증, 백엔드 재검증
- 우측: 미니 Links 패널 (이 세션의 incoming/outgoing Link 목록)

### 10.4 Inline Consult Preview
- `/?` 명령 발사 시 모달 또는 인라인 카드로 표시
- Spec 마크다운 렌더
- 버튼: Send (Enter), Edit (Esc), Cancel (X)
- Edit 모드에서는 텍스트 에디터로 전환

### 10.5 Inline Consult Result
- 원본 세션의 메시지 스트림에 카드로 표시:
  - "Consult to Claude — awaiting" → "Consult to Claude — ready (Review)"
  - 클릭 시 Report 마크다운 표시 + Merge / Reject 버튼

### 10.6 Graph
- 단순 force-directed 또는 정적 SVG 레이아웃
- 노드: 세션, provider 색
- 간선: Link, kind별 스타일 (consult는 점선)
- 노드/간선 클릭 시 우측 패널에 상세

---

## 11. 디렉토리 구조 권고

기존 AWM repo 구조를 준수한다고 가정. 추가 또는 수정될 모듈:

```
apps/
  backend/
    src/
      adapters/
        registry.ts                # AdapterRegistry
        types.ts                   # ProviderAdapter, AdapterEvent 등
        codex.ts                   # CodexAdapter
        claude.ts                  # ClaudeAdapter
      db/
        schema.sql                 # §5 스키마
        migrate.ts
        repositories/
          projects.ts
          workspaces.ts
          sessions.ts
          messages.ts
          links.ts
      services/
        session_service.ts         # 세션 라이프사이클
        consult_service.ts         # Spec 생성, send, merge
        graph_service.ts
      api/
        routes/
          projects.ts
          workspaces.ts
          sessions.ts
          consult.ts
          links.ts
          graph.ts
        ws/
          session_stream.ts
      app.ts
      index.ts

apps/
  frontend/
    src/
      pages/
        ProjectsPage.tsx
        ProjectDetailPage.tsx
        SessionDetailPage.tsx
        GraphPage.tsx
      components/
        SessionStream.tsx
        ConsultPreview.tsx
        ConsultResultCard.tsx
        LinksPanel.tsx
        GraphView.tsx
      api/
        client.ts
        types.ts                   # backend 타입과 공유
      hooks/
        useSessionStream.ts

packages/
  shared/
    src/
      types.ts                     # Project, Session, Link, Spec, Report 등
```

---

## 12. 구현 순서 (권고)

본 슬라이스를 작은 PR로 나눠 진행할 것을 권한다. 각 단계마다 종단 동작이 부분적으로 검증 가능하도록 배열.

### Phase 1 — 토대 (1주)
1. SQLite 스키마 + migrate 함수
2. Repository 계층 (projects, workspaces, sessions, messages, links)
3. Project / Workspace REST API + 단위 테스트
4. 프론트엔드 ProjectsPage, ProjectDetailPage (Workspace 등록까지)

검증: 프로젝트 생성 → 워크스페이스 등록 → 새로고침 후 복원

### Phase 2 — Adapter Protocol + Session 라이프사이클 (1~1.5주)
1. ProviderAdapter 인터페이스 + AdapterRegistry
2. CodexAdapter 구현 (1차: CLI exec 방식)
3. ClaudeAdapter 구현 (동일 패턴)
4. SessionService.start / send / handleStream
5. POST /sessions, POST /sessions/:id/messages, WS /sessions/:id/stream
6. 프론트엔드 SessionDetailPage + SessionStream + useSessionStream

검증: Codex 세션 생성 → 메시지 송신 → 스트리밍 응답 → 새로고침 후 메시지 복원

### Phase 3 — Link 모델 + 영속화 (3일)
1. Link repository, 상태머신 헬퍼
2. GET /links/:id, GET /projects/:id/graph
3. 임시 시드 데이터로 Graph view 렌더 (consult 1개 하드코딩)
4. 프론트엔드 GraphPage, GraphView (단순 SVG)

검증: 시드 데이터 기반 그래프 렌더, 간선 클릭 시 Spec/Report 표시

### Phase 4 — Inline Consult 종단 (1주)
1. ConsultService.draft (자동 Spec 생성)
2. POST /sessions/:id/consult/draft
3. 프론트엔드 입력창 명령 파싱, ConsultPreview
4. ConsultService.send (to_session 자동 생성, inject_spec 호출, 상태 전환)
5. POST /links/:id/send
6. inject_spec 이벤트 스트림 처리 → request_report 호출 → Link 상태 전환
7. WS link_update 이벤트
8. 프론트엔드 ConsultResultCard, Merge / Reject

검증: §2 Happy Path 전체 동작

### Phase 5 — 정리 (3일)
1. Sad path 처리 (§2.1)
2. 에러 토스트, 로그
3. README 업데이트, 데모 영상

---

## 13. 테스트 요구사항

### 13.1 단위 테스트 (필수)
- Repository CRUD (각 객체)
- AdapterRegistry register/get
- Link 상태머신 전환 검증 (모든 valid 전환 + invalid 전환 거부)
- ConsultService.generateSpec (입력별 출력 스냅샷)

### 13.2 통합 테스트 (필수)
- POST /projects → POST /workspaces → POST /sessions 종단
- POST /sessions/:id/consult/draft → POST /links/:id/send → 상태 변화 → POST /links/:id/merge
- WS catchup (after_seq)

### 13.3 E2E 테스트 (선택)
- 실제 Codex / Claude CLI 호출은 mock adapter로 대체. mock adapter가 기록된 응답을 재생.

### 13.4 Mock Adapter
구현 권고:
```typescript
class MockAdapter implements ProviderAdapter {
  key = 'mock';
  // 사전 등록된 응답을 send/inject_spec 호출 시 차례로 반환
}
```
이걸로 §2 Happy Path 전체를 외부 의존 없이 자동 검증 가능.

---

## 14. 열린 질문 (구현 시작 전 결정 필요)

본 슬라이스 구현을 시작하기 전에 사용자(Dennis)에게 확인해야 할 항목들.

| ID | 질문 | 영향 |
|---|---|---|
| OQ-01 | 기존 AWM repo의 backend가 이미 어댑터 추상화를 가지고 있는가? 있다면 그 인터페이스를 §6에 맞춰 리팩터링할 것인가, 새로 추가할 것인가? | Phase 2 작업량 |
| OQ-02 | DB는 SQLite로 새로 추가하는가, 기존에 쓰던 저장소가 있는가? | Phase 1 |
| OQ-03 | 프론트엔드 디렉토리는 apps/frontend인가 apps/frontend-server 정적 자산인가? | Phase 1 마지막 |
| OQ-04 | Codex / Claude의 native session API를 본 슬라이스에서 사용할 것인가, CLI exec로 시작할 것인가? | Phase 2 어댑터 구현 |
| OQ-05 | Spec body 자동 생성 시 메시지 요약은 단순 truncate로 시작하는 것에 동의하는가? | Phase 4 |
| OQ-06 | Graph 시각화 라이브러리 — d3-force, react-flow, 또는 직접 SVG 중 어느 것? | Phase 3 |
| OQ-07 | 본 슬라이스 완료 후 다음 슬라이스는 C-2(안전한 단독 작업)인가, M4(Plays)인가? | 다음 명세 작성 |

---

## 15. 완료 정의 (Definition of Done)

본 슬라이스는 다음 모두를 만족할 때 완료된 것으로 간주한다:

- [ ] §2 Happy Path 모든 단계가 실제 Codex / Claude CLI로 동작
- [ ] §2.1 Sad Path 모든 케이스에서 시스템이 일관된 상태로 복구
- [ ] §3 모든 FR이 자동 테스트 또는 수동 검증으로 입증
- [ ] §4 모든 NFR 충족
- [ ] §13 단위 + 통합 테스트 통과
- [ ] Mock Adapter 기반 E2E 테스트 통과
- [ ] README에 본 슬라이스 사용법 문서화
- [ ] 1분 이내 데모 영상 또는 GIF 작성
- [ ] 본 명세서의 §14 모든 열린 질문이 해소되어 결정 사항으로 기록

---

## 16. 향후 슬라이스 확장 포인트

본 슬라이스가 다음 기능들을 자연스럽게 받을 수 있도록 설계되어야 함.

| 향후 기능 | 본 슬라이스에서 준비할 것 |
|---|---|
| handoff / review 링크 kind | Link.kind enum 확장 가능 구조, Spec body_kind 분기 |
| Plays | Session 생성 API에 play_id 옵션 필드 (현재는 무시) |
| Session Artifacts | Message role enum에 'artifact_ref' 같은 확장 여지 |
| Budget Enforcement | Link.metrics 필드 자리 미리 잡아둠 |
| Git Worktree | Workspace.kind enum에 'git' 추가 가능 구조 |
| 외부 어댑터 (BYOA) | AdapterRegistry.register() 외부 호출 가능 구조 |
| Multi-clarification | Link에 clarifications 배열 필드 자리 |

---

## 17. 본 명세서 사용법 (구현 에이전트 대상)

본 문서를 받은 구현 에이전트는 다음 순서로 동작할 것:

1. **§14 열린 질문**을 사용자에게 먼저 확인. 답을 받기 전에 코드 작성 시작 금지.
2. 답을 받은 후 §12 구현 순서를 따라 Phase별로 PR 분할.
3. 각 Phase 시작 전에 해당 Phase가 건드리는 §3 FR과 §4 NFR을 다시 읽기.
4. 모호한 부분이 발견되면 가정으로 진행하되 PR 설명에 명시.
5. 본 문서 자체와 모순되는 결정을 해야 한다면 사용자에게 확인 후 본 문서를 patch.

본 명세서는 살아있는 문서다. 구현 중 발견된 사실로 갱신하고 v1.1, v1.2로 버전을 올린다.

---

**End of Spec v1.0**
