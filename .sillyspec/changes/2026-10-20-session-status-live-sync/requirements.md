---
author: flow-machine-draft
created_at: 2026-10-20T07:02:11.489Z
---
# 需求规格（Requirements）— 2026-10-20-session-status-live-sync

## 功能需求

### FR-01: 后端在上述 run 状态迁移点补发 publish_sessions_changed（复用既有哑信号链路，Redis 抖动静默容错不拖挂业务写路径）

- 后端必须在以下 5 个 run 状态迁移点成功落库后补发 `publish_sessions_changed("status_changed", session_id, session_user_id)`，复用既有哑信号链路（Redis Pub/Sub → `/api/daemon/sessions/events` SSE → 前端列表失效）：
  1. 多轮会话新 run 创建（`inject.py _inject_into_session` commit 后；纯切换轮 silent_config_switch 不发——无 LLM 轮无可见状态）；
  2. run pending→running 激活（`submit_commit.py` 激活块 rowcount>0 时，经 `PublishIntent` 标量带出、`publish_submitted_messages`（DB 连接归还后）补发——对齐 QueuePool 修复 3 的「commit 前提取标量、连接归还后 publish」纪律）；
  3. run→pending_approval（`coordinator.py request_approval` commit 后）；
  4. approve 翻回 pending（`coordinator.py approve` commit 后；token 校验失败等异常路径不发）；
  5. run 终态但多轮会话 keep-active（`close_run_steps.py _close_flip_session` 的 `new_status=="active"` 分支也置 `sessions_changed_intent`，复用既有 :560 发布点——原注释「列表视图无状态变化，不发」的假设已过时：列表项的 `current_run_status` 会从 running→None，是可见状态变化）。
- 发布必须保持既有静默容错语义（Redis 抖动仅 log.warning 不抛，不拖挂业务写路径）；`_apply_session_terminal_status` 返回 None（会话已终态）时禁止置发。

#### 场景：发消息后左侧立即转圈

- Given 用户在某打开的多轮会话发送一条消息（左侧列表当前为 idle 徽标）
- When inject 落库新 run（pending）并 commit
- Then 后端发布一条 `agent_sessions:changed` status_changed 信号（session_id=该会话，user_id=会话属主），前端经既有 400ms 去抖失效列表查询后，该会话徽标呈现「正在执行」

#### 场景：等待审批即时可见

- Given run 正在执行，左侧徽标转圈「正在执行」
- When run 翻 pending_approval 并 commit（request_approval 成功）
- Then 后端发布 status_changed 信号，左侧徽标秒级翻为琥珀「在等你」

#### 场景：审批通过恢复执行

- Given run 停在 pending_approval，左侧徽标「在等你」
- When 用户带正确 token 审批通过（approve 成功 commit，run 翻回 pending）
- Then 后端发布 status_changed 信号，左侧徽标翻回「正在执行」；token 无效/状态不符的拒绝路径不发布

#### 场景：run 激活不发假信号

- Given submit_messages 上报时 run 已被并发收口为终态（条件 UPDATE rowcount=0）
- When `_submit_finalize` 激活块跳过激活
- Then 不构造列表信号标量，publish 阶段不发布

### FR-02: 前端收到信号后经既有 400ms 去抖失效列表查询，左侧状态标签在 run 状态迁移后秒级（≤2s）更新，与右侧会话状态一致，不再依赖轮询 tick

- 前端经既有 `subscribeAgentSessionsEvents` SSE 订阅 + `SESSION_LIST_REFRESH_DEBOUNCE_MS`（400ms）去抖失效 `["agentSessions"]` 查询链路消费上述信号，列表刷新链路本身禁止改动（零新增基建）；秒级一致性由机制保证（SSE 推送亚秒 + 去抖 400ms + refetch，总时延远低于 2s，非轮询 tick 依赖）。
- 作为 Redis 信号丢失时的本地兜底，`session-panel-page.tsx` 的 `onPermissionRequest` 处理器必须同步调用 `onSessionListRefresh?.()`（与既有 turn_completed 新完成分支同款调用；dialog 模式不传该回调时天然不受影响）。该补偿 SHOULD 限于审批等待边沿（用户可操作状态、即时性最敏感），turn_started 等其余边沿由后端信号覆盖，禁止为省事全量扇出。

#### 场景：审批弹框与左侧徽标同步

- Given 用户正打开某会话页，该会话 run 即将请求审批
- When streamSession 收到 permission_request 事件
- Then 右侧弹出审批交互的同时，`onSessionListRefresh` 被调用（经 400ms 去抖触发列表失效），左侧徽标翻「在等你」不依赖后端信号到达

### FR-03: 多轮会话 run 完成（会话保持 active）时左侧转圈徽标同样秒级收敛

- 多轮会话 run 终态且会话 keep-active（`_close_flip_session` 返回 active）时，后端必须置 `sessions_changed_intent` 使 commit 后广播 status_changed，左侧「正在执行」转圈徽标秒级收敛为 idle；单轮终态翻 ended/failed 的既有发布行为不变。

#### 场景：多轮完成转圈收敛

- Given 多轮会话（turn_count>1）当前 run running，左侧徽标转圈
- When close_interactive_run 收口该 run 为 completed，会话状态保持 active（仅刷 last_active_at）
- Then commit 后广播 status_changed 信号，左侧转圈徽标秒级消失

### FR-04: 既有信号点（会话创建/终态/删除/群聊 audience）行为零回归

- 本变更禁止改变既有信号点的 event 种类、受众与触发时机：会话创建双发（created+status_changed）、单轮终态翻转发布、sweep/lease kill/子会话/typing_presence（群聊 audience）各调用点行为逐字节保持；新增信号点一律使用 "status_changed" 种类、单聊 user_id 受众（会话属主），不触碰群聊 audience 机制。

#### 场景：既有回归面

- Given 本变更合入
- When 运行既有信号相关测试（close_interactive_run_session_status 全量、sessions 列表 SSE、群聊投影等）
- Then 全部通过，无行为漂移断言失败

### FR-05: 新增信号点有单测覆盖；触及的前后端测试全绿

- 每个新增信号点必须有单测断言「迁移成功→发布（event 种类+session_id+user_id）」与守卫路径「迁移未发生/条件不满足→不发布」；触及的前后端测试与回归面必须全绿。

#### 场景：守卫路径不发布

- Given 各信号点的未触发前提（纯切换轮 / rowcount=0 / 审批 token 无效 / 会话已终态）
- When 对应路径执行
- Then 无 publish 调用发生

## 测试绑定（每条 FR 至少一行——`FR-NN: test/路径「用例名」`；空行/待填在 flow done 拒收）

FR-01: backend/app/modules/daemon/tests/test_session_list_live_signal.py「inject 新轮 commit 后发布 status_changed；纯切换轮不发布」
FR-01: backend/app/modules/daemon/tests/test_submit_messages_no_overwrite_terminal.py「run 激活经 PublishIntent 标量补发列表信号；rowcount=0 不发；publish 消费段发/None 零调用」
FR-01: backend/app/modules/agent/tests/test_coordinator_approval_signal.py「request_approval/approve 成功发布、拒绝路径不发布」
FR-02: frontend/src/components/daemon/__tests__/session-panel-approval-list-refresh.test.tsx「permission_request 触发 onSessionListRefresh」
FR-03: backend/app/modules/daemon/tests/test_close_interactive_run_session_status.py「多轮 keep-active 终态发布列表信号（扩展既有用例断言）」
FR-04: backend/app/modules/daemon/tests/test_close_interactive_run_session_status.py「既有终态翻转发布用例回归全绿」
FR-05: 不适用：本条即测试要求本身，由 FR-01~04 的测试绑定行与收口 CLI 实测承载
