---
schema_version: 1
doc_type: module-card
module_id: components-workspace-config
author: qinyi
created_at: 2026-08-18 01:45:00
---

# 工作区绑定配置组件（components-workspace-config）

## 定位
工作区绑定/配置/守卫域组件（7 文件，`components/` 根目录）：
- 成员 daemon 绑定表单：`WorkspaceAccessGuide`（+ `WorkspacePathPicker` 路径选择）。
- 绑定守卫与弹窗壳：`WorkspaceBindingGuard` / `WorkspaceBindingDialog`。
- 工作区概览配置大卡：`WorkspaceConfigCard`（901 行）。
- 顶栏全局切换器：`WorkspaceSwitcher`。
- daemon 依赖功能内联空态：`DaemonRequiredNotice`。

核心演进是 2026-07-26-ungate-workspace-entry 的"门禁后移"：进门不再强制绑定 daemon，配置引导后移到概览页与具体功能点。

## 契约摘要
- `WorkspaceAccessGuide`：props `{ workspaceId, onConfigured, initial? }`。
  - 成员配置自己的 daemon + 本地根路径：`listDaemonInstances()` + `WorkspacePathPicker`。
  - daemon 下拉是守护进程实体维度——一个 daemon 一项（含其全部 providers），online 排前、同级按 hostname 稳定排序。
  - 提交 `upsertMyBinding`；daemon_id 可空（提交 null），root_path 必填。
  - `initial: AccessGuideInitial { daemon_id, root_path }` 传入即编辑模式（回填 + 文案切「编辑」）；不传为首次绑定模式。
  - 绑定维度是 daemon_id（守护进程实体，2026-07-03-daemon-entity-binding D-004，不再按 runtime/provider 维度选）。
- `WorkspaceBindingGuard`：props `{ workspaceId }`。
  - 查 `fetchMyBinding`：bound → 渲染「编辑我的接入配置」入口按钮，点击展开 AccessGuide 编辑模式，保存成功收起并刷新；unbound → return null（门禁后移 D-004，引导交给概览页 WorkspaceConfigCard）。
  - loading 态返回 null 不闪烁。
- `WorkspaceConfigCard`：props `{ workspace, specWs, myBinding, boundDaemon, isOwner, onRefresh, componentCount? }`（901 行），工作区概览配置中枢。
  - spec 同步状态四态：pending 待同步 / clean 已同步 / dirty 有变更未同步 / conflicted 存在冲突（`SYNC_STATUS_VARIANT/LABEL`）。
  - 策略三档：platform-managed 平台托管 / repo-mirrored 仓库镜像 / repo-native 仓库原生（`STRATEGY_LABEL`）。
  - 导入八阶段中文映射（`IMPORT_PHASE_LABEL`）：packing 打包中 → packed 已打包 → applying 落盘中 → reparsing_docs 解析文档 → reparsing_changes 解析变更 → done 完成 / error 失败。
  - 动作链（lib-spec-workspaces / lib-workspaces）：`getSpecWorkspace` / `importSpecWorkspace` / `initDispatch` / `listPendingSync` / `syncManual` / `generateProjects` / `scanGenerate`。
  - 内嵌 `AgentRunPanel`（agent 运行区）与 `WorkspaceAccessGuide`（未绑定/编辑绑定引导）。
  - lender 位渲染 `SharedDaemonToggle`（「我的接入」下方，仅 myBinding 存在时有意义）。
  - `componentCount` 由 page 注入（Workspace 类型无此字段），门禁「同步到服务器」按钮与三态引导消费。
  - CACHE_ROOT_TOOLTIP 解释守护进程本地缓存 `~` 的三平台路径。
- `WorkspaceSwitcher`：顶栏全局工作区切换器（2026-07-09-workspace-prioritization）——登录后「顶层会话」的可视入口。
  - `useWorkspaceContext()`（switchWorkspace；注意 `current.name` 为空串，由本组件用列表数据补全 fillCurrentName）。
  - `useDaemonStatusMap()`（30s 轮询驱动徽标）+ `listWorkspaces`/`fetchMyBindings` 建 id→name 与 binding 映射。
  - 未绑定项点击 → `WorkspaceBindingDialog`（onBound 回调 → 绑定成功 → 切进入，D-003）。
  - 切同模块保留模块段（D-002）；daemon 离线仅标红不阻断（D-005）。
- `WorkspaceBindingDialog`：受控弹窗壳（76 行），包裹 AccessGuide，供切换器未绑定场景。
- `WorkspacePathPicker`：props `{ daemonId, value, onChange, placeholder?, disabled?, inputClassName? }`。
  - 受控 Input + 「浏览」按钮 → `RemoteFolderPicker`（daemon 远程目录浏览，components-daemon 域）；内部解析 daemonId→browseRuntimeId（`listDaemonRuntimes`）。
- `DaemonRequiredNotice`：props `{ feature, workspaceId, canBorrow, onConfigured? }`。
  - daemon 依赖功能（运行时/扫描文档/组件拓扑等）主区的内联空态——非阻断，仅替换该功能主区，页面其余部分正常。
  - [配置我的守护进程] 内联展开 AccessGuide 首次绑定模式，成功后 `onConfigured` 让调用方刷新 binding。
  - canBorrow=true 额外提示已有借用能力可去 Agent 页触发借用（判定 `canBorrowSharedDaemon` 由调用方算好传入）。

## 关键逻辑
```
门禁后移后的三层引导:
  进门:   BindingGuard unbound → null（不阻断）
  概览:   WorkspaceConfigCard 承接可选配置引导（未绑定渲染 AccessGuide）
  功能点: DaemonRequiredNotice 替换依赖 daemon 的主区（非阻断）

绑定维度: daemon_id（守护进程实体）+ root_path 必填
  daemon_id 可 null（不绑 daemon 仅记路径）

WorkspaceSwitcher: 未绑定项点击 → BindingDialog(open, target)
  → onBound → switchWorkspace（切同模块保留模块段）
```

## 注意事项
- WorkspaceConfigCard 是全模块最重组件（901 行），改动前先分清两套映射常量：spec 同步状态机（SYNC_STATUS_*）与导入阶段机（IMPORT_PHASE_LABEL）。
- `useWorkspaceContext().current.name` 是空字符串（上游留空），Switcher 用列表数据补全，勿依赖 context name。
- BindingGuard 的 unbound 分支 return null 是刻意设计（门禁后移 FR-02/D-004），勿"修复"成阻断表单。
- AccessGuide 编辑/首次两态差异全靠 `initial` prop 有无，文案/回填行为随之切换。
- PathPicker 的浏览能力依赖 daemon 在线；RemoteFolderPicker 属 components-daemon 域，本域只做封装。

## 人工备注

<!-- MANUAL_NOTES_START -->

<!-- MANUAL_NOTES_END -->
