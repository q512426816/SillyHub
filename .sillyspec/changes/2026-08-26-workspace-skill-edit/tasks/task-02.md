---
author: qinyi
created_at: 2026-08-26 19:45:00
id: task-02
title: "Backend 5 REST endpoints"
title_zh: "后端5个REST端点"
priority: P0
depends_on: [task-01]
allowed_paths:
  - backend/app/modules/workspace/router.py
goal: router 装配 5 端点（WorkspaceWriter 权限）
acceptance: |
  1. POST /workspaces/{id}/skills（body SkillCreateRequest）→ 201 SkillsViewResponse
  2. DELETE /workspaces/{id}/skills/{skill_name} → 200 {deleted: true}
  3. GET/PUT/DELETE /workspaces/{id}/skills/{skill_name}/files/{file_path:path}（GET →{path,content,size}；PUT body {content} →{path,size}；DELETE →{deleted:true}）
  4. 全部 require_permission(Permission.WORKSPACE_WRITE)（MCP PUT 同模式）；错误经 AppError 全局 handler；router 不写 HTTPException
  5. GET skills 列表端点（:366）零改动
implementation: router.py skills 段新增 5 端点 + pydantic 响应模型（就近 service 文件引用）
constraints: ["响应模型进 OpenAPI（task-04 依赖）", "既有端点零改动"]
verify: cd backend && uv run pytest app/modules/workspace -q --no-cov -n auto + from app.main import app 路由表确认 5 端点注册
expects_from:
  task-01:
    - contract: "SkillsViewService 写方法"
      needs: [create_skill, delete_skill, read_file, write_file, delete_file, AppError 族]
provides:
  - contract: "REST 端点"
    fields: [POST skills, DELETE skills, GET/PUT/DELETE files, 错误码, OpenAPI schema]
---

# task-02: 后端 5 REST 端点

按 frontmatter acceptance 装配 router。
