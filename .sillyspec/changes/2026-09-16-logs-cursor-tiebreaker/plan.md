---
plan_level: light
---

# 轻量计划（Light Plan）：会话日志向上翻页 before_id 复合游标

## 来源
brainstorm 定案（D-001@v1 方案 A，独立设计审查 review-2026-09-16-080819 双 pass）：backend 可选 before_id 查询参数 + 块内复合过滤 `(ts<before) OR (ts=before AND id<before_id)`（ORDER BY 零改动、缺省保持现行 `<=` 语义），前端游标 (ts,id) 二元组（翻页 :1074 与初始加载 :689 双写点均设 id）。

## 范围
- backend/app/modules/daemon/session/service/read_model.py（task-01：复合过滤分支+docstring）
- backend/app/modules/daemon/router/session_insights.py（task-02：before_id Query+422）
- backend/app/modules/daemon/tests/test_group_logs_pagination.py（task-03：150 行批两页/缺省回归/422）
- backend/openapi.json + frontend/src/lib/api-types.ts（task-04：重导出+gen:types）
- frontend/src/lib/daemon/sessions.ts（task-05：beforeId opts+params）
- frontend/src/components/daemon/session-panel/session-panel-page.tsx（task-06：historyCursorIdRef 双写点/:662 重置/:1053 透传/:1093 pageKey 后缀/:1129-1131 二元组进度）
- frontend session-panel 测试（task-07：透传/同 ts 不同 id 有进度/换会话重置/首翻带 beforeId）
- 验收对账（task-08：proposal 成功标准逐条+R-02 耗时观察）

## 验收
- AC-01：同 ts 150 行批、页 100，带复合游标两页取尽批内全部行且零重叠（backend 测试断言）
- AC-02：不传 before_id 行为与现行 `<=` 逐字节一致（回归用例）
- AC-03：单独传 before_id 无 before → 422
- AC-04：前端初始加载后首翻即带 beforeId；同 ts 不同 id 判定有进度（跳转循环不误 break）；换会话游标重置
- AC-05：gen:types:check 过；backend 相关测试（test_group_logs_pagination）与 frontend 相关套件全绿；ruff/mypy/tsc/eslint 0 新增
- AC-06：ORDER BY 与 logsToTurns 零改动（diff 核对无该两处改动）

## 覆盖矩阵（如存在 decisions.md）
| ID | 覆盖任务 | 验收证据 |
|---|---|---|
| D-001@v1 | task-01, task-02, task-03, task-04, task-05, task-06, task-07, task-08 | AC-01~AC-06 |
