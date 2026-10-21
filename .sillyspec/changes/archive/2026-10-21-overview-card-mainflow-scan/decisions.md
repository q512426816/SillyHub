---
author: flow-machine-draft
created_at: 2026-10-21T01:11:50.324Z
---
# 决策记录（Decisions）— 2026-10-21-overview-card-mainflow-scan

## D-001@v1: 设计期风险与放弃方案（底稿）
- 类型：process
- 状态：confirmed
- 答案：答：最大风险：既有测试与潜在快照对「六段管线」的隐含依赖——已定位唯一断言面（本组件测试 213-217 行 scan aria 断言）同步更新，全仓 grep 无其他组件消费本卡 MAIN_STAGES（组件内常量未导出）。次要风险：旧 daemon 采集值（CLI 未升级机器）下 thin 变更暂显 brainstorm 主管线——数据源升级自愈，非本变更面（依据：根因修复在 sillyspec 2026-10-21-overview-thin-stage，跨仓不在本冻结面）。放弃方案：①连带改移动端 stepper（mobile-change-detail STEPPER_STAGES 含 scan）与变更中心 `?? "scan"` 兜底——同根因但异仓异面，用户本轮只点名总览卡，扩面应由用户裁决，留后续候选；②改 CLI 侧让 envelope 附带阶段清单驱动前端渲染——过度设计，前端静态常量与 sillyspec MAIN_FLOW_ORDER 对齐即可，增契约无收益。
