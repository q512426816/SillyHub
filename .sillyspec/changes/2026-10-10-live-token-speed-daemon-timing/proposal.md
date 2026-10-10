---
author: qinyi
created_at: 2026-10-10T19:45:00.000Z
---
# 提案书（Proposal）

## 动机

上变更 2026-10-10-session-turn-token-speed 交付了会话轮**终态** tok/s；用户在
收口汇报后回复「继续」，确认推进汇报建议的下一步：**运行中实时显示**生成速度 +
补齐非 Claude 引擎数据（方向在上变更 design「放弃方案」节已有预研留档）。

## 关键问题

1. **实时无分母**：实时 usage 事件只带 token 数，运行中算不出速度（墙钟含工具
   时间，会把 45 tok/s 稀释成 3，多供应商对比误导——上变更已否决）。
2. **引擎覆盖残缺**：duration_api_ms 仅 Claude SDK 结果元数据上报，codex/pi/cursor
   终态速度永远缺失。
3. **引擎事件形状各异**：三引擎的逐调用边界各不相同（claude 流式事件 /
   codex item 通知 / pi message_end），需要逐引擎锚点设计而非通用墙钟。

## 变更范围

daemon 三引擎（claude+codex+pi）逐调用计时 → usage 事件搭车 `api_duration_ms`
→ backend 既有列 max/仅增不减 累积 → tokens SSE 透传 → 前端运行中+终态统一
显示（门控放宽）。零新协议、零新端点、零轮询。

## 不在范围内（显式清单）

- 不做 cursor 引擎计时（无逐调用 usage，如实不显示；见 design 风险与死路）
- 不做会话级聚合速度（历史窗口化求和必算少 + 需聚合端点，上变更已留档）
- 不做 TTFT 单独展示（平台日志无首 token 时刻）
- 不新增 SSE 事件类型 / REST 端点 / 前端轮询

## 成功标准（可验证）

- claude/codex/pi 引擎的轮**运行中**，tokens 事件携带实时累计 api_duration_ms，
  前端轮尾显示 `N tok/s` 且随生成增长（FR-01/02/03/06/07）
- 工具执行窗口不计入分母（FR-02 场景：工具 20s 不进累计）
- 旧 daemon/旧前端/无计时引擎全部零影响或如实不显示（FR-04/06/07 场景）
- close 权威覆盖与实时累积共存：Claude close 覆盖、codex/pi 保留实时值（FR-05）
- 三侧相关测试全绿（FR-08）
