---
plan_level: full
author: qinyi
created_at: 2026-07-10 22:45:00
---

# 实现计划（Plan）— 移除工作区 server-local 模式

> 来源：design.md §5（7 Phase）+ §6（文件清单）+ tasks.md（Wave 骨架）+ decisions.md（D-001~D-007）。
> 本次为纯删除性质，技术方案确定，**无 Spike 前置验证**（无新技术栈/隔离/性能不确定性）。

## Wave 1（并行，schema 与迁移基础层）

- [x] task-01: workspace model + schema 删 path_source/daemon_runtime_id 字段 + ix 索引（覆盖：FR-2, FR-4, FR-5, D-005）
- [x] task-02: 新 alembic 迁移（down=7c77e09b84e1），显式 DELETE 非 CASCADE 表(incident) + DELETE server-local 工作区行 + DROP 两列（覆盖：FR-4, D-004, D-006, D-007）

## Wave 2（依赖 Wave 1 schema 定型；后端 service/router/delegate/agent/spec_paths）

- [x] task-03: workspace service + router + skills_view_service + member_runtimes(resolver+queries) 删 server-local 分流 + daemon_runtime_id 引用 + scan_generate 两步重命名（覆盖：FR-1, FR-2, FR-5, D-001, D-007）
- [x] task-04: spec_workspace router + service + bootstrap 删 sync_manual_server_local/_pack_sillyspec_local/import_from_repo 本地分支 + daemon_runtime_id fallback + safe.directory（覆盖：FR-2, FR-5）
- [x] task-05: HostFsDelegate 删 6 个 _local_* + _run_git_apply + run_command server-local 拒绝分支(737-747) + read_package_json/read_local_yaml 内联分支 + ws_rpc daemon_runtime_id + docstring 清理（覆盖：FR-3, D-002, D-007, R-01）
- [x] task-06: agent 模块（placement 删 server-local 兜底+daemon_runtime_id legacy / service 重灾区 _legacy_root_exists_check+_get_workspace_root 签名+stage prompt / post_scan_validator _validate_server_local / context_builder / execution 签名断链）（覆盖：FR-2, FR-5, R-07）
- [x] task-07: transport helper 重构（transport_for_path_source/resolve_prompt_spec_root 实际位于 agent/context_builder.py，core/spec_paths.py 核实后可能零改；与 task-06 同改 context_builder 不同函数，execute 顺序处理）（覆盖：FR-6, R-08）

## Wave 3（依赖 Wave 2；后端调度/收尾分流）

- [x] task-08: change/dispatch + change/service + change_writer/service + change_writer/proxy + daemon-patch/service 删 path_source 分流 + daemon_runtime_id（覆盖：FR-2, FR-5）
- [x] task-09: daemon/run_sync/service(1429-1452 分流+or "server-local" 兜底) + daemon/runtime/service(727-730 UPDATE daemon_runtime_id=None **P0 必删**) + knowledge/service + scan_docs/service 删 path_source/daemon_runtime_id（覆盖：FR-2, FR-5, D-003 边界, D-007 P0）

## Wave 4（可与 Wave 2-3 并行；前端清除，api-types 依赖后端 schema 定型）

- [x] task-10: 前端 workspace 组件群（workspace-scan-dialog 删 radio+本地扫描 / access-guide 删下拉 / config-card 删 isServerLocal / path-fields / workspace-card / binding-dialog / binding-guard / daemon-switcher / switcher）（覆盖：FR-1）
- [x] task-11: 前端 lib + pages（workspace-path / workspace-daemon-status / workspaces(path_source 入参) / spec-workspaces / workspaces 列表筛选 / [id]/page / create-change 永远 proxy / changes 禁用 / [id]/agent）（覆盖：FR-1）
- [x] task-12: api-types.ts 手动同步（frontend + sillyhub-daemon 删 path_source/daemon_runtime_id 类型）+ daemon spec-sync.ts/task-runner.ts 注释更新（覆盖：FR-7, R-03）

## Wave 5（依赖 Wave 1-4；测试精简与全量回归）

- [x] task-13: 后端测试精简（~30 文件删 server-local case，保留 daemon-client 断言）+ 全量 pytest 守回归覆盖率≥60%（覆盖：FR-8, R-01, R-07）
- [x] task-14: 前端组件测试精简 + vitest + typecheck 守回归（覆盖：FR-8, R-03）

## Wave 6（依赖全部；端到端验收）

- [x] task-15: Docker 部署迁移 upgrade 验证（incident 不违约）+ daemon-client 端到端（scan/dispatch/lease/spec-sync）+ grep 生产代码 server-local/path_source/daemon_runtime_id 清零（覆盖：AC-1~7, R-02, R-08）

## 任务总表

| 编号 | 任务 | Wave | 优先级 | 依赖 | 覆盖 FR/D | 说明 |
|---|---|---|---|---|---|---|
| task-01 | workspace model+schema 删两列+索引 | W1 | P0 | — | FR-2,4,5; D-005 | schema 定型前置 |
| task-02 | alembic 迁移（incident 显式删+DROP 两列） | W1 | P0 | — | FR-4; D-004,6,7 | down=7c77e09b84e1；apply 在 task-15 |
| task-03 | workspace service/router/skills_view/member_runtimes | W2 | P0 | task-01 | FR-1,2,5; D-001,7 | scan_generate 两步重命名 |
| task-04 | spec_workspace router/service/bootstrap | W2 | P0 | task-01 | FR-2,5 | 删本地分支+fallback |
| task-05 | HostFsDelegate 删 _local_*+run_command 分支 | W2 | P0 | task-01 | FR-3; D-002,7; R-01 | 6 _local_*+ _run_git_apply |
| task-06 | agent placement/service/post_scan_validator/context_builder/execution | W2 | P0 | task-01 | FR-2,5; R-07 | service 重灾区 |
| task-07 | transport helper 重构(context_builder) | W2 | P0 | task-01 | FR-6; R-08 | spec_paths.py 核实后可能零改;与 task-06 同文件不同函数 |
| task-08 | change+change_writer+daemon-patch 分流 | W3 | P0 | task-03,04 | FR-2,5 | 调度分流清除 |
| task-09 | daemon run_sync+runtime[P0]+knowledge+scan_docs | W3 | P0 | task-05 | FR-2,5; D-003,7 | runtime:727-730 必删 |
| task-10 | 前端 workspace 组件群 | W4 | P1 | — | FR-1 | 可与 W2-3 并行 |
| task-11 | 前端 lib+pages | W4 | P1 | — | FR-1 | 可与 W2-3 并行 |
| task-12 | api-types.ts 同步+daemon 注释 | W4 | P1 | task-01 | FR-7; R-03 | 无 codegen 手动同步 |
| task-13 | 后端测试精简+pytest 回归 | W5 | P0 | task-03~09 | FR-8; R-01,7 | 覆盖率≥60% |
| task-14 | 前端测试精简+vitest/typecheck | W5 | P1 | task-10~12 | FR-8; R-03 | typecheck 守类型 |
| task-15 | Docker 迁移+端到端+grep 清零 | W6 | P0 | task-02,13,14 | AC-1~7; R-02,8 | 部署验收 |

## 关键路径

task-01 → task-03 → task-06 → task-13 → task-15（后端 schema → service 核心 → agent 重灾区 → 测试回归 → 部署验收，最长路径）

## 全局验收标准

- [ ] backend `uv run pytest -q --cov=app --cov-fail-under=60` 全绿
- [ ] frontend `pnpm test` + `pnpm typecheck` 全绿
- [ ] sillyhub-daemon `pnpm test` 全绿
- [ ] （brownfield 兼容性）项目未上线，迁移删除存量 server-local 工作区行（D-006），不要求旧 server-local 行为不变；daemon-client 路径行为零回归（复用 D-006 降级）
- [ ] 迁移 upgrade 成功，PG 无 FK 违约残留（incident 等非 CASCADE 表已清理，AC-7）
- [ ] daemon-client 工作区端到端可用：scan → dispatch → lease → spec-sync（AC-6）
- [ ] grep 生产代码 `server-local`/`path_source`/`daemon_runtime_id` 清零（测试与 archive 除外，AC-1）

## 覆盖矩阵

| ID | 覆盖任务 | 验收证据 |
|---|---|---|
| D-001@v1 | task-03 | router 删 _require_server_local_workspace_admin，workspace:admin 枚举/菜单保留 |
| D-002@v1 | task-05 | HostFsDelegate 复用 _via_rpc_or_degrade，run_command 走 _via_rpc |
| D-003@v1 | task-09 | run_sync path_source 分流删；complete_lease 3 处容器越界不在范围 |
| D-004@v1 | task-02,15 | 标准 alembic 迁移保链，Docker upgrade 验证 |
| D-005@v1 | task-01,03,04,06,08,09 | daemon_runtime_id 列+12+ 文件 legacy 清除 |
| D-006@v1 | task-02,15 | 存量 server-local 行删除，FK 全表清理 |
| D-007@v1 | task-02,03,05,06,07,09 | Grill 修正全部落地（_local_* 数/run_command/FK/文件清单） |
| FR-1 | task-03,10,11 | 前端 UI + workspace service 统一 daemon-client |
| FR-2 | task-01,03,04,06,08,09 | 后端 path_source 分流全删 |
| FR-3 | task-05 | HostFsDelegate 固定走 RPC |
| FR-4 | task-02 | DB 迁移 DROP 两列 |
| FR-5 | task-01,03,04,06,08,09 | daemon_runtime_id 清除 |
| FR-6 | task-07 | spec_paths transport 重构 |
| FR-7 | task-12 | api-types.ts 同步 |
| FR-8 | task-13,14 | 测试精简 |
