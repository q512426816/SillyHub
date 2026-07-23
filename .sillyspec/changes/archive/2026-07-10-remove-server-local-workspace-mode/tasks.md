---
author: qinyi
created_at: 2026-07-10 22:38:00
---

# 任务清单（Tasks）— 移除工作区 server-local 模式

> **骨架版**：Wave/Task 由 `sillyspec run plan --change 2026-07-10-remove-server-local-workspace-mode` 细化为可执行 TaskCard。本文件给出 Wave 分组与依赖方向，供 plan 阶段输入。

## Wave 1 · 后端 workspace + spec_workspace 核心（design Phase 1）

- workspace model.py：删 path_source + daemon_runtime_id 列 + ix 索引
- workspace schema.py：删 PathSourceLiteral + 各 DTO 字段
- workspace service.py：删 is_daemon_client_path_source / resolve_root_path_for_server / create server-local 分支 / scan+scan_generate 本地版（两步：删旧 scan_generate:692 + scan_generate_daemon_client:853 改名）/ 列表过滤 / daemon_runtime_id 引用(194/244/373/863/893/944)
- workspace router.py：删 _require_server_local_workspace_admin + 3 调用 + daemon_runtime_id(130/132/141)
- workspace skills_view_service.py：删 server-local 平铺列目录分支
- workspace member_runtimes/resolver.py + queries.py：删 not_daemon_client + daemon_runtime_id legacy(152-186 / 128-169)
- spec_workspace router/service/bootstrap：删 sync_manual_server_local / _pack_sillyspec_local / import_from_repo 本地分支 / daemon_runtime_id fallback(119-202/220-306) / resolve_root_path_for_server + safe.directory

## Wave 2 · HostFsDelegate + agent + spec_paths（design Phase 2，重灾区）

- daemon/host_fs/delegate.py：删 6 个 _local_* + _run_git_apply；read_package_json/read_local_yaml 删内联分支；**run_command 删 server-local 拒绝分支(737-747)**；docstring/异常消息清理(203/837-863)
- daemon/host_fs/ws_rpc.py：daemon_runtime_id 引用(161)
- agent/placement.py：删 server-local Branch 0/2 兜底 + daemon_runtime_id legacy 路由
- agent/service.py（重灾区）：删 _legacy_root_exists_check(247-320) / resolve_root_path_for_server 调用(1411) / _get_workspace_root 签名改单值(1812-1827) / stage prompt spec-root(1052/1073/1124/1372/1472)
- agent/post_scan_validator.py：删 _validate_server_local
- agent/context_builder.py：删 path_source 贯穿
- agent/execution.py：resolve_root_path_for_daemon 签名断链(110)
- core/spec_paths.py：重构 transport_for_path_source / resolve_prompt_spec_root / resolve_root_path_for_daemon 为单一 daemon-client

## Wave 3 · 调度/收尾分流（design Phase 2 续）

- change/dispatch.py + change/service.py（含 daemon_runtime_id 316/375）
- change_writer/service.py + proxy.py（daemon_runtime_id 7）
- daemon/patch/service.py
- daemon/run_sync/service.py：删 path_source 分流(1429-1452) + `or "server-local"` 兜底
- daemon/runtime/service.py：**删 UPDATE daemon_runtime_id=None SQL(727-730)** —— P0 不删运行时崩
- knowledge/service.py + scan_docs/service.py(164-168)

## Wave 4 · DB 迁移（design Phase 3）

- 新迁移 20260710*_remove_workspace_path_source.py，down_revision=7c77e09b84e1
- 步骤：① 显式 DELETE 非 CASCADE 表（incident RESTRICT 必删；workflow/agent_runs SET NULL 评估）→ ② DELETE FROM workspaces WHERE path_source='server-local'（CASCADE 连带）→ ③ DROP path_source + daemon_runtime_id 列

## Wave 5 · 前端清除（design Phase 4）

- 组件群：workspace-scan-dialog / access-guide / config-card / path-fields / workspace-card(98) / binding-dialog / binding-guard / daemon-switcher / switcher
- lib：workspace-path / workspace-daemon-status(6) / workspaces(path_source 入参) / spec-workspaces(199)
- pages：workspaces 列表(筛选 option) / [id]/page / create-change(永远 proxy) / changes(禁用逻辑) / [id]/agent
- api-types.ts：手动同步删字段

## Wave 6 · daemon + 测试精简（design Phase 5+6）

- sillyhub-daemon：spec-sync.ts / task-runner.ts 注释 + api-types.ts 同步
- 后端 ~30 测试文件删 server-local case（test_delegate / test_dispatch_workspace_routing / test_post_scan_validator 等）
- 前端组件测试删 server-local case

## Wave 7 · 验收（design Phase 7）

- AC-1：grep 生产代码 server-local/path_source/daemon_runtime_id 清零
- AC-2~4：backend pytest + frontend vitest/typecheck + daemon vitest 全绿
- AC-5~7：Docker 迁移 + 端到端 + PG 无 FK 残留

## 依赖方向

Wave 4（迁移）依赖 Wave 1~3（代码不再引用列）；Wave 5（前端）可与 Wave 1~3 并行但 api-types 同步依赖后端 schema 定型；Wave 6 测试精简随各 Wave 同步；Wave 7 最后。
