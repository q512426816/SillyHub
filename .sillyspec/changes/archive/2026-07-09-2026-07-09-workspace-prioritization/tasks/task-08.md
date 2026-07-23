---
id: task-08
title: 新建 frontend/src/components/workspace-switcher.tsx — 当前 ws 名 + daemon 徽标 + 下拉切同模块 + 未绑定项触发弹窗 + 平台页引导态
title_zh: 顶栏工作区切换器组件
author: qinyi
created_at: 2026-07-09 22:47:13
status: pending
priority: P0
wave: 3
depends_on: [task-03, task-04, task-06]
blocks: [task-09]
allowed_paths:
  - frontend/src/components/workspace-switcher.tsx
covers:
  - FR-04
  - D-002
  - D-005
---

# TaskCard — 顶栏工作区切换器组件

> 设计依据：`design.md` §5 P4 / §7 `WorkspaceSwitcher` 接口 / §11 D-002@v1 D-005@v1
> 原型参照：`prototype-workspace-prioritization.html` 画面②（顶栏切换器下拉）+ 画面③（未绑定弹窗触发）
> 接入位置参照：`frontend/src/components/top-bar.tsx`（左侧面包屑前，由 task-09 接入）

## 目标

新建顶栏全局工作区切换器组件，作为登录后「顶层会话」的可视入口：常驻顶栏显示当前工作区名 + daemon 在线徽标，下拉快速切换到同模块的其他工作区。

## provides

- `WorkspaceSwitcher` 组件（默认导出 + 命名导出），签名 `function WorkspaceSwitcher(): JSX.Element`
- 内部状态：下拉开合、未绑定弹窗目标 workspaceId

## expects_from（依赖上游契约）

| 来源 | 契约 | 用途 |
|---|---|---|
| task-03 `lib/workspace-daemon-status.ts` | `useDaemonStatusMap(): Record<workspace_id, {online:boolean, daemon_id:string\|null}>` | 下拉每项 + 当前项的 daemon 徽标（绿=在线/红=离线/黄=未绑定） |
| task-04 `lib/use-workspace-context.ts` | `useWorkspaceContext(): {workspaceId, current, switchWorkspace}` | 取当前 ws（`current` 为 store 缓存，可能 null）+ `switchWorkspace(targetId)` 切同模块（D-002，保留模块段截断子路径） |
| task-06 `components/workspace-binding-dialog.tsx` | `<WorkspaceBindingDialog workspaceId open onBound onClose />` | 未绑定项点击触发弹窗（D-003），`onBound` 回调刷新列表后可继续进入 |

工作区列表来源：复用现有 `fetchMyBindings`（React Query，task-03 已批量聚合），按 workspace_id 索引；本任务不新增数据请求。

## 实现要点

1. **触发按钮**：参考原型画面② `.switcher-btn` —— 左侧 daemon 状态圆点徽标（消费 task-03）+ 当前 ws 名（粗体）+ 下拉箭头。使用 shadcn `DropdownMenu`（`ui/dropdown-menu.tsx`，复用 `DropdownMenuTrigger/Content/Item`）。
2. **平台页引导态**（D-005 / R-03）：`useWorkspaceContext().workspaceId === null`（平台页 `/admin` `/ppm` 等，无 wsId）时，按钮退化为「选择工作区」引导态（灰底 + 箭头），下拉打开后仍可挑工作区进入；**不阻断**当前页面渲染。
3. **daemon 离线不阻断**（D-005）：离线项仍可点击进入，仅徽标标红；进入后由各功能页自判依赖（本组件不做禁用/拦截）。
4. **下拉项分组**（参照原型 `.mhead` + `.mitem`）：
   - 「最近使用」分组（前 N 条，按最近活跃；若无活跃记录来源则退化为「全部」单组）
   - 「全部工作区」分组
   - 每项：ws 名（左）+ daemon 徽标（右：在线/离线/未绑定）
   - 当前 ws 项高亮（`.current` 蓝底）
   - 未绑定项点击 → `setBindingTarget(ws.id)` 打开 `WorkspaceBindingDialog`，**不**调 `switchWorkspace`
   - 已绑定项点击 → `switchWorkspace(ws.id)`（D-002，task-04 负责路径重写）
   - 末尾「查看全部工作区 →」跳 `/workspaces` 选择器页
5. **样式**：遵循 `frontend-style-system` token（color/radius/shadow），与 `top-bar.tsx` 现有视觉一致（slate 文字、border-slate-200、hover:border-blue-400）。

## 边界与不做

- ❌ 不实现 `switchWorkspace` 路径解析（task-04 职责，本组件只调用）
- ❌ 不实现 daemon 状态聚合（task-03 职责，本组件只消费 `useDaemonStatusMap`）
- ❌ 不重写绑定表单（task-06 包裹 `WorkspaceAccessGuide`，本组件只控制弹窗 open/target）
- ❌ 不改 `top-bar.tsx` 接入（task-09 职责）

## 验收标准

- [ ] 已绑定 ws 项点击 → 跳目标 ws 同模块（`A/changes → B/changes`，AC-4）
- [ ] 未绑定 ws 项点击 → 弹 `WorkspaceBindingDialog`（AC-5），绑定成功回调后切进入
- [ ] daemon 离线项可点击进入，仅徽标标红（AC-6，D-005）
- [ ] 平台页（无 wsId）显示「选择工作区」引导态，不阻断页面（R-03）
- [ ] 当前 ws 名 + daemon 徽标正确显示（AC-3）
- [ ] `pnpm typecheck` 通过
- [ ] `pnpm test` 新增组件单测通过（下拉项渲染、平台页引导态分支、未绑定点击触发弹窗）；现有测试零回归

## 风险与注意

- task-03/task-04/task-06 未就绪时本任务无法联调，mock 上游契约先写组件骨架 + 单测。
- daemon 徽标三态映射（online→绿 / daemon_id 存在但 offline→红 / daemon_id=null→黄未绑定）需与 task-03 输出形状对齐，联调时核实。
