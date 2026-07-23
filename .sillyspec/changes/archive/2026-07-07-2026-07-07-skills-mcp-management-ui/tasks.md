---
author: qinyi
created_at: 2026-07-07 23:17:00
---

# 2026-07-07-skills-mcp-management-ui 任务清单

> 详细 Wave 分组 + 依赖 + 验收在 plan.md（plan 阶段产出）。本文件是任务总览。

## 任务总览

- **task-01**：backend CustomSkill 数据模型 + Alembic migration（FR-01, D-001 D-002）
- **task-02**：backend CustomSkill admin CRUD 端点 + service（FR-01, NFR-01）
- **task-03**：backend skills_bundle_service 合并 DB 自定义 skills（FR-02, D-001）
- **task-04**：backend MCP 平台配置/白名单 CRUD（扩 settings/router，存 PlatformSetting）（FR-03 FR-04, D-003 NFR-02 NFR-03）
- **task-05**：backend daemon MCP config 端点 `GET /api/daemon/mcp/config`（FR-05, D-004）
- **task-06**：backend workspace skills/.mcp.json 查看端点（经 SpecPathResolver/HostFsDelegate）（FR-07 FR-08, D-006 NFR-05）
- **task-07**：daemon mcp-config 改从 backend 拉 + skill-manager 删除同步清理（FR-05 FR-06）
- **task-08**：frontend `/settings/skills` 页（平台只读列表 + 自定义 CRUD + 编辑器）（FR-09, D-007）
- **task-09**：frontend `/settings/mcp` 页（JSON 编辑器 + 白名单 + 脱敏 + 重启提示）（FR-10, NFR-02）
- **task-10**：frontend workspace 详情 skills/mcp tab（FR-11）
- **task-11**：secret 脱敏 + 权限门控 + 双校验贯通（NFR-01 NFR-02 NFR-03）
- **task-12**：e2e 集成验证（全 FR + NFR-04 零回归）

## 关键依赖

- task-02/03 依赖 task-01（CustomSkill 模型）
- task-05 依赖 task-04（MCP 配置存储就绪）
- task-07 依赖 task-05（daemon 端点）
- task-08/09/10 依赖对应 backend 端点（task-02/04/06）
- task-12 依赖全部

## 覆盖矩阵

| FR/NFR | 覆盖 task |
|---|---|
| FR-01 自定义 skills CRUD | task-01, task-02 |
| FR-02 自定义 skills 分发 | task-03 |
| FR-03 MCP 平台配置 CRUD | task-04 |
| FR-04 MCP 白名单 CRUD | task-04 |
| FR-05 daemon 拉 MCP 配置 | task-05, task-07 |
| FR-06 skill 删除同步 | task-07 |
| FR-07/08 workspace 查看 | task-06 |
| FR-09 Skills 管理页 | task-08 |
| FR-10 MCP 管理页 | task-09 |
| FR-11 workspace tab | task-10 |
| NFR-01 权限 | task-02, task-04, task-11 |
| NFR-02 脱敏 | task-04, task-09, task-11 |
| NFR-03 双校验 | task-04, task-11 |
| NFR-04 零回归 | task-12 |
