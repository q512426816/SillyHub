---
schema_version: 1
doc_type: module-card
module_id: components-shared
source_commit: ba87eec
author: qinyi
created_at: 2026-06-24T01:02:00
---
# components-shared

## 定位
跨页面复用的"业务级"通用组件集合（区别于 components-ui 的设计系统原语）。包含全局外壳（AppShell/TopBar/AntdProviders/ErrorBoundary）、各类卡片与对话框（WorkspaceCard/HealthCard/ServerStatusCard/WorkspaceScanDialog 等）、以及 Agent 运行面板等较重的组合组件。被几乎所有 app-* 页面与布局引用。

## 契约摘要
- `AntdProviders`：全局 antd Provider，`ConfigProvider locale={zhCN}` + 定制 theme + `<AntApp>`（message/modal/notification 静态方法）+ `dayjs.locale('zh-cn')`。RootLayout 唯一子节点。
- `AppShell`：dashboard 业务区外壳，内含侧边栏（菜单按权限渲染、collapsed 持久化到 `localStorage['sidebar-collapsed']`）+ `TopBar` + 退出确认。`usePathname()` 高亮当前菜单。
- `TopBar`：顶栏，`resolvePlatformSwitch(pathname)` 解析平台切换项；props `{ displayName, onLogout }`。
- `ErrorBoundary`：class 组件，`getDerivedStateFromError` + `componentDidCatch`（带 tag 上报 console），捕获子树渲染异常防整页白屏。
- `WorkspaceCard`：props `{ workspace, boundRuntime, onChanged }`，工作区卡片 + 绑定 runtime 展示。
- `HealthCard` / `ServerStatusCard`：健康/服务状态展示卡片。
- `AgentRunPanel`：props 见 `AgentRunPanelProps`；封装活跃 run 日志流（内部 `useAgentRunStream` 连 SSE）、历史 prefetch、input 提交、权限卡片，是 AgentPage 的核心。
- 其余：`WorkspaceScanDialog`、`ComponentDetailDrawer`、`SillySpecStepProgress`、`LogoutConfirmDialog`、`WorkspaceTabs`、`WorkspaceDaemonSwitcher`、`WorkspacePathFields`、`AgentModelInput`、`AgentProviderSelect`、`MissionConsole`。

## 关键逻辑
- AppShell 折叠持久化：
  ```
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem(COLLAPSED_KEY)==='true')
  useEffect(() => localStorage.setItem(COLLAPSED_KEY, String(collapsed)), [collapsed])
  ```
- ErrorBoundary 捕获：`static getDerivedStateFromError(e) => ({error:e})`，渲染期任意子组件抛错都被兜住，按 tag 打 console.error。
- AgentRunPanel：组件挂载即连 SSE，activeRunId 变化自动重连 + prefetch 历史，权限请求走内嵌卡片。

## 注意事项
- AntdProviders 内的 dayjs locale 必须在 ConfigProvider 之外再设一次（ConfigProvider 的 locale 不影响 dayjs）。
- AppShell 菜单可见性依赖 lib-permission 的 `canSeeMenu` / `visibleMenusBySection`，改菜单结构要同步 menu-permissions 定义。
- AgentRunPanel 是较重的组件，SSE 生命周期与 activeRunId 强绑定，卸载/切换时确保断流（hook 内已处理）。
- ErrorBoundary 是全应用为数不多的兜底，tag 用于区分日志区/面板区等不同子树。
- `WorkspaceCard`：标题 `display_alias ?? name` 回退；展示 owner 负责人（display_name ?? email）；提供别名编辑入口（由父页弹 modal 触发）（2026-06-25-admin-global-daemon-workspace-management，D-002/D-004）。

## 人工备注
<!-- MANUAL_NOTES_START -->
- 2026-07-22 平台文件中心（change `2026-07-22-platform-file-center`）新增两个通用组件（scan 未跑，待下次 scan 自动归位）：
  - `@/components/file-upload`（`FileUpload`）：编辑态受控上传组件，value=文件 id 列表，`customRequest` 调 `@/lib/file/api.uploadFile`（XHR + 进度 + 401 刷新重试），已上传项经 `fetchFileMetaBatch` 回显，图片显缩略图、文件显类型图标，可删除。PPM 各表单（问题清单/里程碑等）用它替代旧 `ppm-file-urls`。
  - `@/components/file-viewer`（`FileViewer`）：只读查看态，图片走 antd `Image.PreviewGroup`、文件走下载链接，空 →「暂无附件」。详情弹窗（problem/task-detail-modal、看板抽屉）用它。
- 配套 `@/lib/file/api`（uploadFile/fetchFileMetaBatch/getFileDownloadUrl）+ `@/lib/file/utils`（isImageMime/FileTypeIcon/formatFileSize）。
- `file_urls` 字段名不变，值语义从 URL 改为**文件 id**（design D-006）。
<!-- MANUAL_NOTES_END -->
