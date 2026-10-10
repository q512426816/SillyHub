---
author: flow-machine-draft
created_at: 2026-10-10T11:38:41.163Z
---
# 决策记录（Decisions）— 2026-10-10-turn-speed-enrich-backfill-test

## D-001@v1: 风险与死路（design 槽4 收割）
- 类型：process
- 状态：confirmed
- 答案：答：最大风险是 fixture 与 SessionTurnView/SessionRunRead 真实形状漂移（手工 构造遗漏必填字段编译报错，tsc 兜底）。放弃的方案：塞进 session-panel-history-race 集成测试（组件级成本高、断言间接）——纯函数直测更聚焦（评审建议即此）。
