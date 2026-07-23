---
author: qinyi
created_at: 2026-07-21T13:20:00
---
# 模块影响 — workspace 路径输入改弹窗式选目录

## 受影响模块

### frontend（主要）
- **新增** `src/components/workspace-path-picker.tsx`：公共组件，封装路径 Input + 浏览按钮 + RemoteFolderPicker 弹窗 + daemonId→runtimeId 解析 + 离线禁用。复用 `src/components/daemon/remote-folder-picker.tsx`（不修改）。
- **修改** `src/components/workspace-access-guide.tsx`：「我的接入-本地项目路径」纯手输 Input → WorkspacePathPicker。
- **修改** `src/components/workspace-scan-dialog.tsx`：「添加工作区」DaemonDirBrowser 内联面板 + 自有 daemonId→runtimeId 解析 + 离线 fallback Input → WorkspacePathPicker（移除冗余，逻辑收进公共组件）。
- **新增** `src/components/__tests__/workspace-path-picker.test.tsx`：7 用例。
- **修改** `src/components/__tests__/workspace-access-guide.test.tsx`：mock 加 listDaemonRuntimes，按 placeholder 定位。
- 孤儿（保留）：`src/components/daemon-dir-browser.tsx` 改后全仓零引用，按 D-005 保留留待后续清理。

## 不受影响模块

- **backend**：零改（list-dir 端点 `/runtimes/{runtime_id}/list-dir` 已存在，前端走只读 RPC）。
- **sillyhub-daemon**：零改。
- **deploy / 数据库**：零改（无 schema/migration 变更，仅需 frontend 镜像 rebuild）。

## 契约变更

无。WorkspacePathPicker 是纯前端新增公共组件，props（daemonId/value/onChange/placeholder?/disabled?/inputClassName?）为组件内部契约，不影响 backend API 或 daemon protocol。

## 复用关系

- WorkspacePathPicker → RemoteFolderPicker（弹窗）→ lib/daemon listDir/listRoots → backend `/runtimes/{runtime_id}/list-dir`（只读）。
- WorkspacePathPicker → lib/daemon listDaemonRuntimes（daemonId→runtimeId 解析，复刻 scan-dialog 原逻辑）。

## 风险

LOW。纯前端 UI 改造，无后端/daemon/数据/生命周期变更。task-08（Radix-Dialog 嵌套 antd-Modal）部署后浏览器实测通过。
