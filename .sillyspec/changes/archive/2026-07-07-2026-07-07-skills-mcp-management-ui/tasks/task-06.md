---
author: qinyi
created_at: 2026-07-07 23:23:00
goal: backend workspace skills/.mcp.json 查看端点
implementation: 在 workspaces 或 skills 模块加 GET /api/workspaces/{id}/skills（列 workspace specDir/skills/ 的 skill 名 + 文件）+ GET /api/workspaces/{id}/mcp-config（读 specDir/.mcp.json）；经 SpecPathResolver 定位 specDir，daemon-client 路径经 HostFsDelegate RPC 读（server-local 直接 Path）；membership 校验
acceptance: 两端点通；membership 校验（非成员 403）；workspace 无 skills/.mcp.json 时返回空不报错；daemon-client 路径经 HostFsDelegate 读成功
verify: cd backend && uv run pytest tests/modules/workspaces/test_workspace_skills_view.py
constraints: 只读（D-006）；经 HostFsDelegate 读 specDir（NFR-05 daemon-client 兼容，复用上一变更 host_fs 端点）；membership 校验
depends_on: []
covers: [FR-07, FR-08, D-006, NFR-05]
---

# task-06: backend workspace skills/.mcp.json 查看端点

## 验收标准
A. `GET /api/workspaces/{id}/skills` 列 specDir/skills/ 下 skill 名 + 文件清单（只读）。
B. `GET /api/workspaces/{id}/mcp-config` 读 specDir/.mcp.json（只读）。
C. workspace membership 校验（非成员 403）。
D. daemon-client 模式经 HostFsDelegate RPC 读宿主 specDir；server-local 直接 Path 读；两者均通。
