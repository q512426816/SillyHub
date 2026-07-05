---
author: qinyi
created_at: 2026-07-05 00:32:47
change: 2026-07-05-daemon-client-change-binding-fix
stage: brainstorm
---

# Decisions — daemon-client 写回流程对齐 daemon-entity-binding

> 决策台账：仅记录有实现/验收影响的决策。长期术语在 archive/scan 时再提升到 glossary.md。

## D-001@v1 — 写回时现算 runtime（方案 A）

- **type**: architecture
- **status**: accepted
- **source**: brainstorm step 6 对话式探索（用户选定）
- **question**: daemon-client 写回任务（DaemonChangeWrite）的 runtime_id 怎么补？
  D-003 要求该列 NOT NULL，D-004 要求 binding 不写 runtime_id，二者矛盾。
- **answer**: 每次建写回任务时，用 `binding.daemon_id` + `workspace.default_agent`
  现场解析该 daemon 下匹配的 online runtime。复用 placement._resolve_dispatch_runtime
  已有的查询链路。
- **normalized_requirement**: 不改 DaemonChangeWrite 表结构、不改 daemon 端轮询、
  不改 binding 写入逻辑；写回链路改调共享 resolve_runtime_for_writeback。
- **impacts**:
  - change_writer/proxy.py:192 校验逻辑重写
  - change/service.py:407 runtime_id 来源改现算（+ write_file/router/_enqueue_edit_write 补 user_id 参数，Grill 发现）
  - spec_workspace/router.py sync-manual runtime_id 来源改现算
  - 新增共享 resolve_runtime_for_writeback（见 D-004）
  - 异常类型：复用 placement 查询抛 NoOnlineDaemonError（Exception 子类），resolve_runtime_for_writeback 内部转译为 DaemonClientNoActiveSession（AppError HTTP 400）
- **evidence**:
  - `daemon/model.py:398-403` DaemonChangeWrite.runtime_id NOT NULL
  - `member_runtimes/service.py:43-44` upsert_my_binding 不写 runtime_id
  - `placement.py:702-749` _resolve_dispatch_runtime 的 daemon_id+default_agent 解析逻辑
  - `placement.py:44` NoOnlineDaemonError 是 Exception 非 AppError（Grill 发现 → 转译）
  - `change_writer/proxy.py` DaemonClientNoActiveSession（AppError，code=DAEMON_CLIENT_NO_SESSION）
  - `change/service.py:328` write_file 签名缺 user_id（Grill 发现 → 补传）
- **priority**: P0

## D-002@v1 — proxy-create 端点入参删 runtime_id

- **type**: api
- **status**: accepted
- **source**: brainstorm step 9 设计确认（用户确认）
- **question**: proxy-create 端点（/changes/proxy-create）入参保留 runtime_id 还是
  删掉？
- **answer**: 删掉。前端不传 runtime_id，后端从 binding（resolver）+ workspace.
  default_agent 现算。语义对齐 daemon-entity-binding（runtime 不再是绑定维度）。
- **normalized_requirement**: ProxyCreateChangeRequest 删 runtime_id 字段；
  create_change 签名删 runtime_id 参数；前端 proxyCreateChange + create-change page
  不传 runtime_id。
- **impacts**:
  - change_writer/router.py proxy-create 端点入参
  - change_writer/service.py create_change 签名
  - frontend create-change/page.tsx + lib/changes.ts
  - api-types.ts OpenAPI 重生成
- **evidence**:
  - `change_writer/router.py:90-124` proxy-create 现入参 data.runtime_id
  - `frontend/.../create-change/page.tsx:104` 当前传 runtime_id
- **priority**: P0

## D-003@v1 — runtime 删除 RESTRICT 改查 lease + change_write

- **type**: bugfix
- **status**: accepted
- **source**: brainstorm step 7 grill（同类 workspace.daemon_runtime_id 直读遗漏）
- **question**: daemon/runtime/service.py:674,696 runtime 删除 RESTRICT 查询用
  `Workspace.daemon_runtime_id == runtime_id`，新链路该列永远 NULL → 保护失效。
  怎么修？
- **answer**: 改查 `daemon_task_leases.runtime_id` + `daemon_change_writes.runtime_id`
  （D-003 保留 runtime_id FK 处）。新链路下 lease（派发现算）+ change_write（写回现算）
  的 runtime_id 都有真实值，RESTRICT 保护恢复有效。
- **normalized_requirement**: runtime 删除前的「是否被引用」检查改查 lease +
  change_write 表，不查 workspaces.daemon_runtime_id。
- **impacts**:
  - daemon/runtime/service.py:674,696 两处查询改表
  - daemon-runtime 测试补：删除被 lease/change_write 引用的 runtime 被阻止
- **evidence**:
  - `daemon/runtime/service.py:674,696` 现查 Workspace.daemon_runtime_id
  - `daemon/model.py:303` daemon_task_leases.runtime_id（D-003 保留）
  - `daemon/model.py:398` daemon_change_writes.runtime_id（D-003 保留）
- **priority**: P1（边角，但同源根因）

## D-004@v1 — 抽共享 resolve_runtime_for_writeback 复用 placement 查询

- **type**: refactor
- **status**: accepted
- **source**: brainstorm step 9 设计确认
- **question**: 写回时现算 runtime 的逻辑放哪？placement._resolve_dispatch_runtime
  绑在 DaemonPlacement 类上，change_writer/change/spec_workspace 不能直接调。
- **answer**: 抽共享函数 `resolve_runtime_for_writeback(session, workspace_id, user_id)
  -> DaemonRuntime` 放在 `workspace/member_runtimes/` 模块（与 MemberBindingResolver
  同位）。placement 的三个查询函数（_query_daemon_online_by_id /
  _query_runtime_by_daemon_and_provider / _get_daemon_enabled_providers）提取为
  模块级共享函数（或在 member_runtimes 提供等价实现），placement 与 writeback 共用。
- **normalized_requirement**: 新增共享解析函数；placement 重构为调用同一组查询函数；
  避免逻辑重复（DRY）。
- **impacts**:
  - workspace/member_runtimes/ 新增 resolve_runtime_for_writeback
  - agent/placement.py 查询函数提取为共享（或下沉到 member_runtimes）
  - 测试：placement 现有测试无回归 + writeback 解析单测
- **evidence**:
  - `placement.py:716,740,745` 三个查询函数
  - `member_runtimes/resolver.py` 现有 MemberBindingResolver 位置
- **priority**: P0

## 与既有决策的关系

- **不违反 D-003（daemon-entity-binding）**：DaemonChangeWrite.runtime_id NOT NULL
  保留，仍填值（现算填入）。
- **不违反 D-004（daemon-entity-binding）**：binding 行 runtime_id 不写，本变更不动
  upsert_my_binding。
- **复用 D-005/D-008（daemon-entity-binding）**：daemon_id + default_agent → runtime
  的解析链路 + 不 fallback 语义，与 dispatch 一致。
- **D-007（重置）延续**：不做历史数据迁移。
