---
author: qinyi
created_at: 2026-07-21T10:53:07
---
# 任务（Tasks）— workspace 路径输入改弹窗式选目录

> 初稿。Wave 分组与依赖由 plan 阶段（`sillyspec run plan`）正式确定。

- [ ] **task-01**：新建 `WorkspacePathPicker` 组件（`frontend/src/components/workspace-path-picker.tsx`）：Input + 浏览按钮 + RemoteFolderPicker 弹窗 + daemonId→runtimeId 解析（useEffect 调 listDaemonRuntimes find online，复刻 scan-dialog:55-69）+ canBrowse 禁用逻辑。D-001/D-002/D-004。
- [ ] **task-02**：新建 `workspace-path-picker.test.tsx`：canBrowse 判定（daemonId 空/离线/在线 mock）/ 浏览按钮禁用态 / onPick 回填 + 弹窗关闭 / Input 手输 onChange。
- [ ] **task-03**：改 `workspace-access-guide.tsx`：本地项目路径 Input（179-190）→ `WorkspacePathPicker`。爆炸半径：组件内部闭合，4 个调用点（binding-dialog / config-card 等）自动继承。D-002。
- [ ] **task-04**：改 `workspace-scan-dialog.tsx`：DaemonDirBrowser 内联（142-148）+ fallback Input（149-170）+ browseRuntimeId state（38）+ 解析 useEffect（55-69）→ `WorkspacePathPicker`；清理 import（DaemonDirBrowser / listDaemonRuntimes / normalizeClientPath 按 lint 用况）。R-1：browseRuntimeId 两处读取（142 正向 + 149 反向）皆随 §5.3 移除，删除安全。
- [ ] **task-05**：更新 `workspace-access-guide.test.tsx`：root_path 字段渲染 WorkspacePathPicker（mock listDaemonRuntimes），手输 + 保存流程不变。
- [ ] **task-06**：scan-dialog 测试（如存在）更新 DaemonDirBrowser 断言 → WorkspacePathPicker；无则跳过。
- [ ] **task-07**：自检 `vitest` 相关测试全绿 + `tsc --noEmit` exit 0。
- [ ] **task-08**（e2e/手动，AC-7 / B-002）：`workspace-binding-dialog`（Radix Dialog）内首次绑定，点浏览 → RemoteFolderPicker 正常开关/选目录/回填，且关浏览不连带关外层 Radix Dialog（焦点陷阱/遮罩不串扰）。
