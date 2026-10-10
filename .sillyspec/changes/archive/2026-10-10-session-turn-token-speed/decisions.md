---
author: flow-machine-draft
created_at: 2026-10-10T11:04:53.582Z
---
# 决策记录（Decisions）— 2026-10-10-session-turn-token-speed

## D-001@v1: 风险与死路（design 槽4 收割）
- 类型：process
- 状态：confirmed
- 答案：答：最大风险是 `duration_api_ms` 只有 Claude 系引擎上报（codex/cursor 等引擎 结果元数据可能缺省）→ 这些引擎的轮永远无速度显示。处置：FR-04 明确不显示即 预期行为，不伪造；后续若要全引擎覆盖需 daemon 各 driver 逐调用计时（独立变更）。 第二风险：api-types 重生成暴露无关旧测试债——按仓库规则 21 顺手补字段修好， 不回退手写（本次未暴露）。 试过但放弃的方案： - 实时运行中显示 Δoutput/Δt（tokens 事件差分 ÷ 墙钟）：分母含工具执行时间， 数字被稀释 5-10 倍，多供应商对比场景下误导性强，且 deepseek-harness 明确 拒绝该口径——放弃，宁可运行中不显示。 - 后端聚合端点加会话级总时长出「会话平均速度」：历史窗口化下前端求和必算少 （agent-log-turns.ts 注释既有结论），需新聚合查询，收益/成本比低——留后续。 - daemon 侧逐调用计时透传（对齐 deepseek-harness 的 decode 段口径）：跨 claude/codex/cursor 三引擎消息边界形状不一致，改动面大——本变更先用 duration_api_ms（含 TTFT 的近似 decode 口径），逐调用计时留独立变更。
