---
author: flow-machine-draft
created_at: 2026-10-28T00:32:41.960Z
---
# 决策记录（Decisions）— 2026-10-28-model-retry-visible

## D-001@v1: 设计期风险与放弃方案（底稿）
- 类型：process
- 状态：confirmed
- 锚点：daemon/schema.py
- 答案：最大风险：CLI api_retry 帧的 `error` 字段形态漂移（SDK 类型为 SDKAssistantMessageError 对象，可能随版本变化）——防御：归一化与落行两处都做「非字符串则 JSON.stringify + 截断」，前端渲染对解析失败有中性兜底（FR-02 场景三），最坏退化为不可读摘要行而非报错。次要风险：重试风暴一次轮可产生约 10 行协议行，时间线行数增多——终态轮不渲染已兜住对话正文噪声，进度视图行数可接受（与 thinking 分段同量级）。 试过但放弃的方案：①notifyTurnPhase 新增 `model_retry` 阶段——TurnPhaseValue 七阶段语义均为轮启动阶段，backend schema（daemon/schema.py TurnPhase 枚举）与前端阶段状态条渲染面都要扩，改动面大于协议行方案且信息载量低（phase 无 attempt/error 载荷位）；②daemon 侧对 rate_limited 轮做自动延迟重注入——属行为变更，与 FR-03「纯可观测性透传」定位冲突，且掩盖供应商侧问题（用户应看到限流并决策换模型/稍后再试）；③仅改前端把「API Error」assistant 文本行实时显示——该文本只在轮终态合成一次（重试期间无 assistant 帧），解决不了重试风暴期间的可见性（本次问题的主诉）。
