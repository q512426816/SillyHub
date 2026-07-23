---
author: qinyi
created_at: 2026-07-21T10:53:07
---
# 决策（Decisions）— workspace 路径输入改弹窗式选目录

## D-001: 弹窗式（RemoteFolderPicker）而非内联式（DaemonDirBrowser）
- priority: P1
- status: accepted
- source: 用户确认（AskUserQuestion）
- 决策：两处路径输入统一用 `RemoteFolderPicker` 弹窗式选目录。
- 理由：用户参考 `/runtimes` 可写目录体验；紧凑表单里弹窗比内联面板省空间；两处统一。

## D-002: 抽公共组件 WorkspacePathPicker
- priority: P1
- status: accepted
- source: 用户确认（AskUserQuestion）
- 决策：新建 `WorkspacePathPicker` 封装 Input + 浏览按钮 + 弹窗 + daemonId→runtimeId 解析 + 禁用逻辑，access-guide + scan-dialog 两处复用。
- 理由：两处逻辑重复度高（解析 + 弹窗受控 + 禁用），DRY 降低不一致风险，契合"统一"诉求。

## D-003: 手输 Input 始终保留 + 浏览按钮禁用提示
- priority: P1
- status: accepted
- source: 用户确认（AskUserQuestion）
- 决策：Input 始终可手输；浏览按钮守护进程可用时可点弹窗、不可用禁用 + tooltip「请先选择在线守护进程」；离线/未选守护进程仍能手输。
- 理由：离线场景需能填路径；禁用 + 提示比隐藏按钮稳定（用户知道功能存在）。

## D-004: daemonId→runtimeId 解析收进组件内部
- priority: P2
- status: accepted
- source: design
- 决策：解析逻辑（复刻 scan-dialog:55-69 的 listDaemonRuntimes find online）放 `WorkspacePathPicker` 内部 useEffect，不抽 lib hook。
- 理由：逻辑简单（一个 useEffect），YAGNI。

## D-005: 不删除 DaemonDirBrowser 组件文件
- priority: P2
- status: accepted
- source: design
- 决策：仅 scan-dialog 不再用 `DaemonDirBrowser`，组件文件保留。
- 理由：避免超 scope；删除需全仓核实零引用（已证 scan-dialog.tsx:7,143 唯二引用，改后成孤儿），留待后续清理（见 design R-5）。

## Design Grill 吸收的 P2 修正（不新增决策，记录修正点）
- R-1 措辞修正：browseRuntimeId 在 scan-dialog 被 line 142（正向门控 DaemonDirBrowser）+ line 149（反向门控 fallback Input）两处读取，§5.3 两者皆移除故 state 可安全删除。
- 新增 AC-7：`workspace-binding-dialog`（Radix Dialog）内首次绑定的 antd-Modal-in-Radix-Dialog 嵌套 e2e（B-002）。
- 新增 R-5：DaemonDirBrowser 改后成孤儿，建议后续清理变更统一删除（B-003）。
