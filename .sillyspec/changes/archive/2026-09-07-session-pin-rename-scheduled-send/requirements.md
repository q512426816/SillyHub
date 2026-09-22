---
author: qinyi
created_at: 2026-09-07 23:15:54
---

# 需求规格（Requirements）

## 角色

| 角色 | 说明 |
|---|---|
| 会话属主（用户） | 创建会话的登录用户；置顶/重命名/定时消息均限定属主操作（多成员工作台同会话他人不可改，对齐 archive 口径） |
| 平台服务（sweeper） | 后端常驻协程，以服务身份到点派发定时消息（复用 `inject_session_as_service`） |

## 功能需求

### FR-01: 会话置顶（分组内）
覆盖决策：D-002@v1
Given 属主已登录且会话可见（未删除）
When 调用 `PATCH /api/daemon/sessions/{id}/pin`
Then `pinned_at=now` 落库，列表排序变为 `(pinned_at IS NULL) ASC, coalesce(last_active_at, created_at) DESC, id DESC`，该会话排在其所属工作区分组最前；多个置顶之间按最近活跃排序；SSE 广播 `status_changed`，其它已打开客户端刷新后可见

Given 会话已置顶
When 再次调用 pin
Then 幂等无操作（不更新时间戳），响应 204

Given 会话不存在或非属主
When 调用 pin
Then 404（不泄露存在性，对齐 archive 归属校验口径）

### FR-02: 取消置顶
Given 会话已置顶
When 调用 `PATCH /api/daemon/sessions/{id}/unpin`
Then `pinned_at` 置 NULL，会话回到分组内最近活跃序；SSE 广播同 FR-01

Given 会话未置顶
When 再次调用 unpin
Then 幂等无操作，204

### FR-03: 会话重命名
Given 属主已登录
When 调用 `PATCH /api/daemon/sessions/{id}/title`，body `{"title": "新名字"}`
Then `title` 列写入 strip 后值；列表标题派生逻辑（title 优先、回退首条 user_input）使其立即生效；SSE 广播 `status_changed`

Given title strip 后为空或超过 255 字符
When 调用
Then 422 校验失败，不落库

### FR-04: 定时消息创建/列表/取消（一次性）
覆盖决策：D-001@v1, D-002@v1, D-003@v1
Given 会话属主已登录、会话非终态
When 调用 `POST /api/daemon/sessions/{id}/scheduled`，body `{prompt, dispatch_at, attachment_ids?, agent_profile_id?, llm_provider_id?}`
Then 落库一行 status=pending（快照字段原样保存，sender_user_id=当前用户），响应 201 + 完整条目；仅一次性，到点派发后不重复

Given dispatch_at 早于 now+60s，或 prompt 与附件全空，或会话已终态（ended/failed）/已软删
When 调用创建
Then 422（时间/内容校验）或 409（会话终态），不落库

Given 会话有待发定时消息
When 调用 `GET /api/daemon/sessions/{id}/scheduled`
Then 返回该会话全部状态条目，按 dispatch_at 升序

Given 条目 status=pending
When 调用 `DELETE /api/daemon/sessions/{id}/scheduled/{mid}`
Then 置 cancelled + cancelled_at，响应 204

Given 条目非 pending（已派发/已取消/已失败）
When 调用取消
Then 409

### FR-05: 到点自动派发（sweeper）
覆盖决策：D-001@v1, D-003@v1
Given 存在 status=pending 且 dispatch_at ≤ now 的条目
When sweeper 周期（30s）到达
Then 行锁复核 pending 后调 `inject_session_as_service(prompt=…, queue_when_busy=True, queue_sender_user_id=sender_user_id, …)`；成功 → status=dispatched + dispatched_at

Given 到点时会话正忙（有活跃 run）
When sweeper 派发
Then 消息进入既有 `agent_session_queued_messages` 排队（用户可重排/取消），定时条目置 dispatched

Given 到点时会话已终态或已软删
When sweeper 派发
Then 条目置 failed，error_code=session_inactive，不盲发

Given 到点时会话正忙且既有队列已满（5 条）
When sweeper 派发
Then 条目置 failed，error_code=queue_full（D-003@v1）

Given 同轮多条 due 条目且其一派发抛异常
When sweeper 处理
Then 该条按异常类型置 failed（error_code/message 落库），其余条目不受影响继续处理；单轮异常不崩循环

Given backend 重启后存在过期未派发条目
When sweeper 启动后首轮
Then ≤30s 内补发（due 即捞）

### FR-06: 多端 SSE 同步
Given 用户在两个浏览器标签打开会话门户
When 一端置顶/取消置顶/重命名
Then 另一端经 `agent_sessions:changed` SSE 事件秒级刷新列表（复用 `publish_sessions_changed`，事件 reason=status_changed）

### FR-07: 兼容与回归
Given 存量数据（无 pinned_at、无定时消息）
When 升级后首次请求
Then 列表排序与响应行为与升级前一致（pinned_at 恒 NULL 时谓词恒真）；`AgentSessionRead` 仅新增 `pinned_at` 字段，旧前端忽略无影响；既有 sessions/inject/queue/archive 全链路测试零回归

## 非功能需求

- 兼容性：Windows/Linux/macOS 三平台（sweeper 用 asyncio + UTC 时间计算，无平台 API）；aiosqlite/PG 双方言（时间比较 Python 侧绑定，对齐 sweep.py NFR 惯例）。
- 可回退：新列可空、新表独立、新端点独立——回滚代码即回退功能，无数据迁移负担（未上线项目允许重置数据，CLAUDE.md 规则 11）。
- 可测试：sweeper 单趟函数 `scheduled_send_sweep_once(db_session)` 注入 AsyncSession 可直调单测；四分支各有独立用例；排序/幂等/归属/SSE 均可测（见 design §接口定义测试清单）。
- 失败语义：定时派发 at-least-once（inject 成功后崩溃的极端窗口可能重复发送一次，R-02 已登记为可接受权衡）。
- UI：双主题（blue/ai-native）语义阶取值，`brand-*` 类名纪律（CLAUDE.md 规则 20）。

## 决策覆盖矩阵

| 决策 ID | 覆盖的 FR | 说明 |
|---|---|---|
| D-001@v1 | FR-04, FR-05 | 方案 B：独立定时表 + sweeper 协程，inject 复用全链路 |
| D-002@v1 | FR-01, FR-04 | 分组内置顶（多置顶按最近活跃）；定时仅一次性 |
| D-003@v1 | FR-05 | 队列满员 → failed(queue_full)，不自动延后重试 |
