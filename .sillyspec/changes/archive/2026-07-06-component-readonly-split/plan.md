---
author: qinyi
created_at: 2026-07-06T11:20:00
plan_level: full
---

# 实现计划：组件只读化（剥离 workspaces 表 + 砍无效关系）

> 来源：brainstorm 五件套（proposal/design/requirements/tasks/decisions），变更 `2026-07-06-component-readonly-split`。
> 本文不含实现细节（留 execute 阶段的 `tasks/task-NN.md`），只含 Wave 分组 + 任务总表 + 关键路径 + 验收 + 覆盖矩阵。

## Spike 前置验证

| Spike | 验证内容 | 通过标准 | 不通过后果 |
|---|---|---|---|
| spike-01 | `SpecPathResolver` platform_managed mode 在 daemon-client 下能否正确解析 spec_root 并读 `projects/*.yaml`（容器内 dry-run + 单测两模式） | daemon-client + server-local 都能读到 yaml、返回 `Component[]` | task-02 catalog service 推翻重设计（对应 R-01 P0 风险，参考 memory `runtime-read-broken-daemon-client`） |

## Wave 1 — 后端：前置 + 数据模型 + 接口

- [x] task-01: 前置 grep 调用方登记（覆盖：R-03）✅ 查清 3 处 design 低估：①workspace/service.py 另有 3 处 self.reparse(527/1450/1536) 并入 task-04；②change/service.py 有 3 个 ChangeWorkspace M:N 读路径(list_/get_by_key/get)+2 处 workspace_ids 取值 并入 task-06；③agent/context_builder.py 依赖 WorkspaceRelation（活跃代码），用户决策退化为返回空，扩 task-05 范围
- [x] task-02: 新建 `component_catalog_service`（覆盖：FR-01, D-001@V1）✅ 镜像 reparse 的 spec_root 解析（SpecWorkspaceService platform-managed + _rewrite_path 兜底），过滤项目组自身，返回 ComponentRead[]
- [x] task-03: router `GET /components` 改读 catalog + 移除 relations/reparse 端点（覆盖：FR-01, FR-03, FR-04, D-001@V1, D-003@V1, D-004@V1）✅ 新建 GET /components（注：端点原本不存在，非"改读源"而是新建）；移除 relations CRUD + POST /reparse；TopologyResponse import 改从 topology
- [x] task-04: `generate_projects` 一级粒度 + 去 `await reparse` + 去 relations 生成 + 删 `reparse` 方法（覆盖：FR-02, FR-03, D-002@V1, D-003@V1）✅ 改按 path 顶级目录分组；删 reparse 方法+_build_child_root_path；处理 3 处额外 self.reparse 调用（rescan/_ensure_spec_workspace_from_platform/_ensure_spec_workspace），保留 change_svc.reparse
- [x] task-05: 删 relation 模型/service/schema + topology 退化（覆盖：FR-04, D-004@V1）✅ 删 relation_service/relation_schema/WorkspaceRelation 模型/schema.py relation DTO；topology 退化（Topology* 搬入 + 项目组节点 + edges 恒空）；扩范围 agent/context_builder.py 退化 _fetch_referenced_workspaces 返回空（用户决策）
- [x] task-06: change 废 `_sync_change_workspaces` + `ChangeSummary.workspace_ids` + 删 `ChangeWorkspace` 模型（覆盖：FR-05, D-005@V1）✅ 删 _sync_change_workspaces+调用；list_/get_by_key/get 去 M:N fallback；enrich_* 退化为纯 validate；ChangeRead/ChangeSummary 去 workspace_ids；删 ChangeWorkspace 模型
- [x] task-07: backend 单测（catalog 两模式 + generate_projects 粒度 + workspace/change 回归）✅ 新 test_component_catalog（两模式+过滤）+ test_topology（退化）+ 重写 test_generate_projects（一级粒度+无 relations+不 reparse）；删 test_relation_*/test_m2n_change/test_topology 旧+清理 test_model/test_service/test_context_builder/test_router 的 relation/M:N/reparse/workspace_ids 测试。442 passed，唯一失败 test_init_endpoint_returns_lease 为预存测试债（主仓库亦失败，非本次引入）

## Wave 2 — 前端（依赖 Wave 1）

- [x] task-08: lib 层切换（`workspaces.ts` 去 `getWorkspaceRelations` + 新 `getWorkspaceComponents`；`components.ts` `listComponents` 改调）（覆盖：FR-07, D-001@V1）✅ workspaces.ts 删 relation fn/reparse/ReparseResult/WorkspaceRelation 类型，加 Component+ComponentListResponse+getWorkspaceComponents；components.ts 重写为薄封装（去 workspaceToComponent/getComponent/reparseComponents/重复 Topology 类型），re-export Component
- [x] task-09: `components/page.tsx` 改名"项目组件" + 只读 + 删出/入边 + 删重新扫描按钮（覆盖：FR-06, D-007@V1）✅ 重写页面（标题"项目组件"、load 改调 getWorkspaceComponents、删 outgoing/incoming SectionCard + handleRescan + reparse 按钮 + children-via-listWorkspaces）；删无消费方的 component-detail-drawer
- [x] task-10: `create-change` 候选源切换 + `topology` 退化（覆盖：FR-07, D-004@V1, R-07）✅ create-change 候选源自动随 listComponents 切换（key 改 component_key），无代码改动；topology 方案(a)保留入口，edges 后端恒空自然退化，更新返回链接文案"关系列表"→"项目组件"
- [x] task-11: frontend `pnpm typecheck` 零错误 + `pnpm vitest` 零回归 ✅ typecheck 0 错误（修 create-change c.id→component_key + 删 component-detail-drawer）；vitest 660 passed / 0 failed；lint 仅预存 warnings

## Wave 3 — 清理收尾（依赖 Wave 2）

- [x] task-12: alembic migration `component_readonly_cleanup` + 测试库 dry-run（覆盖：FR-08, D-006@V1, D-008@V1）✅ migration 20260706_component_readonly（down_revision=20260705_tool_kind 真实 head，单 head 无分叉）；upgrade=DELETE component 行（CASCADE 清 relations/change_workspaces）+ DROP 两表，保留 component_key 列；downgrade=NotImplementedError；ruff 过；隔离语义验证通过（两表 dropped + component_key 列保留 + 0 component 行）。全链 SQLite dry-run 卡无关 PG-only pgcrypto migration（预存限制）
- [x] task-13: 端到端验证（SillyHub `/components` 显 5 个一级子项目）+ 模块文档同步 + quicklog/ROADMAP 收尾 ✅ 文档：backend.md 变更索引追加 + quicklog ql-20260706-008（要点/文件/结果/遗留/教训）。端到端浏览器验证 + PG migration apply 标为残留（需部署实跑，worktree 无法完成）

## 任务总表

| 编号 | 任务 | Wave | 优先级 | 依赖 | 覆盖 FR/D | 说明 |
|---|---|---|---|---|---|---|
| task-01 | 前置 grep 调用方登记 | W1 | P0 | — | R-03 | grep `reparse`/`generate_projects`/`_sync_change_workspaces`/`WorkspaceRelation`/`ChangeWorkspace`/`getWorkspaceRelations` 所有调用方，逐一登记 |
| task-02 | 新建 component_catalog_service | W1 | P0 | task-01, spike-01 | FR-01, D-001@V1 | 读 `projects/*.yaml` 返回 `Component[]`，经 SpecPathResolver，过滤项目组自身 yaml |
| task-03 | router 改读 catalog + 移除端点 | W1 | P0 | task-02 | FR-01/03/04, D-001/003/004@V1 | `GET /components` 改调 catalog；移除 `GET/POST/DELETE /relations` + `POST /reparse` |
| task-04 | generate_projects 重构 + 删 reparse | W1 | P0 | task-01 | FR-02/03, D-002/003@V1 | 一级粒度分组 + 去 `await reparse` + 去 relations 生成段（:689-699/:716-725）+ 删 `reparse` 方法 |
| task-05 | 删 relation 层 + topology 退化 | W1 | P0 | task-03 | FR-04, D-004@V1 | 删 `relation_service.py`/`relation_schema.py`/`WorkspaceRelation` 模型；`topology.py` 退化为只项目组节点 |
| task-06 | change 投影表废弃 | W1 | P0 | task-01 | FR-05, D-005@V1 | 删 `_sync_change_workspaces`（:1201-1244）+ 调用处；`ChangeSummary` 去 `workspace_ids`；删 `ChangeWorkspace` 模型 |
| task-07 | backend 单测 | W1 | P0 | task-02~06 | FR-01/02 验收 | catalog daemon-client + server-local 单测；generate_projects 一级粒度测试；workspace + change 全量零回归 |
| task-08 | frontend lib 切换 | W2 | P0 | task-07 | FR-07, D-001@V1 | `workspaces.ts` 移除 `getWorkspaceRelations` + 新增 `getWorkspaceComponents`；`components.ts` `listComponents` 改调 + 移除 `workspaceToComponent` |
| task-09 | components/page.tsx 改造 | W2 | P0 | task-08 | FR-06, D-007@V1 | 标题"项目组件"；`load()` 改调 `getWorkspaceComponents`；删出/入边 SectionCard；删"重新扫描"按钮 + `handleRescan` |
| task-10 | create-change + topology 改造 | W2 | P1 | task-08 | FR-07, D-004@V1, R-07 | `create-change` 选组件候选源切换；`topology/page.tsx` 退化方案（隐藏或只节点，本任务定） |
| task-11 | frontend typecheck + vitest | W2 | P0 | task-08~10 | 验收 | `pnpm typecheck` 零错误；`pnpm vitest` 零回归（更新 components/topology/create-change 相关测试） |
| task-12 | alembic migration + dry-run | W3 | P0 | task-11 | FR-08, D-006/008@V1 | `DELETE workspaces WHERE component_key IS NOT NULL` → `DROP TABLE workspace_relations` → `DROP TABLE change_workspaces`；保留 `component_key` 列；测试库 dry-run 无残留 |
| task-13 | 端到端 + 文档收尾 | W3 | P0 | task-12 | 验收 | SillyHub 重新 `generate_projects` → `/components` 显 5 一级子项目；create-change 选组件正常；变更详情"影响组件"正确；同步模块文档 + quicklog |

## 关键路径

```
task-01 → task-02 → task-03 → task-07 → task-08 → task-09 → task-11 → task-12 → task-13
```

（task-04/05/06 与 task-03 在 W1 内可部分并行，但都需在 task-07 单测前完成；task-04 依赖 task-01 的 grep 结果）

## 全局验收标准

- [ ] backend：`workspace` + `change` 模块全量测试零回归
- [ ] catalog service 单测覆盖 daemon-client + server-local 两模式（spike-01 通过）
- [ ] generate_projects 一级粒度测试：生成 5 个一级子项目 yaml，模块级不生成，无 relations 段
- [ ] migration 测试库 dry-run：`workspaces` 无 component_key 非空行，`workspace_relations`/`change_workspaces` 表不存在
- [ ] frontend `pnpm typecheck` 零错误 + `pnpm vitest` 零回归
- [ ] brownfield：项目组 workspace 的 CRUD/变更/绑定/init/scan-generate 行为不变（`affected_components` 字符串链路未动）
- [ ] 端到端：SillyHub `/workspaces/{id}/components` 显示 5 个一级子项目（只读、无出入边、无重新扫描按钮）；create-change 选组件正常；变更详情"影响组件"正确

## 覆盖矩阵

### 决策覆盖（D-xxx@V1）

| ID | 覆盖任务 | 验收证据 |
|---|---|---|
| D-001@V1 | task-02, task-03, task-08 | catalog 单测 + `GET /components` 接口 + frontend lib 切换 |
| D-002@V1 | task-04 | generate_projects 一级粒度测试（5 个子项目） |
| D-003@V1 | task-03, task-04 | `reparse` 方法/端点移除 + grep 无残留调用 |
| D-004@V1 | task-03, task-05, task-10 | relation 表/模型/service 删 + topology 退化 |
| D-005@V1 | task-06 | `_sync_change_workspaces` 删 + `ChangeSummary.workspace_ids` 移除 |
| D-006@V1 | task-12 | migration dry-run 无残留 |
| D-007@V1 | task-09 | components 页改名"项目组件" + 只读 + 无重新扫描按钮 |
| D-008@V1 | task-12 | migration 保留 `component_key` 列（不删列） |

### 功能需求覆盖（FR-xx）

| FR | 覆盖任务 |
|---|---|
| FR-01 | task-02, task-03 |
| FR-02 | task-04 |
| FR-03 | task-03, task-04 |
| FR-04 | task-03, task-05 |
| FR-05 | task-06 |
| FR-06 | task-09 |
| FR-07 | task-08, task-10 |
| FR-08 | task-12 |

## 自检

- [x] plan_level = full，含 Spike + Wave + 任务总表 + 关键路径 + 验收 + 覆盖矩阵
- [x] Wave 下 checkbox 格式 `- [ ] task-XX:` 保留（execute 依赖此解析）
- [x] 任务总数 13 ≤ 15
- [x] 覆盖矩阵含 D-001~D-008 + FR-01~08 全部
- [x] Spike 含 R-01（P0：daemon-client spec_root）
- [x] 关键路径明确
- [x] 全局验收具体可验证（无"需要充分测试"类废话）
- [x] 任务总表无估时列
- [x] 实现细节未展开（留 execute 阶段 `tasks/task-NN.md`）
- [x] 无 P0/P1 unresolved blocker（decisions 全 accepted）
