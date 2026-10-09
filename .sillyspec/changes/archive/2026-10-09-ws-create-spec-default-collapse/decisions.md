---
author: flow-machine-draft
created_at: 2026-10-09T15:17:33.237Z
---
# 决策记录（Decisions）— 2026-10-09-ws-create-spec-default-collapse

## D-001@v1: 风险与死路（design 槽4 收割）
- 类型：process
- 状态：confirmed
- 答案：- 最大风险：默认策略从「平台托管（不碰源项目）」翻转为「源项目即真理（扫描直接写源项目）」，新工作区默认行为变为写源项目 `.sillyspec`——已有 ⚠ 警示文案在收起态也保持可见（FR-05）来对冲用户无感知的风险；这是用户明确要求的默认值，属预期行为变化。 - 放弃的方案：CSS `display:none` 隐藏前两选项（不满足 FR-03 的 DOM 移除要求，且屏幕阅读器仍可聚焦）；把 spec 策略挪进独立的「高级设置」二级弹窗（改动面大、移动端无对应容器形态，收益低）。
