---
author: flow-machine-draft
created_at: 2026-09-26T12:21:28.976Z
---
# 决策记录（Decisions）— 2026-09-26-knowledge-card-machine-block

## D-001@v1: 风险与死路（design 槽4 收割）
- 类型：process
- 状态：confirmed
- 答案：最大风险：对 writer 格式演进的耦合——tests 多值连接符 " | "、两空格缩进、字段集是 sillyspec test-bindings.js 的现行形态，CLI 侧改形态时这里需跟（宽容匹配注释标记前缀已留余量；tests 用 "|" split 天然容忍多值）。试过放弃的方案：①整块隐藏机器块——丢 tests 覆盖信号，放弃；②后端解析透传结构化字段——动 openapi/api-types 面大，展示层问题展示层解决，放弃。另注：knowledge-page 既有深链用例在 jsdom 下有 scrollIntoView 未实现的既有报错噪音（与本次无关，昨日引入）。
