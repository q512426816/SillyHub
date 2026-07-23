---
author: qinyi
created_at: 2026-07-07 23:16:00
---

# 2026-07-07-skills-mcp-management-ui 需求

## 功能需求

- **FR-01 自定义 skills CRUD**：admin 可经 `POST/PUT/DELETE /api/custom-skills` 新增/编辑/删除自定义 skill（name+description+SKILL.md content）。name 全局唯一，禁 `sillyspec-` 前缀，合法字符 `[a-z0-9-]` 2-40。
- **FR-02 自定义 skills 分发**：DB CustomSkill 并入 `GET /api/daemon/skills/latest/{manifest,bundle}`（显式包含，不靠 glob），daemon 启动 manifest 版本比对自动重拉。
- **FR-03 MCP 平台配置 CRUD**：admin 可经 `GET/PUT /api/platform-settings/mcp` 编辑平台默认 MCP 配置（`{mcpServers}` JSON），存 PlatformSetting(key=`mcp.platform_default`)。
- **FR-04 MCP 白名单 CRUD**：admin 可经 `GET/PUT /api/platform-settings/mcp-whitelist` 编辑白名单（server 名 list），存 PlatformSetting(key=`mcp.whitelist`)。
- **FR-05 daemon 拉 MCP 配置**：新增 `GET /api/daemon/mcp/config`（返回 platform_default+whitelist 原值，daemon token 认证）；daemon `mcp-config.ts` 启动拉替代读本地 `~/.sillyhub/daemon/mcp.json`（本地作 fallback）。
- **FR-06 skill 删除同步**：daemon `skill-manager.ts` 的 `extractSkillsBundle` 改「先清空目标目录→解压」（原子：tmp 解压成功后 rename），保证自定义 skill 删除后 daemon 不残留。
- **FR-07 workspace skills 查看**：`GET /api/workspaces/{id}/skills`（经 SpecPathResolver/HostFsDelegate 读 specDir/skills/，只读）。
- **FR-08 workspace .mcp.json 查看**：`GET /api/workspaces/{id}/mcp-config`（经 SpecPathResolver/HostFsDelegate 读 specDir/.mcp.json，只读）。
- **FR-09 Skills 管理页**：`/settings/skills`——平台 sillyspec skills 只读列表（读 manifest）+ 同步版本 + 自定义 skills 表格 CRUD + 编辑弹窗（markdown 编辑器带预览）。
- **FR-10 MCP 管理页**：`/settings/mcp`——JSON 编辑器（platform_default，schema 校验 + env 遮蔽展示）+ 白名单编辑器（list 增删）+ 保存（提示重启 daemon）。
- **FR-11 workspace tab**：workspace 详情页加 skills tab + mcp tab（只读，调 FR-07/08）。

## 非功能需求

- **NFR-01 权限**：CRUD（FR-01/03/04）= platform admin only（`require_permission(MANAGE_PLATFORM)`）；查看（FR-07/08/09/10/11）= 登录用户（workspace 加 membership 校验）。
- **NFR-02 secret 脱敏**：MCP env 含 token/key/secret/password 的 key，admin GET 返回遮蔽值；daemon GET 返回原值。前端展示遮蔽。
- **NFR-03 校验**：MCP JSON 后端 pydantic（`McpServersSchema`）+ 前端 zod 双校验；CustomSkill name 后端 unique + 字符集校验。
- **NFR-04 零回归**：现有 skills bundle 分发、daemon skill-manager/mcp-config 既有链路不破坏；backend 全量 pytest + sillyhub-daemon pnpm test + frontend pnpm test 全绿。
- **NFR-05 兼容**：Windows/Linux/macOS；daemon-client 模式 workspace 经 HostFsDelegate 读 specDir。
