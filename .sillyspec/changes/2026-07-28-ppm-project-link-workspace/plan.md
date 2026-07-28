---
author: qinyi
created_at: 2026-07-28 13:55:00
change: 2026-07-28-ppm-project-link-workspace
plan_level: full
---

# 实现计划(Plan)— PPM项目关联平台工作区

> A 阶段(关联骨架)。依据 design.md / requirements.md / tasks.md。
> 无 Spike 前置:仿 `TaskWorkspace` 模式确定,无技术不确定性。

## Wave 1 — 后端数据层(并行,无依赖)
- [ ] task-01: 新增 `PpmProjectWorkspace` 模型(`workspace/model.py`,仿 `TaskWorkspace`,复合主键+双向CASCADE+workspace_id索引)(覆盖:FR-01, FR-07, D-001@v1)
- [ ] task-02: 新增 migration `ppm_project_workspace` 建表(`backend/migrations/versions/`,revision 唯一+down_revision 接当前 head)(覆盖:FR-01, NFR-02)

## Wave 2 — 后端 schema + service(依赖 Wave 1)
- [ ] task-03: `workspace/schema.py` 关联请求/响应 DTO(覆盖:FR-02, FR-03, FR-04)
- [ ] task-04: `workspace/link_service.py` 表级逻辑(bind/unbind/list,重复绑 409、目标不存在 404、软删过滤)(覆盖:FR-01, FR-04, FR-06, FR-09)

## Wave 3 — 后端接口 + 注册(依赖 Wave 2)
- [ ] task-05: `workspace/link_router.py` 工作区维度 GET/POST/DELETE `/workspaces/{id}/ppm-projects` + 工作区成员权限(覆盖:FR-03, FR-05, FR-06)
- [ ] task-06: `ppm/project/router.py` 项目维度 GET/POST/DELETE `/projects/{id}/workspaces` + 项目 manager 权限(复用 `data_scope`/`manager_project_ids`)(覆盖:FR-02, FR-05)
- [ ] task-07: `backend/app/main.py` sibling include 注册 link_router(仿 `members_router`)(覆盖:FR-03)

## Wave 4 — 后端测试(依赖 Wave 3)
- [ ] task-08: 后端测试全套(link_service 单测 + 工作区维度接口 + 项目维度接口 + 越权403 + 重复409 + 软删过滤 + CASCADE + 存在性404,PG/SQLite 双兼容)(覆盖:FR-04~FR-09, NFR-01)

## Wave 5 — 前端实现(依赖 Wave 3 API 稳定)
- [ ] task-09: 前端关联 API 客户端(bind/unbind/list,项目侧+工作区侧)(覆盖:FR-02, FR-03)
- [ ] task-10: `ppm/projects` 页加「关联工作区」按钮 + `LinkWorkspaceDialog` 弹窗(已关联可解绑/可选可绑)(覆盖:FR-02)
- [ ] task-11: `workspaces/[id]` 页加「关联项目」区块 `LinkedProjectsSection`(对称操作)(覆盖:FR-03)

## Wave 6 — 前端测试 + 收尾(依赖 Wave 4, Wave 5)
- [ ] task-12: 前端组件测试(弹窗绑定/解绑交互 + 区块对称)(覆盖:FR-02, FR-03)
- [ ] task-13: `pnpm gen:types` 重新生成 OpenAPI 类型并对齐前端调用(覆盖:NFR-05)
- [ ] task-14: 全量回归(workspace 模块 + ppm 模块零回归)(覆盖:FR-08, NFR-03)
- [ ] task-15: 三端 lint/typecheck/build 通过(覆盖:NFR-04)

## 任务总表

| 编号 | 任务 | Wave | 优先级 | 依赖 | 覆盖 FR/D | 说明 |
|---|---|---|---|---|---|---|
| task-01 | PpmProjectWorkspace 模型 | W1 | P0 | — | FR-01, FR-07, D-001@v1 | 仿 TaskWorkspace;独立关联表不加 workspace_id 到 PPM 表 |
| task-02 | migration 建表 | W1 | P0 | task-01 | FR-01, NFR-02 | revision 唯一;down_revision 接当前真实 head(部署前 `alembic heads` 校验,防并行变更撞链) |
| task-03 | schema DTO | W2 | P0 | task-01 | FR-02, FR-03, FR-04 | 关联请求/响应 Pydantic v2 |
| task-04 | link_service 表级逻辑 | W2 | P0 | task-01 | FR-01, FR-04, FR-06, FR-09 | bind/unbind/list;409/404;软删过滤;权限无关供两 router 复用 |
| task-05 | workspace link_router | W3 | P0 | task-03, task-04 | FR-03, FR-05, FR-06 | 工作区维度;`require_permission(WORKSPACE_*)` |
| task-06 | ppm project router 端点 | W3 | P0 | task-03, task-04 | FR-02, FR-05 | 项目维度;复用 `manager_project_ids`;只读写新关联表,零 PPM 数据模型改动 |
| task-07 | main.py 注册 link_router | W3 | P0 | task-05 | FR-03 | sibling include 仿 members_router |
| task-08 | 后端测试 | W4 | P0 | task-05, task-06, task-07 | FR-04~FR-09, NFR-01 | PG/SQLite 双兼容;覆盖越权/重复/软删/CASCADE/存在性 |
| task-09 | 前端 API 客户端 | W5 | P0 | task-05, task-06 | FR-02, FR-03 | 项目侧+工作区侧 bind/unbind/list |
| task-10 | LinkWorkspaceDialog + ppm/projects | W5 | P0 | task-09 | FR-02 | 弹窗绑定/解绑;列表行加按钮 |
| task-11 | LinkedProjectsSection + workspaces/[id] | W5 | P0 | task-09 | FR-03 | 对称区块 |
| task-12 | 前端组件测试 | W6 | P1 | task-10, task-11 | FR-02, FR-03 | 弹窗/区块交互 |
| task-13 | gen:types 类型对齐 | W6 | P1 | task-05, task-06 | NFR-05 | OpenAPI 类型重新生成 |
| task-14 | 全量回归 | W6 | P0 | task-08, task-12 | FR-08, NFR-03 | workspace + ppm 模块零回归 |
| task-15 | 三端 lint/typecheck/build | W6 | P0 | task-14 | NFR-04 | ruff/mypy + pnpm lint/typecheck/build |

## 关键路径
task-01 → task-04 → task-05 → task-09 → task-10 → task-12 → task-14(数据层→service→接口→前端→测试→回归,最长链路)

## 全局验收标准
- [ ] 所有单元/接口测试通过(后端 workspace + ppm 模块、前端组件)
- [ ] brownfield:未关联的项目/工作区行为与现状完全一致(FR-08)
- [ ] PPM 已上线模块零回归(NFR-03)
- [ ] migration 单 head(`alembic heads` 只一个),部署前校验
- [ ] 三端 lint/typecheck/build 通过(NFR-04)
- [ ] 双边对称:项目页与工作区页都能绑定/解绑,操作同一张表,数据一致(AC-1)
- [ ] 越权 403、重复 409、软删过滤、CASCADE、存在性 404 均有测试覆盖(AC-2~AC-5)

## 覆盖矩阵
| ID | 覆盖任务 | 验收证据 |
|---|---|---|
| D-001@v1(PPM 平台级无 workspace_id) | task-01 | AC:PPM 表不加 workspace_id,用独立关联表 |
| FR-01 多对多关联 | task-01, task-02, task-04 | AC-1 |
| FR-02 项目页绑定/查看 | task-06, task-10 | AC-1 |
| FR-03 工作区页绑定/查看 | task-05, task-11 | AC-1 |
| FR-04 防重复 409 | task-04, task-08 | AC-3 |
| FR-05 双边权限 | task-05, task-06, task-08 | AC-2 |
| FR-06 软删过滤 | task-04, task-05, task-08 | AC-4 |
| FR-07 级联删除 | task-01, task-02, task-08 | AC-5 |
| FR-08 零破坏 | task-14 | AC-6 |
| FR-09 存在性 404 | task-04, task-08 | AC(绑定不存在目标) |
| NFR-02 migration chain | task-02 | alembic heads 单头 |

## 注意事项(execute 执行约束)
- **migration chain 风险(最高优先)**:task-02 的 `down_revision` 必须接**当前真实 head**(约 `202607271700`,但并行活跃变更 `llm-provider-presets` 可能已推进);execute 前先 `cd backend && uv run alembic heads` 确认,部署前再校验单 head。SQLite 单测抓不到 PG 的多 head 崩溃(项目高频坑)。
- **PPM 零数据模型改动**:task-06 只在 `ppm/project/router.py` 加关联端点,读写新关联表,不碰 PPM 现有表/业务逻辑。
- **权限双校验**:task-05 工作区侧 `require_permission(WORKSPACE_*)`、task-06 项目侧 `manager_project_ids`,各自独立校验,写测试覆盖 403。
- **类型对齐**:后端 API 稳定后(Wave 3)再做 task-13 `gen:types`,避免前端类型漂移。
- **复合 git 命令绕过 claude 层 hook**:`git add && commit` 以 add 开头绕过 claude 层 mypy/frontend 检查,提交时单独 `git commit` 跑全量 gate。
