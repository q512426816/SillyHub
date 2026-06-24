---
schema_version: 1
doc_type: module-card
module_id: app-pages
source_commit: ba87eec
author: qinyi
created_at: 2026-06-24T01:02:00
---
# app-pages

## 定位
顶层路由页面集合，覆盖未鉴权落地页与登录（`/`、`/login`），以及 dashboard 区下的工作区列表、运行时列表、个人设置三类全局页面。每个文件即一个 Next.js App Router 路由入口，负责数据拉取 + 页面交互编排，UI 主要下沉到 components-* 组件。

## 契约摘要
- `HomePage`（`/`）：服务端组件，未登录态展示落地信息，登录态通常重定向到 dashboard（无重业务）。
- `LoginPage`（`/login`）：表单提交 → 调 `login(account, password)` → 成功后 `router.push` 进 dashboard；本地 `localStorage` 记忆"记住账号/平台"偏好（`sillyhub.login.remember` / `sillyhub.login.platform`）。
- `WorkspacesPage`（`/workspaces`）：`listWorkspaces()` + 批量取 daemon runtime 绑定信息，渲染 `WorkspaceCard` 列表；提供扫描对话框入口。
- `RuntimesPage`（`/runtimes`）：`listDaemonRuntimes()` 列表 + 会话列表，点击某 runtime 打开 `RuntimeSessionDialog`（带 `key={runtime.id}` 强制重 mount 清旧态）；页面层只管列表/刷新，不直接 attach SSE。
- `SettingsPage`（`/settings`）：`listSettings()` / `updateSettings()` 增删改个人偏好（多 Tab 分区）。
- `GitIdentitiesPage`（`/settings/git-identities`）：`listGitIdentities/createGitIdentity/checkGitAccess` 管理 git 凭证，含创建表单（provider/username/email/token/repos）与连通性校验。
- `ApiKeysPage`（`/settings/api-keys`）：`listApiKeys/revokeApiKey` 管理个人 API Key。

## 关键逻辑
- 列表页通用模式（WorkspacesPage / RuntimesPage）：
  ```
  useEffect(() => { (async () => {
    setItems(await listX()); setError(null);
  })().catch(e => setError(String(e))).finally(() => setRefreshing(false)); }, [reload])
  ```
- LoginPage onFinish：`await login(values.account, values.password)` 成功后路由跳转，失败 message 报错并保留输入。
- RuntimeSessionDialog 由页面用 `dialogRuntime` state 驱动开关，`key` 绑 runtime.id 保证切换 runtime 时内部状态全清。

## 注意事项
- 登录态鉴权由 `(dashboard)` 布局统一兜底，单页不重复实现。
- RuntimesPage 文件较长（600+ 行），含若干内联子组件（Key 复制、ServerUrl 设置等），改动时注意区分主页面与内联组件。
- ApiKeysPage 的 key 明文只在创建瞬间返回，列表不回显，UI 需提示一次性。

## 人工备注
<!-- MANUAL_NOTES_START -->

## 变更索引
- ql-20260624-004-c8a2 | 优化 /settings/api-keys 页面：统一 PageHeader、SectionCard、StatusBadge、EmptyState，增加统计概览并整理表格操作区。

<!-- MANUAL_NOTES_END -->
