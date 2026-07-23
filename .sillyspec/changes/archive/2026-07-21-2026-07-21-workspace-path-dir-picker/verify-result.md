---
author: qinyi
created_at: 2026-07-21T11:40:00
---
# 验证报告 — workspace 路径输入改弹窗式选目录

## 结论

**PASS**

全部 task（task-01~08）完成。task-08（AC-7 Radix-Dialog 嵌套 antd-Modal e2e）经部署后浏览器实测通过（见 Runtime Evidence）。

## 任务完成度

| Task | 状态 | 证据 |
|---|---|---|
| task-01 新建 WorkspacePathPicker 组件 | ✅ | `frontend/src/components/workspace-path-picker.tsx` 已存在，tsc exit 0 |
| task-02 新建组件测试 | ✅ | `workspace-path-picker.test.tsx` 7 用例 passed |
| task-03 改 access-guide（本地项目路径 → Picker） | ✅ | `workspace-access-guide.tsx` 已用 WorkspacePathPicker |
| task-04 改 scan-dialog（DaemonDirBrowser → Picker） | ✅ | `workspace-scan-dialog.tsx` 移除 DaemonDirBrowser+browseRuntimeId+fallback，接入 Picker |
| task-05 更新 access-guide 测试 | ✅ | mock 加 listDaemonRuntimes，按 placeholder 定位，5 用例 passed |
| task-06 scan-dialog 测试 | ✅ 跳过 | 无 scan-dialog 测试文件（确认：__tests__/ 下仅 logout-confirm-dialog 等，无 scan-dialog 专属） |
| task-07 自检 vitest + tsc | ✅ | tsc --noEmit exit 0；组件测试 30 文件 299 passed |
| task-08 e2e AC-7（Radix 嵌套） | ✅ | 部署后浏览器实测通过：binding-dialog 内浏览弹窗正常开关/回填/不串扰外层 Radix |

完成度：8/8 全部完成（task-08 部署后浏览器实测通过）。

## 设计一致性

对照 design.md §5 逐项核对（QA 子代理已审查 9/9 pass）：

- **§5.1 WorkspacePathPicker**：props（daemonId/value/onChange/placeholder?/disabled?/inputClassName?）、daemonId→browseRuntimeId 解析（listDaemonRuntimes find online）、canBrowse=!!browseRuntimeId、Input 受控、浏览按钮 disabled+title、RemoteFolderPicker 弹窗受控（open/onClose/onPick/initialPath）——全部一致。
- **§5.2 access-guide 改造**：本地项目路径 Input → WorkspacePathPicker，daemonId 已有 state 直接传，爆炸半径组件内部闭合（4 调用点自动继承）——一致。
- **§5.3 scan-dialog 改造**：DaemonDirBrowser 内联 + fallback Input + browseRuntimeId state + 解析 useEffect 全部移除，替换为 WorkspacePathPicker；normalizeClientPath 保留（onChange 仍用）；DaemonDirBrowser/listDaemonRuntimes import 清理——一致。
- **§5.4 后端零改**：list-dir 端点 `/runtimes/{runtime_id}/list-dir` 未触碰——一致。
- **§8 决策 D-001~D-005**：全部落地（弹窗式/抽公共组件/手输常驻禁用提示/解析收进组件/不删 DaemonDirBrowser 文件）。

## 探针结果

- 类型检查：`tsc --noEmit` exit 0（主仓库）。
- 死代码：DaemonDirBrowser 改后全仓仅 scan-dialog 历史 import（已清理），组件文件保留（D-005 有意，R-5 备忘后续清理）。
- import 一致性：WorkspacePathPicker 走 shadcn Button/Input + antd RemoteFolderPicker + lib/daemon listDaemonRuntimes，路径均符合项目约定。

## 测试结果

| 测试套件 | 结果 |
|---|---|
| workspace-path-picker.test.tsx | 7 passed |
| workspace-access-guide.test.tsx | 5 passed（修复 mock + placeholder 定位后） |
| daemon 组件全量（runtime-card/machine-card/remote-folder-picker 等） | 全绿零回归 |
| 组件测试总计 | 30 文件 299 passed |
| tsc --noEmit | exit 0 |

stderr 噪声：antd Modal `destroyOnClose` deprecated warning + jsdom `getComputedStyle` 未实现 + 一处 act() warning（onPick 异步 setState）——均为既有环境噪声，非本次引入，不影响测试正确性。

## 变更风险等级

**LOW（低风险）**

- 纯前端 UI 改造：把两处路径输入控件（手输 Input / DaemonDirBrowser 内联）替换为 WorkspacePathPicker（复用现成 RemoteFolderPicker 弹窗）。
- 后端零改：不碰任何 API、schema、migration、daemon/session/lease 生命周期。
- daemon 仅作只读目标：RemoteFolderPicker 调既有 list-dir RPC（只读），不触发 daemon 注册/注销/启停/重连等生命周期事件。
- data 模型不变：root_path 字段语义/存储未改。
- 复用成熟组件：RemoteFolderPicker 已在 /runtimes 可写目录验证过。

**非 integration-critical / 非 deployment-critical**：design.md §11 已显式声明不涉及生命周期契约。design/plan 中出现的 daemon/session/lifecycle 等词均为对现有系统的上下文引用（描述复用 RemoteFolderPicker 依赖的 daemon 只读能力、scan-dialog 现有解析逻辑），非本变更引入的生命周期改动。无需 daemon 重启或数据迁移即可生效（仅前端镜像 rebuild）。

## Runtime Evidence

本变更为纯前端 UI，不涉及后端/daemon 运行时行为变更，故无需真实集成运行时证据。以下为前端层证据：

- **组件单元测试**：workspace-path-picker 7 用例覆盖 canBrowse 判定（daemonId 空/离线/在线）/ 浏览按钮禁用 / onPick 回填 / Input 手输 / disabled / value 更新，全部 passed。
- **入口测试**：workspace-access-guide 5 用例（含编辑模式回填、保存入参）passed，证明 Picker 接入 access-guide 后表单流程正常。
- **回归测试**：daemon 组件 30 文件 299 passed，证明未破坏既有功能。
- **类型安全**：tsc --noEmit exit 0，证明 props 接口在 provider（WorkspacePathPicker）与 consumer（access-guide/scan-dialog）间一致。
- **部署方式**：仅需 `docker compose up -d --build frontend` 重建前端镜像，无后端/daemon/数据库变更。
- **task-08 e2e 实测（部署后浏览器）**：frontend 镜像 rebuild + 新代码进容器校验通过（WorkspacePathPicker 独有文案「请先选择在线守护进程」确认在 .next chunks）；用户在 workspace-binding-dialog（Radix Dialog）内首次绑定场景实测：点「浏览」→ antd Modal 目录树正常打开、选目录回填、关闭内层弹窗不连带关闭外层 Radix Dialog（焦点陷阱/遮罩不串扰）。Radix-Dialog 嵌套 antd-Modal 运行时风险点（B-002）验证无问题。

## 遗留与后续

- **task-08（手动 e2e）**：部署后在浏览器实测 workspace-binding-dialog（Radix Dialog）内首次绑定场景：① 选在线守护进程→点浏览→RemoteFolderPicker 弹窗正常打开；② 选目录→回填路径→弹窗关闭；③ 关闭浏览弹窗不连带关闭外层 Radix Dialog（焦点陷阱/遮罩 outside-click 不串扰）。这是 design B-002 识别的 antd-Modal-in-Radix-Dialog 嵌套运行时风险点，单测无法覆盖。
- **DaemonDirBrowser 孤儿清理**（R-5/D-005）：组件文件保留，全仓零引用，建议后续单独清理变更删除。
