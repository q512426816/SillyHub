---
author: qinyi
created_at: 2026-07-21T10:18:00
scale: large
---

# 设计文档（Design）— workspace 路径输入改弹窗式选目录

## 1. 背景

/workspaces 相关的两处路径输入现状不一致且体验差：

- **添加工作区**（`workspace-scan-dialog.tsx`）：用 `DaemonDirBrowser` 内联面板选目录，内联面板占用表单空间大，且与 `/runtimes`「可写目录」的弹窗式体验不一致。
- **我的接入-本地项目路径**（`workspace-access-guide.tsx:183`）：纯手输 `<Input>`，用户必须手敲绝对路径，易出错（路径分隔符、拼写），且无法浏览守护进程机器上的实际目录。

`/runtimes` 页「可写目录」已用 `RemoteFolderPicker`（antd Modal 弹窗 + 目录树懒加载 + 地址栏跳转）实现了成熟的远程目录选择体验。本变更把上述两处路径输入统一改成复用 `RemoteFolderPicker` 的弹窗式选目录，与可写目录体验一致。

## 2. 设计目标

- G1：两处路径入口（添加工作区 + 我的接入-本地项目路径）统一为弹窗式选目录，对齐 `/runtimes` 可写目录体验。
- G2：复用现成 `RemoteFolderPicker`，不新造目录浏览组件。
- G3：路径输入框始终可手输；「浏览」按钮在守护进程可用时辅助选目录、不可用时禁用并提示；离线/未选守护进程仍能手输。
- G4：消除两处重复的 daemonId→runtimeId 解析逻辑，抽公共组件。
- G5：纯前端，后端零改。

## 3. 非目标

- N1：不改 `RemoteFolderPicker` 组件本身（复用现成）。
- N2：不改后端 list-dir 端点（已存在 `/runtimes/{runtime_id}/list-dir`）。
- N3：不改 workspace 路径的数据模型/存储（root_path 字段不变）。
- N4：不做路径有效性校验（是否真实存在）——浏览选定即视为有效，手输由后端 scan 时校验。
- N5：不处理 server-local 模式（已移除，见 2026-07-10-remove-server-local-workspace-mode）。
- N6：不删除 `DaemonDirBrowser` 组件文件（仅 scan-dialog 不再用，保留留待后续清理，避免超 scope）。

## 4. 拆分判断

小-中型变更（2 入口文件 + 1 新建公共组件 + 测试），不满足拆分条件（<3 模块、无多角色、无审批流），不满足批量模式（<10 任务、非模板×数据）。单变更推进。

## 5. 总体方案

### 5.1 核心组件：WorkspacePathPicker（新建）

文件：`frontend/src/components/workspace-path-picker.tsx`

封装「路径 Input + 浏览按钮 + RemoteFolderPicker 弹窗 + daemonId→runtimeId 解析 + 离线禁用」整套逻辑。

Props：

```ts
interface WorkspacePathPickerProps {
  daemonId: string;            // 当前选中守护进程 id（""=未选）
  value: string;               // 路径（受控）
  onChange: (path: string) => void;
  placeholder?: string;
  disabled?: boolean;          // 外部禁用（保存中）
  inputClassName?: string;     // 适配两处 Input 尺寸差异
}
```

内部状态与逻辑：

- `browseRuntimeId`：useEffect 监听 daemonId，调 `listDaemonRuntimes()`，`find(r => r.daemon_instance_id === daemonId && r.status === "online")`，取第一个的 id。daemonId 为空或无在线 runtime → `browseRuntimeId=""`。（复刻 `workspace-scan-dialog.tsx:55-69`）
- `canBrowse = !!browseRuntimeId`。
- `pickerOpen`：boolean，控制 RemoteFolderPicker 弹窗显隐。
- Input：受控 value/onChange，始终可编辑（disabled 仅由外部 disabled prop 控制）。
- 浏览按钮：`<Button>` 放 Input 右侧（flex 布局）。`canBrowse` → 可点，onClick `setPickerOpen(true)`；`!canBrowse` → disabled + `title="请先选择在线守护进程"`。
- RemoteFolderPicker：`runtimeId={browseRuntimeId}`、`open={pickerOpen}`、`onClose`、`onPick={(p)=>{onChange(p); setPickerOpen(false);}}`、`initialPath={value}`。

### 5.2 入口1：WorkspaceAccessGuide（修改）

文件：`frontend/src/components/workspace-access-guide.tsx`

- 移除 line 179-190 的「本地项目路径」纯 `<Input>`。
- 替换为 `<WorkspacePathPicker daemonId={daemonId} value={rootPath} onChange={setRootPath} placeholder="/Users/you/code/project" inputClassName="text-xs" />`。
- daemonId 已有（line 76 state，下拉选），无需新增解析。
- import `WorkspacePathPicker`；`Input` 若该文件他处不再用则按 lint 清理 import。
- 爆炸半径：`WorkspaceAccessGuide` 被多处复用（`workspace-binding-dialog` 首次绑定 / `workspace-config-card` 编辑态等），改动在组件内部闭合，所有调用点自动继承新 UI，无需逐点改。

### 5.3 入口2：WorkspaceScanDialog（修改）

文件：`frontend/src/components/workspace-scan-dialog.tsx`

- 移除 DaemonDirBrowser 内联面板（line 142-148）。
- 移除离线 fallback 手输 Input（line 149-170）——公共组件统一处理（Input 始终在，canBrowse 决定按钮）。
- 移除自有的 `browseRuntimeId` state（line 38）+ 解析 useEffect（line 55-69）——逻辑收进公共组件。
- 替换为 `<WorkspacePathPicker daemonId={daemonId} value={daemonRootPath} onChange={(p)=>setDaemonRootPath(normalizeClientPath(p))} placeholder="C:\\path\\to\\repo 或 /abs/path" inputClassName="text-sm" />`。
- 移除 `DaemonDirBrowser` import（line 7）；`listDaemonRuntimes` / `normalizeClientPath` 若不再用则清理 import。

### 5.4 后端：零改

list-dir 端点 `/api/daemon/runtimes/{runtime_id}/list-dir` 已存在（RemoteFolderPicker 调 listDir + listRoots）。无需新增/修改端点。

## 6. 文件变更清单

| 操作 | 文件路径 | 说明 |
|---|---|---|
| 新增 | frontend/src/components/workspace-path-picker.tsx | 公共组件：Input + 浏览按钮 + RemoteFolderPicker 弹窗 + daemonId→runtimeId 解析 + 离线禁用 |
| 修改 | frontend/src/components/workspace-access-guide.tsx | 本地项目路径 Input → WorkspacePathPicker |
| 修改 | frontend/src/components/workspace-scan-dialog.tsx | DaemonDirBrowser 内联 + fallback + 自有解析 → WorkspacePathPicker，移除冗余 |
| 新增 | frontend/src/components/__tests__/workspace-path-picker.test.tsx | 公共组件单测：canBrowse 判定 / 浏览禁用 / onPick 回填 / Input 手输 |
| 修改 | frontend/src/components/__tests__/workspace-access-guide.test.tsx | root_path 字段改用 WorkspacePathPicker |

## 7. 验收标准（AC）

- AC-1：添加工作区，选在线守护进程 → 点「浏览」弹目录树 → 选目录回填 → 创建工作区成功。
- AC-2：我的接入首次绑定/编辑，选在线守护进程 → 点「浏览」弹目录树选路径 → 保存成功。
- AC-3：守护进程未选/离线/无在线 runtime → 「浏览」按钮禁用 + tooltip「请先选择在线守护进程」，但仍能手输路径并保存。
- AC-4：两处路径输入体验一致（弹窗式），与 `/runtimes` 可写目录体验一致。
- AC-5：Input 始终可手输（离线场景不卡死）。
- AC-6：vitest 相关测试全绿 + `tsc --noEmit` exit 0。
- AC-7：`workspace-binding-dialog`（Radix Dialog）内嵌的首次绑定场景，点「浏览」→ antd Modal 弹窗正常开关、选中回填，且关闭浏览弹窗不会连带关闭外层 Radix Dialog（antd-Modal-in-Radix-Dialog 嵌套的焦点陷阱/遮罩 outside-click 不串扰）。e2e 验证。

## 8. 决策记录

- **D-001**：弹窗式（RemoteFolderPicker）而非内联式（DaemonDirBrowser）。理由：用户参考可写目录体验 + 紧凑表单里弹窗比内联面板省空间 + 两处统一。@用户确认
- **D-002**：抽公共组件 WorkspacePathPicker 而非两处各自内联。理由：两处逻辑重复度高（解析 + 弹窗受控 + 禁用）、用户诉求是"统一"、DRY 降低不一致风险。@用户确认
- **D-003**：手输 Input 始终保留 + 浏览按钮禁用提示（而非隐藏按钮或去掉手输）。理由：离线/未选守护进程场景仍需能填路径，禁用 + 提示比隐藏更稳定。@用户确认
- **D-004**：daemonId→runtimeId 解析复刻 scan-dialog:55-69，收进 WorkspacePathPicker 内部，不抽 lib hook。理由：逻辑简单（一个 useEffect），YAGNI。
- **D-005**：DaemonDirBrowser 组件文件保留不删（仅 scan-dialog 不再用）。理由：避免超 scope，删除需全仓核实零引用，留待后续清理。

## 9. 风险与边界

- R-1：scan-dialog 的 `browseRuntimeId` 有两处读取——line 142 正向门控 DaemonDirBrowser + line 149 反向门控 fallback Input。§5.3 两块（142-148 + 149-170）都移除后 state 零读者，删除安全。
- R-2：daemonId→runtimeId 解析是异步网络请求（listDaemonRuntimes），daemonId 切换时 browseRuntimeId 有短暂空窗——此期间浏览按钮禁用，用户等解析完成或手输。与 scan-dialog 现状一致，无新增风险。
- R-3：RemoteFolderPicker 是 antd Modal，在 WorkspaceAccessGuide（antd 风格）和 WorkspaceScanDialog（shadcn 风格）中均需正常渲染——antd Modal 全局可用（AntApp 已注入），无问题。
- R-4：normalizeClientPath 在 scan-dialog 的 onChange 中仍调用（保持现有路径规范化语义）；access-guide 侧 onChange 直接 setRootPath（无 normalize），保持现状不引入行为变化。
- R-5：改动后 `DaemonDirBrowser` 全仓零引用成孤儿（N6/D-005 有意保留）。建议后续单独清理：全仓核实零引用后删 `daemon-dir-browser.tsx` 及其 `__tests__`，不在本变更 scope 内。

## 10. 测试策略

- **workspace-path-picker.test.tsx（新建）**：
  - daemonId="" → canBrowse=false，浏览按钮禁用。
  - daemonId 有效 + mock listDaemonRuntimes 返回 online runtime → canBrowse=true，浏览按钮可点。
  - 点浏览 → RemoteFolderPicker 弹窗 open。
  - onPick 回调 → onChange 调用 + 弹窗关闭。
  - Input 手输 → onChange 调用。
- **workspace-access-guide.test.tsx（更新）**：root_path 字段渲染 WorkspacePathPicker（mock listDaemonRuntimes），手输 + 保存流程不变。
- **scan-dialog 测试（如有）**：DaemonDirBrowser 相关断言改为 WorkspacePathPicker。

## 11. 生命周期契约声明（豁免）

本变更**不涉及生命周期契约**，无需「生命周期契约表」（事件×状态转换矩阵）。理由：

- **纯前端 UI 改造**：把两处路径输入控件（手输 `<Input>` / `DaemonDirBrowser` 内联面板）替换为 `WorkspacePathPicker`（复用 `RemoteFolderPicker` 弹窗）。不新增/修改任何 `session`、`lease`、`agent_run`、`daemon_instance`、`daemon_runtime` 的状态机、事件转换或生命周期。
- **daemon 仅作只读目标**：`RemoteFolderPicker` 调 `listDir` / `listRoots` 拉取目录列表（只读 RPC），不触发 daemon 的注册/注销/启停/升级/重连/lease 续约等生命周期事件。
- **后端零改**：不动任何端点的生命周期语义；`list-dir` 端点（`/runtimes/{runtime_id}/list-dir`）已存在，本变更不碰。
- **daemonId→runtimeId 解析是前端只读查询**：`listDaemonRuntimes` 仅读取 runtime 列表找 online 项，不写 daemon/runtime 状态。

design.md 正文出现的 session / lease / agent_run / daemon / lifecycle 等词均为对现有系统的**上下文引用**（描述复用的 RemoteFolderPicker 所依赖的 daemon 读取能力、scan-dialog 现有解析逻辑等），非本变更引入的生命周期改动。故申请豁免生命周期契约表。

## 12. 自审

本 design 自审通过：
- **章节完整**：背景 / 目标 / 非目标 / 拆分判断 / 总体方案 / 文件清单 / AC / 决策 / 风险 / 测试 / 生命周期豁免 / 自审。
- **与用户确认一致**：3 次 AskUserQuestion 确认（弹窗式 D-001 / 抽公共组件 D-002 / 手输常驻 + 浏览禁用提示 D-003）。
- **行号引用真实**：经独立子代理逐行核实（scan-dialog:38/55-69/142-148/149-170、access-guide:76/179-190、RemoteFolderPicker 7 props、list-dir router.py:1323）。
- **Design Grill**：pass/pass，无 P0/P1 blocker；3 个 P2 gap 已吸收（R-1 措辞修正 / AC-7 嵌套 e2e / R-5 孤儿备忘）。
- **规模 large**，四件套齐全，可进入 plan。
