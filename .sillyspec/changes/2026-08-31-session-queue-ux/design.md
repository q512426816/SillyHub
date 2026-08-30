---
author: qinyi
created_at: 2026-08-31 03:40:00
change: 2026-08-31-session-queue-ux
scale: large
---

# 设计文档（Design）— 会话消息排队体验修复与增强（滞留修复 + 立即发送/拖拽排序/重新编辑 + 消息复制）

## 1. 背景

用户反馈三类问题（2026-08-31）：

1. **"排队感觉不对劲"**：代码调研（brainstorm step2）定位三个真实缺陷：
   - **P1 队头滞留**：`dispatch_queued_messages`（session/service.py:4292）取队头一条、
     失败即停（"不再尝试后续条目"）；派发触发点仅两个（close_interactive_run 的
     run 终态钩子 `_fire_background_task`（run_sync/service.py:1911-1934）+ retry 端点）。
     队头在**会话空闲**时派发失败（daemon 瞬断/附件失效）后，后续 pending 条目
     无任何触发点 → 永久"等待中"（前端 pending 条目又无重试按钮，只有 failed 有）。
   - **P2 queue_changed SSE 未消费**：后端入队/派发/删除/失败均 `_publish_session_event`
     发 `queue_changed`（session/service.py:939-962，Redis channel `agent_session:{id}`
     ——与会话 SSE 流同通道），但前端 `streamSession` 的 envelope switch
     （lib/daemon.ts:1595-1630）无该 case，事件静默丢弃 → 队列 UI 更新靠 5s 轮询 +
     turn 生命周期 refresh，后台派发后条目消失滞后可感知。
   - **P3 非 active 批量转 failed**：dispatch 入口在 `session.status != "active"` 时
     调 `_fail_pending_queued_messages` 把**全部** pending 打成 failed（"会话当前状态
     为 reconnecting…"）——daemon 短暂掉线（run 终态钩子恰在 reconnecting 窗口触发）
     即排队全灭，恢复后需逐条手动重试。
2. **排队三功能缺失**：立即发送（用户确认语义=**打断当前轮立即派发**，方案选择
   AskUserQuestion 2026-08-31）、拖拽排序、重新编辑。
3. **聊天记录无复制按钮**：用户气泡（turn-timeline.tsx:427-459）、agent 文本段
   （turn-segment-views.tsx:388 TextSegmentView）、思考段展开正文（:409 ThinkingRowView）
   均无复制入口（工具行 ToolRowView 已有，不动）。

## 2. 目标（FR）

- **FR-01 滞留修复（P1）**：dispatch 改循环派发——单次调用内连续派发至"无可派发/
  会话忙/连续失败"，**连续失败 ≥2 次即停**（系统性故障不连环刷屏）；pending 条目
  前端提供「立即发送」入口（本质=dispatch-now 空闲分支）作滞留手动兜底；会话
  recover 回 active 时补一次派发（自动兜底）。
- **FR-02 P3 收敛**：dispatch 遇非终态非 active（pending/reconnecting/suspended）时
  **保持 pending 不动**（等下一触发点）；仅终态（ended/failed）批量
  转 failed（现状保留）。
- **FR-03 SSE 实时（P2）**：前端订阅 `queue_changed` → 立即 refresh 队列；后端在
  reorder/edit/dispatch-now 动作后补发该事件（现有入队/删除/失败/派发点已发）。
- **FR-04 拖拽排序**：排队表加 `position INT`；前端队列条 HTML5 原生拖拽换位，松手
  调 `PATCH /sessions/{id}/queue/reorder` 持久化；派发序 = `ORDER BY position,
  created_at`；新条目 position = 当前最大 +1。
- **FR-05 立即发送**：`POST /sessions/{id}/queue/{entry_id}/dispatch-now`：
  ①条目置队首（position 最小）；②有活跃 run → 复用 interrupt 控制指令（daemon
  停轮 → run 终态钩子接力派发队首=本条）；③无活跃 run → 当场 dispatch。pending
  与 failed 条目均可用（failed 先重置 pending）。
- **FR-06 重新编辑**：`PATCH /sessions/{id}/queue/{entry_id}` 改 prompt 文本
  （附件/配置快照不动）；failed 条目编辑保存后重置 pending + 清 error + 尝试派发；
  pending 编辑保持 pending。
- **FR-07 消息复制按钮**：三类气泡（用户/agent 文本/思考展开正文）hover 右下角
  浮现「⧉ 复制」→ `navigator.clipboard.writeText(纯文本)` + 短暂"✓ 已复制"反馈
  （对齐 session-panel :3265 复制会话 ID 交互先例）。

## 3. 非目标（NG）

- **NG-01** 不做附件/供应商/档案的重新编辑（仅 prompt 文本；快照语义保持）。
- **NG-02** 不引入 DnD 三方库（@dnd-kit 等）——队列 ≤5 条，HTML5 原生 DnD 足够
  （原型已验证交互形态），零新增依赖。
- **NG-03** 不改排队上限（SESSION_QUEUE_MAX_PENDING=5）与"单会话至多一个活跃 run"
  不变式；不做常驻后台 sweeper（定时扫描 idle+pending）——recover 钩子 + 手动入口
  已覆盖，sweeper 是过度设计。
- **NG-04** 不迁移/重写历史排队数据语义；position 回填按 created_at 序一次完成。
- **NG-05** 工具行/文件卡片不加复制（已有或不适用）。
- **NG-06** 不改 daemon（sillyhub-daemon 零改动——interrupt/派发链路全部复用）。

## 4. 总体方案

### Phase 1 — backend（daemon 模块）

1. **迁移**（`20260831130000_add_queued_message_position.py`）：
   `agent_session_queued_messages` 加 `position INT NOT NULL`；回填按
   `created_at` 升序 `ROW_NUMBER()`；唯一约束不加（并发插入由会话行锁串行，
   position 重复不破坏正确性——排序键带 created_at 次序）。
2. **模型**：`AgentSessionQueuedMessage.position: int`（default 见下）；入队路径
   （session/service.py:3272 建 entry 处 + TASK_WAKEUP merge 路径不动）在行锁内
   `position = (SELECT MAX(position))+1`。
3. **dispatch 循环化**（FR-01/02）：`dispatch_queued_messages` 外层 `while`：
   - 会话非 active 且**非终态**（终态集合 = {ended, failed}，会话状态词表无
     cancelled，agent/model.py:711）→ rollback 直接返回（pending 保留，FR-02）；
   - 终态 → `_fail_pending_queued_messages`（现状）；
   - 有活跃 run → 返回；
   - 取队首 pending（ORDER BY position, created_at）→ `_inject_into_session`；
     - 成功：删行（现状）→ **继续下一轮循环**（run 已活跃则下轮自然退出）；
     - 失败：failed 留队（现状）→ 连续失败计数 +1，**≥2 即退出循环**，否则继续
       下一条（瞬态单点失败不拖队）。
4. **dispatch-now**（FR-05）：`dispatch_queued_message_now(session_id, entry_id,
   user_id)`（行锁内）：条目存在性校验（404）；会话非 active → 409（终态/挂起均
   拒绝——与 interrupt 端点同口径）；failed → pending+清 error；条目
   position 置队首（其余条目 position 顺移：简单实现=全量重写会话队列 position，
   ≤5 行）；commit + queue_changed 事件（action=dispatch_now）；然后：
   - 无活跃 run → 直接 `dispatch_queued_messages`（同步派发本条）；
   - 有活跃 run → 调 interrupt 控制链（复用 interrupt_session 内部发送段——抽
     `_send_interrupt_control(session)` 供两端点共用；daemon 停轮 → 终态钩子派发
     队首=本条）。interrupt 下发失败（WS 不通但控制指令已落库待 daemon 补拉，
     control-dispatcher 三段式不抛错）→ `interrupted: true` 语义不变（指令在途，
     daemon 补拉后停轮，链路仍闭环）；仅真异常（runtime 离线等 AppError）向上
     4xx/5xx——条目已置顶不回滚，下个触发点派发。
5. **reorder**（FR-04）：`reorder_queued_messages(session_id, entry_ids: list[uuid],
   user_id)`：行锁内校验 ids 集合 == 当前 pending+failed 条目全集（多/少/错 → 422
   `QUEUE_ORDER_MISMATCH`——不允许部分重排，前端始终全量上传）；按列表序重写
   position 0..n-1；commit + queue_changed（action=reordered）。
6. **edit**（FR-06）：`update_queued_message(session_id, entry_id, prompt, user_id)`：
   行锁内取条目（404）；空 prompt/超 8000（对齐 SessionInjectRequest max_length）
   → 422；**系统通知条目（prompt 以 TASK_WAKEUP_PROMPT_PREFIX 开头）→ 409
   不支持编辑**（编辑去掉前缀会破坏后续 wakeup 的 like 去重匹配 → 语义漂移；
   前端对这类条目隐藏 ✎）；改 prompt + updated_at；failed → pending + error_msg=None；
   commit + queue_changed（action=edited）；若重置过 failed → 尝试 dispatch（复用入口）。
7. **恢复链补派发**（FR-01，Grill 修正锚点）：钩子挂在 `confirm_session_reconnected`
   （session/service.py:4946；active 赋值 :5005、commit :5008）的 commit 点之后——
   `recover_session_after_daemon_restart`（:4498）只把会话置 `reconnecting` 从不翻
   active，挂那里会空转（Grill 阻断项修正）。fire 模式对齐 run 终态钩子：
   **SessionService 内新增同款 `_fire_background_task` helper**（RunSyncService
   :391 的强引用防 GC + 独立 DB session 模式照搬；run_sync 确实无需改动）；
   无 pending 时 dispatch 自查自弃。reopen 恢复链经 confirm 同点自然覆盖。
8. **queue_changed 事件补发点**：Phase1 各新动作（reordered/edited/dispatch_now）
   均发（上列）；现有 deleted/dispatched/failed/merged/created 保持。

### Phase 2 — frontend 队列（SSE + 三功能）

1. **SSE**（FR-03）：`lib/daemon.ts` envelope kind 联合 + `queue_changed` case →
   `handlers.onQueueChanged?.(envelope)`；session-panel 装配器接线 → `refresh()`
   （useMessageQueue.refresh 复用，5s 轮询保留兜底）。
2. **useMessageQueue 扩展**：`reorderEntry(ids)` / `editEntry(id, prompt)` /
   `dispatchNowEntry(id)` 三方法（对齐 removeEntry/retryEntry 的 load 刷新模式）。
3. **MessageQueueBar 重构**（照原型 prototype-session-queue-ux.html）：
   - 每条 chip 加**拖拽手柄**（⇅）：`draggable` + dragstart/dragover(drop-target
     高亮)/drop/dragend 原生事件换位，松手收集全量 id 序调 `onReorder`；jsdom 无
     原生 DnD，测试用 fireEvent.dragStart/dragOver/drop 模拟（dataTransfer mock）；
   - **⚡立即发送按钮**（pending+failed 均显示；title="打断当前轮，立即发送"）；
   - **✎编辑按钮** → 展开 inline 编辑浮层（textarea + 取消/保存；failed chip 编辑
     后说明转等待中）；**[后台任务通知] 前缀条目（TASK_WAKEUP）不渲染 ✎**
     （后端 409 双保险，D-009）；
   - failed 保留 ↻ 重试 + ✕ 删除（现状）；pending 保留 ✕ 删除 + 新增 ⚡ ✎。

### Phase 3 — frontend 消息复制（FR-07）

- `TextSegmentView`：气泡容器 relative；hover 显示 `.copy-btn`（右下角浮出，
  `group-hover` 语义用 CSS `:hover` 实现，纯 CSS 零状态）；复制 `segment.text`
  纯文本；点击后按钮文案切"✓ 已复制"1.2s（本地 state，memo 组件内 useState）。
- `ThinkingRowView` 展开正文：同款按钮复制 `segment.text`。
- turn-timeline 用户气泡：复制 `parseAttachmentMarkers(turn.prompt).text`（剥离
  附件标记行，与显示一致；空文本时按钮不渲染）。
- 交互统一抽 `CopyButton`（小组件，三处复用；`navigator.clipboard?.writeText`，
  失败静默 console.warn——jsdom/非安全上下文降级）。

## 5. 接口定义

```
PATCH /api/daemon/sessions/{session_id}/queue/reorder        # FR-04
  body: {"entry_ids": ["<uuid>", ...]}                       # 全量、有序
  resp: 204；422 QUEUE_ORDER_MISMATCH（ids 与现有条目集不一致）

PATCH /api/daemon/sessions/{session_id}/queue/{entry_id}     # FR-06
  body: {"prompt": "..."}                                    # 1..8000 字
  resp: 200 {"entry": SessionQueueEntry}                     # 复用现有 DTO
  404 条目不存在；422 空文本/超长；409 系统通知条目（TASK_WAKEUP 前缀）不支持编辑

POST /api/daemon/sessions/{session_id}/queue/{entry_id}/dispatch-now   # FR-05
  resp: 200 {"interrupted": bool}   # true=已打断活跃轮（终态钩子接力派发）
                                    # false=空闲直接派发（可能已派发成功删行）
  404 条目不存在；409 会话非 active（终态/挂起均拒绝）
```

> 路由注册顺序：`/queue/reorder` 必须先于 `/queue/{entry_id}` 声明（FastAPI 按
> 注册顺序匹配，否则字面量 reorder 被路径参数捕获 → 422）。

DTO：`QueueReorderRequest{entry_ids: list[uuid]}`、`QueueEntryUpdateRequest
{prompt: str(min_length=1,max_length=8000)}`、`QueueDispatchNowResponse
{interrupted: bool}`（schema.py）；`SessionQueueEntry` 现有 DTO 定义在
router.py（`_queue_entry_dto` :2095），补 `position: int` 字段。

## 6. 数据模型变更

```python
# AgentSessionQueuedMessage 新列
position: int = Field(sa_column=Column(Integer, nullable=False, default=0))
```

迁移三步走（对齐 202607240900_add_user_username 先例；`UPDATE ... ROW_NUMBER()`
内联窗口函数非合法 Postgres 语法）：①加 `position INT NULL`；②CTE
`ROW_NUMBER() OVER (ORDER BY created_at, id)` 回填；③`ALTER COLUMN SET NOT NULL`。
测试库走 create_all 建表（不跑 Alembic），迁移本体不在 pytest 覆盖面（静态审查 +
部署冒烟；模型/MAX+1 语义用 create_all 测）。

派发序改 `ORDER BY position, created_at`（list/dispatch 两处）。入队 `MAX+1` 在
会话行锁内（与既有 enqueue 同事务）。

## 7. 边界与并发

- **R-01 行锁串行**：reorder/edit/dispatch-now/delete/enqueue 全走
  `_get_owned_session_for_update` 行锁，与 dispatch 互斥；position 重写无并发窗口。
- **R-02 拖拽 vs 派发竞态**：拖拽落手时条目恰被派发删除 → reorder 422
  MISMATCH → 前端 catch 静默 + load 以服务端为准（条目已消失，自然收敛）。
- **R-03 dispatch-now 时序**：置顶 commit **先于** interrupt 发送——interrupt 失败
  也不丢语义（队首保持）；interrupt 后 run 终态钩子派发是既有链路（run_sync 不改）。
- **R-04 空闲分支同步派发**：dispatch 在请求内完成 inject（既有 retry 端点同模式，
  耗时=WS 下发，可接受）；条目可能当场删行（派发成功）→ 响应不含条目体，前端以
  SSE/load 收敛。
- **R-05 连续失败上限 2**：防 daemon 全程掉线时 N 条排队逐条转 failed 刷屏（现状
  只失败 1 条即停，改循环后必须加上限防回归放大）。
- **R-06 复制降级**：非安全上下文（http 局域网）clipboard API 可能不可用 →
  try/catch 静默 + 按钮短暂显示"复制失败"（不阻塞聊天）。

## 8. 测试策略

- backend pytest（新 `test_session_queue_actions.py` + 既有排队用例适配）：
  入队 MAX+1、reorder 全量校验/MISMATCH、edit 空/超长/failed 重置+派发/TASK_WAKEUP
  条目 409、dispatch-now 空闲直发/忙时置顶+interrupt 下发（mock hub）、dispatch
  循环化（瞬态失败续派下一条/连续 2 次停/非 active 保持 pending/终态批量 fail）、
  confirm_session_reconnected 恢复钩子。迁移本体不在 pytest 覆盖面（见 §6，静态
  审查 + 部署冒烟）。
- frontend vitest：MessageQueueBar 拖拽换位+onReorder 全量上传、编辑浮层保存/取消/
  failed 转等待中、⚡ 调用、SSE queue_changed → refresh（daemon.test envelope 分发）、
  CopyButton 复制/失败反馈、三类气泡挂载（含用户气泡剥离附件标记）。
- 回归：既有 message-queue/session-panel 队列用例、session-panel-ctx-tokens 等近邻。

## 9. 文件变更清单

| 操作 | 文件 | 说明 |
|---|---|---|
| 修改 | backend/app/modules/agent/model.py | AgentSessionQueuedMessage.position |
| 新增 | backend/migrations/versions/20260831130000_add_queued_message_position.py | 加列+回填 |
| 修改 | backend/app/modules/daemon/session/service.py | dispatch 循环化/非 active 收敛/reorder/edit/dispatch-now/confirm_session_reconnected 恢复钩子 + _fire_background_task helper/入队 MAX+1/事件补发 |
| 修改 | backend/app/modules/daemon/service.py | 门面委托（三新方法） |
| 修改 | backend/app/modules/daemon/schema.py | 三个请求/响应 DTO |
| 修改 | backend/app/modules/daemon/router.py | 三端点（reorder 先注册）+ _queue_entry_dto 补 position |
| 新增 | backend/app/modules/daemon/tests/test_session_queue_actions.py | 新端点+循环派发用例 |
| 修改 | backend/app/modules/daemon/tests/test_session_queue*.py（既有） | 循环化/position 适配 |
| 修改 | frontend/src/lib/daemon.ts | queue_changed case + 三个 API client + SessionQueueEntry 类型 |
| 修改 | frontend/src/hooks/use-message-queue.ts | reorder/edit/dispatchNow 三方法 + SSE 友好 |
| 修改 | frontend/src/components/daemon/message-queue-bar.tsx | 拖拽/⚡/✎ 重构 |
| 新增 | frontend/src/components/daemon/copy-button.tsx | 三处复用复制按钮 |
| 修改 | frontend/src/components/daemon/turn-timeline.tsx | 用户气泡挂 CopyButton |
| 修改 | frontend/src/components/daemon/turn-segment-views.tsx | Text/Thinking 挂 CopyButton |
| 修改 | frontend/src/components/daemon/session-panel.tsx | SSE onQueueChanged→refresh + 队列回调接线 |
| 生成 | frontend/src/lib/api-types.ts + backend/openapi.json | gen:types 产物 |
| 测试 | frontend/src/components/daemon/__tests__/message-queue-bar.test.tsx | 既有适配+新增（task-10） |
| 测试 | frontend/src/hooks/__tests__/use-message-queue.test.ts | 既有适配+新增（task-10） |
| 测试 | frontend/src/lib/daemon.test.ts | queue_changed 分发用例（task-10） |
| 测试 | frontend/src/components/daemon/__tests__/session-panel-dialog-attachments.test.tsx | panel 接线用例宿主（task-10） |
| 测试 | frontend/src/components/daemon/__tests__/copy-button.test.tsx | 新增（task-12） |
| 测试 | frontend/src/components/daemon/__tests__/turn-segment-views.test.tsx | 复制挂载断言（task-12） |
| 测试 | frontend/src/components/daemon/__tests__/turn-timeline-session-input-bar.test.tsx | 用户气泡复制断言宿主（task-12） |
| 测试 | backend/app/modules/daemon/tests/test_session_queue_actions.py | 新增（task-05） |
| 测试 | backend/app/modules/daemon/tests/test_session_queue.py | 既有适配（task-05） |
| 测试 | backend/app/modules/daemon/tests/test_session_user_preamble.py | 既有适配（task-05） |

## 10. 决策记录

- **D-001** 立即发送=打断当前轮立即派发（用户 AskUserQuestion 确认；仅置顶与拖拽
  排序功能重复，故取打断语义）。
- **D-002** 排序键=独立 position INT 列而非重写 created_at（审计语义不破坏；全量
  重写 ≤5 行成本可忽略；不加唯一约束——行锁已保证串行）。
- **D-003** reorder 全量上传（部分重排语义歧义且实现易错；前端始终持有全量）。
- **D-004** dispatch 循环连续失败上限 2（平衡瞬态恢复与系统性故障不刷屏）。
- **D-005** 非 active 非终态保持 pending（P3 根因；失败化仅限会话终态）。
- **D-006** HTML5 原生 DnD 不引库（NG-02，队列规模小）。
- **D-007** daemon 零改动（interrupt/派发链路全部复用，NG-06）。
- **D-008**（Grill 修正）恢复补派发锚点 = confirm_session_reconnected 的 active
  commit 点（recover_session_after_daemon_restart 只置 reconnecting 不翻 active）；
  SessionService 新增 _fire_background_task helper（run_sync 不动）。
- **D-009**（Grill 吸收）TASK_WAKEUP 系统通知条目（[后台任务通知] 前缀）不支持
  编辑（409）——防 like 去重匹配失配导致 wakeup 重复入队；前端隐藏其 ✎。
- **D-010**（Grill 吸收）终态集合 = {ended, failed}（词表无 cancelled）；迁移
  nullable→回填→NOT NULL 三步走（Postgres 语法合法性）。

## 11. 风险登记（Risk）

- **RISK-1 dispatch 循环化回归**：改动派发核心路径，既有排队/retry/终态钩子用例
  全量回归 + 新循环语义用例（连续失败上限/瞬态续派）双覆盖。
- **RISK-2 dispatch-now 打断链路依赖异步接力**：置顶 commit 与 interrupt 下发之间
  daemon 崩溃 → 条目仍在队首、下个触发点派发（R-03 已钉死不丢语义）；verify 需
  真实会话打断实测（integration-critical）。
- **RISK-3 position 迁移回填**：存量表非空时 NOT NULL 收紧失败风险——三步走迁移
  （§6），部署前本地 Docker Postgres 实测。
- **RISK-4 前端原生 DnD 跨浏览器差异**：仅桌面 Chrome/Edge/Firefox 目标场景，
  触屏拖拽降级为不可用（按钮操作完整覆盖核心功能，拖拽是效率增强非唯一路径）。
- **RISK-5 queue_changed 高频刷新**：队列事件驱动 load 全量拉取，单会话低频场景
  可接受；5s 轮询与 SSE 双源并发由 epoch 丢弃机制兜底（use-message-queue 既有）。

## 12. 自审（Self-Review）

- 三根因（P1/P2/P3）均有代码行号实证（brainstorm step2 调研），非推测。
- 全部新端点/语义经独立 Design Grill 两轮审查（1 阻断项修正 + 8 gap 吸收 + 复审
  pass），审查记录见 .runtime/stage-reviews/brainstorm-review-2026-08-31-033213。
- 与 NG 对齐：daemon 零改动（R-03 链路全部复用既有 interrupt/终态钩子）、零新增
  前端依赖（原生 DnD）、排队上限与串行不变式不动。
- 遗留已知项：迁移本体不在 pytest 覆盖面（§6/§8 已声明，部署冒烟兜底）；jsdom
  原生 DnD 需 dataTransfer mock（§8 已记）。

## 13. 生命周期契约表

| 实体/状态 | 迁移 | 触发点 | 写入方 | 备注 |
|---|---|---|---|---|
| QueuedMessage pending → 派发中 | 取队首 inject 成功 | dispatch_queued_messages（终态钩子/retry/dispatch-now 空闲分支/confirm 恢复钩子） | SessionService.dispatch_queued_messages | 成功即删行（现状不变） |
| QueuedMessage pending → failed | 派发失败 | dispatch 循环内 AppError 捕获 | 同上 | 连续 2 次即停整轮循环（R-05） |
| QueuedMessage failed → pending | retry 端点 / dispatch-now / edit 保存 | 用户动作 | retry/dispatch_now/update_queued_message | 重置后均尝试派发 |
| QueuedMessage 新建 → pending | 忙轮 inject 入队 | _inject_into_session 排队分支 | SessionService | position=行锁内 MAX+1；TASK_WAKEUP merge 原地改 prompt 不新建（现状） |
| QueuedMessage position 变更 | reorder/dispatch-now 置顶 | 用户动作 | reorder/dispatch_now | 全量重写 ≤5 行（行锁串行） |
| AgentSession reconnecting → active | daemon 重连确认 | confirm_session_reconnected commit 后 | SessionService | **新增**：commit 后 fire 派发钩子（D-008） |
| AgentRun running → 终态（interrupt） | dispatch-now 忙时分支 | daemon 停轮回传 result | 既有 close_interactive_run 终态钩子 | 置顶条目接力派发（链路复用零改动） |
