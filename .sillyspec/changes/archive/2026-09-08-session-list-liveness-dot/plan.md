---
author: qinyi
created_at: 2026-09-08 00:26:00
plan_level: light
---

# 轻量计划（Light Plan）— 会话列表活性小灯 + idle 未读点

## 来源
design.md（Grill 修订版，D-001@v2 客户端转移检测 / D-002@v1 Popover portal 悬停卡 / D-003@v1 未读转移语义）+ 用户原始规格（纯前端、无后端改动、布局零变化硬验收）。任务链线性：hook → 行渲染 → 测试。

## 范围
- 新增 `frontend/src/hooks/use-session-liveness.ts`（取数 + 转移检测状态机 + localStorage 降级）
- 修改 `frontend/src/components/sessions/session-list-panel.tsx`（SessionRow 行尾 Popover 小灯 + 悬停卡 + 未读红点 + props 链透传，selected 置真清红点）
- 测试：`frontend/src/components/sessions/__tests__/session-list-panel.test.tsx` 补用例（含 vi.mock @/lib/agent-logs）+ 新增 `frontend/src/hooks/__tests__/use-session-liveness.test.ts`
- 模块：frontend（frontend_components / frontend_lib）；不涉后端、不跑 gen:types

## 验收
- AC-1：hook 单测全绿（map DESC 首胜、queryKey 固定 "all" 槽、转移检测各边：working→idle 亮 / blocked→idle 亮 / 首见不亮 / unknown→idle 不亮 / 存储异常降级）
- AC-2：组件用例全绿（有命中渲染小灯与悬停卡四行内容、无命中无灯、红点出现 / selected 置真消失、布局断言不新增列）
- AC-3：`cd frontend && pnpm exec tsc --noEmit` 干净；`pnpm exec vitest run src/components/sessions/__tests__` 既有用例零回归
- AC-4：双主题语义阶（无 blue-* 硬编码信息蓝外的用法、无 hex 色值）

## 覆盖矩阵
| ID | 覆盖任务 | 验收证据 |
|---|---|---|
| D-001@v2 | task-01, task-02 | AC-1（状态机各边）+ AC-2（红点出现/消失） |
| D-002@v1 | task-02 | AC-2（小灯/悬停卡/布局断言）+ AC-4 |
| D-003@v1 | task-01, task-03 | AC-1（working/blocked→idle 边） |
| FR-01/FR-02/FR-04 | task-01, task-02 | AC-1/AC-2/AC-4 |
| FR-03 | task-01, task-02, task-03 | AC-1/AC-2 |
