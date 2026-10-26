# 决策知识 — components-daemon

> decision-distill 从变更 decisions.md 幂等提炼（「最近确认」= 归档时 HEAD）。条目字段行为 docs-check 机械解析契约，勿手改。

## D-components-daemon-001@v2 变更计数徽标双色——蓝=blue-* 固定阶真信息蓝
状态：implemented
变更：2026-10-26-session-change-progress-hover
原编号：D-012@v2
锚点：frontend/src/components/daemon/session-change-files-hover.tsx:211
最近确认：33f4154a3
理由：有未完成（active>0）时徽标改蓝；无未完成（active=0，仅剩归档）保持绿色（完成态语义）。蓝色用 **blue-* 固定阶**（本场景是 CLAUDE.md 规则 20 的"真信息蓝"语义，不随主题换肤）——semantic.info 不可用（两主题下均为青，themes.ts D-003@v2"info 不再是蓝"）。
supersedes：D-012@v1
