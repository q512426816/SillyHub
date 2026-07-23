---
author: qinyi
created_at: 2026-07-21T10:53:07
---
# 提案（Proposal）— workspace 路径输入改弹窗式选目录

## 一句话
把 /workspaces 两处路径输入（添加工作区 + 我的接入-本地项目路径）统一改成 `RemoteFolderPicker` 弹窗式选目录，对齐 `/runtimes` 可写目录体验。

## 背景
两处路径输入现状不一致且体验差：
- 添加工作区（`workspace-scan-dialog.tsx`）用 `DaemonDirBrowser` 内联面板，占表单空间、与可写目录弹窗体验不一致。
- 我的接入-本地项目路径（`workspace-access-guide.tsx:183`）纯手输 `<Input>`，易错、不能浏览守护进程机器实际目录。

`/runtimes` 可写目录已用成熟的 `RemoteFolderPicker`（antd Modal 弹窗 + 目录树懒加载）。

## 方案概要
新建公共组件 `WorkspacePathPicker`（Input + 浏览按钮 + RemoteFolderPicker 弹窗 + daemonId→runtimeId 解析 + 离线禁用），`access-guide` + `scan-dialog` 两处复用。纯前端，后端零改。

## 影响
- frontend：1 新组件（`workspace-path-picker.tsx`）+ 2 改入口（access-guide / scan-dialog）+ 2 测试
- backend：零改（list-dir 端点 `/runtimes/{runtime_id}/list-dir` 已存在）
- 数据：无 schema 变更

## 不在范围内（Non-Goals）
- 不改 `RemoteFolderPicker` 组件本身（复用现成）。
- 不改后端 list-dir 端点（已存在）。
- 不改 workspace 路径数据模型/存储（root_path 字段不变）。
- 不做路径有效性校验（浏览选定即有效，手输由后端 scan 校验）。
- 不删除 `DaemonDirBrowser` 组件文件（仅 scan-dialog 不再用，留待后续清理）。

## 关键决策
D-001 弹窗式 / D-002 抽公共组件 / D-003 手输常驻 + 浏览禁用提示（均用户 AskUserQuestion 确认）；D-004 解析收进组件；D-005 不删 DaemonDirBrowser（留待后续清理）。

## 验收
AC-1 ~ AC-7（详见 design.md §7），其中 AC-7 覆盖 `workspace-binding-dialog`（Radix Dialog）内嵌首次绑定的 antd-Modal-in-Radix-Dialog 嵌套 e2e。

## 下一步
`sillyspec run plan --change 2026-07-21-workspace-path-dir-picker`
