---
author: qinyi
created_at: 2026-07-05 01:12:09
change: 2026-07-05-workspace-config-card
stage: brainstorm
---

# Requirements — 工作区配置卡（WorkspaceConfigCard）

## 角色表

| 角色 | 在本变更中的诉求 |
|---|---|
| 工作区成员（owner） | 一眼看清工作区所有配置位置；能改自己的接入；能初始化 / 扫描 / 同步 / 导入 |
| 工作区成员（非 owner） | 一眼看清自己的接入 + 工作区共享存储；能改自己的接入；不能扫描（owner only 门禁保留） |
| server-local 工作区成员 | 看清服务器存储位置；无 daemon 概念，相关字段隐藏 |

## 功能需求（FR）

### FR-001 配置数据来源（覆盖 D-001@V1）
卡片展示的配置数据来自 backend DB（`GET /my-binding` 返回 `MemberBindingView` + `GET /spec-workspace` 返回 `SpecWorkspaceRead`），**不读**项目根过时的 `.sillyspec-platform.json`，**不读** daemon 写的新 schema 文件。daemon 元数据（hostname / alias / provider）来自 page.tsx 已加载的 `boundDaemon`（按 `myBinding.daemon_id` 从 `listDaemonInstances` find）。

### FR-002 共享字段只读（覆盖 D-002@V1）
「工作区文档存储」组所有字段（spec_root / runtime_root / cache_root / spec_version / sync_status / last_synced_at / strategy）**无编辑入口**；可编辑范围限定为「我的接入」组的 root_path / daemon_id / path_source（就地展开 WorkspaceAccessGuide 编辑模式）。

### FR-003 卡片位置（覆盖 D-003@V1）
卡片位于详情页原「规范管理」SectionCard 位置（page.tsx 第 598-825 行替换为 `<WorkspaceConfigCard>`），不新增独立区块、不合并进基本信息区。

### FR-004 守护进程本地缓存展示（覆盖 D-004@V1）
「守护进程本地缓存」字段值 = 约定模板 `~/.sillyhub/daemon/specs/<workspaceId>`；tooltip 文案「守护进程在你电脑上缓存这个工作区文档的位置。`~` = 你的用户主目录（Windows: `C:\Users\<你>`；macOS/Linux: `/home/<你>`）」；`path_source !== 'daemon-client'` 时隐藏该字段。

### FR-005 组件结构（覆盖 D-005@V1）
新建独立 `WorkspaceConfigCard` 单组件，复用 `WorkspaceAccessGuide`（首次 + 编辑模式）子组件不重写；接收 `workspace / specWs / myBinding / boundDaemon / isOwner / onRefresh` props；内部管理编辑展开 state + 操作按钮 state + handlers；不强制使用 `WorkspaceBindingGuard`（卡片自管理未绑定/已绑定分支）。

### FR-006 状态分支
卡片支持 6 状态：
- **loading**：骨架占位
- **error**：错误提示 + 重试
- **未绑定**（my-binding 为空）：「我的接入」组渲染 WorkspaceAccessGuide 首次模式；「工作区文档存储」组仍展示（共享只读，不依赖 binding）
- **已绑定·未初始化**（init_synced_at 为空）：两组完整展示；「我的接入」组挂"未初始化" amber 徽标 + 「初始化」按钮
- **已绑定·已初始化**：两组完整展示；「我的接入」组挂"已初始化" emerald 徽标
- **server-local**（path_source === 'server-local'）：隐藏「绑定守护进程」「守护进程本地缓存」字段；显示"服务器本地工作区，无需守护进程"说明

### FR-007 操作按钮等价搬迁
初始化 / 扫描 / 同步到服务器 / 导入 / 生成项目组件 5 个按钮的 handler 从 page.tsx 等价迁入卡片，行为对等（initPollRef / syncPollRef 轮询 + visibilitychange 暂停 + 5min 上限 + 409 重扫确认 + SSE onProgress + 卸载清理）。owner 门禁（扫描按钮 disabled）保留。

### FR-008 编辑入口就地展开
「编辑我的接入」按钮点击就地展开 WorkspaceAccessGuide 编辑模式（回填当前 binding），保存（`upsertMyBinding`）后调 `onRefresh` + 收起；不弹 Modal。

## 行为规格（Given / When / Then）

### FR-001 数据来源
- **Given** 工作区已关联 spec_workspace + 当前用户有 binding
- **When** 打开详情页
- **Then** 卡片「我的接入」组显示 myBinding 字段、「工作区文档存储」组显示 specWs 字段；不读取 / 展示项目根 `.sillyspec-platform.json` 内容

### FR-003 卡片位置
- **Given** 详情页加载完成
- **When** 渲染
- **Then** 原「规范管理（Spec Workspace）」SectionCard 不再出现；同一位置渲染「我的工作区配置」卡

### FR-004 缓存路径 tooltip
- **Given** daemon-client 工作区
- **When** hover「守护进程本地缓存」字段
- **Then** tooltip 显示含 `~` 三平台解释；字段值为 `~/.sillyhub/daemon/specs/<workspaceId>`

### FR-006 状态分支
- **Given** myBinding == null（未绑定）
- **When** 渲染卡片
- **Then** 「我的接入」组显示首次引导表单（WorkspaceAccessGuide 首次模式）；「工作区文档存储」组仍展示
- **Given** myBinding.path_source == 'server-local'
- **When** 渲染卡片
- **Then** 隐藏「绑定守护进程」「守护进程本地缓存」字段；显示"服务器本地工作区，无需守护进程"说明

### FR-008 编辑入口
- **Given** 已绑定工作区
- **When** 点击「编辑我的接入」
- **Then** 就地展开编辑表单（回填当前 daemon_id / root_path / path_source）；保存后字段刷新、表单收起

### FR-007 操作按钮等价
- **Given** 就绪态工作区（initSyncedAt 非空 + componentCount > 0）
- **When** 点击「同步到服务器」
- **Then** 按钮转"同步中…"；syncPollRef 轮询 listPendingSync 直到 done / failed / 5min 超时；done 后调 onRefresh

## 非功能需求

### NFR-01 跨平台
路径展示兼容 Windows（反斜杠 + `C:\`）/ macOS / Linux（POSIX）；cache_root 含 `~` 三平台解释。前端不假设特定 OS（浏览器本就跨平台，路径由后端返回原样展示）。

### NFR-02 中文 UI
所有标签 / 说明 / tooltip 中文（CLAUDE.md 规则 11），专业术语（spec_root / runtime_root / daemon-client / spec_version 等）保留英文。

### NFR-03 无障碍
路径用 `font-mono + truncate + title`（hover 显示完整路径）；tooltip 可达；按钮有 `disabled` + `title` 解释（如"仅 owner 可扫描"）。

### NFR-04 性能
卡片不重复请求已加载的共享数据（page.tsx `load()` 已加载的 specWs / myBinding / boundDaemon 走 props 传递）。

### NFR-05 兼容性
改造前后详情页其他区块（基本信息 / 默认智能体 / Overview / Quick nav）行为不变；详情页现有测试 `page.test.tsx` 全绿。

## D-xxx@vN 覆盖关系

| 决策 ID | 覆盖 FR |
|---|---|
| D-001@V1（数据源 backend DB） | FR-001 |
| D-002@V1（spec_root / runtime_root 只读） | FR-002 |
| D-003@V1（卡片位置 = 升级规范管理区） | FR-003 |
| D-004@V1（缓存路径展示 + tooltip） | FR-004 |
| D-005@V1（独立单组件） | FR-005 |
