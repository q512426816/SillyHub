---
author: flow-machine-draft
created_at: 2026-10-10T10:35:27.990Z
---
# 提案书（Proposal）— 2026-10-10-session-turn-token-speed

## 动机

任务原话转写：动机：平台会话轮次目前只显示 ↑输入 ↓输出 token 数，用户想参考 deepseek-harness 展示模型生成速度 tok/s（口径=提供方报告的输出词元 ÷ 模型 API 调用时长，不用含工具执行时间的墙钟，避免数字被稀释误导）。AgentRun.duration_api_ms 列已存在且轮收尾已写入，只是 turn_completed SSE 事件与 SessionRunRead 两个出口均未透传。
成功标准：
- turn_completed SSE 事件携带 duration_api_ms（close_run_steps.py 从 AgentRun 既有列透传，None 亦如实下发）
- GET /api/daemon/sessions/{id}/runs 的 SessionRunRead 增加 duration_api_ms 字段（from_attributes 直映，零查询改动），跑 pnpm gen:types 同步 api-types.ts 与 backend/openapi.json
- 前端会话面板轮尾两处（对话视图 RoundDivider meta、全部视图 TurnStatusBadge）在终态轮显示『N tok/s』：output_tokens ÷ duration_api_ms，格式化口径 ≥10 取整、<10 保留 1 位小数、负值钳 0
- 运行中轮 / 旧数据 / 无时长引擎（duration_api_ms 为空或非正）如实不显示速度，不伪造不降级
- page 与 dialog 两种面板模式、断线 resync 合成轮、历史回填（enrichDisplayTurns）路径均接线一致
- 后端与前端相关测试通过（不跑全量）

## 变更范围

按成功标准机械推导，共 6 条验收面：
1. turn_completed SSE 事件携带 duration_api_ms（close_run_steps.py 从 AgentRun 既有列透传，None 亦如实下发）
2. GET /api/daemon/sessions/{id}/runs 的 SessionRunRead 增加 duration_api_ms 字段（from_attributes 直映，零查询改动），跑 pnpm gen:types 同步 api-types.ts 与 backend/openapi.json
3. 前端会话面板轮尾两处（对话视图 RoundDivider meta、全部视图 TurnStatusBadge）在终态轮显示『N tok/s』：output_tokens ÷ duration_api_ms，格式化口径 ≥10 取整、<10 保留 1 位小数、负值钳 0
4. 运行中轮 / 旧数据 / 无时长引擎（duration_api_ms 为空或非正）如实不显示速度，不伪造不降级
5. page 与 dialog 两种面板模式、断线 resync 合成轮、历史回填（enrichDisplayTurns）路径均接线一致
6. 后端与前端相关测试通过（不跑全量）

## 成功标准（可验证）

1. turn_completed SSE 事件携带 duration_api_ms（close_run_steps.py 从 AgentRun 既有列透传，None 亦如实下发）
2. GET /api/daemon/sessions/{id}/runs 的 SessionRunRead 增加 duration_api_ms 字段（from_attributes 直映，零查询改动），跑 pnpm gen:types 同步 api-types.ts 与 backend/openapi.json
3. 前端会话面板轮尾两处（对话视图 RoundDivider meta、全部视图 TurnStatusBadge）在终态轮显示『N tok/s』：output_tokens ÷ duration_api_ms，格式化口径 ≥10 取整、<10 保留 1 位小数、负值钳 0
4. 运行中轮 / 旧数据 / 无时长引擎（duration_api_ms 为空或非正）如实不显示速度，不伪造不降级
5. page 与 dialog 两种面板模式、断线 resync 合成轮、历史回填（enrichDisplayTurns）路径均接线一致
6. 后端与前端相关测试通过（不跑全量）
