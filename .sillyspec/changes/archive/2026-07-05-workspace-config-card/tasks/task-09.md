---
id: task-09
title: 更新 page.test.tsx 适配新结构（断言无"规范管理"区 + <WorkspaceConfigCard> 渲染 + 其他区块行为不变）
change: 2026-07-05-workspace-config-card
author: qinyi
created_at: 2026-07-05T01:18:51
priority: P1
status: pending
depends_on: [task-07]
blocks: []
requirement_ids: [FR-003]
decision_ids: []
allowed_paths:
  - frontend/src/app/(dashboard)/workspaces/[id]/page.test.tsx
---

## Goal

task-07 已把 `workspaces/[id]/page.tsx` 第 598-825 行「规范管理（Spec Workspace）」SectionCard 删除并替换为 `<WorkspaceConfigCard>`，相关配置 state/handlers（initing/syncStatus/scanStatus/activeScanRunId/importing/importPhase/initSyncedAt/handleInit/handleScan/handleSyncManual/handleImport/handleGenerateProjects/initPollRef/syncPollRef）已迁入卡片。本任务把现有 `page.test.tsx` 593 行的断言适配到新结构：**断言"规范管理"区文本已不渲染 + `<WorkspaceConfigCard>` 被渲染 + 其他区块（基本信息 / 默认智能体 / Overview / Quick nav）行为零回归**。覆盖 FR-003（升级现有"规范管理"区为"我的工作区配置"卡）+ NFR-05（不破坏既有详情页测试）。

## Implementation

1. **加 mock 收口新卡片**：在文件顶部 `vi.mock` 段加 `vi.mock("@/components/workspace-config-card", () => ({ WorkspaceConfigCard: (props) => <div data-testid="workspace-config-card-mock" /> }))`，隔离卡片内部 6 状态分支 + handlers（已由 task-08 的 `workspace-config-card.test.tsx` 单独覆盖，本测试只验证 page 层接线）。
2. **删除/弱化对已迁入卡片 DOM 的断言**：
   - 删除对"规范管理（Spec Workspace）"区标题/字段（spec_root / sync_status / profile_version / last_synced_at 直接展示在 page）的 `getByText` 断言。
   - `task-14` 系列"扫描按钮 / 初始化按钮 / 同步按钮 / 重新扫描 / 上次扫描未完成"等断言：这些按钮随 task-07 迁入卡片，page 层不再渲染——改为断言 `screen.getByTestId("workspace-config-card-mock")` 在文档中（即卡片被渲染即可），不再在 page.test.tsx 重复断言按钮文本（按钮行为由 task-08 组件测试负责）。
   - `task-08` 三态引导（"此工作区尚未初始化。" / "已初始化，但工作区尚无扫描文档。" / "工作区已就绪。" / "请先扫描" / "规范文档已同步"）+ `initDispatch` + owner 门禁 + 409 重扫确认：同样随 handlers/JSX 迁入卡片，page.test.tsx 删除这些 case（迁入 task-08 的组件测试覆盖）。
3. **保留的 page 层断言**（行为不变，回归守护）：
   - 详情页 PageHeader 渲染工作区名 `multi-agent-profile`（`getAllByText` 长度 > 0，作为 `renderWithStrategy` 的 ready 信号保留）。
   - 基本信息 SectionCard、默认智能体 SectionCard（task-11 daemon-entity-binding 三个 `default_agent` case 保留：daemon 未绑占位 / 已绑有在线 provider 选择器 / 已绑无在线 provider 提示——这些字段在 page.tsx 顶层 state，未迁入卡片）。
4. **fixture 不动**：`makeWorkspace` / `mockDefaultBinding` / `renderWithStrategy` 三个 helper 维持现状（仍 mock getWorkspace/getSpecWorkspace/fetchMyBinding/listComponents/listDaemonRuntimes/listDaemonInstances 等共享数据源，卡片走 props 接收，mock 链路不变）。
5. **describe 重命名**：从 `"WorkspaceDetailPage daemon-client 扫描入口（task-14 / D-006@v1 + task-08）"` 改为 `"WorkspaceDetailPage 接线 WorkspaceConfigCard（task-09 / FR-003）"`，并删掉文件顶部 task-14/task-08 注释段。

## Acceptance

- AC-1：「规范管理（Spec Workspace）」原 SectionCard 文本（含 spec_root 直显/profile_version 直显/三态引导文案/操作按钮文案）在 page 层断言全部移除，`queryByText(...).not.toBeInTheDocument()` 或直接删 case。
- AC-2：新增 mock 后 `screen.getByTestId("workspace-config-card-mock")` 在所有保留 case 中可查到，证明 page.tsx 正确渲染 `<WorkspaceConfigCard>`。
- AC-3：default_agent 三个 case（task-11）保留并通过——验证基本信息/默认智能体区块行为不变。
- AC-4：fixture（makeWorkspace / mockDefaultBinding / renderWithStrategy）结构不变，仅删除依赖已迁入卡片字段的 case。
- AC-5：不再在 page.test.tsx 重复覆盖已迁入卡片的按钮行为（init/scan/sync/import/重新扫描/owner 门禁/409 确认），避免与 task-08 组件测试重复。

## Verify

```bash
cd frontend && pnpm exec vitest run src/app/\(dashboard\)/workspaces/\[id\]/page.test.tsx
```

期望：保留 case 全绿（default_agent × 3 + 卡片渲染接线断言），删掉的 task-14/task-08 按钮类 case 不再出现在结果中。若 mypy/ruff/CI 不介入前端测试，本任务 verify 即上述单条 vitest 命令。

## Constraints

- **删除断言**「规范管理（Spec Workspace）」区文本：原 page.tsx 第 598-825 行 SectionCard 已被 task-07 整段删除，对应断言（spec_root 直显、profile_version 直显、三态引导、init/scan/sync/import 按钮文本）一并删除，不再在 page 层断言。
- **保留**对基本信息 / 默认智能体 / Overview / Quick nav 区块的断言（这些区块 task-07 不动，行为应零回归）——具体保留 default_agent × 3 case（task-11）。
- **不破坏现有 fixture**：`makeWorkspace` / `mockDefaultBinding` / `renderWithStrategy` 三个 helper 签名 + 内部 mock 结构不变；只删调用方 case，不改 helper 本身。
- **不直接断言 spec_root 在 page**：原 spec_root 直显断言已随 SectionCard 删除；若需验证 spec_root 渲染，改为 mock 卡片后断言 `data-testid="workspace-config-card-mock"` 存在（spec_root 展示由 task-03/08 组件测试负责，page 层只验证接线）。
- **不重新实现已迁入卡片的测试逻辑**：init/scan/sync/import 按钮 + 三态引导 + owner 门禁 + 409 重扫 + initDispatch 调用 + syncManual 状态机——这些 case 整体从 page.test.tsx 删除，由 task-08 在 `workspace-config-card.test.tsx` 重新覆盖（避免双份维护、避免 mock 边界混乱）。
- **allowed_paths 严格限定**：只改 `frontend/src/app/(dashboard)/workspaces/[id]/page.test.tsx` 一个文件，不动 page.tsx（task-07 已改）/ 不动卡片组件（task-01~06 已建）/ 不动卡片测试（task-08）。
