---
schema_version: 1
doc_type: module-card
module_id: lib-mcp-skills
author: qinyi
created_at: 2026-08-18 01:45:00
---

# MCP 与技能管理客户端（lib-mcp-skills）

## 定位
MCP 配置与技能管理的 API 客户端 + React Query hooks 三件套（skills-mcp-management-ui 系列变更产出）：`mcp-settings.ts` 平台级 MCP 默认配置/白名单（admin）、`custom-skills.ts` 自定义技能 CRUD + 平台 sillyspec skills 清单/内容（只读）、`workspace-skills-view.ts` workspace 详情只读 skills / .mcp.json 视图。裸 fetch 函数与 hooks 双层暴露，key 集中在 `lib-react-query` 的 `queryKeys`。

## 契约摘要
`mcp-settings.ts`（平台级，admin）：
- `getMcpConfig` / `updateMcpConfig` — GET/PUT `/api/platform-settings/mcp`。
- `getMcpWhitelist` / `updateMcpWhitelist` — GET/PUT `/api/platform-settings/mcp-whitelist`（PUT 请求体为顶层 JSON 数组）。
- hooks：`useMcpConfig` / `useMcpWhitelist`（staleTime 60s）；`useUpdateMcpConfig` / `useUpdateMcpWhitelist`（成功后 invalidate 各自 key）。
- zod schema（D-009 前端校验）：`mcpConfigSchema` / `mcpServerEntrySchema`（command 必填，args 默认 []）/ `mcpWhitelistSchema`。
- `MCP_SECRET_PLACEHOLDER = "<set>"` — 与后端 `_SECRET_REDACTED_PLACEHOLDER` 一致的遮蔽占位符。

`custom-skills.ts`：
- CRUD（后端 admin 鉴权，列表登录可见）：`listCustomSkills`（含 content_preview）/ `getCustomSkill`（含全文）/ `createCustomSkill` / `updateCustomSkill` / `deleteCustomSkill`。
- 平台清单（只读）：`getPlatformSkillsManifest`（`/api/daemon/skills/latest/manifest` → version + files[] + skills[] 摘要 + 可选 message）；`getPlatformSkillContent(name)`（单 skill SKILL.md 全文）。
- hooks：`useCustomSkills`（staleTime 30s）；`usePlatformSkillsManifest` / `usePlatformSkillContent(name)`（5min；content 的 enabled 由 name 非空控制）。
- mutation hooks（`useCreate/Update/DeleteCustomSkill`）：**成功后双 invalidate**（customSkills.all + manifest）——DB 自定义 skill 内容会进 manifest version hash。

`workspace-skills-view.ts`（只读，D-006 无 mutation）：
- `getWorkspaceSkills(workspaceId)` → `{ skills: [{ name, files: relpath[] }] }`。
- `getWorkspaceMcpConfig(workspaceId)` → `{ mcpServers: {...} }`（env secret 已后端脱敏；无 .mcp.json 时返空对象不抛错）。
- hooks：`useWorkspaceSkills` / `useWorkspaceMcpConfig` — refetchInterval 30s，可被父组件按需关闭。

## 关键逻辑
```
MCP secret 编辑：GET 返回 token/key/secret/password 类 env 值为 "<set>"
  → 保持 "<set>" 不变提交 = 不改该 secret（后端原样存储）
custom skill mutation onSuccess:
  invalidate(customSkills.all) + invalidate(customSkills.manifest)
```

## 注意事项
- 三文件类型均**手写**：后端这些端点无 pydantic response_model（dict/list 直返），不在 OpenAPI 生成范围，符合规则 20 的独立手写文件模式；改后端返回结构须手动同步这里。
- `created_by` 自 custom-skill-per-user task-05 起收窄为非空 string。
- `usePlatformSkillContent` 的 key 是参数化的 `customSkills.content(name)`，避免不同 skill 缓存串。
- `McpServerEntry` 在本模块有两个同名形态（mcp-settings 的 zod 推导 vs workspace-skills-view 的宽松 `Record<string, unknown>`），导入时注意来源文件。
- 消费方（已核实 import）：
  - mcp-settings：`settings/mcp` 页；
  - custom-skills：`settings/skills` 页、`CustomSkillEditDialog`、`SkillContentDrawer`、`agent-profile-form`；
  - workspace-skills-view：workspace `skills` / `mcp` 页、`agent-profile-form`（读 mcp-config 展示）。

## 人工备注

<!-- MANUAL_NOTES_START -->

<!-- MANUAL_NOTES_END -->
