---
id: task-08
title: 'regression-deploy-evidence'
title_zh: '全量回归部署与三入口实证'
author: qinyi
created_at: 2026-08-23 04:52:00
priority: P0
depends_on: [task-07]
blocks: []
requirement_ids: [FR-01, FR-02, FR-03, FR-04, FR-05, FR-06]
decision_ids: [D-101@v1, D-102@v1, D-103@v1, D-104@v1, D-105@v1, D-106@v1, D-107@v1, D-108@v2, D-109@v1]
allowed_paths:
  - .sillyspec/changes/2026-08-23-sessions-workspace-hub/
  - .sillyspec/docs/frontend/modules/
  - .sillyspec/docs/backend/modules/
goal: >
  全量回归（backend pytest + frontend vitest/tsc/lint）+ Docker 重建部署（backend+frontend）+ 三入口
  浏览器实证（对照原型 v2 截图留档）+ 模块文档同步。
implementation:
  - 全量：backend pytest（daemon 模块）+ frontend vitest/tsc/lint（lint 与基线持平零新增）
  - 部署：backend+frontend 镜像 --build --force-recreate（backend 变了 owner_name/limit；Windows 豁免不 export COMMIT_SHA）；容器内 grep 校验新代码标识
  - 浏览器实证（截图留档 runtime-evidence/artifacts/，10 项清单）：全局完整树/两层筛选/组头＋预会话/首句创建原地开聊/失败重试/不发言零残留/owner chip/旧会话"—"/workspace 预展开/change 独立页变更名/?session= 深链
  - 模块文档同步：components-sessions.md（树/浮层/退役）、components-daemon.md（预会话守卫清单）、backend daemon 模块文档（owner_name/limit）
acceptance:
  - 后端 pytest + 前端全量全绿；lint 持平
  - 部署后 /api/health ok；容器内新代码标识 grep 命中
  - 实证 10 项清单截图留档；plan.md 全局验收 6 条逐项结论
  - 模块文档三份同步
verify:
  - uv run pytest -q + pnpm test + pnpm typecheck + pnpm lint
  - docker compose --env-file deploy/.env -f deploy/docker-compose.yml ps（healthy）
constraints:
  - 实证前先跑 sillyspec run verify 对照（顺序：verify → 部署实证 → 归档建议）
---

# task-08 补充说明
无。
