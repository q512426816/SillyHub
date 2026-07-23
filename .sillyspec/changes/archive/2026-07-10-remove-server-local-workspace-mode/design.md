---
author: qinyi
created_at: 2026-07-10 22:05:30
updated_at: 2026-07-10 22:30:00
scale: large
---

# 设计文档（Design）— 移除工作区 server-local (localhost) 模式

> **revision note（D-007 Grill 修正）**：首版 design 经 Design Grill 子代理交叉审查发现文件清单不全、HostFsDelegate 方法枚举错、迁移 FK 范围严重低估、daemon_runtime_id 影响面低估等硬伤。本版已全部修正（采纳 P0-1~4 / P1-1~5 / P2-1~4；仅否决 P0-5 alembic 多 head 误判——实测 `alembic heads` 单一 head `7c77e09b84e1`）。

## 1. 背景

multi-agent-platform 的工作区（workspace）历史上支持两种 `path_source`：

- `server-local`：工作区根目录在 backend 容器/进程可直接访问的本地文件系统（早期架构，backend 直接 `Path.exists()` / `subprocess git`）
- `daemon-client`：工作区根目录在绑定的 daemon 守护进程所在机器，backend 经 WS RPC 委托 daemon 读写

daemon-entity-binding 落地后，工作区绑定已从 runtime 改为 daemon 实体，`server-local` 路径在生产中被完全旁路。但全栈仍保留大量 `if path_source == "server-local"` 分支与 `HostFsDelegate` 的本地实现，构成维护负担。用户决定只保留 daemon 模式，彻底移除 server-local。

## 2. 设计目标

- 全平台（backend + frontend + daemon + DB）统一为单一 daemon-client 模式
- 删除 server-local 所有代码分支、UI 选项、DB 字段、测试用例
- 清理连带的 `daemon_runtime_id` 半死代码列（daemon-entity-binding 后 legacy fallback）
- 保持 daemon-client 路径零回归（复用现有 D-006 降级机制）
- 符合生产级标准（标准 alembic 迁移，保迁移链完整）

## 3. 非目标

- **不修** complete_lease 侧 3 处**容器越界 bug**（apply_patch 500 / post_scan_validation / stage_callback，即 backend 容器内裸做宿主文件操作的 3 处）——属独立 container-overreach 变更（D-003）。注意区分：complete_lease 路径里**因 path_source 而分流的代码**仍属本次（如 `run_sync/service.py:1429-1452` 的 `if path_source == "daemon-client"` + `:1452 or "server-local"` 兜底，删 path_source 列后必断链，属本次必删）。
- **不删** `workspace:admin` 权限枚举/菜单绑定/角色赋权——仍用于前端菜单「工作区管理」显示（D-001）。
- **不改** daemon 生命周期事件契约（claim/start/complete lease、session create/end）。
- **不做** daemon-client 工作区的新功能。
- **不重置** DB（用标准迁移）。

## 4. 拆分判断

单一目标（path_source 二元统一）贯穿前后端，高度耦合须协同变更。不拆分、不走批量，plan 阶段按 Wave 分组。

## 5. 总体方案

### Phase 1 · 后端 workspace + spec_workspace 核心清除
- workspace 模块：删 `PathSourceLiteral`、`is_daemon_client_path_source`、`resolve_root_path_for_server`、`create` 的 server-local 分支、`scan`/`scan_generate` 本地版、列表 `workspace_type` 过滤；`scan_generate_daemon_client` 收为唯一路径。schema 各 DTO 去 `path_source` 入参。
- router：删 `_require_server_local_workspace_admin` 函数 + 3 处调用；scan/scan-generate/create 永远走 daemon-client。
- spec_workspace：删 `sync_manual_server_local`、`_pack_sillyspec_local`、`import_from_repo` 本地分支、`bootstrap` 的 `resolve_root_path_for_server` 调用 + safe.directory 容器逻辑；sync-manual 永远走 daemon-client outbox。
- **skills_view_service.py**：删 server-local 平铺列目录分支，永远走 RPC `list_dir`。

### Phase 2 · HostFsDelegate + 调度/校验（重灾区）
**HostFsDelegate（`daemon/host_fs/delegate.py`）**——修正首版方法枚举错误：
- 删 **6 个 `_local_*` 方法**：`_local_stat`(245) / `_local_git_apply`(376) / `_local_git_rev_parse`(476) / `_local_pollution_archive`(564) / `_local_read_json`(636) / `_local_read_yaml`(668)。
- 删 **1 个孤儿辅助** `_run_git_apply`(430，仅被 `_local_git_apply` 调用)。
- public 方法 `read_package_json`(615) / `read_local_yaml`(647) 删内联 server-local `Path` 分支，固定走 `_via_rpc_or_degrade`。（注：public 方法名是 `read_package_json`/`read_local_yaml`，非首版误写的 read_json/read_yaml。）
- **`run_command`(692)**——修正首版"保持不变"错误：line 737-747 有 `if not is_daemon_client_path_source(workspace.path_source): raise` + line 745 `"path_source": workspace.path_source` 直接读列。DROP 列后这两处 `AttributeError`。必须删 server-local 拒绝分支，永远走 `_via_rpc`。
- 同步清理模块/方法 docstring 与异常消息（line 203 / 837-863 引用 `path_source`/`daemon_runtime_id` 的陈旧文案）。

**agent 模块（改动量被首版严重低估）**：
- `placement.py`：删 `_resolve_dispatch_runtime` server-local Branch 0/2 兜底 + `daemon_runtime_id` legacy 路由分支。
- `service.py`（重灾区，十几处）：删 `_legacy_root_exists_check`(247-320) 整个 path_source 分流函数；删 `resolve_root_path_for_server` 调用(1411)；改 `_get_workspace_root`(1812-1827) 返回签名（现返回 `(root_path, path_source)` 元组，删 path_source 后改单值）；清理 stage prompt `--spec-root` 决策(1052/1073/1124/1372/1472 等)、scan bundle 透传里的 path_source。
- `post_scan_validator.py`：删 `_validate_server_local`，`validate` 永远走 daemon-client。
- `context_builder.py`：删 path_source 参数贯穿（transport 决策 + prompt spec root）。
- `execution.py:110`：`resolve_root_path_for_daemon(ws.root_path, ws.path_source)` 签名断链，改去 path_source 参数。

**core/spec_paths.py（首版遗漏）**：`transport_for_path_source` / `resolve_prompt_spec_root` / `resolve_root_path_for_daemon` 整套 per-workspace transport 决策建立在 path_source 上，须重构为 daemon-client 单一路径。

**change / change_writer / daemon-patch / run_sync**：
- `change/dispatch.py`、`change/service.py`、`change_writer/service.py`、`change_writer/proxy.py`、`daemon/patch/service.py`：删 path_source 分流。
- **`daemon/run_sync/service.py:1429-1452`**：删 `if path_source == "daemon-client"` 分流 + `:1452 or "server-local"` 兜底（属本次，必删否则断链）。

**daemon/runtime/service.py:727-730（首版遗漏，P0）**：`UPDATE workspaces SET daemon_runtime_id=None` 直接 SQL，删列后 100% 运行时崩，必须删。

**member_runtimes/resolver.py**：删 `not_daemon_client` 兜底 + `daemon_runtime_id` legacy fallback 段(152-186)。

**knowledge/service.py、scan_docs/service.py**：删 path_source 分支。

### Phase 3 · 数据库迁移（标准 alembic，FK 全表清理）
- 新迁移 `down_revision = 7c77e09b84e1`（实测 `alembic heads` 单一 head，已核实）。
- **存量 server-local 工作区 DELETE 的 FK 连带全表**（修正首版只列 4 张的错误）。grep 出约 18 张引用 `workspaces.id` 的表，按 `ondelete` 行为分两组：
  - **CASCADE（DELETE workspace 自动连带，无需显式删）**：auth、release、git_gateway、change、daemon_audit、worktree(×2)、scan_docs/conflict_model、spec_workspace、scan_docs/model、spec_profile、tool_gateway、tool_policy、task、daemon/model、workspace 自表、workspace/member_runtimes、agent_runs(516)。
  - **非 CASCADE（迁移必须显式处理）**：
    - `incident`（FK 无 ondelete = RESTRICT）→ **迁移先 `DELETE FROM incidents WHERE workspace_id IN (SELECT id FROM workspaces WHERE path_source='server-local')`**，否则 DELETE workspace 被 PG 拦截。
    - `workflow`（SET NULL）→ 不阻断 DELETE，但相关行 workspace_id 置 NULL，需评估是否一并清理。
    - `agent_runs`(450 SET NULL) → 同上。
- **迁移步骤**：① 显式 DELETE 非 CASCADE 表（至少 incident）的引用行 → ② `DELETE FROM workspaces WHERE path_source='server-local'`（CASCADE 连带其余）→ ③ `DROP COLUMN path_source` + `DROP COLUMN daemon_runtime_id`（PG 自动级联删 `ix_workspaces_daemon_runtime_id` 索引）。
- downgrade 对称（项目未上线，仅形式对称）。

### Phase 4 · 前端清除（清单已补全）
- workspace-scan-dialog / workspace-access-guide / workspace-config-card / workspace-path-fields / workspace-path.ts / workspaces.ts / workspaces 列表页 / create-change / changes 页（首版清单）。
- **首版遗漏补全**：workspace-card.tsx(98 读 path_source)、workspace-binding-dialog.tsx、workspace-binding-guard.tsx、workspace-daemon-switcher.tsx、workspace-switcher.tsx、lib/workspace-daemon-status.ts、lib/spec-workspaces.ts(199)、workspaces/[id]/page.tsx、workspaces/[id]/agent/page.tsx。
- 手动同步 `frontend/src/lib/api-types.ts` + `sillyhub-daemon/src/api-types.ts` 删 `path_source`/`daemon_runtime_id` 类型字段（无自动化 codegen，R-03）。

### Phase 5 · daemon 侧（最小）
- spec-sync.ts / task-runner.ts 注释更新（wsId 永远非空）；api-types.ts 手动同步。无功能改动。

### Phase 6 · 测试精简
- 后端 ~30 个含 server_local 测试删 server-local case，保留 daemon-client 断言。
- 前端组件测试（workspace-scan-dialog 等 + 上述遗漏组件）删 server-local 分支 case。

### Phase 7 · 验收
- backend pytest 全绿（覆盖率 ≥60%）；frontend vitest + typecheck 全绿；daemon vitest 全绿。
- grep 确认生产代码 `server-local`/`path_source`/`daemon_runtime_id` 字样清零（测试与 archive 除外）。
- Docker 部署验证：迁移 upgrade 成功（特别 incident 不违约）；新建工作区只能 daemon-client。

## 6. 文件变更清单

### 后端（workspace / spec_workspace 核心）
| 操作 | 文件路径 | 说明 |
|---|---|---|
| 修改 | backend/app/modules/workspace/model.py | 删 path_source + daemon_runtime_id 列 + ix_workspaces_daemon_runtime_id 索引(35) |
| 修改 | backend/app/modules/workspace/schema.py | 删 PathSourceLiteral；各 DTO 去 path_source/daemon_runtime_id |
| 修改 | backend/app/modules/workspace/service.py | 删 is_daemon_client_path_source/resolve_root_path_for_server/create server-local 分支/scan+scan_generate 本地版/列表过滤；daemon_runtime_id 引用(194/244/373/863/893/944) |
| 修改 | backend/app/modules/workspace/router.py | 删 _require_server_local_workspace_admin + 3 调用；daemon_runtime_id(130/132/141) |
| 修改 | backend/app/modules/workspace/skills_view_service.py | 删 server-local 平铺列目录分支 |
| 修改 | backend/app/modules/workspace/member_runtimes/resolver.py | 删 not_daemon_client + daemon_runtime_id legacy(152-186) |
| 修改 | backend/app/modules/workspace/member_runtimes/queries.py | 删 daemon_runtime_id legacy JOIN(128-169) |
| 修改 | backend/app/modules/spec_workspace/router.py | sync-manual 走 outbox；daemon_runtime_id fallback(119-202) |
| 修改 | backend/app/modules/spec_workspace/service.py | 删 _pack_sillyspec_local/sync_manual_server_local/import_from_repo 本地分支；daemon_runtime_id(220-306) |
| 修改 | backend/app/modules/spec_workspace/bootstrap.py | 删 resolve_root_path_for_server + safe.directory |

### 后端（HostFsDelegate + agent + 调度）
| 操作 | 文件路径 | 说明 |
|---|---|---|
| 修改 | backend/app/modules/daemon/host_fs/delegate.py | 删 6 个 _local_* + _run_git_apply；read_package_json/read_local_yaml/run_command 删 server-local 分支；docstring 清理 |
| 修改 | backend/app/modules/daemon/host_fs/ws_rpc.py | daemon_runtime_id 引用(161) |
| 修改 | backend/app/modules/agent/placement.py | 删 server-local 兜底 + daemon_runtime_id legacy 路由 |
| 修改 | backend/app/modules/agent/service.py | 删 _legacy_root_exists_check/resolve_root_path_for_server 调用/_get_workspace_root 签名/stage prompt spec-root |
| 修改 | backend/app/modules/agent/post_scan_validator.py | 删 _validate_server_local |
| 修改 | backend/app/modules/agent/context_builder.py | 删 path_source 贯穿 |
| 修改 | backend/app/modules/agent/execution.py | resolve_root_path_for_daemon 签名断链(110) |
| 修改 | backend/app/core/spec_paths.py | 重构 transport_for_path_source/resolve_prompt_spec_root/resolve_root_path_for_daemon 为单一 daemon-client |
| 修改 | backend/app/modules/change/dispatch.py | 删 path_source 分流 |
| 修改 | backend/app/modules/change/service.py | 删 path_source 分流；daemon_runtime_id(316/375) |
| 修改 | backend/app/modules/change_writer/service.py | 删 path_source 分流 |
| 修改 | backend/app/modules/change_writer/proxy.py | daemon_runtime_id(7) + path_source 分支 |
| 修改 | backend/app/modules/daemon/patch/service.py | 删 path_source 分流 |
| 修改 | backend/app/modules/daemon/run_sync/service.py | 删 path_source 分流(1429-1452) + or "server-local" 兜底 |
| 修改 | backend/app/modules/daemon/runtime/service.py | 删 UPDATE daemon_runtime_id=None SQL(727-730) |
| 修改 | backend/app/modules/knowledge/service.py | 删 path_source 分支 |
| 修改 | backend/app/modules/scan_docs/service.py | 删 path_source 分支(164-168) |
| 新增 | backend/migrations/versions/20260710*_remove_workspace_path_source.py | down=7c77e09b84e1，显式删非 CASCADE 表 + DELETE server-local 行 + DROP 两列 |

### 前端
| 操作 | 文件路径 | 说明 |
|---|---|---|
| 修改 | frontend/src/components/workspace-scan-dialog.tsx | 删 radio+本地扫描区+canUseServerLocal+本地 handler |
| 修改 | frontend/src/components/workspace-access-guide.tsx | 删路径来源下拉 |
| 修改 | frontend/src/components/workspace-config-card.tsx | 删 isServerLocal 分支 |
| 修改 | frontend/src/components/workspace-path-fields.tsx | 删非 daemon 分支 |
| 修改 | frontend/src/components/workspace-card.tsx | 删 path_source 读取(98) |
| 修改 | frontend/src/components/workspace-binding-dialog.tsx | 删 server-local 相关 |
| 修改 | frontend/src/components/workspace-binding-guard.tsx | 删 server-local 相关 |
| 修改 | frontend/src/components/workspace-daemon-switcher.tsx | 删 server-local 相关 |
| 修改 | frontend/src/components/workspace-switcher.tsx | 删 server-local 相关 |
| 修改 | frontend/src/lib/workspace-path.ts | 删二元映射 |
| 修改 | frontend/src/lib/workspace-daemon-status.ts | 删 path_source 注释(6) |
| 修改 | frontend/src/lib/workspaces.ts | 删 path_source 入参 |
| 修改 | frontend/src/lib/spec-workspaces.ts | 删 server-local 分支(199) |
| 修改 | frontend/src/app/(dashboard)/workspaces/page.tsx | 删列表筛选「本机路径」option |
| 修改 | frontend/src/app/(dashboard)/workspaces/[id]/page.tsx | 删 server-local 分支 |
| 修改 | frontend/src/app/(dashboard)/workspaces/[id]/create-change/page.tsx | 永远走 proxyCreateChange |
| 修改 | frontend/src/app/(dashboard)/workspaces/[id]/changes/page.tsx | 简化禁用逻辑 |
| 修改 | frontend/src/app/(dashboard)/workspaces/[id]/agent/page.tsx | 删 server-local 分支 |
| 手动同步 | frontend/src/lib/api-types.ts | 删 path_source/daemon_runtime_id 类型 |

### daemon
| 操作 | 文件路径 | 说明 |
|---|---|---|
| 修改 | sillyhub-daemon/src/spec-sync.ts | 注释更新 |
| 修改 | sillyhub-daemon/src/task-runner.ts | 注释更新 |
| 手动同步 | sillyhub-daemon/src/api-types.ts | 删 path_source/daemon_runtime_id 类型 |

## 7. 接口定义

本次为**纯删除**，无新增接口/方法签名。变更后：

- `WorkspaceCreate`/`WorkspaceUpdate`/`ScanGenerateRequest` Pydantic DTO 去掉 `path_source` 与 `daemon_runtime_id` 字段；`WorkspaceRead` 去掉两输出字段。
- **`scan_generate` 两步处理**（修正首版"重命名无冲突"误导）：① 删除现有 `scan_generate`(service.py:692，server-local 本地版) → ② 将 `scan_generate_daemon_client`(853) 改名为 `scan_generate` 作为唯一入口。
- `WorkspaceService._get_workspace_root` 返回签名从 `(root_path, path_source)` 改为单值 `root_path`。
- `resolve_root_path_for_daemon(root_path, path_source)` 去 path_source 参数（core/spec_paths.py）。
- `HostFsDelegate` public 方法签名不变，内部固定走 `_via_rpc_or_degrade`（`run_command` 固定走 `_via_rpc`）。

## 7.5 生命周期契约表

涉及 daemon / lease / agent_run 关键词，但**不改生命周期事件本身**，仅删 dispatch 路由的 server-local 分流。下表为受影响路径的**现有契约（保持不变）**：

| 事件 | 发起方 | 接收方 | 必需字段 | 状态变化 | 本次影响 |
|---|---|---|---|---|---|
| dispatch agent_run | backend | daemon | workspace_id, daemon_instance_id, root_path | pending → running | 路由永远走 daemon 绑定（删 server-local 兜底） |
| claim/start/complete lease | daemon | backend | leaseId, claimToken, agentRunId | lease lifecycle | 不变 |
| complete_lease 收尾回调 | backend | HostFsDelegate | patch/stat/rev_parse/run_command | — | run_command 删 server-local 拒绝分支；complete_lease 侧 3 处容器越界 bug 不在范围（D-003） |
| session create/end | backend ↔ daemon | sessionId, leaseId | session active → ended | 不变 |

## 8. 数据模型

`workspaces` 表：

- 删 `path_source` VARCHAR(20) NOT NULL DEFAULT 'server-local'
- 删 `daemon_runtime_id` UUID NULL（legacy fallback）
- `DROP COLUMN daemon_runtime_id` 时 PG 自动级联删 `ix_workspaces_daemon_runtime_id` 索引（model.py:35）。
- `root_path` 列**保留**，语义统一为"daemon 侧工作区根路径"。

## 9. 兼容策略

项目未正式上线，**不要求历史兼容**（CLAUDE.md 规则 10）。策略：

- 迁移删除存量 server-local 工作区行（D-006）。
- 不提供"旧 server-local 转 daemon-client"回退路径。
- API/表结构变更不向后兼容。
- 所有工作区都是 daemon-client，走现有 daemon-client 路径。

## 10. 风险登记

| 编号 | 风险 | 等级 | 应对策略 |
|---|---|---|---|
| R-01 | HostFsDelegate 删 6 _local_* + _run_git_apply 后调用方回归；run_command 删 server-local 分支后行为变化 | P0 | execute 逐一核对调用方走 _via_rpc_or_degrade；daemon 离线走 D-006；全量 backend pytest 守回归 |
| R-02 | 存量 server-local DELETE 时 incident(FK RESTRICT)违约 + workflow/agent_runs SET NULL 连带 | P0 | 迁移步骤①显式 DELETE 非 CASCADE 表(至少 incident)→②DELETE workspace CASCADE 连带→③DROP 列；verify 在 PG 核实无违约 |
| R-03 | 无自动化 OpenAPI codegen，api-types.ts 手动同步易漏 | P1 | execute 时对照 backend/openapi.json 全量删 path_source/daemon_runtime_id 类型；frontend typecheck + daemon tsc 守类型一致 |
| R-04 | 与潜在 container-overreach 变更边界（都动 HostFsDelegate） | P2 | D-003 明确 complete_lease 3 处容器越界 bug 不在本次；run_sync path_source 分流属本次 |
| R-05 | alembic head 在 execute 间漂移 | P1 | 已实测单一 head=7c77e09b84e1（Grill 子代理曾误判多 head，已否决）；execute 写迁移前重新 `alembic heads` 确认 |
| R-06 | workspace_type 筛选前端仍传 server-local 致 422 | P2 | 前端筛选下拉同步删 option；后端忽略未知值 |
| R-07 | agent/service.py 改动量大（十几处 + _get_workspace_root 签名）易回归 | P1 | execute 单列 Wave；全量 agent 模块 pytest 守回归 |
| R-08 | core/spec_paths.py transport 决策重构影响 prompt --spec-root 计算链 | P1 | execute 验证 daemon-client 工作区 spec-root 解析正确；端到端跑一次 brainstorm→plan spec 流程 |

## 11. 决策追踪

### D-001@v1: workspace:admin 权限保留
- type: boundary, status: accepted, source: code
- question: 删 server-local 后 workspace:admin 权限是否一并清理？
- answer: 否。仍用于前端菜单「工作区管理」(menu-permissions.ts:72) + Permission 枚征(permissions.py:53) + admin 角色赋权。仅删运行时门禁 _require_server_local_workspace_admin。
- evidence: permissions.py:53, menu-permissions.ts:72, router.py:55-72

### D-002@v1: daemon 离线复用 D-006 degrade
- type: boundary, status: accepted, source: code
- answer: 复用 HostFsDelegate._via_rpc_or_degrade；run_command 用 _via_rpc raise。已是现有行为。
- evidence: delegate.py:77-109,236-659,718

### D-003@v1: complete_lease 3 处容器越界不在本次范围
- type: boundary, status: accepted, source: user+code
- answer: apply_patch 500 / post_scan_validation / stage_callback 3 处**容器越界 bug**属独立 container-overreach 变更。本次只删 path_source 分流 + _local_* 方法；run_sync/service.py 的 path_source 分流属本次（必删否则断链）。

### D-004@v1: 实现方案 A（标准迁移 + 专项范围）
- type: architecture, status: accepted, source: user
- answer: 标准 alembic 迁移保链 + 范围限定 server-local 专项。

### D-005@v1: daemon_runtime_id 一并清理
- type: boundary, status: accepted, source: user
- answer: 删列 + 所有 legacy 回退路径（影响矩阵见 §6，12+ 文件）。

### D-006@v1: 存量 server-local 数据删除
- type: compatibility, status: accepted, source: user
- answer: 删除（连带 FK 全表，迁移策略见 §5 Phase 3）。

### D-007@v1: Design Grill 修正
- type: consistency, status: accepted, source: code (Grill 子代理审查)
- question: 首版 design 是否有结构性硬伤？
- answer: 采纳修正 P0-1（_local_* 6 个 + _run_git_apply，public 名 read_package_json/read_local_yaml）/ P0-2（run_command 删 server-local 分支）/ P0-3（FK 全表 18 张 + incident RESTRICT 显式删）/ P0-4（补 spec_paths/context_builder/execution/skills_view_service/daemon-runtime-service 等遗漏文件）/ P1-1~5（前端补全 + agent/service 重灾 + daemon_runtime_id 影响矩阵 + docstring + OpenAPI 脚本）/ P2-1~4。**否决 P0-5**（子代理误判 alembic 多 head，实测单一 head 7c77e09b84e1）。
- evidence: 本 design revision note + §5/§6/§8/§10 修正

## 12. 自审

### 关键词检测与生命周期契约表
design.md 涉及关键词：daemon / lease / agent_run / session / complete / claim / heartbeat。按规则已生成「生命周期契约表」（§7.5），列 4 个事件（dispatch agent_run / claim-start-complete lease / complete_lease 收尾 / session create-end），声明现有契约不变 + 本次影响列。

### 事件 → 任务映射
- dispatch agent_run 路由变化（删 server-local 兜底）→ Wave 2 agent/placement.py
- complete_lease 收尾 run_command 分支删除 → Wave 2 HostFsDelegate
- complete_lease 侧 3 处容器越界 bug → 不在范围（D-003），无遗漏事件
- lease/session 事件本身不变 → 无对应任务（声明性）

### 文件清单完整性
经 Design Grill（D-007）交叉审查修正，§6 清单已补全：后端 28（含 Grill 发现的 core/spec_paths.py / agent context_builder+execution / daemon runtime+run_sync service 等遗漏）+ 前端 19（含 workspace-card/binding-dialog/switcher 等遗漏）+ daemon 3；daemon_runtime_id 影响矩阵 12+ 文件已标注引用点。

### 决策一致性
D-001~D-007 全部 status=accepted，与 §3 非目标 / §5 方案 / §6 清单 / §10 风险交叉一致，无矛盾。

### Grill 通过
首版经子代理对抗审查发现 P0×4 / P1×5 / P2×4，已全部修正（D-007），无未决 P0/P1 阻断。
