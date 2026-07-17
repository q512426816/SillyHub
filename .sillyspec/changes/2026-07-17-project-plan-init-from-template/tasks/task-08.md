---
author: WhaleFall
created_at: 2026-07-17T11:02:17
priority: P1
depends_on: [task-06, task-07]
blocks: []
requirement_ids: [FR-006, FR-007]
decision_ids: []
allowed_paths: [frontend/, deploy/]
---

# task-08 — 前端测试 + 部署 + 浏览器验收

> 变更 `2026-07-17-project-plan-init-from-template` · Wave 2 收尾
> 依据：design.md §5（方案）、§9（兼容）；plan.md task-08；local.yaml（test_frontend/lint_frontend/docker_up）

## 目标

确认 task-06（types）+ task-07（milestone-details 模块层 has_module）改动无回归，rebuild Docker 跑 migration，交付给用户做浏览器 UI 验收。

## implementation

1. 前端静态检查（确认 task-07 改动无回归）：
   - `cd frontend && pnpm exec vitest run`
   - `cd frontend && pnpm exec tsc --noEmit`
   - `cd frontend && pnpm lint`
2. rebuild backend + frontend Docker（含 migration alembic upgrade）：
   ```
   cd SillyHub && docker compose --env-file deploy/.env -f deploy/docker-compose.yml up --build --force-recreate -d backend frontend
   ```
3. 浏览器验收点（列给用户，CLI 不代点）：
   - 新建项目计划 → 自动建里程碑（无模块模板含明细草稿 / 有模块模板只建空里程碑）。
   - 实施阶段里程碑新建模块 → 模块 + 复制模板明细（草稿）。
   - milestone-details：has_module=true 三级展开（模块层）/ false 二级（现有手动里程碑不回归）。

## acceptance

- vitest 931+ passed（无新增 fail）。
- tsc --noEmit 过。
- pnpm lint 过。
- backend / frontend Docker healthy（`docker compose ps`）。
- migration `<ts>_ps_plan_node_template_fields` 执行（ADD 两列）。
- curl 验证：新建项目计划 → 里程碑数 = PlanNode 模板数；has_module 字段返回正确。

## verify

```
cd frontend && pnpm exec vitest run
cd frontend && pnpm exec tsc --noEmit
cd frontend && pnpm lint
docker compose --env-file deploy/.env -f deploy/docker-compose.yml ps   # healthy
curl 验证：POST /api/ppm/project-plan → GET 里程碑数 == 模板数
```

## constraints

- 浏览器 UI 验收由用户做；CLI 只代 curl 端点验证。
- 现有项目计划/里程碑不回归（手动里程碑 template_plan_node_id=null, has_module=false 行为不变）。
- 项目未上线，允许重置数据（R-02 不回填）。
