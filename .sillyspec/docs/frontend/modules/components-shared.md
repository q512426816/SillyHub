---
schema_version: 1
doc_type: module-card
module_id: components-shared
author: qinyi
created_at: 2026-08-18 01:45:00
---

# 业务级通用组件（components-shared）

## 定位
跨页面复用的"业务级"通用组件集合（16 文件，`components/` 根目录），区别于 components-ui 的设计系统原语。覆盖四块：
- 全局骨架：AppShell / TopBar / AntdProviders / ErrorBoundary。
- 工作区相关卡片与对话框：WorkspaceCard / WorkspaceScanDialog / WorkspaceTabs / WorkspaceDaemonSwitcher / WorkspacePathFields / WorkspaceSessionSection / LogoutConfirmDialog。
- Agent 运行：AgentRunPanel / AgentModelInput / AgentProviderSelect。
- Mission 任务会话：MissionConsole / MissionSummaryCard。

被几乎所有 app-* 页面与布局引用。注意与 `components-workspace-config`（绑定/配置/守卫域）、`components-file-center`（文件上传/查看）的拆分边界。

## 契约摘要
全局骨架：
- `AntdProviders`：全局 antd Provider——`ConfigProvider locale={zhCN}` + 定制 theme + `<AntApp>`（message/modal/notification 静态方法）+ `dayjs.locale('zh-cn')`；RootLayout 唯一子节点。
- `AppShell`：dashboard 业务区外壳——侧边栏（菜单按权限渲染，折叠状态持久化 `localStorage['sidebar-collapsed']`）+ TopBar + 退出确认；`usePathname()` 高亮当前菜单。
- `TopBar`：props `{ displayName, onLogout }`；导出 `resolvePlatformSwitch(pathname)` 解析平台切换项。
- `ErrorBoundary`：class 组件，`getDerivedStateFromError` + `componentDidCatch`（带 tag 上报 console），兜底子树渲染异常防整页白屏。
工作区相关：
- `WorkspaceCard`：工作区卡片 + 绑定 runtime 展示；导出 `DaemonBadgeStatus = "online"|"offline"|"unbound"`。
  - 标题 `display_alias ?? name` 回退；owner 显示 `display_name ?? email`。
  - 提供别名编辑入口（由父页弹 modal 触发）。
- `WorkspaceScanDialog`：props `{ onCreated, onCancel }`，工作区扫描创建对话框。
- `WorkspaceTabs`：工作区页内 tab 导航。
- `WorkspaceDaemonSwitcher`：切换工作区绑定的 daemon 实例。
- `WorkspacePathFields`：工作区路径输入组（配合路径校验）。
- `WorkspaceSessionSection`：props `{ workspaceId }`——工作区级「会话」两栏区（task-08 D-002/FR-03，从 ChangeSessionSection 抽出的 workspace 通用版，去 changeId 依赖）。
  - 左：`SessionListLayout`（含已结束会话，`listWorkspaceAgentSessions` include_ended=true）。
  - 右：`InteractiveSessionPanel`（建会话传 workspace_id 不传 change_id）。
  - 选中历史会话 → `attachSessionId` + `initialTurns`（`logsToTurns`）attach 恢复。
  - ended/failed 会话：先 `reopenSession` 转 reconnecting/active 再 attach（panel 轮询仅识别 active/failed，直接 attach 会卡超时，F-1/C-3）。
  - providers/model 来源 `listDaemonRuntimes`（与 RuntimeSessionDialog 同源）。
- `LogoutConfirmDialog`：退出登录确认（props 见 `LogoutConfirmDialogProps`）。
Agent 运行：
- `AgentRunPanel`：props 见 `AgentRunPanelProps`；封装活跃 run 日志流（内部 `useAgentRunStream` 连 SSE）、历史 prefetch、input 提交、权限卡片，AgentPage 的核心。
- `AgentModelInput`（33 行）：agent 模型输入小组件。
- `AgentProviderSelect`（87 行）：agent provider 选择小组件（`listDaemonRuntimes` 填充）。
Mission：
- `MissionConsole`（835 行）：mission 任务会话控制台；导出纯函数 `mergeLogsById`（日志按 id 合并去重）。
- `MissionSummaryCard`：props `{ mission: Mission }`，mission 摘要卡。

## 关键逻辑
```
AppShell 折叠持久化:
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem(KEY)==='true')
  useEffect(() => localStorage.setItem(KEY, String(collapsed)), [collapsed])

ErrorBoundary: static getDerivedStateFromError(e) => ({error: e})
  渲染期任意子组件抛错被兜住，按 tag 打 console.error

WorkspaceSessionSection attach 恢复:
  选中历史会话 → logsToTurns(getAgentSessionLogs) → initialTurns
  status ended/failed → reopenSession() 先行（否则 panel 轮询卡超时）
  未选 → idle 新建 createSession({workspace_id, ...})（不带 change_id）
```

## 注意事项
- AntdProviders 内 dayjs locale 必须在 ConfigProvider 之外再设一次（ConfigProvider 的 locale 不影响 dayjs）。
- AppShell 菜单可见性依赖 lib-permission 的 `canSeeMenu`/`visibleMenusBySection`，改菜单结构要同步 menu-permissions 定义。
- AgentRunPanel / MissionConsole 是较重组件，SSE 生命周期与 activeRunId 强绑定，卸载/切换时确保断流（hook 内已处理）。
- ErrorBoundary 是全应用为数不多的兜底，tag 用于区分日志区/面板区等不同子树。
- 旧 HealthCard / ServerStatusCard / ComponentDetailDrawer / SillySpecStepProgress 已删除；文件上传/查看在 components-file-center，绑定/配置/守卫在 components-workspace-config，勿再往本域塞。

## 人工备注

<!-- MANUAL_NOTES_START -->
- 2026-07-22 平台文件中心（change `2026-07-22-platform-file-center`）新增两个通用组件（scan 未跑，待下次 scan 自动归位）：
  - `@/components/file-upload`（`FileUpload`）：编辑态受控上传组件，value=文件 id 列表，`customRequest` 调 `@/lib/file/api.uploadFile`（XHR + 进度 + 401 刷新重试），已上传项经 `fetchFileMetaBatch` 回显，图片显缩略图、文件显类型图标，可删除。PPM 各表单（问题清单/里程碑等）用它替代旧 `ppm-file-urls`。
  - `@/components/file-viewer`（`FileViewer`）：只读查看态，图片走 antd `Image.PreviewGroup`、文件走下载链接，空 →「暂无附件」。详情弹窗（problem/task-detail-modal、看板抽屉）用它。
- 配套 `@/lib/file/api`（uploadFile/fetchFileMetaBatch/getFileDownloadUrl）+ `@/lib/file/utils`（isImageMime/FileTypeIcon/formatFileSize）。
- `file_urls` 字段名不变，值语义从 URL 改为**文件 id**（design D-006）。
- （2026-08-18 重扫补记：file-upload/file-viewer/file-image 已归位 components-file-center 模块，上三条仅作历史沿革保留。）
<!-- MANUAL_NOTES_END -->
