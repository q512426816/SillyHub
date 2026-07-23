---
id: task-05
title: 前端 pending 文案"待处理"→"启动中" + 快照同步（P2 可选）
author: qinyi
created_at: 2026-07-13 20:56:24
priority: P2
wave: 3
depends_on: []
requirement_ids: [FR-4]
decision_ids: []
allowed_paths:
  - frontend/src/components/daemon/session-list-layout.tsx
  - frontend/src/components/daemon/__tests__/session-list-layout.test.tsx
---

# task-05 — 前端 pending 文案"待处理"→"启动中"

## goal

修复后 `pending` 是瞬时态（会话创建到 daemon 接手之间），文案"待处理"语义偏弱，改为更准确的"启动中"。`isActiveBadge` 逻辑保留——瞬时态仍属活跃类（绿色 success 徽标）。

> 依据：design.md §6 文件清单（frontend session-list-layout.tsx，P2 可选）、§10 R-06（前端文案改动影响快照测试，P2 可选不做）、plan.md task-05 行（FR-4）。

## implementation

1. `frontend/src/components/daemon/session-list-layout.tsx:67`
   `SESSION_STATUS_LABELS.pending: "待处理"` → `"启动中"`（仅此一行常量改动）。
2. `isActiveBadge`（:60-62，含 `pending`）**不动**——pending 仍属活跃类（success 绿色徽标），瞬时态视觉语义正确。
3. 检查 `__tests__/session-list-layout.test.tsx`：当前测试项 statusBadge 仅用 `active`/`ended`，**无 "待处理" 文案断言**（已核实）；若本任务期间新增 pending 断言则同步用 "启动中"。
4. `frontend/src/lib/status-labels.ts:16` 全局 `STATUS_LABELS.pending: "待处理"` **不改**——该映射被 incidents (`page.tsx:39` `open: "待处理"`)、审批/运行状态等多页面复用，改全局会误伤。`session-list-layout.tsx` 使用**本地专属** `SESSION_STATUS_LABELS`（不 import STATUS_LABELS），故只改本地映射即可，天然隔离。

## 验收标准

- [ ] 会话列表 pending 徽标显示"启动中"（本地 SESSION_STATUS_LABELS 生效）。
- [ ] `isActiveBadge` 逻辑不变（pending 仍算活跃类，渲染 success 绿色徽标）。
- [ ] incidents 等其他页面"待处理"文案**不受影响**（全局 STATUS_LABELS 未动）。
- [ ] 相关测试 / 快照同步通过。

## verify

```bash
cd frontend && pnpm test src/components/daemon/__tests__/session-list-layout.test.tsx
cd frontend && pnpm test
cd frontend && pnpm typecheck
```

## constraints

- 仅改文案常量一行；不动 `isActiveBadge` 逻辑、不动 Badge 样式 / variant。
- 复用现有 frontend 样式系统（CLAUDE.md 规则 17）。
- 不改全局 `status-labels.ts`（多页面共用，避免误改 incidents 审批等文案）。
- Windows / Linux / macOS 兼容（纯文案常量，无平台依赖）。

## notes

- 本任务 P2 可选：若 task-01~04 已让 pending 仅作瞬时态（创建→daemon 接手之间），文案优化为锦上添花；不做也不阻塞 AC-1~5。
- design §10 R-06 风险已评估：仅 session-list-layout.tsx:67 文案常量，影响面可控。
