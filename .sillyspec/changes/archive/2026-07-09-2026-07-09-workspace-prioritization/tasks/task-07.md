---
id: task-07
title: 修改 frontend/src/app/(dashboard)/workspaces/page.tsx — 列表页改造选择器：顶部后台旁路入口（D-001）+ daemon 状态徽标（消费 task-03）+ 空状态创建引导（D-004）+ 卡片点击区分已绑定（进）/未绑定（弹 task-06）
title_zh: 工作区列表页改造为选择器
author: qinyi
created_at: 2026-07-09 23:10:00
priority: P0
depends_on: [task-03, task-06]
blocks: []
allowed_paths:
  - frontend/src/app/(dashboard)/workspaces/page.tsx
  - frontend/src/components/workspace-card.tsx
---

## 目标(goal)

把现有 `/workspaces` 列表页从"纯列表"改造为"工作区选择器"：登录后落地此处，顶部常驻后台旁路入口（任何人可不选工作区直接进平台管理/系统设置），卡片强化 daemon 在线状态徽标，无工作区时显"创建工作区"引导，卡片点击区分已绑定 daemon（直接进 `/workspaces/{id}`）与未绑定（弹 task-06 `WorkspaceBindingDialog`，绑好才进）。

覆盖：FR-03（落地页改选择器）、D-001（选择器页后台旁路）、D-004（空状态创建引导）、CB-1（选择器弹窗管首次绑定，详情页 Guard 退化为编辑入口）。

## 实现(implementation)

改 `frontend/src/app/(dashboard)/workspaces/page.tsx`（现有约 314 行，已并行拉 `listWorkspaces` + `listDaemonRuntimes` + `listDaemonInstances` + `fetchMyBindings`，`WorkspaceCard` 已展示 `boundDaemon`）。本任务在其基础上叠加 4 处改造：

1. **顶部后台旁路入口（D-001）**：在 `PageHeader` 与筛选条之间（或 `PageHeader.actions` 旁）新增一行旁路链接组，`next/link` 的 `Link` 到 `/admin`（平台管理）、`/settings`（系统设置）。文案"平台管理 / 系统设置"，slate 次级色、圆角 12 的 ghost 按钮。任何人可见，不要求绑定工作区即可进（守卫 task-05 白名单已放行）。

2. **daemon 状态徽标（消费 task-03）**：导入 `useDaemonStatusMap`（来自 task-03 新增的 `@/lib/workspace-daemon-status`），在页面顶层调用得到 `Map<workspaceId, DaemonStatus>`（`DaemonStatus` = `online | offline | unbound`，由 task-03 定义）。渲染每张卡片时把对应状态透传给徽标渲染：
   - `online` → 绿（StatusBadge success / `#16A34A`）"在线"
   - `offline` → 红（destructive / `#DC2626`）"离线"
   - `unbound` → 黄（warning / `#D97706`）"未绑定"
   徽标实现方式二选一：① 给 `WorkspaceCard` 加可选 prop `daemonStatus?: DaemonStatus`（推荐，徽标随卡片信息一起渲染）；② 若不想动 `WorkspaceCard`（allowed_paths 外文件），则在页面层用绝对定位浮层或卡片上方独立小徽标行渲染。**优先选①**，task-07 产出后再 quick 补 `WorkspaceCard`（或本任务的 allowed_paths 协商扩展）。若执行阶段确认不能动 `WorkspaceCard`，改在 page 层用单独徽标行（不阻塞交付）。

3. **空状态创建引导（D-004）**：现有空状态文案"还没有工作区。点击右上角…"。改为更显眼的引导态：保留虚线框（`border-dashed`），加一个主色（`#2563EB`）"创建工作区"按钮（点击触发现有 `setShowDialog(true)` 打开 `WorkspaceScanDialog`），副文案说明"绑定一个项目仓库后即可开始使用"。

4. **卡片点击区分已绑定 / 未绑定（CB-1）**：
   - 引入 `next/navigation` 的 `useRouter`。
   - 新增 state `bindingTarget: Workspace | null`（被点击的未绑定 ws，驱动 task-06 弹窗）。
   - 卡片整张可点击（`onClick`）：判断 `bindingsByWs.get(w.id)?.daemon_id` 是否存在（已绑定）：
     - 已绑定 → `router.push(\`/workspaces/${w.id}\`)`（与现有"详情"链接行为一致，现保留"详情"按钮作为冗余入口或移除，视实现取舍，建议保留按钮避免点击区域歧义）。
     - 未绑定 → `setBindingTarget(w)`（打开 task-06 `WorkspaceBindingDialog`）。
   - 渲染 `<WorkspaceBindingDialog>`（来自 task-06 `@/components/workspace-binding-dialog`），props：`workspaceId={bindingTarget.id}`、`open={bindingTarget !== null}`、`onBound={(binding) => { setBindingTarget(null); reload(); }}`、`onClose={() => setBindingTarget(null)}`。
   - 注意 `WorkspaceCard` 现有 footer 按钮的点击事件需 `stopPropagation`，避免误触整卡片 onClick（若选了方案①给 `WorkspaceCard` 加 prop，本任务同时协调此 stopPropagation；若不动 `WorkspaceCard`，则在 page 层用一个可点击包裹层实现整卡点击，footer 按钮区单独留白不覆盖）。

样式统一遵循 `frontend-style-system` token：主色 `#2563EB`、slate 中性色、圆角 12、StatusBadge 语义色（绿/红/黄）。参照 `.sillyspec/changes/archive/2026-06-21-2026-06-21-frontend-style-system/design.md`。

## provides

- 改造后的 `frontend/src/app/(dashboard)/workspaces/page.tsx`（工作区选择器）
- 顶部"平台管理 / 系统设置"后台旁路链接组（`Link` 到 `/admin` `/settings`）
- 每张卡片的 daemon 在线状态徽标（绿/红/黄三态）
- 空状态"创建工作区"主色按钮引导
- 卡片整张可点击：已绑定进详情、未绑定弹 `WorkspaceBindingDialog`
- `bindingTarget` state + 内嵌 `<WorkspaceBindingDialog>`（接 task-06）

## expects_from

- **task-03**：`@/lib/workspace-daemon-status` 导出 `useDaemonStatusMap()` → `Map<workspaceId, DaemonStatus>`，`DaemonStatus` 含 `online | offline | unbound` 三态（及 `last_seen` 等元数据，可选）。本任务只消费不实现。
- **task-06**：`@/components/workspace-binding-dialog` 导出 `WorkspaceBindingDialog`（默认或命名导出），props `{ workspaceId: string; open: boolean; onBound: (binding: MemberBindingView) => void; onClose: () => void }`，内部容器化包裹 `WorkspaceAccessGuide`（CB-2，复用表单不重写）。本任务只消费不实现。

## 验收标准

- [ ] 顶部有"平台管理""系统设置"两个旁路链接（`Link` 到 `/admin` `/settings`），点击直达不报错（不被守卫阻断，验证 AC-2）
- [ ] 每张工作区卡片显示 daemon 状态徽标：已绑在线=绿"在线"、已绑离线=红"离线"、未绑=黄"未绑定"（验证 AC-6 离线可见不阻断）
- [ ] 无工作区时空状态显示"创建工作区"主色按钮，点击打开 `WorkspaceScanDialog`（验证 AC-1 空状态分支 / D-004）
- [ ] 已绑定 daemon 的卡片：整卡或主入口点击 → `router.push('/workspaces/{id}')`
- [ ] 未绑定 daemon 的卡片：点击 → 打开 `WorkspaceBindingDialog`，绑定成功后 `reload()` 刷新徽标状态（验证 AC-5 / D-003）
- [ ] 现有筛选/分页/别名编辑/添加工作区功能保留不回归
- [ ] `WorkspaceCard` footer 按钮（详情/重新扫描/删除/别名）点击不误触发整卡 onClick（stopPropagation 或区域分离）
- [ ] 现有列表页测试（若有 `workspaces-page.test`）不回归；新增或更新针对旁路链接 / 空状态 / 点击分流的单测

## 验证(verify)

```bash
cd frontend
pnpm test          # 全量回归（改 page 组件，记忆：必跑全量）
pnpm typecheck     # 校验 useDaemonStatusMap / WorkspaceBindingDialog / useRouter 类型接通
```

如执行阶段发现 `WorkspaceCard` 必须加 prop 才能合理渲染徽标，allowed_paths 协商扩展到含 `components/workspace-card.tsx`，并在本 TaskCard 补记决策。

## 约束(constraints)

- 仅改 `frontend/src/app/(dashboard)/workspaces/page.tsx`（allowed_paths；若需动 `WorkspaceCard` 按上方"验证"段补记）。
- daemon 状态数据来自 task-03 `useDaemonStatusMap`，**不**在本任务重新拉 `listDaemonInstances`/`fetchMyBindings` 做映射（避免与 task-03 重复实现）。
- `WorkspaceBindingDialog` 来自 task-06，**不**在本任务重写绑定表单（CB-2）。
- 详情页 `WorkspaceBindingGuard` 保留不删（CB-1：弹窗管首次绑定，Guard 退化详情页编辑入口）。
- daemon 离线只显示状态不阻断进入（D-005）：离线卡片仍可点击进入工作区。
- 样式遵循 `frontend-style-system` token（主色 `#2563EB` / slate / 圆角 12 / StatusBadge 语义）。
