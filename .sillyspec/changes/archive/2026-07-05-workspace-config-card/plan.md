---
author: qinyi
created_at: 2026-07-05 01:15:00
change: 2026-07-05-workspace-config-card
stage: plan
plan_level: light
---

# 轻量计划：工作区配置卡（升级详情页"规范管理"区为"我的工作区配置"）

## 来源

直接引用 brainstorm 阶段四件套：`proposal.md`（动机 + 关键问题 + 范围 + SC-1~8）/ `design.md`（12 章节 + Grill 4 修正 + 文件清单 + 字段映射 + 状态分支）/ `requirements.md`（FR-001~008 + GWT + NFR）/ `decisions.md`（D-001~D-005）/ `tasks.md`（T-01~T-09）。不重新扩写。

核心方案（D-005@V1）：新建独立 `WorkspaceConfigCard` 单组件，升级详情页第 598-825 行"规范管理"SectionCard，内分「我的接入」per-member 可编辑组 +「工作区文档存储」共享只读组；操作按钮 handlers 等价迁入；server-local 隐藏 daemon 字段。

## 范围

- **新增** `frontend/src/components/workspace-config-card.tsx`（主组件 + 6 状态分支 + 两组渲染 + 编辑入口 + 操作按钮 handlers）
- **新增** `frontend/src/components/workspace-config-card.test.tsx`（组件测试）
- **修改** `frontend/src/app/(dashboard)/workspaces/[id]/page.tsx`（删除第 598-825 行 + 配置 state/handlers，替换为 `<WorkspaceConfigCard>`）
- **修改** `frontend/src/app/(dashboard)/workspaces/[id]/page.test.tsx`（适配新卡片结构）

不涉及 backend / daemon / migration。

## Tasks

- [x] task-01: 新建 `workspace-config-card.tsx` 骨架 + Props 类型签名（workspace/specWs/myBinding/boundDaemon/isOwner/onRefresh）+ 6 状态分支框架（覆盖：FR-005, FR-006, D-005@V1）
- [x] task-02: 实现「我的接入」组渲染（绑定守护进程 daemon-chip / 本地项目路径 mono-path / 路径来源 badge / 接入初始化状态徽标 / 上次接入同步 + 「编辑我的接入」按钮入口）（覆盖：FR-001, FR-008, D-001@V1）
- [x] task-03: 实现「工作区文档存储」组渲染（spec_root / runtime_root 派生 / cache_root+tooltip / sync_status 徽标 / last_synced_at / strategy），无编辑入口（**R-07：不展示工作区级 spec_version**，frontend SpecWorkspace 类型 + SpecWorkspaceRead + backend schema 均无此字段；版本仅「我的接入」组展示 myBinding.init_synced_spec_version）（覆盖：FR-001, FR-002, FR-004, D-001@V1, D-002@V1, D-004@V1）
- [x] task-04: 实现编辑入口就地展开（复用 WorkspaceAccessGuide 编辑模式 + 回填当前 binding + 保存调 upsertMyBinding + onRefresh + 收起）（覆盖：FR-008, D-002@V1）
- [x] task-05: 实现未绑定首次引导（WorkspaceAccessGuide 首次模式）+ server-local 字段条件隐藏（daemon/cache_root）+ "服务器本地工作区，无需守护进程"说明文案（覆盖：FR-006）
- [x] task-06: 操作按钮 handlers 等价迁入（handleInit/handleScan/handleSyncManual/handleImport/handleGenerateProjects + initPollRef/syncPollRef 轮询 + visibilitychange 暂停 + 5min 上限 + 409 重扫确认 + SSE onProgress + 卸载清理 + owner 门禁）（覆盖：FR-007）
- [x] task-07: `page.tsx` 改造——删除第 598-825 行「规范管理」SectionCard + 配置 state/handlers/initPollRef/syncPollRef，替换为 `<WorkspaceConfigCard workspace={workspace} specWs={specWs} myBinding={myBinding} boundDaemon={boundDaemon} isOwner={isOwner} onRefresh={load} />`；保留共享 state（workspace/specWs/myBinding/boundDaemon/boundDaemonProviders/boundRuntime/componentCount/...）（覆盖：FR-003, D-003@V1）
- [x] task-08: 写 `workspace-config-card.test.tsx`（6 状态分支 + 编辑就地展开/保存/收起 + server-local 隐藏 + cache_root tooltip 文案 + 操作按钮行为含轮询/卸载清理/visibilitychange）（覆盖：FR-006, FR-007, FR-008, NFR-01, NFR-03）
- [x] task-09: 更新 `page.test.tsx` 适配新结构（断言无"规范管理"区 + `<WorkspaceConfigCard>` 渲染 + 其他区块行为不变）（覆盖：FR-003, NFR-05）

## 验收

- **AC-01**：详情页原"规范管理（Spec Workspace）"SectionCard 不再渲染；同一位置渲染"我的工作区配置"卡（FR-003 / SC-3）
- **AC-02**：daemon-client 工作区详情页，卡片完整展示「我的接入」5 字段 +「工作区文档存储」7 字段，无需点击弹层（FR-001 / SC-1）
- **AC-03**：「工作区文档存储」组所有字段无编辑入口（FR-002 / SC-5）
- **AC-04**：守护进程本地缓存字段 tooltip 含 `~` 三平台（Windows/macOS/Linux）解释（FR-004 / SC-4）
- **AC-05**：6 状态分支正确渲染（loading 骨架 / error 重试 / 未绑定首次引导 / 已绑定未初始化 amber 徽标 / 已绑定已初始化 emerald 徽标 / server-local 隐藏 daemon+cache）（FR-006 / SC-3）
- **AC-06**：点击「编辑我的接入」就地展开表单（回填），保存后字段刷新 + 表单收起（FR-008 / SC-2）
- **AC-07**：初始化/扫描/同步/导入按钮在新卡片内行为与改造前等价（initPollRef/syncPollRef 轮询 + 409 重扫确认 + 状态反馈 + 卸载清理）（FR-007 / SC-6）
- **AC-08**：详情页其他区块（基本信息/默认智能体/Overview/Quick nav）行为不变，`page.test.tsx` 全绿（NFR-05 / SC-7）
- **AC-09**：新组件测试 `workspace-config-card.test.tsx` 全绿，覆盖六态 + 编辑流程 + server-local + 操作按钮（SC-8）
- **AC-10**：跨平台路径展示（Windows 反斜杠 / POSIX）+ 中文 UI + 无障碍 tooltip（NFR-01/02/03）

## 覆盖矩阵

| ID | 覆盖任务 | 验收证据 |
|---|---|---|
| D-001@V1（数据源 backend DB） | task-02, task-03 | AC-02（字段来自 my-binding + spec-workspace API） |
| D-002@V1（spec_root/runtime_root 只读） | task-03, task-04 | AC-03（共享组无编辑入口；编辑限定 my-binding 三字段） |
| D-003@V1（卡片位置=升级规范管理区） | task-07 | AC-01（替换 page.tsx 第 598-825 行） |
| D-004@V1（缓存路径展示+tooltip） | task-03 | AC-04（cache_root 约定模板 + ~ 三平台 tooltip） |
| D-005@V1（独立单组件） | task-01 | AC-02 + task-01（WorkspaceConfigCard 单组件 + props） |
