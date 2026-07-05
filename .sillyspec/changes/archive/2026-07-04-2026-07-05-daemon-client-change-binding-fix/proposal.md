---
author: qinyi
created_at: 2026-07-05 00:32:47
change: 2026-07-05-daemon-client-change-binding-fix
stage: brainstorm
---

# Proposal — daemon-client 写回流程对齐 daemon-entity-binding

## 背景

`2026-07-03-daemon-entity-binding` 把工作区绑定从 `runtime_id`（智能体会话）改成
`daemon_id`（机器实体）：`workspace_member_runtimes.runtime_id` 保留列但
`upsert_my_binding` **不再写入**（注释明示 "preserved nullable but NOT written"），
`workspaces.daemon_runtime_id` 同样退化为 NULL。该变更改了派发写侧
（`placement._resolve_dispatch_runtime` 用 `MemberBindingResolver` + `default_agent`
现算 runtime，D-005/D-008）+ task-16 改了 runtime 页面读侧。

但「变更写回任务队列」这一层（`DaemonChangeWrite` 表 + proxy/lease-polling 代写链路）
**全程直读 `workspace.daemon_runtime_id` / `binding.runtime_id`**，没适配。而
`DaemonChangeWrite.runtime_id` 是 **NOT NULL FK**（`daemon/model.py:398-403`），daemon
端按 `runtime_id` 轮询领任务（`GET /runtimes/{rid}/pending-change-writes`）。

D-003（lease/change_writes 保留 runtime_id FK）与 D-004（binding 不写 runtime_id）
直接矛盾 → daemon-client workspace 上所有写回操作拿不到 runtime_id → 全部失败：

- 建变更 `proxy_create_change`：`change_writer/proxy.py:192` 校验
  `workspace.daemon_runtime_id != runtime_id`，新链路前者 NULL 永远不匹配 →
  `DAEMON_CLIENT_NO_SESSION`。
- 写变更文件 `_enqueue_edit_write`：`change/service.py:407`
  `runtime_id = workspace.daemon_runtime_id` → NULL → `ChangeDocNotFound`。
- spec 手动同步 `sync-manual`：`spec_workspace/router.py:172` 分流条件
  `runtime_id is not None` 永远 False → 错走 server-local 分支（同 import 的
  "cannot resolve server path"，已由 ql-20260704-002 单点修了 import，sync-manual 未修）。
- runtime 删除 RESTRICT：`daemon/runtime/service.py:674,696` 查
  `Workspace.daemon_runtime_id == runtime_id`，新链路永远空 → 保护失效。

`spec_workspace/import`（ql-20260704-002，commit a14c45c5）已暴露并单点修复了同类
问题的一个表现。本变更是对其余 4 处的同源根因系统性修复。

## 目标

- daemon-client workspace 上建变更 / 写文件 / spec 同步不再因 runtime_id 缺失失败。
- 写回链路与派发链路共用同一套「daemon_id + default_agent → runtime」解析，消除
  D-003/D-004 矛盾在写回层的体现。
- runtime 删除的 RESTRICT 保护恢复有效（按 lease/change_write 实际 runtime_id 引用查）。
- 补 `daemon_runtime_id=NULL + member binding` 新链路测试覆盖（现有 fixture 全用
  非空 runtime_id，是该 bug 漏到生产的主因）。

## 方案（A · 写回时现算 runtime）

每次需要建 `DaemonChangeWrite`（或校验写回 runtime）时，用
`binding.daemon_id` + `workspace.default_agent` 现场解析该 daemon 下匹配的 online
runtime，复用 `placement._resolve_dispatch_runtime` 已有的查询链路
（`_query_daemon_online_by_id` + `_query_runtime_by_daemon_and_provider` +
`_get_daemon_enabled_providers`）。抽共享函数 `resolve_runtime_for_writeback`
（D-004），在 change_writer / change / spec_workspace 三处调用。proxy-create 端点
入参不再要 `runtime_id`（前端不传，后端从 binding 现算）。runtime 删除 RESTRICT
改查 lease + change_write 的 runtime_id（D-003）。

不改 `DaemonChangeWrite` 表结构（NOT NULL 保留，仍填值）、不改 daemon 端轮询
（仍按 runtime_id）、不改 lease 流程（派发已修）。

## 影响范围

- backend：`workspace/member_runtimes`（新增共享解析）、`change_writer`
  （proxy + router + service）、`change`（service）、`spec_workspace`（router
  sync-manual）、`daemon/runtime`（service 删除 RESTRICT）、`agent/placement`
  （抽取查询逻辑为共享）。
- frontend：`create-change/page.tsx`、`lib/changes.ts`（删 runtime_id 参数）、
  `lib/api-types.ts`（OpenAPI 重生成）。
- 测试：change_writer / change / spec_workspace / daemon-runtime / placement 各补
  新链路用例；create-change page 前端测试更新。
- 数据：无需迁移（D-007 重置；新链路不依赖历史 runtime_id 值）。

## Non-Goals（不在范围内）

- 不改 `DaemonChangeWrite` 表结构（runtime_id NOT NULL 保留，D-003）。
- 不改 daemon 端轮询协议（仍按 runtime_id）。
- 不改 `daemon_task_leases` 流程（派发已由 daemon-entity-binding 修好）。
- 不动 spec_workspace/import（ql-20260704-002 已修）。
- 不重构整个 change-writer 模块（仅修 binding 解析层）。
- 不做历史数据迁移（D-007 重置）。
- 不引入 daemon 端按 daemon_id 轮询的新协议（本变更仅 backend + frontend 侧）。

详细 AC / 非目标见 `requirements.md`。
