# 12 — Frontmatter Schema 建议

## Change

```yaml
---
id: 2026-05-25-multi-agent-platform-bootstrap-v2
title: 多智能体协作管理平台搭建
status: in_progress
change_type: feature
owner: qinyi
affected_components:
  - platform-web
  - platform-api
---
```

## Task

```yaml
---
id: task-01
title: 初始化平台仓库与基础工程
status: draft
priority: P0
owner: qinyi
affected_components:
  - platform-web
  - platform-api
allowed_paths:
  - frontend/
  - backend/
acceptance:
  - 能启动前端
  - 能启动后端
---
```

## Project Component

```yaml
id: silly-admin-ui
name: Silly Admin UI
type: frontend
path: ../silly-admin-ui
role: admin_console
tech_stack:
  - TypeScript
  - React
  - Vite
commands:
  build: npm run build
  test: npm run test
relations:
  - target: silly
    type: consumes_api_from
```
