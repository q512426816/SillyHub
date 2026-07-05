---
author: qinyi
created_at: 2026-07-05 00:32:47
change: 2026-07-05-daemon-client-change-binding-fix
stage: brainstorm
---

# Design — daemon-client 写回流程对齐 daemon-entity-binding

> 关联前驱变更：`2026-07-03-daemon-entity-binding`（已 merge main 52101447）。
> 本变更修复该变更在「写回任务队列」层的适配遗漏。

## §1 背景与根因

`daemon-entity-binding`（D-004）把工作区绑定从 `runtime_id` 改 `daemon_id`：

- `workspace_member_runtimes.runtime_id` 保留列但 `upsert_my_binding`
  （`member_runtimes/service.py:30-44`）**不再写入**——注释明示
  "preserved nullable but NOT written by this function — it retains legacy snapshot
  data only"。
- `workspaces.daemon_runtime_id` 同样退化为 NULL（新链路 workspace 不写）。

但 D-003 又明确「`daemon_task_leases.runtime_id` 与 `daemon_change_writes.runtime_id`
FK 保留不动」，且 `DaemonChangeWrite.runtime_id` 是 **NOT NULL**
（`daemon/model.py:398-403`）。daemon 端按 runtime_id 轮询领任务
（`GET /runtimes/{rid}/pending-change-writes`）。

→ 凡是需要建 `DaemonChangeWrite` 或校验写回 runtime 的代码，若直读
`workspace.daemon_runtime_id` / `binding.runtime_id`，新链路下都拿到 None → 失败。

派发写侧（`placement._resolve_dispatch_runtime`，`placement.py:660-749`）已用
`MemberBindingResolver` + `default_agent` 现算 runtime（D-005/D-008）。task-16 修了
runtime 页面读侧。**但写回任务队列这一层 4 处直读点漏了适配**：

| # | 位置 | 失败表现 |
|---|------|----------|
| 1 | `change_writer/proxy.py:192` `workspace.daemon_runtime_id != runtime_id` | 建变更永远 `DAEMON_CLIENT_NO_SESSION` |
| 2 | `change/service.py:407` `runtime_id = workspace.daemon_runtime_id` | 写变更文件抛 `ChangeDocNotFound` |
| 3 | `spec_workspace/router.py:172,191` 分流条件 + `runtime_id = ws.daemon_runtime_id` | sync-manual 错走 server-local |
| 4 | `daemon/runtime/service.py:674,696` `col(Workspace.daemon_runtime_id) == runtime_id` | runtime 删除 RESTRICT 保护失效 |

`spec_workspace/import` 同源已由 ql-20260704-002（commit a14c45c5）单点修复。本变更
系统修剩下 4 处。

## §2 方案概述（方案 A · 写回时现算 runtime）

**核心思路**：写回链路与派发链路共用同一套「daemon_id + default_agent → runtime」
解析。每次需要 runtime_id 时，用 `binding.daemon_id` + `workspace.default_agent`
现场解析该 daemon 下匹配的 online runtime。

**抽共享函数**（D-004）：

```
resolve_runtime_for_writeback(session, workspace_id, user_id) -> DaemonRuntime
```

放在 `workspace/member_runtimes/`（与 `MemberBindingResolver` 同位）。复用 placement
的三个查询函数（提取为共享）。

**不动的边界**：
- `DaemonChangeWrite` 表结构不变（runtime_id NOT NULL 保留，现算后填入）。
- daemon 端轮询协议不变（仍按 runtime_id）。
- `daemon_task_leases` 流程不变（派发已修）。
- `upsert_my_binding` 不变（D-004 binding 不写 runtime_id 原则不动）。

## §3 共享函数设计（新增）

### 3.1 resolve_runtime_for_writeback

**位置**：`backend/app/modules/workspace/member_runtimes/resolver.py`（新增，紧邻
`MemberBindingResolver`）

**签名**：
```python
async def resolve_runtime_for_writeback(
    session: AsyncSession,
    workspace_id: uuid.UUID,
    user_id: uuid.UUID,
) -> DaemonRuntime:
    """Resolve an online runtime for writeback dispatch (D-001@v1).

    与 placement._resolve_dispatch_runtime 同语义，但不接受 caller provider override
    （写回始终用 workspace.default_agent）。失败抛 NoOnlineDaemonError（不 fallback，
    D-008 一致）。
    """
```

**逻辑**（复刻 `placement.py:702-749`，去掉 provider override 分支）：
1. `MemberBindingResolver.resolve_member_binding(session, workspace_id, user_id)`
   - 无 binding 行 → 抛 `NoOnlineDaemonError(message="未绑定守护进程，请重绑")`
2. `binding.daemon_id is None`（旧 binding 未迁移）→ 同上「请重绑」（D-004 过渡期）。
3. `_query_daemon_online_by_id(daemon_id, user_id)` → None →
   `NoOnlineDaemonError(message="绑定的守护进程离线或不存在，请启动后重试")`。
4. 读 `workspace.default_agent`（`SELECT default_agent FROM workspaces WHERE id=...`）。
5. `_query_runtime_by_daemon_and_provider(daemon_id, default_agent)` → 命中即返回。
6. 未命中 → `_get_daemon_enabled_providers(daemon_id)` → `NoOnlineDaemonError`：
   - `default_agent` 非空：`"守护进程已启用 {enabled}，但未启用 default_agent '{default_agent}'"`
   - `default_agent` 为空：`"守护进程已启用 {enabled}，但未设置 default_agent，请在工作区设置中配置"`

> 以上 step 1/2/3/6 抛的 `NoOnlineDaemonError` 由 §3.3 转译为
> `DaemonClientNoActiveSession`（AppError，HTTP 400）对外暴露；reason 字段映射见 §6。

### 3.2 placement 查询函数提取（重构）

placement 的三个私有方法（`placement.py:716,740,745`）提取为模块级共享函数
（位置：`workspace/member_runtimes/queries.py` 新建，或 `agent/placement.py` 顶部
模块级）：

- `query_daemon_online_by_id(session, daemon_id, user_id) -> DaemonInstance | None`
- `query_runtime_by_daemon_and_provider(session, daemon_id, provider) -> DaemonRuntime | None`
- `get_daemon_enabled_providers(session, daemon_id) -> list[str]`

`DaemonPlacement._resolve_dispatch_runtime` 改调这些模块级函数；
`resolve_runtime_for_writeback` 也调同一组。避免逻辑重复（DRY，D-004）。

### 3.3 异常类型（Grill 修订）

`NoOnlineDaemonError`（`placement.py:44`）是 `Exception` 子类**而非 `AppError`**——
它由 AgentService 派发入口捕获转成 `AgentRun.status=failed`，没有 http_status，
router 不会自动翻译成 HTTP 响应。writeback 调用链（change_writer / change /
spec_workspace 的 router 路径）若直接抛它 → 裸 500。

**改用 `DaemonClientNoActiveSession`**（`change_writer/proxy.py` 现有，`AppError`
子类，`code=DAEMON_CLIENT_NO_SESSION`，HTTP 400）作为 writeback 失败错误。
`resolve_runtime_for_writeback` 内部捕获 `NoOnlineDaemonError`（复用 placement
查询逻辑时抛出）→ 转译为 `DaemonClientNoActiveSession`（保留 reason 字段：未绑定 /
离线 / default_agent 未设置 / 无匹配 runtime）。reason 区分由 details 携带。

## §4 后端改动详表

### 4.1 change_writer/proxy.py（D-001 / D-002）

`proxy_create_change`（line 168）签名删 `runtime_id` 参数。line 192 的
`workspace.daemon_runtime_id != runtime_id` 死校验**整段删除**，改为：

```python
# 校验：从 binding 现算 online runtime（D-001@v1）。
runtime = await resolve_runtime_for_writeback(
    session, workspace_id, user_id
)  # 失败抛 NoOnlineDaemonError，含 enabled providers 引导
runtime_id = runtime.id
```

后续 `DaemonRuntime` 在线心跳校验（line 205-215）保留（runtime 现算已 online，
二次校验防竞态）。`DaemonChangeWrite(runtime_id=runtime_id, ...)`（line 234）
填入现算值。

### 4.2 change_writer/router.py + service.py（D-002）

- `router.py:90` `/changes/proxy-create`：`ProxyCreateChangeRequest` 删 `runtime_id`
  字段。
- `service.py:57` `create_change` 签名删 `runtime_id` 参数；line 113-135 daemon-client
  分支不再有 `runtime_id is None` 防御（改为调 `resolve_runtime_for_writeback`）。

### 4.3 change/service.py（D-001）

**调用链 user_id 补传**（Grill 发现）：`write_file`（line 328）当前签名
`(workspace_id, change_id, rel_path, content)` **不含 user_id**，router
（`change/router.py:216`）也未传。但 `resolve_runtime_for_writeback` 需要 user_id
校验 daemon 归属。改动链：

1. `write_file` 签名加 `user_id: uuid.UUID` 参数。
2. `change/router.py:216` write_file 端点传 `user.id`（端点依赖 `get_current_user`）。
3. `_enqueue_edit_write`（line 384）签名加 `user_id`。
4. line 372 调用处传入 user_id。

`_enqueue_edit_write` line 407 改：
```python
# 旧：runtime_id = workspace.daemon_runtime_id  # 新链路 NULL → 失败
# 新：写回时现算（D-001@v1）
from app.modules.workspace.member_runtimes.resolver import resolve_runtime_for_writeback
runtime = await resolve_runtime_for_writeback(
    self._session, workspace.id, user_id
)
runtime_id = runtime.id
```

### 4.4 spec_workspace/router.py（D-001）

`sync_manual_spec_workspace`（line 130）：daemon-client 分流的 `runtime_id` 改现算
（不再读 `binding.runtime_id` line 191 / `ws.daemon_runtime_id`）。分流条件
line 172 `if path_source == "daemon-client" and runtime_id is not None:` 改为
`if path_source == "daemon-client":`（runtime_id 在分支内现算）。

```python
if path_source == "daemon-client":
    runtime = await resolve_runtime_for_writeback(session, workspace_id, user.id)
    runtime_id = runtime.id
    daemon_id = <已从 binding 解析>
    # 建 DaemonChangeWrite（runtime_id 现算值）...
```

### 4.5 daemon/runtime/service.py（D-003）

line 674, 696 两处 runtime 删除 RESTRICT 查询：
```python
# 旧：col(Workspace.daemon_runtime_id) == runtime_id  # 新链路永远空
# 新：查 lease + change_write 的 runtime_id（D-003 保留处，有真实值）
leases = await session.execute(
    select(DaemonTaskLease.id).where(DaemonTaskLease.runtime_id == runtime_id).limit(1)
)
writes = await session.execute(
    select(DaemonChangeWrite.id).where(DaemonChangeWrite.runtime_id == runtime_id).limit(1)
)
# 任一命中 → RESTRICT 阻止删除
```

## §5 前端改动（D-002）

- `frontend/src/lib/changes.ts:226` `proxyCreateChange`：删 `runtime_id` 入参。
- `frontend/src/app/(dashboard)/workspaces/[id]/create-change/page.tsx:104`：
  `proxyCreateChange(workspaceId, { title, change_type, description })`——不再传
  runtime_id（daemon_id 后端从 binding 拿）。
- `frontend/src/lib/api-types.ts`：OpenAPI 重生成（`/changes/proxy-create` 请求体
  删 runtime_id）。
- create-change page 测试（`__tests__/page.test.tsx`）：更新断言（不传 runtime_id）。

## §6 边界与错误处理

所有失败均抛 `DaemonClientNoActiveSession`（AppError，HTTP 400，
code=DAEMON_CLIENT_NO_SESSION），details.reason 区分场景（§3.3）。**不偷偷 fallback**
到其他 provider（与派发 D-008 一致）。

| 场景 | reason | 错误信息 |
|------|--------|----------|
| 无 binding 行（用户未初始化 workspace） | not_bound | "未绑定守护进程，请重绑" |
| binding.daemon_id=None（旧 binding 未迁移） | not_bound | 同上（D-004 过渡期） |
| daemon 离线 / 不存在 / 不属 user | daemon_offline | "绑定的守护进程离线或不存在，请启动后重试" |
| workspace.default_agent=None | default_agent_unset | "守护进程已启用 {enabled}，但未设置 default_agent，请在工作区设置中配置" |
| daemon 无对应 default_agent 的 runtime | provider_unavailable | "守护进程已启用 {enabled}，但未启用 default_agent '{x}'" |
| runtime 心跳 stale（现算后竞态） | daemon_offline | proxy.py 二次心跳校验兜底，标 offline |

## §7 测试策略

### 7.1 后端单测（补 daemon_runtime_id=NULL + member binding 新链路）

- **member_runtimes/test_resolver**（新增）：`resolve_runtime_for_writeback`
  各边界（无 binding / daemon 离线 / default_agent 空 / 命中 / 无匹配 runtime）。
- **change_writer/test_proxy**：daemon-client workspace（runtime_id=NULL + binding）
  proxy_create_change 成功（不再 DAEMON_CLIENT_NO_SESSION）；daemon 离线 →
  NoOnlineDaemonError。
- **change/test_files_router**：`_enqueue_edit_write` 新链路成功落
  DaemonChangeWrite（runtime_id 现算值）。
- **spec_workspace/test_sync_manual**：daemon-client sync-manual 走 outbox
  分支返回 pending（不再错走 server-local）。
- **daemon/runtime/test_***：删除被 lease/change_write 引用的 runtime 被阻止；
  无引用的删除成功。
- **placement 现有测试**：查询函数提取为模块级后，零回归。

### 7.2 现有 fixture 盲区修复

`test_proxy.py` / `test_import.py` / `test_files_router.py` 等的 daemon-client
workspace fixture 当前用 `daemon_runtime_id=uuid.uuid4()`（非空 legacy）。
**新增 `daemon_runtime_id=None` + member binding 行的 fixture**，覆盖新链路
（这是 bug 漏到生产的主因）。

### 7.3 前端测试

- create-change page：daemon-client workspace 建变更不传 runtime_id，断言成功。

## §8 风险与对策

| 风险 | 对策 |
|------|------|
| placement 查询函数提取为模块级，可能影响派发现有测试 | 提取保持纯查询语义（不改逻辑），placement 测试全量跑（零回归门槛） |
| `NoOnlineDaemonError` 是 `Exception` 非 `AppError`，router 不翻译 → 裸 500（Grill 发现） | §3.3 已定：`resolve_runtime_for_writeback` 内部捕获转译为 `DaemonClientNoActiveSession`（AppError，HTTP 400） |
| `write_file` / `_enqueue_edit_write` 缺 user_id 参数（Grill 发现） | §4.3 已定改动链：write_file 签名 + change/router.py 端点 + _enqueue_edit_write 三处加 user_id |
| runtime 删除 RESTRICT 改查询后，lease/change_write 的 runtime_id 必须有真实值 | 前提：派发（placement 现算填 lease.runtime_id）+ 写回（本变更现算填 change_write.runtime_id）都满足；旧 NULL 行已 D-007 重置 |
| daemon-entity-binding 后建的 workspace 历史数据 runtime_id 全 NULL | D-007 重置原则，不做回填；新链路不读这些列 |

## §9 非目标

- 不改 DaemonChangeWrite 表结构（D-003 保留）。
- 不改 daemon 端轮询协议（仍按 runtime_id）。
- 不改 daemon_task_leases 流程（派发已修）。
- 不动 spec_workspace/import（ql-20260704-002 已修）。
- 不重构整个 change-writer 模块（仅修 binding 解析层）。
- 不做历史数据迁移（D-007 重置）。
- 不引入 daemon 端按 daemon_id 轮询的新协议（D-002 仅 backend+frontend 侧）。

## §10 决策引用

| 决策 | 说明 | 影响 |
|------|------|------|
| D-001@v1 | 写回时现算 runtime（方案 A） | §2 §3 §4.1 §4.3 §4.4 |
| D-002@v1 | proxy-create 入参删 runtime_id | §4.1 §4.2 §5 |
| D-003@v1 | runtime 删除 RESTRICT 改查 lease+change_write | §4.5 |
| D-004@v1 | 抽共享 resolve_runtime_for_writeback + placement 查询提取 | §3 |

与 daemon-entity-binding 既有决策关系：不违反 D-003/D-004，复用 D-005/D-008，
延续 D-007（重置）。

## §11 生命周期契约表

本变更**不引入新事件、不改任何状态转换**。仅在两个既有生命周期的固定环节
替换「runtime_id 取值来源」与「删除前引用检查的表」。下面列出涉及实体的
**事件 × 状态转换矩阵**，「本变更影响」列标注触及点：

### DaemonChangeWrite（变更写回任务）

| 事件 | from | to | 触发方 | 本变更影响 |
|------|------|----|--------|------------|
| create | (none) | pending | backend（proxy_create_change / _enqueue_edit_write / sync-manual） | **runtime_id 来源**从「直读 workspace.daemon_runtime_id」改为「resolve_runtime_for_writeback 现算」；其余字段/状态不变 |
| claim | pending | claimed | daemon（lease-polling GET /runtimes/{rid}/pending-change-writes） | 不变 |
| complete | claimed | done / failed | daemon（回执） | 不变 |

### DaemonRuntime（守护进程智能体会话）

| 事件 | from | to | 触发方 | 本变更影响 |
|------|------|----|--------|------------|
| register | (none) | online | daemon 注册（daemon-entity-binding D-006） | 不变 |
| heartbeat | online | online | daemon 心跳 | 不变 |
| mark_offline | online | offline | backend（heartbeat stale） | 不变 |
| delete | any | (deleted) | backend（runtime 注销） | **delete 前引用检查**：RESTRICT 查询表从 `workspaces.daemon_runtime_id` 改为 `daemon_task_leases.runtime_id` + `daemon_change_writes.runtime_id` |

### daemon_task_leases（派发租约）

| 事件 | from | to | 触发方 | 本变更影响 |
|------|------|----|--------|------------|
| create | (none) | pending | backend（dispatch，placement._resolve_dispatch_runtime） | 不变（派发已由 daemon-entity-binding D-005/D-008 现算填 lease.runtime_id） |
| claim / run / complete / cancel | … | … | daemon | 不变 |

### workspace_member_runtime（成员绑定）

| 事件 | from | to | 触发方 | 本变更影响 |
|------|------|----|--------|------------|
| upsert | (none)/bound | bound | backend（upsert_my_binding） | 不变（D-004：binding 行 runtime_id 仍不写） |
| delete | bound | (deleted) | backend | 不变 |

**结论**：本变更仅在 DaemonChangeWrite.create 与 DaemonRuntime.delete 两个固定点
替换内部取值/查询来源；事件、状态、转换、daemon 端协议（claim/complete/轮询）
零改动。

## §12 自审（Self-Review）

| 维度 | 结论 |
|------|------|
| 需求覆盖 | FR-01~07 / AC-01~08 覆盖对话式探索 + Grill 确认的全部需求 ✓ |
| decisions 引用一致性 | D-001~004@v1 在 design / proposal / requirements / decisions 四件套一致引用 ✓ |
| Grill 覆盖 | step 12 抓到 2 个真问题已修订：NoOnlineDaemonError 非 AppError（→ 转译 DaemonClientNoActiveSession，§3.3/§6/AC-05/D-001）；write_file 缺 user_id（→ 明确改动链，§4.3/D-001）✓ |
| 真实性 | 表名/字段名/方法名（DaemonChangeWrite.runtime_id NOT NULL / upsert_my_binding 不写 runtime_id / placement._resolve_dispatch_runtime / proxy.py:192 / service.py:407 / runtime/service.py:674,696）均来自真实代码核实 ✓ |
| YAGNI | 仅修 4 处直读点 + 1 个共享函数 + 前端删参数；不重构 change-writer 模块、不改表结构、不改 daemon 端协议 ✓ |
| 非目标清晰 | §9 + proposal Non-Goals + requirements 非目标三处显式列出 ✓ |
| 兼容策略 | legacy fixture（非空 daemon_runtime_id）走 fallback / server-local 不变；新 fixture 覆盖 NULL 新链路 ✓ |
| 风险识别 | §8 五条风险 + 对策（placement 查询提取 / 异常转译 / user_id 改动链 / RESTRICT 前提 / D-007 重置）✓ |
| 生命周期契约 | §11 事件×状态矩阵：本变更仅触及 DaemonChangeWrite.create 取值与 DaemonRuntime.delete 引用检查，不改事件/状态/协议 ✓ |
| 验收可测 | AC-01~08 均具体可测（含端到端 + 单测 + 回归）✓ |

自审通过，进入 plan 阶段。

## 文件变更清单

### 新增文件
- backend/app/modules/workspace/member_runtimes/queries.py （task-01）
- backend/app/modules/workspace/member_runtimes/tests/test_resolver.py （task-01）

### 修改文件
- backend/app/modules/workspace/member_runtimes/resolver.py （task-01）
- backend/app/modules/agent/placement.py （task-01）
- backend/app/modules/change_writer/proxy.py （task-02）
- backend/app/modules/change_writer/router.py （task-02）
- backend/app/modules/change_writer/service.py （task-02）
- backend/app/modules/change/service.py （task-03）
- backend/app/modules/change/router.py （task-03）
- backend/app/modules/spec_workspace/router.py （task-04）
- backend/app/modules/daemon/runtime/service.py （task-05）
- frontend/src/lib/changes.ts （task-06）
- frontend/src/app/(dashboard)/workspaces/[id]/create-change/page.tsx （task-06）
- frontend/src/lib/api-types.ts （task-06，OpenAPI 重生成）

### 测试文件（新增/修改）
- backend/app/modules/change_writer/tests/test_proxy.py （task-07）
- backend/app/modules/change/tests/test_files_router.py （task-07）
- backend/app/modules/spec_workspace/tests/test_sync_manual.py （task-07）
- backend/app/modules/daemon/runtime/tests/ （task-07）
- backend/app/modules/agent/tests/test_placement_member_binding.py （task-07）
- frontend/src/app/(dashboard)/workspaces/[id]/create-change/__tests__/page.test.tsx （task-08）
