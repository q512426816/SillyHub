---
schema_version: 1
doc_type: module-card
module_id: app-pages
author: qinyi
created_at: 2026-08-18 01:45:00
---

# 平台级页面（app-pages）

## 定位
顶层路由页面集合（`src/app/` 根 + `(auth)` + `(dashboard)` 平台级页面），共 12 个 page.tsx：落地页 `/`、登录 `/login`、工作区选择器 `/workspaces`、机器列表 `/runtimes`、机器审计 `/runtimes/[id]/audit`、设置域 `/settings` 及其 5 个子页（git-identities / api-keys / mcp / providers / skills）、个人中心 `/account`。页面负责数据拉取与交互编排，UI 骨架下沉 components-layout / components-shared / components-llm-providers / components-daemon。

## 契约摘要
- `HomePage`（`/`）：client 组件，hydrate 后按 accessToken `router.replace` 到 `/workspaces` 或 `/login`；token 在 localStorage、server 端读不到，故 client effect 跳转；persist 恢复前 `return null` 防首帧误判闪烁。
- `LoginPage`（`/login`，`(auth)` 路由组，不进 dashboard layout）：表单 → `login(account, password)` → 成功跳平台默认页；localStorage 记忆账号/平台偏好（`sillyhub.login.remember` / `sillyhub.login.platform`，移动端 `/m/login` 复用同组 key 保持两端回填一致）。
- `WorkspacesPage`（`/workspaces`，387 行）：`listWorkspaces` + `fetchMyBindings` + `useDaemonStatusMap` 组装 `WorkspaceCard` 卡片列表；扫描入口 `WorkspaceScanDialog`；平台管理员可见人员搜索（`listUsers`，`is_platform_admin` 控制显隐，失败降级隐藏控件）。
- `RuntimesPage`（`/runtimes`，1197 行）：数据源 `useDaemonMachines`（机器级聚合：machines/total/sessions 一体管理）；点卡片开 `RuntimeSessionDialog`（`key={runtime.id}` 重 mount 清旧态）；跨机器 runtime 扁平化支持 `?session` 查询参数恢复定位。
- `AuditPage`（`/runtimes/[id]/audit`，88 行起）：机器级策略审计视图，数据走 lib-daemon-audit（`usePolicyAuditByRuntime`）。
- `SettingsPage`（`/settings`）：多 Tab 个人设置（`listSettings`/`updateSettings`）。
- `GitIdentitiesPage`（`/settings/git-identities`）：git 凭证管理，含创建表单（provider/username/email/token/repos）与 `checkGitAccess` 连通性校验。
- `ApiKeysSettingsPage`（`/settings/api-keys`）：API Key 签发/吊销；明文只在创建瞬间返回，列表不回显。
- `McpSettingsPage`（`/settings/mcp`）：MCP 设置视图（lib-mcp-skills）。
- `LlmProvidersPage`（`/settings/providers`，34 行薄壳）：`PageHeader` + `<LlmProviderSection />`，"我的供应商"独立路由（侧边栏直达），配置跟随账号、所有工作空间通用。
- `SkillsSettingsPage`（`/settings/skills`）：技能管理入口。
- `AccountPage`（`/account`）：个人中心，平台级路由不依赖工作区上下文。

## 关键逻辑
```
HomePage:   !hydrated→null(不跳转); hydrated→replace(token?/workspaces:/login)
RuntimesPage: useDaemonMachines(listParams) → machines/sessions
              → RuntimeSessionDialog(跨机器扁平 runtimes) 页面只切 dialogRuntime
WorkspacesPage: listWorkspaces ∥ fetchMyBindings ∥ useDaemonStatusMap
              → WorkspaceCard 列表（daemon 徽标/绑定态）
```

## 注意事项
- 登录守卫在 `(dashboard)/layout.tsx` 统一兜底（未登录 replace `/login` + 工作区白名单守卫），单页不重复实现；`/account`、`/agent-profiles`、`/sessions` 均已在该白名单内。
- RuntimesPage 单文件 1197 行、含大量内联子组件（Key 复制、ServerUrl 设置等），改动先确认逻辑是否已下沉 components-daemon / hooks，勿在页内重复实现 SSE/会话交互。
- 机器级数据模型（machine > runtime > session）是 /runtimes 域的既定形态（D-005 完全替换平铺），改回平铺会丢跨机器会话聚合与 `?session` 恢复。
- `/settings/providers` 是薄壳页：供应商 CRUD/模型拉取/用量逻辑全在 components-llm-providers + lib-llm-providers，本页勿加业务。
- 登录页与移动端 `/m/login` 是两份独立实现（桌面零回归约束），改认证行为（如 key 名、跳转规则）须双向同步。

## 人工备注
<!-- MANUAL_NOTES_START -->

## 变更索引
- ql-20260624-004-c8a2 | 优化 /settings/api-keys 页面：统一 PageHeader、SectionCard、StatusBadge、EmptyState，增加统计概览并整理表格操作区。

<!-- MANUAL_NOTES_END -->
