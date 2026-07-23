---
author: qinyi
created_at: 2026-07-21T10:53:07
---
# 需求（Requirements）— workspace 路径输入改弹窗式选目录

## 功能需求（FR）
- **FR-1**：新建 `WorkspacePathPicker` 公共组件，封装路径 Input + 浏览按钮 + `RemoteFolderPicker` 弹窗 + daemonId→runtimeId 解析 + 离线禁用。
- **FR-2**：`WorkspaceAccessGuide`「本地项目路径」改用 `WorkspacePathPicker`（替代纯手输 Input）。
- **FR-3**：`WorkspaceScanDialog`「使用本机守护进程上的项目路径」改用 `WorkspacePathPicker`（替代 DaemonDirBrowser 内联 + fallback Input + 自有解析）。
- **FR-4**：守护进程在线（有 online runtime）时浏览按钮可点 → 弹窗选目录 → 选中回填；未选/离线/无在线 runtime 时按钮禁用 + tooltip「请先选择在线守护进程」。
- **FR-5**：路径 Input 始终可手输（离线/未选守护进程仍能填路径并保存）。

## 非功能需求（NFR）
- **NFR-1**：复用现成 `RemoteFolderPicker`，不新造目录浏览逻辑。
- **NFR-2**：纯前端，后端零改。
- **NFR-3**：两处入口体验一致，对齐 `/runtimes` 可写目录。
- **NFR-4**：中文文案。

## 验收标准（AC）
AC-1 ~ AC-7（详见 design.md §7）。核心：
- AC-1/AC-2：两处选在线守护进程 → 浏览弹窗选目录 → 创建/保存成功。
- AC-3：守护进程不可用 → 浏览禁用 + 提示，但仍能手输保存。
- AC-5：Input 始终可手输。
- AC-7：`workspace-binding-dialog`（Radix Dialog）内首次绑定，浏览弹窗正常开关回填，关浏览不连带关外层 Radix Dialog。
