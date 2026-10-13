---
author: flow-machine-draft
created_at: 2026-10-13T01:14:30.214Z
---
# 需求规格（Requirements）— 2026-10-13-multiturn-changeid-misjudge

## 功能需求

### FR-01: 聊天会话的 interactive 轮保持 active，不再被 run.change_id 误收口

- 必须：`_apply_session_terminal_status` 的多轮判定改以 **session 级** `AgentSession.change_id` 为锚——`session.change_id IS NULL` 且 `run.spec_strategy == "interactive"` 的会话，无论该轮 run 的 `change_id`/`status`（completed/failed）如何，一律返回 `active`，禁止因 2026-10-12-run-level-change-attribution 写入的 run 级 change_id 把会话终态化。

#### 场景：聊天轮带归因 change_id 完成不收口

- Given：聊天会话（session.change_id=NULL，session.status=active），本轮 run.spec_strategy="interactive"、run.change_id 非空（轮级归因打锚）、run.status="completed"
- When：run 终态回写调用 `_apply_session_terminal_status(run, session)`
- Then：返回 "active"，会话保持 active 等下一轮（生产实证：会话 47e2ff1a 今晨 08:40:38 / 08:47:49 / 09:04:38 三次误置 ended）

#### 场景：聊天轮失败不收口

- Given：同上，但 run.status="failed"（任意 error_detail，含不可恢复失败）
- When：调用判定
- Then：返回 "active"（多轮分支先于 D-006 豁免命中——恢复既有归因功能上线前语义）

### FR-02: 真绑定会话（session.change_id 非空）维持既有收口语义

- 必须：`session.change_id` 非空的会话（stage 派发经 interactive dispatch 创建，create.py 写 session 级 change_id）按 run.status 收口——completed→"ended"、failed→"failed"；D-006 可恢复失败豁免（quota_exceeded / context_overflow → active）判定条件与优先级零变化。

#### 场景：stage 会话完成收口

- Given：session.change_id 非空、run.spec_strategy="interactive"、run.change_id 非空、run.status="completed"
- When：调用判定
- Then：返回 "ended"（与修复前一致）

#### 场景：stage 会话可恢复失败豁免不变

- Given：session.change_id 非空、run.spec_strategy="interactive"、run.status="failed"、error_detail.type="quota_exceeded"
- When：调用判定
- Then：返回 "active"（D-006 既有行为零回归）

### FR-03: 单轮任务收口语义零回归

- 必须：非 interactive 策略（platform-managed / sillyspec / quick-chat / group_carrier / None）的单轮会话维持既有语义——completed→"ended"、failed/killed→"failed"，不受本修复影响。

#### 场景：quick-chat 完成收口

- Given：run.spec_strategy="quick-chat"、run.status="completed"、session.change_id=NULL
- When：调用判定
- Then：返回 "ended"（策略非 interactive，多轮分支不命中）

### FR-04: D-005 幂等守卫零回归

- 必须：session 已处于终态（ended/failed）时，无论 run 形态如何，判定返回 `None`（不覆盖既有终态）。

#### 场景：已终态会话不复活

- Given：session.status="ended"、run.spec_strategy="interactive"、session.change_id=NULL、run.status="completed"
- When：调用判定
- Then：返回 None

## 测试绑定（每条 FR 至少一行——`FR-NN: test/路径「用例名」`；空行/待填在 flow done 拒收）

FR-01: backend/app/modules/daemon/tests/test_apply_session_terminal_status.py「TestChatTurnAttributionNotTerminal」
FR-02: backend/app/modules/daemon/tests/test_apply_session_terminal_status.py「test_interactive_with_change_completed_returns_edge_ended / TestRecoverableFailureKeepsSessionActive」
FR-03: backend/app/modules/daemon/tests/test_apply_session_terminal_status.py「test_quick_chat_completed_returns_ended / test_platform_managed_completed_returns_ended / test_sillyspec_completed_returns_ended / test_none_spec_strategy_completed_returns_ended」
FR-04: backend/app/modules/daemon/tests/test_apply_session_terminal_status.py「test_idempotent_ended_even_for_multi_turn」
