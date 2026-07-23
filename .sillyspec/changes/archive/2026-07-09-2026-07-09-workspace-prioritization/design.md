---
author: qinyi
created_at: 2026-07-09T22:35:00
scale: large
---

# 设计文档（Design）— 工作区前置化

> 变更 `2026-07-09-workspace-prioritization` · 方案 A（客户端守卫 + 顶栏切换器）
> 原型 `prototype-workspace-prioritization.html`

## 1. 背景

当前平台"工作区"只是侧边栏里一个与"变更/管理员权限"平级的普通菜单项（`menu-permissions.ts` 的"工作区首页"）。但事实上工作区（及其绑定的守护进程 daemon）是绝大多数功能的前置依赖——约 20 个菜单（变更/Agent/运行时/扫描/知识库/审批/故障/发布/审计/任务/组件等）在未进入工作区时全部灰显不可点（`app-shell.tsx:259-267`），daemon 绑定也是进入工作区后由 `WorkspaceBindingGuard` 事后引导。

问题：
1. **工作区定位低**：与功能菜单平级，没有体现"顶层会话"地位。
2. **无全局切换器**：切换工作区需退回列表页点卡片，顶栏（`top-bar.tsx`）不显示当前工作区。
3. **上下文无缓存**：当前工作区靠 `useWorkspaceId()` 正则解析 URL（`app-shell.tsx:104`），顶栏无法反映上下文。
4. **daemon 绑定是事后补救**：登录后落到标题页（`app/page.tsx`）→ 列表 → 进详情才弹绑定引导，守护进程不是和工作区一起建立的"前置会话"。

诉求：把"工作区+守护进程"提升为登录后的顶层会话——第一步进入工作区（含确认 daemon 绑定），再开放依赖工作区的功能菜单。

## 2. 设计目标

- **登录强制先选工作区**：未选时侧边栏只露全局菜单（平台管理/系统设置/PPM），但选择器页常驻后台旁路入口（不困住管理员，D-001）。
- **顶栏全局工作区切换器**：显示当前工作区名 + daemon 在线状态，切换时跳到新工作区同模块（D-002/D-005）。
- **落地页改选择器**：登录后直接进工作区选择器，取代双入口标题页。
- **daemon 绑定在选择器内完成**：未绑定的工作区点击弹绑定弹窗，绑好才进（D-003）。
- **URL 路径派生保持真相源**：store 仅缓存，深链/刷新天然工作（用户硬约束）。

## 3. 非目标

- ❌ 不改后端表结构/API（只读消费现有 `my-binding` 接口、daemon 实例在线状态）。
- ❌ 不引入 Next.js middleware（token 在 localStorage，middleware 读不到，改动过大，见 Step 8 方案对比）。
- ❌ 不改 `menu-permissions.ts` 菜单数据结构（继续用 `absolute` 标记区分平台级/工作区级）。
- ❌ 不做工作区级别的路由组重组（不移动 `/workspaces/[id]/*` 路由文件）。
- ❌ 不做移动端响应式（后台桌面为主）。
- ❌ 不改 daemon 生命周期/会话/lease 逻辑（daemon 在本次是只读状态消费方）。

## 4. 拆分判断

单一变更，不拆分、不批量。理由：3 个改造点（守卫+选择器、顶栏切换器、daemon 绑定弹窗）高度耦合，共享同一工作区上下文 store，不可独立交付。任务量约 6-8 个，无重复模式。拆分 4 条件（3+独立模块/3+角色/跨页面流转/低耦合）均不满足。

## 5. 总体方案（分 Phase，plan 细化为 Wave）

| Phase | 内容 | 类型 |
|---|---|---|
| P1 | 工作区上下文 store `stores/workspace.ts`（缓存当前 ws 对象，非 persist）+ `switchWorkspace` helper（切同模块 D-002） | 地基 |
| P2 | 工作区守卫 `(dashboard)/layout.tsx` 加同层守卫（无 wsId 且非白名单 → 重定向 `/workspaces`）+ 落地页 `app/page.tsx` 登录后重定向选择器 | 核心 |
| P3 | `/workspaces` 列表页改造为工作区选择器（后台旁路 D-001 + daemon 状态徽标强化 + 空状态创建引导 D-004） | 核心 |
| P4 | 顶栏 `WorkspaceSwitcher`（当前 ws 名 + daemon 徽标 + 下拉切同模块 + 未绑定弹窗 D-003）接入 `top-bar.tsx` | 核心 |
| P5 | daemon 状态数据接入（复用 `listDaemonInstances` + `fetchMyBindings` 聚合 ws→daemon 在线映射）+ store/切换器消费 | 渐进 |

数据流：
```
URL /workspaces/[id]/* (真相源)
    ↓ useWorkspaceId() 解析（app-shell.tsx 现有）
stores/workspace.ts (缓存: {id,name,daemon_id,daemon_online})
    ↑ 写入                       ↓ 读取
React Query (workspace 列表 + daemon 实例 + my-bindings)   TopBar.WorkspaceSwitcher
                                                              ↓ switchWorkspace(id)
                                                        URL 重写 (保留模块段, 替换 wsId)
```

## 6. 文件变更清单

| 操作 | 文件路径 | 说明 |
|---|---|---|
| 新增 | `frontend/src/stores/workspace.ts` | 工作区上下文 zustand store（非 persist），缓存当前 ws 对象，提供 `setCurrent`/`switchWorkspace` |
| 新增 | `frontend/src/components/workspace-switcher.tsx` | 顶栏切换器组件（当前 ws 名 + daemon 徽标 + 下拉 + 切同模块） |
| 新增 | `frontend/src/components/workspace-binding-dialog.tsx` | daemon 绑定弹窗（复用 `lib/workspace-binding.ts` 的 `upsertMyBinding`；表单复用现有 `WorkspaceAccessGuide` 字段逻辑） |
| 新增 | `frontend/src/lib/workspace-daemon-status.ts` | daemon 在线状态聚合：`fetchMyBindings`（批量，按 workspace_id 索引）+ `listDaemonInstances` 映射 daemon_id→online，供切换器/选择器消费（R-02 落地文件） |
| 新增 | `frontend/src/lib/use-workspace-context.ts` | 组合 hook：`useWorkspaceId`（从 app-shell 提取/复用）+ 进入 ws 时写 store + 暴露当前 ws 与 daemon 状态（聚合 workspace-daemon-status） |
| 修改 | `frontend/src/app/(dashboard)/layout.tsx` | 加工作区守卫 `useEffect`（同 `useSession` 登录守卫层），无 wsId 且非白名单 → `router.replace("/workspaces")` |
| 修改 | `frontend/src/app/page.tsx` | 登录态直接 `redirect("/workspaces")`，未登录 `redirect("/login")`，删除双入口标题页 |
| 修改 | `frontend/src/app/(dashboard)/workspaces/page.tsx` | 列表页改造为选择器：强化 daemon 状态徽标、加顶部"平台管理/系统设置"旁路入口、空状态"创建工作区"引导；卡片点击逻辑区分已绑定（进）/未绑定（弹窗） |
| 修改 | `frontend/src/components/top-bar.tsx` | 左侧接入 `<WorkspaceSwitcher />`（平台页无 wsId 时显示"选择工作区"引导） |
| 修改 | `frontend/src/components/app-shell.tsx` | `useWorkspaceId` 改为复用 `use-workspace-context`，进入 ws 时写 store 缓存；`resolveHref` 逻辑不变（路径派生仍为真相源） |

> 无后端文件变更。daemon 状态/binding 全部走现有接口只读消费。

### 组件复用与职责边界（Design Grill CB-1/CB-2）

- **WorkspaceBindingDialog 复用 WorkspaceAccessGuide（CB-2）**：现有 `WorkspaceAccessGuide` 已支持首次绑定 + 编辑双模式（回填 `daemon_id/root_path/path_source`，保存调 `upsertMyBinding`）。`WorkspaceBindingDialog` **不重写表单**，只作弹窗容器（antd Modal/shadcn Dialog）包裹 `WorkspaceAccessGuide` 主体，避免双份维护。
- **列表页/切换器弹窗 vs 详情页 Guard 职责边界（CB-1）**：本次把"首次绑定"提前到列表页/切换器点击未绑定项时弹窗；**详情页 `WorkspaceBindingGuard` 保留**，但对其而言用户进入详情时已绑定（列表页已强制），Guard 退化为详情页内的「编辑我的接入配置」入口（即其现有 bound 分支）。两者互补不冲突：弹窗管首次绑定，Guard 管详情页编辑入口。

## 7. 接口定义

```ts
// stores/workspace.ts —— 工作区上下文缓存（非 persist）
interface CurrentWorkspace {
  id: string;
  name: string;
  daemon_id: string | null;
  daemon_online: boolean;        // 聚合自 daemon 实例在线状态
  root_path?: string | null;
}
interface WorkspaceStore {
  current: CurrentWorkspace | null;
  setCurrent: (ws: CurrentWorkspace | null) => void;
  clear: () => void;
}
// switchWorkspace 放在 lib/use-workspace-context.ts（需要 router）
function switchWorkspace(targetId: string): void;
// 解析当前 pathname，替换 /workspaces/{id} 段，保留首个模块段（/changes），不保留子路径
// 例: /workspaces/A/changes → /workspaces/B/changes
//     /workspaces/A/changes/123 → /workspaces/B/changes（截断子路径，避免目标 404）
//     /workspaces/A → /workspaces/B（概览）

// components/workspace-switcher.tsx
function WorkspaceSwitcher(): JSX.Element;
// 内部: useWorkspaceContext() 取 current；下拉项来自 my-bindings + daemon 状态映射
// 未绑定项点击 → 打开 <WorkspaceBindingDialog workspaceId={...} />

// components/workspace-binding-dialog.tsx
interface WorkspaceBindingDialogProps {
  workspaceId: string;
  open: boolean;
  onBound: (binding: MemberBindingView) => void;  // 绑定成功回调（刷新列表/进入）
  onClose: () => void;
}
// 复用 lib/workspace-binding.ts: fetchMyBinding / upsertMyBinding
// 字段: daemon_id(选 listDaemonInstances 实例) + root_path + path_source(daemon-client|server-local)

// lib/use-workspace-context.ts
function useWorkspaceContext(): {
  workspaceId: string | null;          // URL 派生（真相源）
  current: CurrentWorkspace | null;    // store 缓存
  daemonOnline: boolean;
  switchWorkspace: (id: string) => void;
};
```

## 7.5 生命周期契约表

> **判定**：本次变更涉及"daemon"关键词，但仅作为**只读状态消费方**——不新增任何 daemon 生命周期事件、不改动 session/lease/agent_run/state transition。复用现有接口：

| 事件 | 发起方 | 接收方 | 必需字段 | 状态变化 | 本次改动 |
|---|---|---|---|---|---|
| 查询 my-binding | frontend | backend | workspaceId | 无（只读） | 切换器/选择器消费（新调用点） |
| upsert my-binding | frontend | backend | workspaceId, daemon_id, root_path, path_source | binding 写入 | 绑定弹窗复用（新 UI 入口） |
| 查询 daemon 实例在线状态 | frontend | backend | 无 | 无（只读） | 切换器聚合 ws→daemon 在线映射 |

无新增生命周期事件，无新增必需字段（`MemberBindingView.daemon_id/root_path/path_source` 已存在）。自审结论：不触发生命周期回归风险。

## 8. 数据模型

无后端表/字段变更。前端新增 `CurrentWorkspace` 缓存类型（见 §7），非持久化（随 URL，刷新重建）。

## 9. 兼容策略（brownfield）

- **路径派生不变**：`/workspaces/[id]/*` 路由结构与 URL 完全不变，深链/刷新行为零回归（`useWorkspaceId` 正则解析保留，store 只是叠加缓存层）。
- **菜单数据源不变**：`menu-permissions.ts` 的 `absolute` 标记继续区分平台级/工作区级，无 wsId 时相对菜单灰显逻辑（`app-shell.tsx:259-267`）保留。
- **未配置时行为**：守卫白名单覆盖现有平台级路由（`/admin` `/settings` `/ppm` `/runtimes` `/workspaces`），平台后台用户不被阻断。
- **回退路径**：store 缓存层与守卫是叠加式增量，可独立回退（删除 store 引用即恢复纯路径派生）。
- 项目未上线，无历史数据兼容负担（CLAUDE.md 规则 7）。

## 10. 风险登记

| 编号 | 风险 | 等级 | 应对策略 |
|---|---|---|---|
| R-01 | 客户端守卫有轻微闪烁（页面先渲染再重定向） | P2 | dashboard layout 已有同模式登录守卫（`useEffect`+`router.replace`），加 loading/`return null` 过渡一致化；可接受 |
| R-02 | daemon 状态聚合数据可得性：切换器需每个候选 ws 的 daemon 在线状态 | P1 | **Grill 已核实**：`MemberBindingView` 不带 online 字段（仅 daemon_id/root_path/path_source），确认需客户端用 `fetchMyBindings`（批量，按 workspace_id 索引）+ `listDaemonInstances`（带在线状态）做 daemon_id→online 映射；可行，P5 实现，无新端点 |
| R-03 | 平台页（admin/ppm，无 wsId）切换器显示形态 | P2 | 显示"选择工作区"引导态，不阻断；design 已定 |
| R-04 | 未绑定 ws 点击弹窗打断只想进后台的管理员 | P2 | 与 D-001 协调：管理员走选择器页后台旁路直接进 `/admin`，不触发绑定弹窗；弹窗仅在点击工作区项时触发 |
| R-05 | `switchWorkspace` 截断子路径（`/changes/123`→`/changes`）可能与用户预期不符 | P2 | D-002 已接受：保留模块级避免目标 ws 404；交互上切换器切的是"工作区"非"具体条目"，合理 |
| R-06 | 改 router/layout 必跑 `test_router`（记忆教训） | P1 | 守卫在 layout 不在 router，但 plan/verify 阶段补充 layout 守卫单测 + 现有路由测试回归 |

## 11. 决策追踪

| 决策 ID | 内容 | 覆盖章节/FR | 状态 |
|---|---|---|---|
| D-001@v1 | 统一强制守卫 + 选择器页后台旁路 | §5 P2/P3、AC-1/AC-2 | accepted |
| D-002@v1 | 切换器跳同模块，保留模块级路径 | §5 P1、§7 switchWorkspace、AC-4 | accepted |
| D-003@v1 | daemon 未绑定弹绑定弹窗（非内嵌下拉） | §5 P4、§6 WorkspaceBindingDialog、AC-5 | accepted |
| D-004@v1 | 无工作区空状态引导创建 | §5 P3、AC-3 | accepted |
| D-005@v1 | daemon 离线仅显示状态不阻断 | §5 P4、AC-6 | accepted |
| D-006@v1 | 采用方案 A 客户端守卫 | §5、§6 layout、§9 | accepted |

剩余风险：R-02（daemon 状态批量聚合性能）需 P5/plan 阶段实测确认。

## 12. 自审

- ✅ 12 章节齐备，文件变更清单 9 项（4 新增 + 5 修改），无后端改动。
- ✅ URL 路径派生真相源约束满足（store 非 persist，`useWorkspaceId` 保留）。
- ✅ daemon 生命周期契约表已说明本次无新增事件（§7.5）。
- ✅ D-001~D-006 全部被具体章节/FR 覆盖，无悬空决策。

### Design Grill 交叉审查结论（Step 12，passed）

cross-check matrix：

| 层 | 检查项 | 结论 |
|---|---|---|
| 定义层 | "daemon 在线"判定标准 | 未在 design 明确，但对齐 `listDaemonInstances` 现有 online 字段语义即可，execute 落实，非阻塞 |
| 一致性 | 列表/切换器弹窗 vs 详情页 Guard 职责 | **CB-1 已修正**（§6 补职责边界：弹窗管首次绑定，Guard 退化为详情页编辑入口） |
| 一致性 | WorkspaceBindingDialog vs WorkspaceAccessGuide 重叠 | **CB-2 已修正**（§6 补复用：Dialog 容器化包裹 AccessGuide 主体，不重写表单） |
| 一致性 | 守卫白名单 vs absolute 菜单 | 白名单前缀全覆盖；**CB-3 实现要点**：守卫须先判 `/workspaces/:id` 再判白名单前缀（避免 `/workspaces/xxx` 被白名单 `/workspaces` 误匹配），execute 注意实现顺序 |
| 可行性 | MemberBindingView.online 字段 | **R-02 已核实**：字段不存在，需 daemon_id→listDaemonInstances 映射（§10 已更新） |
| 可行性 | URL 路径派生不变 | 满足，store 叠加层可独立回退（§9） |
| 可行性 | switchWorkspace 截断子路径 | D-002 已接受（避免目标 404），交互合理 |

**Design Grill passed**，无 P0/P1 未决项进入 plan。CB-1/CB-2 已修正入 design，CB-3/CB-4 转为 execute 实现要点。
