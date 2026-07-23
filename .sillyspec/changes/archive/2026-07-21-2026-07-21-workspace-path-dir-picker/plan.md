---
author: qinyi
created_at: 2026-07-21T11:15:00
plan_level: light
---
# 轻量计划（Light Plan）：workspace 路径输入改弹窗式选目录

## 来源
brainstorm 变更 `2026-07-21-workspace-path-dir-picker`：把 /workspaces 两处路径输入（添加工作区 + 我的接入-本地项目路径）统一改成 `RemoteFolderPicker` 弹窗式选目录，复用现成组件，纯前端后端零改。详见 changeDir 下 `design.md` §5 + `tasks.md` + `decisions.md`。

## 范围
- `frontend/src/components/workspace-path-picker.tsx`（新建公共组件）
- `frontend/src/components/workspace-access-guide.tsx`（改：本地项目路径 Input → WorkspacePathPicker）
- `frontend/src/components/workspace-scan-dialog.tsx`（改：DaemonDirBrowser 内联 + fallback + 自有解析 → WorkspacePathPicker）
- `frontend/src/components/__tests__/workspace-path-picker.test.tsx`（新建测试）
- `frontend/src/components/__tests__/workspace-access-guide.test.tsx`（改测试）
- 模块：frontend（单模块），后端零改

## Tasks
- [x] task-01: 新建 `WorkspacePathPicker` 公共组件（路径 Input + 浏览按钮 + `RemoteFolderPicker` 弹窗 + daemonId→runtimeId 解析 useEffect 调 listDaemonRuntimes find online + canBrowse 禁用提示「请先选择在线守护进程」+ initialPath 回填）（覆盖：FR-1, D-001, D-002, D-003, D-004）
- [x] task-02: 新建 `workspace-path-picker.test.tsx`（canBrowse 判定 daemonId 空/离线/在线 mock / 浏览按钮禁用态 / onPick 回填 + 弹窗关闭 / Input 手输 onChange）（覆盖：FR-1, FR-4, FR-5）— 依赖 task-01
- [x] task-03: 改 `workspace-access-guide.tsx` 本地项目路径（179-190）→ `<WorkspacePathPicker daemonId value onChange>`（覆盖：FR-2, D-002）— 依赖 task-01，与 task-04 并行
- [x] task-04: 改 `workspace-scan-dialog.tsx`：DaemonDirBrowser 内联(142-148) + fallback Input(149-170) + browseRuntimeId state(38) + 解析 useEffect(55-69) → `<WorkspacePathPicker>`，清理 import（DaemonDirBrowser / listDaemonRuntimes 按用况清理；normalizeClientPath 保留——scan-dialog onChange 仍包 normalizeClientPath(p) 保持现有路径规范化语义，design §5.3 / R-4）（覆盖：FR-3, D-005）— 依赖 task-01，与 task-03 并行
- [x] task-05: 更新 `workspace-access-guide.test.tsx`（root_path 渲染 WorkspacePathPicker，mock listDaemonRuntimes，手输 + 保存流程不变）（覆盖：FR-2）— 依赖 task-03
- [x] task-06: scan-dialog 测试（如存在）更新 DaemonDirBrowser 断言 → WorkspacePathPicker；无则跳过（覆盖：FR-3）— 依赖 task-04
- [x] task-07: 自检 `vitest` 相关测试全绿 + `tsc --noEmit` exit 0（覆盖：AC-6）— 依赖 task-02/05/06
- [ ] task-08: e2e/手动 AC-7：`workspace-binding-dialog`（Radix Dialog）内首次绑定，点浏览 → 弹窗正常开关/选目录/回填，关浏览不连带关外层 Radix Dialog（覆盖：AC-7, B-002）— 最后

## 验收
- AC-1：添加工作区选在线守护进程 → 浏览弹窗选目录 → 创建成功
- AC-2：我的接入首次绑定/编辑选在线守护进程 → 浏览弹窗选目录 → 保存成功
- AC-3：守护进程未选/离线/无在线 runtime → 浏览按钮禁用 + 提示，仍能手输路径保存
- AC-4：两处体验一致（弹窗式），对齐 /runtimes 可写目录
- AC-5：Input 始终可手输（离线场景不卡死）
- AC-6：vitest 相关测试全绿 + tsc --noEmit exit 0
- AC-7：workspace-binding-dialog（Radix Dialog）内嵌首次绑定的 antd-Modal-in-Radix-Dialog 嵌套 e2e 正常

## 覆盖矩阵
| ID | 覆盖任务 | 验收证据 |
|---|---|---|
| D-001 弹窗式（RemoteFolderPicker） | task-01 | AC-1 / AC-2 / AC-4 |
| D-002 抽公共组件 WorkspacePathPicker | task-01, task-03, task-04 | AC-4 |
| D-003 手输常驻 + 浏览禁用提示 | task-01 | AC-3 / AC-5 |
| D-004 daemonId→runtimeId 解析收进组件 | task-01 | task-01 内部 useEffect |
| D-005 不删 DaemonDirBrowser 文件 | task-04 | task-04 仅移除 scan-dialog 引用，不删组件文件 |
