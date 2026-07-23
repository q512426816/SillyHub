---
author: qinyi
created_at: 2026-07-10 22:38:00
---

# 决策记录（Decisions）— 移除工作区 server-local 模式

> 与 design.md §11 同步。版本规则：推翻旧决策新增 `@v2`，不覆盖 `@v1`。

## D-001@v1: workspace:admin 权限保留
- type: boundary
- priority: P1
- status: accepted
- source: code
- question: 删 server-local 后 workspace:admin 权限是否一并清理？
- answer: 否。仍用于前端菜单「工作区管理」(menu-permissions.ts:72) + Permission 枚举(permissions.py:53) + admin 角色赋权。仅删运行时门禁 `_require_server_local_workspace_admin`。
- normalized_requirement: 保留 Permission.WORKSPACE_ADMIN 枚举/菜单/赋权；删 router._require_server_local_workspace_admin + scan/scan-generate/create 三处调用。
- impacts: [FR-2, Wave 1 router]
- evidence: permissions.py:53, menu-permissions.ts:72, workspace/router.py:55-72,113,147,172

## D-002@v1: daemon 离线复用 D-006 degrade
- type: boundary
- priority: P1
- status: accepted
- source: code
- question: 删 server-local 后所有工作区依赖 daemon，离线时 scan/create/文件操作如何处理？
- answer: 复用 HostFsDelegate._via_rpc_or_degrade（D-006 warn-and-degrade），返回降级值；run_command 用 _via_rpc raise。已是现有行为，无需新增。
- normalized_requirement: 不新增降级逻辑，复用 delegate._via_rpc_or_degrade；run_command 保持 raise HostFsDelegateUnavailable。
- impacts: [FR-3, NFR-1, Wave 2]
- evidence: delegate.py:77-109,166,236-659,718

## D-003@v1: complete_lease 3 处容器越界不在本次范围
- type: boundary
- priority: P1
- status: accepted
- source: user + code
- question: 删 _local_* 方法时 complete_lease 侧 3 处容器越界是否一并修？
- answer: 否。apply_patch 500 / post_scan_validation / stage_callback 3 处**容器越界 bug**属独立 container-overreach 变更（用户已表态起独立变更，当前未建）。本次只删 path_source 分流 + _local_* 方法；run_sync/service.py 的 path_source 分流属本次（必删否则断链）。
- normalized_requirement: 本次范围限定 path_source 分支删除 + _local_* 方法删除；容器越界 3 处不在范围（除非引用被删符号）。
- impacts: [Wave 2-3 边界]
- evidence: 调研报告 + 用户决策

## D-004@v1: 实现方案 A（标准迁移 + 专项范围）
- type: architecture
- priority: P0
- status: accepted
- source: user
- question: 迁移策略与范围边界？
- answer: 标准 alembic 迁移（down=当前 head）保链 + 范围限定 server-local 专项不碰 container-overreach。否决方案 B（重置 DB 原地改早期迁移，破坏链）与方案 C（顺带修越界，扩范围冲突）。
- normalized_requirement: 标准迁移文件，down_revision=7c77e09b84e1；范围不裹挟 container-overreach。
- impacts: [FR-4, Wave 4]
- evidence: 用户 Step 8 选择

## D-005@v1: daemon_runtime_id 一并清理
- type: boundary
- priority: P1
- status: accepted
- source: user
- question: daemon_runtime_id 半死代码列是否一并清理？
- answer: 是。daemon-entity-binding 后已 legacy fallback，本次连 path_source 一起删列 + placement/resolver/queries/spec_workspace 等 12+ 文件 legacy 回退路径。
- impacts: [FR-4, FR-5, Wave 1-3]
- evidence: 用户 Step 6 选择

## D-006@v1: 存量 server-local 数据删除
- type: compatibility
- priority: P0
- status: accepted
- source: user
- question: 存量 server-local 工作区数据如何处理？
- answer: 删除（连带 FK 全表：incident 显式删 + CASCADE 连带其余 18 张）。项目未上线允许重置。
- impacts: [FR-4, Wave 4]
- evidence: 用户 Step 6 选择

## D-007@v1: Design Grill 修正
- type: consistency
- priority: P0
- status: accepted
- source: code (Design Grill 子代理交叉审查)
- question: 首版 design 是否有结构性硬伤？
- answer: 采纳修正：
  - **P0-1** _local_* 实际 6 个（_local_stat/_local_git_apply/_local_git_rev_parse/_local_pollution_archive/_local_read_json/_local_read_yaml）+ _run_git_apply 辅助；首版误写 8 且 _local_read_file/_local_list_dir 不存在（内联 Path）；public 名 read_package_json/read_local_yaml。
  - **P0-2** run_command(692) 读 workspace.path_source（首版"保持不变"错），补删 server-local 拒绝分支(737-747)。
  - **P0-3** FK 连带表 4→18 张，incident 无 ondelete=RESTRICT 迁移须显式 DELETE。
  - **P0-4** 后端补遗漏文件：core/spec_paths.py / agent/context_builder.py / agent/execution.py / workspace/skills_view_service.py / daemon/runtime/service.py(727-730) / daemon/run_sync/service.py(1452) / knowledge+scan_docs+change_writer/proxy。
  - **P1-1~5** 前端补 9 文件 + agent/service 重灾区十几处 + daemon_runtime_id 影响矩阵 12 文件 + docstring 清理 + OpenAPI 无 codegen 手动同步。
  - **P2-1~4** scan_generate 两步 + DROP ix 索引 + root_path 语义 + run_sync 边界澄清。
  - **否决 P0-5**：子代理误判 alembic 多 head，实测 `alembic heads` 单一 head 7c77e09b84e1。
- impacts: [design.md 全文修正, 所有 Wave]
- evidence: design.md revision note + delegate.py:245-668 grep + model.py FK grep + alembic heads 实测
