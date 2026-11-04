# 决策知识 — components-mobile

> decision-distill 从变更 decisions.md 幂等提炼（「最近确认」= 归档时 HEAD）。条目字段行为 docs-check 机械解析契约，勿手改。

## D-components-mobile-001@v1 2026-10-21-mobile-scan-birth-cleanup——答：总览卡已在 2026-10-21-overview-card-mainflow-scan 去 scan，本变更清掉同根因的三处残留。
状态：implemented
变更：2026-10-21-mobile-scan-birth-cleanup
原编号：D-000@v1
锚点：.sillyspec/changes/archive/2026-10-21-mobile-scan-birth-cleanup/design.md
文件：frontend/src/app/(dashboard)/workspaces/[id]/changes/page.tsx, frontend/src/components/mobile/mobile-change-card.test.tsx, frontend/src/components/mobile/mobile-change-card.tsx, frontend/src/components/mobile/mobile-change-detail.test.tsx, frontend/src/components/mobile/mobile-change-detail.tsx
最近确认：未记录
理由：答：总览卡已在 2026-10-21-overview-card-mainflow-scan 去 scan，本变更清掉同根因的三处残留。①`mobile-change-detail.tsx`：删除 `STEPPER_STAGES` 局部别名（`["scan", ...WORKFLOW_STAGES]`），5 处使用点改直用桌面单一源 `WORKFLOW_STAGES`（change-stage-header 导出，本就五段 brainstorm→archive）——移动端与桌面共用同一阶段数组，杜绝第三份口径副本。②`changes/page.tsx:764` 与 `mobile-change-card.tsx:261` 的 `current_stage ?? "scan"` 兜底改 `?? "brainstorm"`（出生阶段即 brainstorm，缺失兜底显 scan 是 2026-09-27 前的过时口径）；mobile-change-card.tsx 头注释 35 行的降级口径描述同步。③`change-step-badge.tsx` 的 STAGE_LABELS/STAGE_KIND 中 scan 映射**不动**——那是 legacy 数据值域映射（旧归档行可能带 scan 阶段值），与「起步阶段」口径无关。测试同步：detail 步骤条标签数组与可点性循环去「扫描」、card 缺省降级用例改断言「需求分析」。
