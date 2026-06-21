# Agent Web Manager — 엔지니어링 구현 명세서 v0.7

> 상태: 구현용 통합 초안
> 성격: single-session architecture 기준 개정판
> 대상 독자: 제품 엔지니어, 백엔드 엔지니어, 프론트엔드 엔지니어, 인프라 엔지니어
> 문서 목적: 프로젝트당 하나의 주 세션을 중심으로, 영속적 지식과 경험을 축적하는 Agent Web Manager의 구현 기준을 정의한다.

---

## 1. 문서 목적과 범위

### 1.1 목적

본 문서는 Agent Web Manager v0.7의 구현 기준을 정의한다. 특히 다음을 명확히 한다.

* ProjectAgent의 정체성과 책임 범위
* 세션의 정확한 정의
* 단일 세션 기반 상호작용 모델
* explicit memory, trace, episode, tacit pattern의 저장 및 동작 규칙
* Knowledge Inventory, SessionState, Working Set, Context Assembly의 역할과 경계
* Dream의 역할과 선택적 도입 방식
* retrieval 및 injection 우선순위
* UI 요구사항
* 데이터 스키마
* 운영, 보안, 롤아웃 기준

### 1.2 범위

본 버전의 구현 범위는 다음을 포함한다.

* ProjectAgent
* Primary Session
* Standing Order / Policy / Budget
* Memory 시스템
* Mid-session Memory Capture
* Session Trace Capture
* Knowledge Inventory
* SessionState
* Working Set / Context Assembly
* Episode / Case Distillation
* Tacit Pattern Inference
* 선택적 Dream / Dream Journal
* Evidence Chain 기반 provenance 설명

### 1.3 범위 제외

본 버전에서 구현하지 않거나 기본값으로 비활성화하는 항목은 다음과 같다.

* 사용자 승인 없는 자율 의사결정
* hidden chain-of-thought 저장
* raw trace의 기본 컨텍스트 자동 주입
* 동일 ProjectAgent 내부의 복수 active interactive session
* direct session-to-session chat bus
* cross-agent tacit pattern 자동 공유
* 강한 push 기반 멀티에이전트 자동화
* Session Graph 같은 세션 네트워크 시각화
* cross-project collaboration 실행 로직
* Connection / Link 기반 orchestration runtime
* Network View의 실제 제품 구현

### 1.4 장기 비전(비구현 범위)

장기적으로 본 시스템은, 각 ProjectAgent가 축적한 전문가 경험을 바탕으로 **전문가 간 협업 관계를 점진적으로 그래프로 구축하는 오케스트레이션 레이어**로 확장될 수 있다.

다만 v0.7 현재 구현 범위에서는 이 방향을 **큰 그림으로만 유지**한다. 즉, 현재 단계에서는 다음을 구현 대상으로 삼지 않는다.

* 전문가 간 자동 협업 runtime
* cross-project consult / share / notify의 실제 제품 플로우
* Network View의 상시 노출 UI
* 그래프 기반 orchestration decision engine

현재 단계의 우선순위는 어디까지나 **단일 ProjectAgent 안에서 전문가 경험을 정확하게 축적하는 것**이다.

---

## 2. 설계 결정 요약

본 문서는 다음 설계 결정을 전제로 한다.

D1. **프로젝트당 하나의 주 세션만 둔다.**
사용자와 agent의 대화는 ProjectAgent에 연결된 하나의 persistent session 안에서 이뤄진다.

D2. **세션은 영속적인 대화 채널이지, 일회성 실행 컨테이너가 아니다.**
작업이 이어질수록 같은 세션 안에서 정보가 누적된다. 다만 실제 prompt 주입은 전체 이력을 통째로 넣지 않고 retrieval로 구성한다.

D3. **영속성은 세션 자체보다 ProjectAgent 상태에 저장된다.**
세션은 상호작용 표면이고, 장기 정보는 Memory, Episode, TacitPattern, Spec, Report에 저장된다.

D4. **Dream은 세션이 아니라 선택적 maintenance subsystem이다.**
Dream은 필요한 경우에만 백그라운드 maintenance job으로 실행된다. MVP 단계에서는 비활성화 가능하다.

D5. **권한 모델은 단순해야 한다.**
사용자 쓰기는 primary session에서만 발생한다. Dream은 proposal-only다.

D6. **전문가 간 그래프 오케스트레이션은 장기 비전으로만 유지한다.**
cross-project 협업 구조와 관계 그래프는 현재 구현 범위가 아니라 미래 확장 방향이다.

D7. **저장소와 컨텍스트는 분리해야 한다.**
Memory, Episode, TacitPattern, Trace는 장기 저장소에 축적되지만, 실제 prompt에는 작은 working set만 주입해야 한다.

D8. **무엇을 알고 있는지와 지금 무엇을 하는지를 분리해야 한다.**
Knowledge Inventory는 agent가 알고 있는 것의 얇은 목록이고, SessionState는 현재 작업 상태이며, Working Set은 이번 turn에 실제로 사용할 컨텍스트다.

---

## 3. 배경 및 문제 정의

일반적인 채팅형 워크플로는 다음 한계를 가진다.

1. 대화창이 바뀌면 프로젝트 정체성이 약해진다.
2. 중요한 결정과 실패가 구조화된 장기 지식으로 남지 않는다.
3. 세션 전체 흐름에서 드러나는 tacit knowledge를 학습하지 못한다.
4. provider가 바뀌면 프로젝트 맥락 일관성이 약해진다.

본 시스템은 프로젝트 폴더를 ProjectAgent로 모델링하여 다음 문제를 해결한다.

* 프로젝트 정체성의 지속성
* explicit knowledge의 구조화 저장
* session trace로부터의 tacit knowledge 증류
* 필요 시 maintenance job 기반 통합 및 가지치기
* 협업 관계의 명시화

---

## 4. 제품 목표와 비목표

### 4.1 목표

시스템은 다음을 만족해야 한다.

G1. 프로젝트 폴더는 영속적 정체성을 가진 ProjectAgent로 표현되어야 한다.
G2. 각 ProjectAgent는 정확히 하나의 primary interactive session을 가져야 한다.
G3. 사용자와 agent는 동일한 primary session 안에서 대화하면서 영속 정보를 갱신할 수 있어야 한다.
G4. ProjectAgent의 메모리는 provider와 독립적으로 유지되어야 한다.
G5. 중요한 결정, 실패, 발견은 세션 중 바로 저장 가능해야 한다.
G6. 세션의 user / assistant / tool / artifact 흐름은 구조화된 trace로 저장 가능해야 한다.
G7. trace는 episode로 증류 가능해야 한다.
G8. episode는 tacit pattern으로 증류 가능해야 한다.
G9. retrieval 시 rule, memory, pattern, case를 구분된 타입으로 주입해야 한다.
G10. 모든 고위험 변경은 사용자 승인 게이트를 거쳐야 한다.
G11. Dream은 선택적으로 memory 및 experience를 재평가하는 maintenance job으로 동작할 수 있어야 한다.

### 4.2 비목표

시스템은 다음을 목표로 하지 않는다.

NG1. 사용자를 대신해 프로젝트 결정을 자동 확정하지 않는다.
NG2. 모든 대화 내용을 무차별 장기 저장하지 않는다.
NG3. hidden reasoning을 저장하거나 재사용하지 않는다.
NG4. 동일 ProjectAgent 안에 여러 interactive context를 동시에 열어 복잡한 권한 모델을 만들지 않는다.
NG5. Dream이 사용자 승인 없이 memory나 standing order를 직접 수정하지 않는다.
NG6. session 간 direct messaging이나 숨겨진 session bus를 제공하지 않는다.

---

## 5. 용어 정의

* **ProjectAgent**: 프로젝트 폴더에 anchored된 영속적 에이전트
* **Primary Session**: ProjectAgent에 1:1로 연결된 주 대화 채널
* **Memory**: 안정적인 explicit knowledge 단위
* **Knowledge Inventory**: agent가 알고 있는 항목들의 얇은 카탈로그
* **SessionState**: 현재 세션에서 무엇을 하고 있는지를 나타내는 작업 상태
* **Working Set**: 이번 turn에 실제로 prompt에 주입되는 작은 컨텍스트 묶음
* **Context Assembly**: Knowledge Inventory와 SessionState를 이용해 Working Set을 구성하는 과정
* **SessionEvent**: 세션 중 발생한 구조화 이벤트
* **Episode**: SessionEvent 집합을 문제-접근-결과-교훈 형태로 압축한 사례
* **TacitPattern**: 여러 Episode로부터 추론된 반복적 작업 방식
* **Dream**: memory와 experience를 재정리하는 선택적 maintenance job
* **Standing Order**: 프로젝트별 지속 운영 지침
* **Policy**: standing order보다 더 강한 제약
* **Connection**: ProjectAgent 간 지속 권한 관계
* **Link**: consult / share / notify 등 구체적 관계 기록
* **Network View**: ProjectAgent와 Connection / Link 관계를 보여주는 그래프 뷰
* **Evidence Chain**: Memory / Pattern / Episode / Trace 간 provenance를 따라가는 시각화 또는 drill-down 경로
* **Hot Trace**: 최근 고충실도 trace 저장 계층
* **Warm Trace**: 압축된 trace 저장 계층
* **Cold Distilled Layer**: 장기 보존용 distilled knowledge 계층

---

## 6. 설계 원칙

P1. 장소로서의 정체성
P2. 독립 우선
P3. Push가 아니라 Pull
P4. 명시적 링크
P5. 점진적 경화
P6. 그래프는 결과물
P7. 컨텍스트 덤프보다 문서
P8. 결정하지 말고 드러내기
P9. 할당이 아니라 앵커링
P10. Provider 독립 메모리
P11. 대화 중에는 갱신하고, 정리는 분리하기
P12. 먼저 Trace를 남기고, 재사용 전 증류하기
P13. 습관보다 증거
P14. 발화보다 결과
P15. 세션 구조보다 권한 단순성 우선

모든 하위 설계는 위 원칙을 위반해서는 안 된다.

---

## 7. 시스템 개요

### 7.1 상위 아키텍처

```text
ProjectAgent
 ├─ Primary Session (1:1)
 │   ├─ SessionEvent
 │   └─ SessionState
 ├─ Knowledge Inventory
 ├─ Explicit Memory
 ├─ Experience Layer
 │   ├─ Episode
 │   └─ TacitPattern
 ├─ Context Assembly
 │   └─ Working Set
 ├─ Optional Maintenance Jobs
 │   └─ Dream
 ├─ Standing Orders / Policy / Budget
 ├─ Specs / Reports
 └─ Connections / Links
```

### 7.2 핵심 데이터 흐름

```text
User ↔ Agent 대화
    ↓
Primary Session에 SessionEvent 저장
    ↓
중요 신호 발생 시 Memory 즉시 저장 가능
    ↓
Memory / Episode / Pattern / Rule에서 Knowledge Inventory 갱신
    ↓
SessionState가 현재 goal / task / active artifact / open question 유지
    ↓
Context Assembly가 Inventory 후보를 좁혀 Working Set 생성
    ↓
같은 Primary Session의 이후 turn에서 Working Set만 prompt에 주입
    ↓
누적 trace를 기준으로 Episode 생성
    ↓
여러 Episode에서 TacitPattern 추론
    ↓
충분히 검증되면 Memory 또는 Standing Order 승격 제안
```

### 7.3 세션 정의

세션은 다음과 같이 정의한다.

> **Session은 특정 ProjectAgent에 1:1로 연결된, 사용자와 agent 사이의 지속적인 대화 채널이다.**

세션의 의미는 다음과 같다.

* 세션은 사용자 상호작용의 기본 표면이다.
* 세션은 프로젝트별로 정확히 하나만 존재한다.
* 세션은 장기 정보를 직접 소유하지 않는다. 장기 정보는 ProjectAgent 상태에 저장된다.
* 세션은 대화 흐름을 남기며, 이후 retrieval에 필요한 근거를 제공한다.
* 세션은 prompt 전체를 영구 누적하는 컨테이너가 아니라, 구조화된 retrieval의 입력원이 되는 대화 로그다.

### 7.4 Context Assembly 원칙

* 장기 저장소 전체를 prompt에 직접 주입하지 않는다.
* 먼저 Knowledge Inventory에서 후보를 찾고, 그다음 SessionState를 기준으로 좁힌다.
* 최종적으로 Working Set만 prompt에 주입한다.
* Working Set은 turn 단위 ephemeral object이며, 장기 저장소가 아니다.
* 같은 사실을 Memory / Pattern / Episode에서 중복 주입하지 않는다.

### 7.5 핵심 제약

* 동일 ProjectAgent 내부에 복수 active interactive session을 허용하지 않는다.
* raw trace는 기본적으로 prompt에 주입하지 않는다.
* tacit pattern은 최소 2개 이상의 evidence episode 없이는 `proposed` 이상으로 만들지 않는다.
* Dream은 proposal만 생성하며, 고위험 변경은 직접 적용하지 않는다.

---

## 8. 도메인 모델

### 8.1 ProjectAgent

```typescript
interface ProjectAgent {
  id: string;
  name: string;
  root_path: string;
  description: string | null;

  identity_prompt: string;
  preferred_provider: string | null;
  allowed_providers: string[];

  primary_session_id: string;

  standing_order_ids: string[];
  policy_ids: string[];
  budget_id: string | null;

  connection_ids: string[];
  spec_ids: string[];
  report_ids: string[];

  memory_settings_id: string | null;
  dream_schedule_id: string | null;
  experience_settings_id: string | null;

  created_at: string;
  updated_at: string;
}
```

#### 불변 조건

* `id`는 전역 유일해야 한다.
* `root_path`는 하나의 ProjectAgent에만 귀속되어야 한다.
* `preferred_provider`가 설정되어 있으면 `allowed_providers`에 포함되어야 한다.
* `primary_session_id`는 반드시 존재해야 하며, 정확히 하나의 session만 가리켜야 한다.
* `standing_order_ids`, `policy_ids`, `connection_ids`는 존재하는 객체만 가리켜야 한다.

### 8.2 Session

```typescript
interface Session {
  id: string;
  agent_id: string;
  current_provider: string | null;
  status: 'active' | 'archived';

  created_at: string;
  updated_at: string;
}
```

#### 상태 전이

```text
active → archived
```

#### 불변 조건

* 하나의 `agent_id`에는 정확히 하나의 active session만 존재해야 한다.
* `current_provider`가 설정되어 있으면 해당 값은 ProjectAgent의 `allowed_providers` 안에 있어야 한다.
* session은 user-facing primary channel이며, Dream 실행 컨테이너로 사용하지 않는다.

### 8.3 Standing Order

Standing Order는 낮은 변동성의 운영 규칙이다.

#### 요구사항

* ProjectAgent 단위로 저장해야 한다.
* retrieval 시 Memory보다 우선한다.
* standing order 승격은 사용자 승인 후에만 가능하다.

### 8.4 Policy

Policy는 강한 제약 조건이다.

#### 요구사항

* retrieval 시 최우선으로 주입해야 한다.
* Dream은 policy 자체를 직접 수정해서는 안 된다.
* policy 위반 가능성이 있는 제안은 UI에서 위험 경고가 표시되어야 한다.

### 8.5 Memory

```typescript
interface Memory {
  id: string;
  agent_id: string;

  kind: 'decision' | 'discovery' | 'failure' | 'convention'
      | 'dependency' | 'architecture' | 'contact'
      | 'synthesis';

  content: string;
  detail: string | null;
  tags: string[];

  capture_mode: 'mid_session'
              | 'end_extraction'
              | 'dream_synthesis'
              | 'dream_promotion'
              | 'user_manual'
              | 'cross_project'
              | 'episode_distillation'
              | 'pattern_promotion';

  source_session_id: string | null;
  source_provider: string | null;
  source_agent_id: string | null;
  source_link_id: string | null;
  source_dream_id: string | null;
  source_memory_ids: string[] | null;
  source_episode_ids: string[] | null;
  source_pattern_id: string | null;

  superseded_by: string | null;

  importance: number;
  last_referenced_at: string | null;
  reference_count: number;
  archived: boolean;

  created_at: string;
  updated_at: string;
}
```

#### 불변 조건

* `importance`는 0 이상 100 이하의 정수여야 한다.
* `archived=true`인 memory는 기본 retrieval 대상에서 제외한다.
* `superseded_by`가 설정된 memory는 기본 retrieval 대상에서 제외한다.
* `source_pattern_id`가 설정된 경우 `capture_mode='pattern_promotion'`이어야 한다.
* `source_episode_ids`가 설정된 경우 `capture_mode`는 `episode_distillation`, `dream_synthesis`, `pattern_promotion` 중 하나여야 한다.

### 8.6 Knowledge Inventory

```typescript
interface KnowledgeIndexEntry {
  id: string;
  agent_id: string;
  kind: 'rule' | 'memory' | 'episode' | 'pattern';

  source_ref_id: string;
  title: string;
  summary_head: string;

  task_signature: string | null;
  tags: string[];
  artifact_refs: string[];

  status: 'active' | 'archived' | 'superseded' | 'rejected' | 'stale';
  importance: number | null;
  confidence: number | null;

  updated_at: string;
  last_referenced_at: string | null;
  reference_count: number;
}
```

#### 역할

* Knowledge Inventory는 원본 지식 저장소가 아니라 agent가 알고 있는 것의 얇은 카탈로그다.
* Context Assembly는 먼저 Inventory에서 후보를 찾고, 필요한 항목만 원본 객체를 다시 로드한다.
* Inventory에는 긴 detail 본문이나 raw trace를 저장하지 않는다.

#### 불변 조건

* `source_ref_id`는 실제 Rule / Memory / Episode / Pattern 객체를 가리켜야 한다.
* `status='superseded' | 'archived' | 'rejected'`인 항목은 기본 shortlist에서 제외한다.
* Inventory는 source object의 상태 변화와 동기화되어야 한다.

### 8.7 SessionState

```typescript
interface SessionState {
  session_id: string;
  agent_id: string;

  current_goal: string | null;
  current_task_signature: string | null;
  active_artifact_refs: string[];
  open_questions: string[];

  pinned_memory_ids: string[];
  pinned_episode_ids: string[];
  pinned_pattern_ids: string[];

  rolling_summary: string | null;
  topic_version: number;
  updated_at: string;
}
```

#### 역할

* SessionState는 agent 전체가 아는 것을 담지 않는다.
* SessionState는 현재 세션에서 무엇을 하고 있는지의 작업 상태를 유지한다.
* topic shift가 발생하면 `topic_version`을 올리고 pinned 항목을 부분 초기화할 수 있다.

#### 불변 조건

* `session_id`는 active primary session을 가리켜야 한다.
* `pinned_*_ids`는 동일 agent 소속 객체만 가리켜야 한다.
* SessionState는 장기 저장소를 대체하지 않는다.

### 8.8 Working Set

```typescript
interface WorkingSet {
  session_id: string;
  agent_id: string;
  turn_id: string;

  selected_rule_ids: string[];
  selected_memory_ids: string[];
  selected_pattern_ids: string[];
  selected_episode_ids: string[];
  selected_trace_ids: string[];

  assembled_prompt_tokens: number;
  created_at: string;
}
```

#### 역할

* Working Set은 이번 turn에 실제로 prompt에 들어갈 작은 컨텍스트다.
* Working Set은 저장소가 아니라 Context Assembly 결과물이다.
* Working Set은 ephemeral object이며, 필요 시 디버깅 로그만 남긴다.

#### 불변 조건

* 같은 의미를 가진 Memory / Pattern / Episode를 중복 주입해서는 안 된다.
* `selected_trace_ids`는 기본적으로 비어 있어야 하며, forensic mode 또는 명시적 요청 시에만 채워질 수 있다.
* Working Set은 token quota를 초과해서는 안 된다.

### 8.9 SessionEvent

```typescript
interface SessionEvent {
  id: string;
  agent_id: string;
  session_id: string;
  turn_index: number;

  role: 'user' | 'assistant' | 'tool' | 'system';
  event_type: 'message' | 'tool_call' | 'tool_result' | 'file_patch' | 'marker';

  content_preview: string;
  content_blob_ref: string | null;
  tool_name: string | null;
  artifact_refs: string[];

  tags: string[];
  outcome_signal: 'progress' | 'blocked' | 'decision' | 'failure' | 'success' | null;
  sensitivity: 'normal' | 'redacted' | 'secret';

  created_at: string;
}
```

#### 불변 조건

* `turn_index`는 `(session_id, turn_index)` 조합 기준 유일해야 한다.
* `role='tool'`이면 `event_type`는 `tool_call` 또는 `tool_result`여야 한다.
* `sensitivity='secret'`인 경우 원문 blob 저장은 금지하거나 별도 encrypted store로 격리해야 한다.
* hidden reasoning은 SessionEvent로 저장해서는 안 된다.

### 8.10 Episode

```typescript
interface Episode {
  id: string;
  agent_id: string;
  source_session_id: string | null;

  title: string;
  task_signature: string;
  kind: 'debug' | 'refactor' | 'research' | 'delivery' | 'incident';

  summary: string;
  outcome: 'success' | 'failure' | 'mixed' | 'blocked';
  lesson: string | null;
  applicability: string | null;

  validation_signals: Array<
    'user_confirmed' | 'tool_verified' | 'tests_passed' | 'artifact_created'
  >;

  source_event_ids: string[];
  derived_memory_ids: string[];

  status: 'draft' | 'active' | 'archived';
  confidence: number;
  reference_count: number;
  last_referenced_at: string | null;

  created_by: 'user_manual' | 'session_distillation' | 'dream';
  created_at: string;
  updated_at: string;
}
```

#### 불변 조건

* `confidence`는 0 이상 100 이하의 정수여야 한다.
* `source_event_ids`는 최소 1개 이상이어야 한다.
* `status='archived'`인 episode는 기본 retrieval 대상에서 제외한다.
* `outcome='success'`이면 최소 하나 이상의 validation signal이 있는 것이 권장된다.

### 8.11 TacitPattern

```typescript
interface TacitPattern {
  id: string;
  agent_id: string;

  kind: 'workflow' | 'heuristic' | 'anti_pattern' | 'preference' | 'style';

  statement: string;
  applicability: string | null;
  counterexamples: string | null;

  evidence_episode_ids: string[];
  confidence: number;
  validation_status: 'proposed' | 'confirmed' | 'weak' | 'rejected';

  promoted_memory_id: string | null;
  promoted_standing_order_id: string | null;

  last_confirmed_at: string | null;
  reference_count: number;
  last_referenced_at: string | null;

  created_by: 'dream' | 'user_manual' | 'cross_project';
  created_at: string;
  updated_at: string;
}
```

#### 불변 조건

* `evidence_episode_ids`는 최소 2개 이상일 때만 `validation_status='proposed'`를 허용한다.
* `validation_status='confirmed'`이면 최소 3개 이상의 evidence episode가 있어야 한다.
* `promoted_memory_id`와 `promoted_standing_order_id`는 동시에 설정하지 않는 것을 기본 정책으로 한다.
* `statement`는 무조건적 문장 대신 조건부 문장을 사용해야 한다.

### 8.12 Dream

```typescript
interface Dream {
  id: string;
  agent_id: string;
  scope: 'self' | 'cross_agent';

  triggered_by: 'schedule' | 'idle' | 'threshold' | 'user_manual';
  status: 'running' | 'completed' | 'failed' | 'awaiting_review';

  input_memory_count: number;
  input_memory_ids: string[];
  input_episode_count: number;
  input_episode_ids: string[];
  input_pattern_count: number;
  input_pattern_ids: string[];
  input_event_count: number;

  proposals: DreamProposal[];

  provider: string;
  tokens_used: number;
  duration_ms: number;

  started_at: string;
  ended_at: string | null;
  reviewed_at: string | null;
}

interface DreamProposal {
  id: string;
  dream_id: string;
  kind: 'merge'
      | 'synthesis'
      | 'supersede'
      | 'archive'
      | 'compress'
      | 'retag'
      | 'flag_contradiction'
      | 'promote_importance'
      | 'create_episode'
      | 'merge_episodes'
      | 'infer_pattern'
      | 'confirm_pattern'
      | 'weaken_pattern'
      | 'retire_pattern'
      | 'promote_pattern_to_memory'
      | 'promote_pattern_to_order';

  rationale: string;
  affected_memory_ids: string[];
  affected_episode_ids: string[];
  affected_pattern_ids: string[];
  proposed_change: object;

  status: 'pending' | 'accepted' | 'rejected' | 'modified';
  user_decision_at: string | null;
}
```

#### Dream 상태 전이

```text
running → completed
running → failed
completed → awaiting_review
awaiting_review → completed
```

#### 불변 조건

* Dream은 session이 아니라 background maintenance job이다.
* Dream은 직접 memory를 mutate해서는 안 되고 proposal만 생성해야 한다.
* `scope='cross_agent'`는 기본 비활성화 상태여야 한다.
* `provider`는 agent budget 정책에 의해 허용된 provider여야 한다.

### 8.13 Connection / Link (장기 비전 모델, 현재 비구현)

```typescript
interface Connection {
  id: string;
  from_agent_id: string;
  to_agent_id: string;
  trust_level: 'low' | 'medium' | 'high';
  allowed_scopes: Array<'consult' | 'share_memory' | 'share_report' | 'notify'>;
  created_at: string;
}

interface Link {
  id: string;
  kind: 'consult' | 'share' | 'notify' | 'dependency' | 'report_ref' | 'spec_ref';
  from_agent_id: string;
  to_agent_id: string | null;
  source_artifact_id: string | null;
  target_artifact_id: string | null;
  payload_ref: string | null;
  created_at: string;
}
```

#### 불변 조건

* Link 생성 시 Connection 또는 동등한 권한 검증이 선행되어야 한다.
* `kind='share'`인 경우 payload provenance를 유지해야 한다.
* cross-agent tacit pattern 공유는 default로 허용하지 않는다.

---

## 9. 기능 요구사항

### 9.1 ProjectAgent 생성 및 관리

REQ-PA-1. 사용자는 프로젝트 폴더를 ProjectAgent로 생성할 수 있어야 한다.
REQ-PA-2. ProjectAgent는 identity prompt, allowed provider, preferred provider를 가져야 한다.
REQ-PA-3. ProjectAgent는 정확히 하나의 primary session을 가져야 한다.
REQ-PA-4. ProjectAgent는 memory, experience, standing order, policy를 독립적으로 유지해야 한다.
REQ-PA-5. ProjectAgent 삭제 시 연결된 memory, episode, tacit pattern, session event는 cascade 또는 archive 정책을 따라야 한다.

### 9.2 Session 처리

REQ-SE-1. Session은 ProjectAgent당 정확히 하나의 active primary session만 허용해야 한다.
REQ-SE-2. Session은 사용자와 agent의 기본 상호작용 표면이어야 한다.
REQ-SE-3. Session은 정확히 하나의 current provider를 가질 수 있어야 한다.
REQ-SE-4. 사용자는 같은 session 안에서 계속 대화하면서 장기 정보를 축적할 수 있어야 한다.
REQ-SE-5. Session은 전체 이력을 항상 prompt에 주입하지 않고, recent turns + retrieval 구조로 동작해야 한다.
REQ-SE-6. v0.7은 복수 active interactive session을 허용해서는 안 된다.
REQ-SE-7. v0.7은 direct session-to-session chat bus를 제공해서는 안 된다.

### 9.3 Mid-session Memory Capture

REQ-MC-1. 사용자는 `/remember` 명령으로 memory를 즉시 생성할 수 있어야 한다.
REQ-MC-2. 사용자는 메시지 또는 메시지 범위를 선택해 memory로 저장할 수 있어야 한다.
REQ-MC-3. provider는 memory-worthy signal 감지 시 inline proposal을 생성할 수 있어야 한다.
REQ-MC-4. inline proposal은 configurable rate limit를 가져야 한다.
REQ-MC-5. 사용자가 reject를 반복하면 inline proposal 빈도는 자동 감소 가능해야 한다.
REQ-MC-6. 저장된 memory는 동일 session의 이후 retrieval에서 즉시 사용 가능해야 한다.

### 9.4 End-of-session Extraction

REQ-EE-1. End-of-session extraction은 선택 기능이어야 한다.
REQ-EE-2. 기본값은 OFF여야 한다.
REQ-EE-3. 활성화 시 session trace를 기준으로 memory proposal을 생성할 수 있어야 한다.
REQ-EE-4. 단일 primary session 구조를 해치지 않도록, extraction은 별도 새 session을 만들지 않아야 한다.

### 9.5 Session Trace Capture

REQ-ST-1. 사용자 메시지, assistant 메시지, tool call, tool result, file patch summary는 SessionEvent로 기록 가능해야 한다.
REQ-ST-2. hidden reasoning은 저장 금지해야 한다.
REQ-ST-3. 민감 정보는 redaction 정책을 따라야 한다.
REQ-ST-4. raw trace는 기본 retrieval 대상이 아니어야 한다.
REQ-ST-5. trace 저장 정책은 ProjectAgent별 experience settings로 제어 가능해야 한다.

### 9.6 Knowledge Inventory

REQ-KI-1. 시스템은 Rule / Memory / Episode / Pattern에 대한 얇은 Knowledge Inventory를 유지해야 한다.
REQ-KI-2. Inventory는 title, summary head, task signature, tags, artifact refs, status, importance/confidence 등 retrieval용 메타데이터를 포함해야 한다.
REQ-KI-3. Inventory는 긴 본문이나 raw trace를 저장해서는 안 된다.
REQ-KI-4. source object의 상태가 바뀌면 Inventory도 동기화되어야 한다.
REQ-KI-5. Context Assembly는 전체 저장소를 직접 훑기보다 Inventory shortlist를 우선 사용해야 한다.

### 9.7 SessionState

REQ-SS-1. 시스템은 primary session마다 SessionState를 유지해야 한다.
REQ-SS-2. SessionState는 최소한 current goal, current task signature, active artifact refs, open questions, pinned knowledge, rolling summary를 포함해야 한다.
REQ-SS-3. SessionState는 agent 전체 지식의 복사본이 아니라 현재 작업 상태만 표현해야 한다.
REQ-SS-4. topic shift가 감지되면 SessionState는 pinned knowledge와 rolling summary를 부분 초기화할 수 있어야 한다.
REQ-SS-5. SessionState는 retrieval 범위를 현재 작업에 맞게 좁히는 데 사용되어야 한다.

### 9.8 Context Assembly / Working Set

REQ-CA-1. 시스템은 매 turn마다 Context Assembly를 수행해 Working Set을 구성해야 한다.
REQ-CA-2. Context Assembly는 최소한 다음 단계를 가져야 한다: current turn 해석 → Inventory shortlist → SessionState 기반 재랭킹 → full fetch → dedup / quota 적용 → prompt assembly.
REQ-CA-3. Working Set은 Rule / Memory / Pattern / Case / Recent Turns의 제한된 묶음이어야 한다.
REQ-CA-4. Working Set은 strict token quota를 가져야 하며, quota 초과 시 낮은 우선순위 항목부터 제거해야 한다.
REQ-CA-5. 같은 사실을 설명하는 Memory / Pattern / Episode는 중복 주입해서는 안 된다.
REQ-CA-6. `proposed`, `weak`, `rejected` pattern은 기본 Working Set에서 제외해야 한다.
REQ-CA-7. raw trace는 기본 Working Set에서 제외해야 하며, forensic mode 또는 명시적 요청 시에만 포함할 수 있다.
REQ-CA-8. Context Assembly는 “왜 이 항목이 선택되었는가”를 설명 가능한 상태로 남겨야 한다.

### 9.9 Episode / Case Distillation

REQ-EP-1. 사용자는 `/case` 명령 또는 메시지 범위 선택으로 case를 수동 생성할 수 있어야 한다.
REQ-EP-2. 시스템은 같은 primary session의 trace를 기준으로 episode를 조용히 증류할 수 있어야 한다.
REQ-EP-3. Episode는 문제, 접근, 결과, 교훈을 포함해야 한다.
REQ-EP-4. Episode는 validation signal을 저장할 수 있어야 한다.
REQ-EP-5. Episode는 retrieval 시 case 타입으로 구분되어 주입되어야 한다.

### 9.10 Tacit Pattern Inference

REQ-TP-1. 시스템은 여러 episode를 기반으로 tacit pattern proposal을 만들 수 있어야 한다.
REQ-TP-2. evidence episode 수가 2개 미만이면 pattern 생성이 금지되어야 한다.
REQ-TP-3. evidence episode 수가 3개 이상이고 validation이 충분한 경우 confirmed 후보가 될 수 있어야 한다.
REQ-TP-4. 반례가 누적되면 pattern을 weak 또는 rejected로 낮출 수 있어야 한다.
REQ-TP-5. tacit pattern은 applicability와 evidence를 표시해야 한다.
REQ-TP-6. tacit pattern은 retrieval 시 memory와 구분되는 타입으로 주입되어야 한다.

### 9.11 Promotion Ladder

REQ-PR-1. confirmed tacit pattern은 memory 또는 standing order 승격 proposal을 생성할 수 있어야 한다.
REQ-PR-2. 승격은 사용자 승인 전까지 적용되어서는 안 된다.
REQ-PR-3. 승격된 memory는 provenance를 source pattern에 연결해야 한다.

### 9.12 Retrieval / Injection

REQ-RI-1. retrieval은 전체 저장소 직접 주입이 아니라 Inventory shortlist를 먼저 구성하는 방식이어야 한다.
REQ-RI-2. retrieval은 SessionState를 사용해 현재 task, active artifact, open question 범위로 좁혀야 한다.
REQ-RI-3. 최종 prompt에는 Working Set만 주입되어야 한다.
REQ-RI-4. Working Set의 우선순위는 Rule → Memory → Pattern → Case → Raw Trace 순이어야 한다.
REQ-RI-5. retrieval 항목은 타입 라벨과 핵심 메타데이터를 포함해야 한다.
REQ-RI-6. archived 또는 superseded memory는 기본 retrieval에서 제외해야 한다.
REQ-RI-7. rejected pattern과 기본 상태의 weak / proposed pattern은 retrieval에서 제외해야 한다.
REQ-RI-8. raw trace 주입은 명시적 요청 또는 forensic mode에서만 허용해야 한다.
REQ-RI-9. inject 시 참조 카운트를 갱신해야 한다.
REQ-RI-10. 같은 의미를 가진 Memory / Pattern / Episode는 한 Working Set 안에서 중복 주입되어서는 안 된다.

### 9.13 Dream

REQ-DR-1. Dream은 optional subsystem이어야 하며, MVP에서는 비활성화 가능해야 한다.
REQ-DR-2. Dream은 schedule, idle, threshold, user_manual로 트리거될 수 있어야 한다.
REQ-DR-3. Dream은 active memory, recent event, episode, pattern을 입력으로 사용할 수 있어야 한다.
REQ-DR-4. Dream은 proposal만 생성해야 하며 직접 변경을 적용해서는 안 된다.
REQ-DR-5. Dream은 merge, synthesis, supersede, archive, compress, retag, contradiction, episode creation, pattern inference, promotion proposal을 지원할 수 있어야 한다.
REQ-DR-6. Dream은 token budget 상한을 가져야 한다.
REQ-DR-7. Dream 실행 결과는 Dream Journal UI에 노출 가능해야 한다.

### 9.14 장기 비전: 전문가 간 협업 그래프 오케스트레이션

본 항목은 현재 구현 요구사항이 아니라 장기 방향을 문서화하기 위한 비구현 섹션이다.

장기적으로 시스템은 다음을 지원할 수 있다.

* ProjectAgent 간 `consult`, `share`, `notify` 기반 협업
* Connection / Link 관계의 그래프 구축
* 전문가 간 협업 패턴의 점진적 시각화
* pull 기반 orchestration

단, v0.7 현재 구현에서는 아래를 요구하지 않는다.

* cross-project collaboration runtime
* Network View 실제 UI
* 전문가 그래프를 활용한 자동 routing 또는 자동 orchestration

---

## 10. 동작 시나리오

### 10.1 Primary Session 상호작용 시나리오

1. 사용자가 ProjectAgent의 primary session을 연다.
2. 사용자는 같은 session 안에서 agent와 연속적으로 대화한다.
3. provider는 recent turns와 retrieval된 Rule / Memory / Pattern / Case를 바탕으로 응답한다.
4. 중요한 결정이나 실패가 생기면 memory가 즉시 저장된다.
5. 대화는 같은 session 안에서 계속 이어진다.

### 10.2 Context Assembly 시나리오

1. 사용자의 새 turn이 들어온다.
2. 시스템은 current turn parse를 수행해 task signature, active artifact, topic shift 여부를 추출한다.
3. SessionState를 로드한다.
4. Knowledge Inventory에서 관련 후보를 shortlist한다.
5. shortlist 후보 중 상위 일부만 원본 객체를 full fetch한다.
6. dedup, validity filter, quota를 적용해 Working Set을 만든다.
7. Recent Turns + Working Set으로 prompt를 조립한다.
8. 응답 후 reference_count, last_referenced_at, SessionState를 갱신한다.

### 10.3 Mid-session Memory Capture 시나리오

1. 사용자가 대화 중 중요한 결정을 언급한다.
2. provider 또는 heuristic이 memory-worthy signal을 감지한다.
3. 시스템은 inline proposal을 노출한다.
4. 사용자가 Accept하면 Memory가 생성된다.
5. 이후 turn의 retrieval에서 바로 사용 가능해진다.

### 10.4 Session Trace → Episode 시나리오

1. Primary Session 동안 SessionEvent가 누적된다.
2. 일정 조건이 충족되면 distillation job이 관련 event 묶음을 분석한다.
3. Episode 초안이 생성된다.
4. validation signal이 있으면 confidence가 높아진다.
5. Episode는 Experience 탭과 retrieval에서 사용 가능해진다.

### 10.5 Episode → Tacit Pattern 시나리오

1. 동일 task signature 또는 유사 패턴을 가진 episode가 누적된다.
2. Dream 또는 별도 inference job이 반복 구조를 찾는다.
3. evidence 수와 validation 조건을 확인한다.
4. TacitPattern proposal을 생성한다.
5. 사용자가 수락하면 proposed 또는 confirmed 상태로 저장된다.

### 10.6 Dream 시나리오

1. Dream schedule 또는 threshold가 트리거된다.
2. Dream maintenance job이 실행된다.
3. memory / event / episode / pattern을 입력으로 읽는다.
4. DreamProposal 목록을 생성한다.
5. 결과는 Dream Journal과 Inbox에 노출된다.
6. 사용자가 고위험 proposal을 검토한다.
7. 승인된 변경만 실제 데이터에 반영된다.

---

## 11. Retrieval 및 Context Assembly 규격

### 11.1 핵심 원칙

* 장기 저장소 전체를 prompt에 직접 주입하지 않는다.
* 먼저 Knowledge Inventory에서 후보를 찾는다.
* SessionState로 현재 작업 범위를 좁힌다.
* 실제 prompt에는 Working Set만 들어간다.
* raw trace는 기본 제외한다.
* 동일한 의미를 여러 층에서 중복 주입하지 않는다.

### 11.2 2단계 Retrieval 모델

시스템은 다음 2단계 모델을 사용해야 한다.

#### 1단계: Inventory Shortlisting

* Rule / Memory / Episode / Pattern 원본 전체를 직접 prompt 후보로 올리지 않는다.
* 먼저 Knowledge Inventory에서 현재 turn과 관련된 얇은 후보 목록을 찾는다.
* 이 단계에서는 title, summary head, task signature, tags, artifact refs, status, importance/confidence 같은 메타데이터만 사용한다.

#### 2단계: Full Fetch and Assembly

* shortlist된 후보 중 상위 일부만 원본 객체를 다시 읽는다.
* full fetch된 항목에 대해 dedup, validity filter, quota 적용을 수행한다.
* 최종적으로 Working Set을 만든 뒤 prompt를 조립한다.

### 11.3 Context Assembly 파이프라인

매 turn의 Context Assembly는 최소한 다음 순서를 가져야 한다.

1. **Current Turn Parse**
   사용자의 현재 입력에서 intent, task signature, active artifact, topic shift 여부를 추출한다.

2. **SessionState Load**
   현재 goal, open question, active artifact, pinned knowledge, rolling summary를 로드한다.

3. **Inventory Search**
   Rule / Memory / Pattern / Episode에 대해 얇은 shortlist를 만든다.

4. **Re-ranking**
   shortlist를 SessionState와 결합해 재랭킹한다.

5. **Full Fetch**
   각 bucket에서 상위 몇 개만 실제 본문을 로드한다.

6. **Dedup / Validity Filter**
   중복 의미 항목, archived / superseded / rejected / weak 항목을 제거한다.

7. **Quota Apply**
   token budget과 bucket quota에 맞게 Working Set을 줄인다.

8. **Prompt Assembly**
   Recent Turns + Working Set을 조립해 prompt를 생성한다.

9. **Post-turn Update**
   reference_count, last_referenced_at, SessionState, rolling summary를 갱신한다.

### 11.4 기본 retrieval 순서

1. Policy
2. Standing Order
3. Explicit Memory
4. Confirmed Tacit Pattern
5. Relevant Episode
6. Raw Trace Excerpt

단, 실제 주입 여부는 항상 SessionState와 quota 규칙을 함께 적용한 뒤 최종 결정한다.

### 11.5 랭킹 스코어

구현은 다음 요소를 조합한 가중 합 또는 동등한 랭킹 전략을 사용해야 한다.

#### Memory

* semantic relevance
* importance
* recent reference count
* task signature match
* active artifact match
* archived / superseded / stale penalty

#### Episode

* task signature similarity
* validation signal count
* outcome weight
* recency
* active artifact match

#### TacitPattern

* applicability match
* confidence
* evidence episode count
* last_confirmed_at recency
* current task relevance

### 11.6 Working Set bucket quota

구현은 bucket별 상한을 가져야 한다. 기본 예시는 다음과 같다.

* Policy: 1~3
* Standing Order: 0~3
* Memory: 3~5
* Pattern: 0~2
* Episode: 0~2
* Raw Trace: 기본 0

정확한 수치는 실험으로 조정할 수 있으나, 원칙은 유지해야 한다.

* 각 bucket은 상한이 있어야 한다.
* Working Set 전체 토큰 상한이 있어야 한다.
* quota 초과 시 낮은 우선순위 항목부터 제거해야 한다.

### 11.7 주입 포맷

주입 항목은 다음 형식을 따라야 한다.

```text
[Current Goal]
...

[Open Questions]
...

[Rule]
...

[Memory | importance N]
...

[Pattern | confidence N | evidence N]
...

[Case | outcome success|failure|mixed|blocked]
...
```

### 11.8 금지 규칙

* 전체 session history를 항상 prompt에 주입해서는 안 된다.
* Inventory 전체 목록을 모델에게 그대로 보여줘서는 안 된다.
* 같은 사실을 Memory, Pattern, Episode로 중복 주입해서는 안 된다.
* `proposed`, `weak`, `rejected` pattern을 기본 주입해서는 안 된다.
* raw trace를 기본 주입해서는 안 된다.

### 11.9 Topic Shift 처리

* topic shift가 감지되면 SessionState의 `topic_version`을 증가시켜야 한다.
* topic shift 시 pinned knowledge는 부분 초기화할 수 있어야 한다.
* 이전 작업과 무관한 working set 항목은 새 turn에서 제거되어야 한다.

### 11.10 참조 추적

* inject 시 `reference_count += 1`
* inject 시 `last_referenced_at = now()`
* 이 값은 Dream 또는 maintenance job의 importance recalibration과 pruning 판단에 사용한다.

### 11.11 설명 가능성

시스템은 각 injected item에 대해 최소한 다음을 설명할 수 있어야 한다.

* 왜 선택되었는가
* 어떤 task signature 또는 artifact와 연결되는가
* 어떤 source evidence를 갖는가

---

## 12. Dream 세부 규격

### 12.1 도입 원칙

* Dream은 필수 1차 기능이 아니다.
* Dream이 없더라도 primary session + explicit memory + trace + episode까지는 시스템이 동작해야 한다.
* Dream은 memory 및 experience 정리를 자동화하기 위한 선택적 subsystem이다.

### 12.2 Dream 입력 집합

Dream은 다음 입력 집합을 읽을 수 있어야 한다.

* active memory
* non-archived episode
* non-rejected tacit pattern
* recent hot / warm session event
* reference / importance metadata

### 12.3 Dream proposal 종류

* `merge`
* `synthesis`
* `supersede`
* `archive`
* `compress`
* `retag`
* `flag_contradiction`
* `promote_importance`
* `create_episode`
* `merge_episodes`
* `infer_pattern`
* `confirm_pattern`
* `weaken_pattern`
* `retire_pattern`
* `promote_pattern_to_memory`
* `promote_pattern_to_order`

### 12.4 안전 / 위험 구분

#### Safe bucket

* compress
* retag
* 낮은 위험의 promote_importance
* 명확한 duplicate merge

#### Review-required bucket

* supersede
* archive
* flag_contradiction
* confirm_pattern
* retire_pattern
* promote_pattern_to_memory
* promote_pattern_to_order

### 12.5 실패 처리

* Dream 실패 시 `status='failed'`로 기록해야 한다.
* 실패 로그와 원인 요약은 Dream Journal 또는 운영 로그에서 확인 가능해야 한다.
* 같은 입력 집합에 대한 무한 재시도는 금지해야 한다.

---

## 13. 저장 및 보존 정책

### 13.1 Trace 보존 계층

* **Hot Trace**: 최근 30일 기본값, 상세 preview + blob ref 유지
* **Warm Trace**: 최근 90일 기본값, 압축된 preview 중심
* **Cold Distilled Layer**: 장기 보존은 episode / pattern / memory 중심

### 13.2 민감 정보 처리

* `redact_secrets=true`가 기본값이어야 한다.
* 민감 정보 감지 시 SessionEvent 본문은 redacted preview만 저장하고, 원문은 저장하지 않거나 별도 안전 저장소에 격리한다.
* trace export 기능이 추가될 경우 redaction 후 export를 기본값으로 해야 한다.

### 13.3 삭제 및 archive

* archive는 soft removal이다.
* archive된 객체는 기본 retrieval에서 제외하되, UI와 검색에서 접근 가능해야 한다.
* hard delete 정책은 별도 관리 정책 또는 관리자 기능으로 제한한다.

---

## 14. UI 요구사항

### 14.1 ProjectAgent Detail

탭:

* Overview
* Session
* Memory
* Experience

  * Cases
  * Patterns
  * Evidence Chain
* Dream Journal
* Specs / Reports
* Connections (장기 비전)
* Network View (장기 비전)

#### Session 탭 요구사항

* primary session의 최근 turn 표시
* session provider 표시
* current goal, open questions, active artifact 요약 표시
* 현재 pin된 memory / pattern / case 요약 표시
* memory / episode capture 상태 요약 표시
* session timeline 접근 제공

#### Memory 탭 요구사항

* importance 표시
* capture mode 표시
* reference count 표시
* archived / superseded 표시
* source Dream / source Episode / source Pattern 링크 표시

#### Experience 탭 요구사항

* Episode 목록 표시
* Pattern 목록 표시
* Pattern confidence와 evidence count 표시
* Pattern 승격 액션 표시
* Evidence chain drill-down 제공

### 14.2 Session Detail

* `/remember` 자동완성
* `/case` 자동완성
* 메시지 또는 범위 선택 후 Save as memory / Save as case
* inline proposal card
* similar cases 패널
* current goal / open questions / active artifact 표시
* injected pattern why-this-was-shown 설명
* injected memory / pattern / case의 provenance 설명
* 이번 session에서 생성된 memory / episode 카운터

### 14.3 Inbox

* 위험한 Dream proposal
* contradiction flag
* pattern promotion 요청
* share / notify review item

### 14.4 Sidebar

* 미검토 Dream 존재 시 indicator
* consult / share unread marker
* ProjectAgent health summary

### 14.5 Mobile

* primary session 보기
* Dream Journal 보기
* proposal 승인 / 거절
* Memory / Experience 요약 보기
* linked report 열람

### 14.6 시각화 요구사항

#### Evidence Chain

* Memory, Episode, TacitPattern, Link, SessionEvent 사이의 provenance를 drill-down할 수 있어야 한다.
* Pattern에서 supporting episode로, episode에서 source event로 내려갈 수 있어야 한다.
* “왜 이 지식이 여기 있는가”를 설명할 수 있어야 한다.

#### 장기 비전

* Network View는 향후 전문가 간 협업 그래프를 시각화하기 위한 확장 포인트로만 문서화한다.
* v0.7 현재 구현에서는 Network View의 실제 UI 제공을 요구하지 않는다.

#### 시각화 원칙

* 시각화는 runtime 제어판이 아니라 inspectable artifact여야 한다.
* 시각화는 explanation과 debugging을 위한 것이며, 자동 orchestration의 근거로만 사용해서는 안 된다.

---

## 15. 데이터 스키마

### 15.0 `project_agents`

```sql
CREATE TABLE project_agents (
  id                     TEXT PRIMARY KEY,
  name                   TEXT NOT NULL,
  root_path              TEXT NOT NULL UNIQUE,
  description            TEXT,

  identity_prompt        TEXT NOT NULL,
  preferred_provider     TEXT,
  allowed_providers      TEXT NOT NULL,

  primary_session_id     TEXT,

  standing_order_ids     TEXT,
  policy_ids             TEXT,
  budget_id              TEXT,
  connection_ids         TEXT,
  spec_ids               TEXT,
  report_ids             TEXT,

  memory_settings_id     TEXT,
  dream_schedule_id      TEXT,
  experience_settings_id TEXT,

  created_at             TEXT NOT NULL,
  updated_at             TEXT NOT NULL
);
CREATE UNIQUE INDEX idx_project_agents_root_path ON project_agents(root_path);
CREATE INDEX idx_project_agents_updated ON project_agents(updated_at DESC);
```

#### 구현 참고

* `allowed_providers`, `standing_order_ids`, `policy_ids`, `connection_ids`, `spec_ids`, `report_ids`는 1차 구현에서 JSON 배열 문자열로 저장해도 된다.
* `primary_session_id`는 `sessions`와 순환 참조가 생기므로, 1차 구현에서는 DB foreign key보다 application invariant로 강제해도 된다.
* legacy JSON import 시 ProjectAgent 생성은 반드시 `root_path` 기준 dedup을 먼저 수행해야 한다.

### 15.1 `sessions`

```sql
CREATE TABLE sessions (
  id                TEXT PRIMARY KEY,
  agent_id          TEXT NOT NULL UNIQUE REFERENCES project_agents(id) ON DELETE CASCADE,
  current_provider  TEXT,
  status            TEXT NOT NULL DEFAULT 'active',
  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL
);
CREATE UNIQUE INDEX idx_sessions_agent_unique ON sessions(agent_id);
```

### 15.1.1 `session_states`

```sql
CREATE TABLE session_states (
  session_id            TEXT PRIMARY KEY REFERENCES sessions(id) ON DELETE CASCADE,
  agent_id              TEXT NOT NULL REFERENCES project_agents(id) ON DELETE CASCADE,
  current_goal          TEXT,
  current_task_signature TEXT,
  active_artifact_refs  TEXT,
  open_questions        TEXT,
  pinned_memory_ids     TEXT,
  pinned_episode_ids    TEXT,
  pinned_pattern_ids    TEXT,
  rolling_summary       TEXT,
  topic_version         INTEGER NOT NULL DEFAULT 0,
  updated_at            TEXT NOT NULL
);
CREATE INDEX idx_session_states_agent ON session_states(agent_id, updated_at DESC);
```

### 15.1.2 `knowledge_inventory`

```sql
CREATE TABLE knowledge_inventory (
  id                  TEXT PRIMARY KEY,
  agent_id            TEXT NOT NULL REFERENCES project_agents(id) ON DELETE CASCADE,
  kind                TEXT NOT NULL,
  source_ref_id       TEXT NOT NULL,
  title               TEXT NOT NULL,
  summary_head        TEXT NOT NULL,
  task_signature      TEXT,
  tags                TEXT,
  artifact_refs       TEXT,
  status              TEXT NOT NULL,
  importance          INTEGER,
  confidence          INTEGER,
  updated_at          TEXT NOT NULL,
  last_referenced_at  TEXT,
  reference_count     INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_knowledge_inventory_agent_kind ON knowledge_inventory(agent_id, kind, status);
CREATE INDEX idx_knowledge_inventory_signature ON knowledge_inventory(agent_id, task_signature);
CREATE INDEX idx_knowledge_inventory_updated ON knowledge_inventory(agent_id, updated_at DESC);
```

#### 구현 참고

* `knowledge_inventory`는 실제 테이블로 구현할 수도 있고, materialized view 또는 검색 인덱스로 구현할 수도 있다.
* 구현 방식과 무관하게, Context Assembly가 먼저 참조하는 얇은 카탈로그라는 성질은 유지해야 한다.
* Working Set은 ephemeral object이므로 영구 저장 테이블을 요구하지 않는다.

### 15.2 `memories`

```sql
CREATE TABLE memories (
  id                  TEXT PRIMARY KEY,
  agent_id            TEXT NOT NULL REFERENCES project_agents(id) ON DELETE CASCADE,
  kind                TEXT NOT NULL,
  content             TEXT NOT NULL,
  detail              TEXT,
  tags                TEXT,

  capture_mode        TEXT NOT NULL DEFAULT 'end_extraction',
  source_session_id   TEXT,
  source_provider     TEXT,
  source_agent_id     TEXT,
  source_link_id      TEXT,
  source_dream_id     TEXT REFERENCES dreams(id),
  source_memory_ids   TEXT,
  source_episode_ids  TEXT,
  source_pattern_id   TEXT REFERENCES tacit_patterns(id),

  superseded_by       TEXT REFERENCES memories(id),
  importance          INTEGER NOT NULL DEFAULT 50,
  last_referenced_at  TEXT,
  reference_count     INTEGER NOT NULL DEFAULT 0,
  archived            INTEGER NOT NULL DEFAULT 0,

  created_at          TEXT NOT NULL,
  updated_at          TEXT NOT NULL
);
CREATE INDEX idx_memories_importance ON memories(agent_id, importance DESC)
  WHERE archived = 0 AND superseded_by IS NULL;
CREATE INDEX idx_memories_capture_mode ON memories(agent_id, capture_mode);
```

### 15.3 `session_events`

```sql
CREATE TABLE session_events (
  id                TEXT PRIMARY KEY,
  agent_id          TEXT NOT NULL REFERENCES project_agents(id) ON DELETE CASCADE,
  session_id        TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  turn_index        INTEGER NOT NULL,
  role              TEXT NOT NULL,
  event_type        TEXT NOT NULL,
  content_preview   TEXT NOT NULL,
  content_blob_ref  TEXT,
  tool_name         TEXT,
  artifact_refs     TEXT,
  tags              TEXT,
  outcome_signal    TEXT,
  sensitivity       TEXT NOT NULL DEFAULT 'normal',
  created_at        TEXT NOT NULL
);
CREATE UNIQUE INDEX idx_session_events_unique_turn ON session_events(session_id, turn_index);
CREATE INDEX idx_session_events_agent ON session_events(agent_id, created_at DESC);
CREATE INDEX idx_session_events_outcome ON session_events(agent_id, outcome_signal);
```

#### 구현 참고

* 현재 UI와 provider transcript 재구성을 위해 `session_events`만으로는 부족하므로, `content_blob_ref`가 가리키는 본문 저장소를 반드시 함께 둬야 한다.
* 1차 구현은 `.data/backend/blobs/<event-id>.md` 같은 파일 blob 저장소로 시작해도 된다.
* recent turn window API는 `session_events` 메타데이터와 blob 본문을 hydrate하여 기존 chat UI가 바로 사용할 수 있는 형태로 반환해야 한다.

### 15.4 `episodes`

```sql
CREATE TABLE episodes (
  id                  TEXT PRIMARY KEY,
  agent_id            TEXT NOT NULL REFERENCES project_agents(id) ON DELETE CASCADE,
  source_session_id   TEXT REFERENCES sessions(id) ON DELETE SET NULL,

  title               TEXT NOT NULL,
  task_signature      TEXT NOT NULL,
  kind                TEXT NOT NULL,
  summary             TEXT NOT NULL,
  outcome             TEXT NOT NULL,
  lesson              TEXT,
  applicability       TEXT,

  validation_signals  TEXT,
  source_event_ids    TEXT NOT NULL,
  derived_memory_ids  TEXT,

  status              TEXT NOT NULL DEFAULT 'draft',
  confidence          INTEGER NOT NULL DEFAULT 50,
  reference_count     INTEGER NOT NULL DEFAULT 0,
  last_referenced_at  TEXT,

  created_by          TEXT NOT NULL,
  created_at          TEXT NOT NULL,
  updated_at          TEXT NOT NULL
);
CREATE INDEX idx_episodes_agent ON episodes(agent_id, created_at DESC);
CREATE INDEX idx_episodes_signature ON episodes(agent_id, task_signature);
CREATE INDEX idx_episodes_status ON episodes(agent_id, status);
```

### 15.5 `tacit_patterns`

```sql
CREATE TABLE tacit_patterns (
  id                         TEXT PRIMARY KEY,
  agent_id                   TEXT NOT NULL REFERENCES project_agents(id) ON DELETE CASCADE,

  kind                       TEXT NOT NULL,
  statement                  TEXT NOT NULL,
  applicability              TEXT,
  counterexamples            TEXT,

  evidence_episode_ids       TEXT NOT NULL,
  confidence                 INTEGER NOT NULL DEFAULT 50,
  validation_status          TEXT NOT NULL DEFAULT 'proposed',

  promoted_memory_id         TEXT REFERENCES memories(id),
  promoted_standing_order_id TEXT,

  last_confirmed_at          TEXT,
  reference_count            INTEGER NOT NULL DEFAULT 0,
  last_referenced_at         TEXT,

  created_by                 TEXT NOT NULL,
  created_at                 TEXT NOT NULL,
  updated_at                 TEXT NOT NULL
);
CREATE INDEX idx_patterns_agent ON tacit_patterns(agent_id, created_at DESC);
CREATE INDEX idx_patterns_status ON tacit_patterns(agent_id, validation_status, confidence DESC);
```

### 15.6 `dreams`

```sql
CREATE TABLE dreams (
  id                  TEXT PRIMARY KEY,
  agent_id            TEXT NOT NULL REFERENCES project_agents(id) ON DELETE CASCADE,
  scope               TEXT NOT NULL,
  triggered_by        TEXT NOT NULL,
  status              TEXT NOT NULL,

  input_memory_count  INTEGER NOT NULL DEFAULT 0,
  input_memory_ids    TEXT,
  input_episode_count INTEGER NOT NULL DEFAULT 0,
  input_episode_ids   TEXT,
  input_pattern_count INTEGER NOT NULL DEFAULT 0,
  input_pattern_ids   TEXT,
  input_event_count   INTEGER NOT NULL DEFAULT 0,

  provider            TEXT NOT NULL,
  tokens_used         INTEGER NOT NULL DEFAULT 0,
  duration_ms         INTEGER NOT NULL DEFAULT 0,

  started_at          TEXT NOT NULL,
  ended_at            TEXT,
  reviewed_at         TEXT
);
CREATE INDEX idx_dreams_agent ON dreams(agent_id, started_at DESC);
CREATE INDEX idx_dreams_status ON dreams(status);
```

### 15.7 `dream_proposals`

```sql
CREATE TABLE dream_proposals (
  id                   TEXT PRIMARY KEY,
  dream_id             TEXT NOT NULL REFERENCES dreams(id) ON DELETE CASCADE,
  kind                 TEXT NOT NULL,
  rationale            TEXT NOT NULL,
  affected_memory_ids  TEXT,
  affected_episode_ids TEXT,
  affected_pattern_ids TEXT,
  proposed_change      TEXT NOT NULL,
  status               TEXT NOT NULL DEFAULT 'pending',
  user_decision_at     TEXT,
  created_at           TEXT NOT NULL
);
CREATE INDEX idx_proposals_dream ON dream_proposals(dream_id);
CREATE INDEX idx_proposals_status ON dream_proposals(status);
```

### 15.8 `dream_schedules`

```sql
CREATE TABLE dream_schedules (
  agent_id            TEXT PRIMARY KEY REFERENCES project_agents(id) ON DELETE CASCADE,
  enabled             INTEGER NOT NULL DEFAULT 0,
  schedule_kind       TEXT NOT NULL,
  schedule_value      TEXT,
  last_run_at         TEXT,
  next_run_at         TEXT,
  preferred_provider  TEXT,
  token_budget        INTEGER
);
```

### 15.9 `experience_settings`

```sql
CREATE TABLE experience_settings (
  agent_id                  TEXT PRIMARY KEY REFERENCES project_agents(id) ON DELETE CASCADE,
  trace_capture_enabled     INTEGER NOT NULL DEFAULT 1,
  auto_episode_enabled      INTEGER NOT NULL DEFAULT 1,
  pattern_inference_enabled INTEGER NOT NULL DEFAULT 1,
  hot_trace_days            INTEGER NOT NULL DEFAULT 30,
  warm_trace_days           INTEGER NOT NULL DEFAULT 90,
  redact_secrets            INTEGER NOT NULL DEFAULT 1
);
```

---

## 16. 운영 및 관측 가능성

### 16.1 필수 메트릭

* memory 생성 수
* mid-session capture accept / reject 비율
* inline proposal 노출 수
* trace 저장량
* inventory shortlist hit rate
* context assembly latency
* working set token size
* episode auto-create 수
* pattern proposed / confirmed / rejected 수
* dream 실행 수
* dream 실패율
* dream 토큰 사용량
* retrieval hit type 분포(rule / memory / pattern / case)
* reference_count 증가 추이
* evidence chain drill-down 사용 빈도

### 16.2 로그 요구사항

* Dream 실행 로그
* proposal 생성 로그
* supersede / archive / promotion 승인 로그
* redaction 이벤트 로그
* cross-project share / consult provenance 로그

### 16.3 알림 요구사항

* Dream 실패 알림
* review-required proposal 누적 알림
* budget threshold 초과 알림

---

## 17. 보안 및 프라이버시 요구사항

SEC-1. hidden reasoning 저장 금지
SEC-2. 민감 정보 redaction 기본 ON
SEC-3. 장기적으로 cross-project 공유 기능이 도입될 경우 provenance와 권한 검증이 필수여야 함
SEC-4. archived / deleted 데이터 접근은 권한 검사를 거쳐야 함
SEC-5. raw trace export 시 redacted view를 기본값으로 사용해야 함
SEC-6. pattern 승격 또는 memory 공유 시 source evidence를 추적 가능해야 함
SEC-7. primary session 외부의 숨겨진 interactive context를 생성해서는 안 됨

---

## 18. 마이그레이션 및 롤아웃

### 18.1 구조 개정 요약

* 복수 active session 가정을 제거한다.
* SessionEdge 및 Session Graph 개념을 제거한다.
* session은 ProjectAgent당 하나의 primary channel로 단순화한다.
* Dream은 session이 아니라 optional maintenance job으로 재정의한다.

### 18.1.1 현재 저장소 기준 출발점

현재 Agent Web Manager 저장소는 다음 구조를 기준으로 통합해야 한다.

* `packages/shared`: 공용 타입, provider 라벨, transcript helper 등 공유 로직
* `apps/backend`: provider subprocess 실행, 세션 저장, WebSocket 스트리밍을 담당하는 단일 backend
* `apps/frontend-server`: 백엔드 레지스트리 보관 및 다중 backend 프록시/집계 레이어
* `apps/frontend`: 세션 중심 React UI

현재 구현의 특징은 다음과 같다.

* backend 저장소는 SQLite가 아니라 JSON 파일 기반 session store다.
* provider 연동은 Codex / Claude / Kimi CLI subprocess 실행이 기본이다.
* frontend-server는 backend의 `/api/...` 엔드포인트를 compound id 기반으로 프록시한다.
* frontend UI는 `session list → session detail` 중심이다.

따라서 v0.7 통합은 **새 제품을 별도로 만드는 작업이 아니라, 현재 저장소를 ProjectAgent 중심 구조로 재편하는 작업**으로 계획해야 한다.

### 18.1.2 기존 구조와 v0.7 도메인 매핑

| 현재 구조 | v0.7 목표 구조 | 통합 원칙 |
|---|---|---|
| backend의 `BackendSessionRecord` | `ProjectAgent` + `Session` + `SessionState` | 현재 세션 레코드를 분해해 agent 중심 모델로 재구성한다. |
| `record.messages[]` 대화 배열 | `SessionEvent` + recent-turn query | 채팅 렌더링과 prompt recent window를 위해 원문은 blob/file 또는 동등한 본문 저장소에 유지하고, event row에는 preview와 메타데이터를 둔다. |
| `provider.ts`의 CLI 실행 함수 | `ProviderAdapter` 프로토콜 구현 | 현재 subprocess 자산은 유지하되, `start/send/stop` 및 retrieval/injection 흐름으로 감싼다. |
| frontend의 session sidebar | ProjectAgent sidebar | 사용자에게는 프로젝트 단위 진입점을 보여주고, 그 안에서 primary session을 연다. |
| frontend-server의 compound session id | compound agent/session id 또는 동등한 proxy key | 다중 backend 집계 구조는 유지하되, 1차 식별자를 session에서 agent로 이동한다. |
| `.data/.../sessions/*.json` | `.data/.../awm.db` | 영속 계층은 SQLite로 통합하고 legacy JSON은 startup migration 대상으로 본다. |

### 18.1.3 API / 런타임 통합 계획

구현은 다음 원칙으로 현재 앱에 통합해야 한다.

1. backend에 v0.7용 **신규 `/api/v1/...` 엔드포인트**를 추가한다.
2. 기존 `/api/...` 엔드포인트는 frontend 절체가 끝날 때까지 compatibility layer로 유지한다.
3. frontend-server는 신규 `/api/v1/...` 경로를 backend로 그대로 프록시하고, 필요한 경우 compound id rewrite만 수행한다.
4. `packages/shared`에 v0.7 canonical type을 먼저 정의하고, backend/frontend/frontend-server는 이 타입을 공통으로 사용한다.
5. provider 실행부는 현재 CLI 기반을 유지하되, backend 내부 경계는 `ProviderAdapter` 기준으로 통일한다.
6. WebSocket은 기존 chat stream을 대체하지 말고 확장한다. 즉, 초기 단계에서는 `message_appended / text_delta / message_complete` 흐름을 유지하면서 `session_state_update`, `memory_proposal`, `inventory_hit` 같은 v0.7 이벤트를 점진적으로 추가한다.

### 18.1.4 Legacy 데이터 마이그레이션 계획

기존 JSON session 저장소를 새 구조로 옮길 때는 다음 규칙을 따른다.

1. startup 시 backend는 `.data/backend/sessions/*.json` 존재 여부를 검사한다.
2. 새 DB 파일(`.data/backend/awm.db`)이 비어 있고 legacy JSON이 존재하면 1회성 import migration을 수행한다.
3. migration 기준 단위는 **legacy session이 아니라 `workDir/root_path`** 이다. 즉, 같은 경로를 가리키는 여러 legacy session은 하나의 ProjectAgent로 통합한다.
4. 같은 `root_path`를 가진 legacy session이 여러 개면, 가장 최근 `lastUpdated` 세션을 canonical primary session의 seed transcript로 사용한다.
5. 그보다 오래된 legacy session은 별도 active session으로 복원하지 않고, 다음 둘 중 하나로 변환한다.
   * `imported episode` 후보
   * `legacy-import` 태그가 붙은 cold session event 묶음
6. migration은 원본 JSON을 즉시 삭제하지 않는다. DB import 완료 후 `migrated/` 폴더로 이동하거나 `.bak`로 보존한다.
7. migration 결과 충돌(중복 root path, 손상 JSON, provider 미상)은 `migration_report`에 기록하고 UI Inbox 또는 운영 로그에서 검토 가능해야 한다.

### 18.1.5 UI 통합 계획

현재 UI가 session 중심이므로, v0.7 UI 전환은 다음 순서를 따른다.

1. 기존 sidebar의 1차 목록 단위를 `Session`에서 `ProjectAgent`로 바꾼다.
2. 현재 session detail 화면은 제거하지 않고, `ProjectAgent Detail > Session 탭` 안으로 재배치한다.
3. 기존 create-session dialog는 `create-project-agent dialog`로 대체하고, 초기 provider 선택은 primary session의 `current_provider` seed 값으로 저장한다.
4. 현재 archive/delete/fork 같은 session 액션은 v0.7 의미가 정리될 때까지 숨기거나 project 단위 액션으로 재정의한다.
5. frontend-server를 쓰는 다중 backend 환경에서는 sidebar에 backend/server 경계가 아니라 ProjectAgent 경계를 먼저 노출하고, server 표시는 보조 메타데이터로만 둔다.

### 18.2 점진 롤아웃

1. Phase 1: primary session + memory capture + session trace capture + SessionState
2. Phase 2: Knowledge Inventory + Context Assembly + retrieval reference tracking
3. Phase 3: episode distillation + tacit pattern inference
4. Phase 4: optional Dream subsystem
5. 전문가 간 협업 그래프 오케스트레이션은 장기 비전으로만 유지

### 18.3 실험 플래그 후보

* `enable_inline_memory_proposals`
* `enable_session_state_updates`
* `enable_knowledge_inventory`
* `enable_context_assembly`
* `enable_auto_episode_distillation`
* `enable_tacit_pattern_inference`
* `enable_optional_dream`
* `enable_pattern_promotion`

### 18.4 장기 비전 메모

전문가 간 협업 관계를 점진적으로 그래프로 구축하는 방향은 유지한다. 다만 이는 현재 구현 우선순위가 아니라, **ProjectAgent 내부의 전문가 경험 축적이 충분히 검증된 뒤** 다음 단계에서 설계한다.

---

## 19. 수용 기준

### 19.1 기능 수용 기준

AC-1. 사용자는 하나의 primary session 안에서 계속 대화할 수 있어야 한다.
AC-2. 하나의 ProjectAgent에 복수 active interactive session이 생성되지 않아야 한다.
AC-3. 사용자는 `/remember`로 memory를 생성할 수 있어야 한다.
AC-4. 같은 session의 이후 turn은 방금 생성된 memory를 retrieval에 반영해야 한다.
AC-5. SessionEvent는 user / assistant / tool 흐름을 저장해야 한다.
AC-6. raw trace는 기본 prompt에 직접 주입되지 않아야 한다.
AC-7. trace에서 episode를 생성할 수 있어야 한다.
AC-8. 여러 episode에서 tacit pattern proposal을 생성할 수 있어야 한다.
AC-9. Dream은 활성화된 경우 proposal-only 방식으로 동작해야 한다.
AC-10. 고위험 Dream proposal은 사용자 승인 없이 적용되지 않아야 한다.
AC-11. retrieval은 Inventory shortlist → SessionState 기반 재랭킹 → Working Set assembly 순서를 따라야 한다.
AC-12. retrieval 결과는 Rule → Memory → Pattern → Case 우선순위를 따라야 한다.
AC-13. archived / superseded / rejected 상태 객체는 기본 retrieval에서 제외되어야 한다.
AC-14. 사용자는 Evidence Chain을 통해 pattern → episode → trace provenance를 확인할 수 있어야 한다.
AC-15. 같은 의미를 가진 Memory / Pattern / Episode가 한 turn에 중복 주입되지 않아야 한다.

### 19.2 품질 수용 기준

AC-Q-1. inline proposal rate limit가 동작해야 한다.
AC-Q-2. 민감 정보 redaction이 적용되어야 한다.
AC-Q-3. Dream 실패는 관측 가능해야 한다.
AC-Q-4. pattern evidence chain이 UI에서 추적 가능해야 한다.
AC-Q-5. reference_count와 last_referenced_at 갱신이 정확해야 한다.
AC-Q-6. 동일 agent에 두 번째 active session 생성 시도가 차단되어야 한다.
AC-Q-7. Working Set token quota가 강제되어야 한다.
AC-Q-8. topic shift 시 SessionState가 적절히 갱신되어야 한다.

---

## 20. 미해결 이슈

OQ-1. `task_signature` 생성 규칙을 문자열 규약으로 고정할지, embedding 기반 유사도와 병행할지 결정 필요
OQ-2. trace redaction을 정규식 + 분류기 혼합으로 할지 결정 필요
OQ-3. Dream proposal의 safe bucket 범위를 얼마나 넓힐지 추가 실험 필요
OQ-4. pattern confidence 계산 공식을 rule-based로 둘지, 학습형 랭킹을 도입할지 결정 필요
OQ-5. primary session이 매우 길어질 때 recent-turn window와 retrieval 경계를 어떻게 자를지 결정 필요
OQ-6. Knowledge Inventory를 별도 테이블, materialized view, 검색 인덱스 중 어떤 형태로 유지할지 결정 필요
OQ-7. Working Set bucket quota의 기본값을 어떤 수치로 둘지 실험 필요
OQ-8. topic shift detection을 규칙 기반으로 할지, 모델 보조로 할지 결정 필요

---

## 21. 구현 우선순위

### Phase 1

* `packages/shared`에 `ProjectAgent`, `SessionState`, `Memory`, `SessionEvent` canonical type 추가
* `apps/backend`에 SQLite 저장소와 `project_agents`, `sessions`, `session_states`, `memories`, `session_events` 마이그레이션 추가
* `apps/backend`의 legacy JSON import 경로 추가
* `apps/backend`에 `/api/v1/agents`, `/api/v1/agents/:id`, `/api/v1/sessions/:id/events` 기본 API 추가
* `apps/frontend-server`에 v1 agent/session 프록시 경로 추가
* `apps/frontend`에서 sidebar를 ProjectAgent 기준으로 전환
* Primary Session
* Memory
* `/remember`
* inline memory proposal
* SessionEvent 저장
* SessionState

### Phase 2

* `knowledge_inventory` 저장/동기화 로직
* `apps/backend` Context Assembly / Working Set 파이프라인
* retrieval reference tracking
* `apps/frontend` Experience 탭 기초 UI
* `apps/frontend` Evidence chain 1차 UI
* `apps/frontend-server`에서 v1 retrieval/debug endpoint 프록시

### Phase 3

* Episode distillation
* Tacit pattern inference
* Pattern promotion flow
* legacy imported trace를 episode 후보로 승격하는 도구 추가

### Phase 4

* Optional Dream core
* DreamProposal
* Dream Journal
* Dream 관련 review/inbox UI

### Phase 5 (장기 비전)

* cross-project consult / share 고도화
* 전문가 간 관계 그래프
* Network View

---

## 22. 최종 요약

본 명세의 핵심은 다음이다.

1. 프로젝트 폴더는 ProjectAgent라는 영속적 주체로 구현한다.
2. 각 ProjectAgent에는 하나의 primary session만 둔다.
3. 사용자와 agent는 같은 session 안에서 계속 대화하면서 영속 정보를 갱신한다.
4. explicit memory는 즉시 캡처 가능해야 한다.
5. session trace는 raw evidence로 저장하되 기본 prompt 주입은 금지한다.
6. agent가 무엇을 알고 있는지는 Knowledge Inventory로, 지금 무엇을 하는지는 SessionState로 분리해야 한다.
7. 매 turn의 실제 컨텍스트는 Context Assembly가 만든 Working Set이어야 한다.
8. trace는 episode로, episode는 tacit pattern으로 증류할 수 있어야 한다.
9. Dream은 필수가 아니라 선택적 maintenance subsystem이며 proposal-only로 동작해야 한다.
10. retrieval은 Inventory shortlist → SessionState 기반 좁히기 → Working Set 구성 순으로 동작해야 한다.
11. 모든 고위험 변경은 사용자 승인 게이트를 거쳐야 한다.
12. 전문가 간 협업 그래프 오케스트레이션은 장기 비전으로 유지하되, 현재 단계에서는 내부 전문가 경험 축적에 집중한다.

이 구조를 통해 Agent Web Manager는 멀티 컨텍스트 시스템이 아니라, **하나의 지속적 대화 채널을 중심으로 프로젝트 지식을 축적하고, 저장소와 작업 컨텍스트를 분리해 안정적으로 불러오는 영속적 작업 시스템**으로 구현된다.

**End of Engineering Spec v0.7**
