---
author: qinyi
created_at: 2026-07-10 22:38:00
---

# 需求规格（Requirements）— 移除工作区 server-local 模式

## 角色

| 角色 | 说明 |
|---|---|
| 工作区创建者 | 创建/绑定工作区，统一走 daemon-client（绑 daemon 实体） |
| 平台管理员 | 原 server-local 的 `workspace:admin` 运行时门禁移除（权限枚举保留用于菜单显示） |
| daemon | 工作区文件操作唯一执行方（backend 经 HostFsDelegate RPC 委托） |

## 功能需求（FR）

- **FR-1**：工作区创建/绑定 UI 不再提供 server-local 选项，统一 daemon-client（scan-dialog / access-guide / 列表筛选 / config-card 等 19 个前端文件）。
- **FR-2**：后端 workspace / spec_workspace / agent / change / change_writer / daemon-patch / knowledge / scan_docs 所有 path_source 分流删除，永远走 daemon-client。
- **FR-3**：HostFsDelegate 删 6 个 `_local_*`（_local_stat/_local_git_apply/_local_git_rev_parse/_local_pollution_archive/_local_read_json/_local_read_yaml）+ `_run_git_apply` 辅助；public 方法（read_package_json/read_local_yaml 等）固定走 `_via_rpc_or_degrade`；`run_command` 删 server-local 拒绝分支，走 `_via_rpc`。
- **FR-4**：DB 迁移删除 `path_source` + `daemon_runtime_id` 列；DELETE 存量 server-local 工作区行（显式处理 incident RESTRICT + CASCADE 连带其余 18 张 FK 表）。
- **FR-5**：`daemon_runtime_id` legacy 回退路径清除（placement / resolver / queries / spec_workspace / workspace service+schema+router / daemon-runtime-service / ws_rpc 等 12+ 文件）。
- **FR-6**：`core/spec_paths.py` transport 决策（transport_for_path_source / resolve_prompt_spec_root / resolve_root_path_for_daemon）重构为单一 daemon-client。
- **FR-7**：前端 + daemon `api-types.ts` 手动同步删 path_source/daemon_runtime_id 类型字段（无自动化 codegen）。
- **FR-8**：测试精简（后端 ~30 文件 + 前端组件测试删 server-local case，保留 daemon-client 断言）。

## 非功能需求（NFR）

- **NFR-1**：daemon-client 路径零回归（复用 D-006 降级，daemon 离线走 `_via_rpc_or_degrade` 不崩）。
- **NFR-2**：迁移链完整（标准 alembic，down_revision=7c77e09b84e1 实测单一 head）。
- **NFR-3**：兼容 Win/Linux/macOS（无平台特定代码引入）。
- **NFR-4**：中文 UI/文档（CLAUDE.md 规则 11）。
- **NFR-5**：生产级标准（CLAUDE.md 规则 2，TDD：测试先于/同步实现改动）。

## 验收标准（AC）

- **AC-1**：`grep -rn "server-local\|path_source\|daemon_runtime_id" backend/app frontend/src sillyhub-daemon/src`（排除 tests / archive）→ 零命中。
- **AC-2**：backend `uv run pytest -q --cov=app --cov-fail-under=60` 全绿。
- **AC-3**：frontend `pnpm test` + `pnpm typecheck` 全绿。
- **AC-4**：sillyhub-daemon `pnpm test` 全绿。
- **AC-5**：Docker compose up，迁移 upgrade 成功，`curl` 新建工作区只能 daemon-client。
- **AC-6**：daemon-client 工作区端到端：scan → dispatch → lease → spec-sync 可用。
- **AC-7**：迁移后 PG 无 FK 违约残留（incident 等非 CASCADE 表已清理）。
