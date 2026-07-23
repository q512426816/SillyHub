---
author: qinyi
created_at: 2026-07-08 07:30:00
---

# 模块影响分析 — 2026-07-07-skills-mcp-management-ui

> 数据源：`git diff --name-only 64ab2d4d..1a79952d`（40 文件，3 模块）。

## 模块影响矩阵

| 模块 | 影响类型 | 相关文件 | 更新内容摘要 | needs_review |
|------|----------|----------|-------------|-------------|
| backend | 数据结构变更 | skills/model.py + migrations/20260707_custom_skills.py | CustomSkill 表（id/name unique/description/content/created_by）+ alembic migration | false |
| backend | 接口变更 | skills/router.py + main.py | CustomSkill admin CRUD 5 端点（SETTINGS_ADMIN） | false |
| backend | 接口变更 | settings/router.py + schema.py | MCP 平台配置/白名单 CRUD 4 端点 + McpServersSchema + 脱敏 helper | false |
| backend | 接口变更 | daemon/router.py | GET /api/daemon/mcp/config（daemon token，原值） | false |
| backend | 接口变更 | workspace/router.py + skills_view_service.py | workspace skills/.mcp.json 只读查看 2 端点（HostFsDelegate 分流） | false |
| backend | 逻辑变更 | agent/skills_bundle_service.py | 合并 DB CustomSkill 进 manifest/bundle | false |
| backend | 测试 | 6 个 test 文件 | 单测覆盖 CRUD/MCP/查看/bundle/端点 | false |
| sillyhub-daemon | 逻辑变更 | mcp-config.ts | fetchPlatformMcpConfig（backend 拉）+ FromBackend（fallback） | false |
| sillyhub-daemon | 逻辑变更 | skill-manager.ts | syncSkills 原子提升 tmpDir→final（删除同步） | false |
| sillyhub-daemon | 测试 | mcp-config.test.ts | fetch/回落单测 | false |
| frontend | 新增 | settings/skills/page.tsx + lib/custom-skills.ts + 编辑弹窗 | skills 管理页（平台只读+自定义 CRUD+markdown 编辑器） | false |
| frontend | 新增 | settings/mcp/page.tsx + lib/mcp-settings.ts | MCP 管理页（JSON 编辑器+白名单+脱敏+重启提示） | false |
| frontend | 新增 | workspaces/[id]/skills + /mcp 页 + lib/workspace-skills-view.ts + workspace-tabs | workspace 只读 skills/mcp tab | false |
| frontend | 测试 | 4 page.test.tsx | 21 组件测试 | false |

## 未匹配文件

无。40 文件全匹配 backend/sillyhub-daemon/frontend 模块。

## 跨模块契约

- backend `GET /api/daemon/skills/latest/manifest`（task-03 合并 DB 自定义）↔ frontend `usePlatformSkillsManifest`
- backend `/api/custom-skills` ↔ frontend `useCustomSkills` CRUD
- backend `/api/platform-settings/mcp{,-whitelist}` ↔ frontend `useMcpConfig/useMcpWhitelist`
- backend `/api/daemon/mcp/config` ↔ daemon `fetchPlatformMcpConfig`
- backend `/api/workspaces/{id}/skills` + `/mcp-config` ↔ frontend `useWorkspaceSkills/useWorkspaceMcpConfig`

所有影响确定，无 needs_review=true。
