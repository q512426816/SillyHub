# 提案（Proposal）— 2026-09-10-group-agent-direct-chat

## 一句话

群聊新增「汇总模式」与「agent 间私聊通道」：多 @ 消息由第一个被 @ 的 agent 收口汇总（其余成员意见私下转交、超时强制收口），agent 之间互@讨论不刷群、回复定向注入发起方会话；后端任务状态机 + 投影层硬拦截保证可靠驾驭。

## 问题

1. 现状多 @ 触发 = 每个 agent 各自回复进群时间线，跨工作区需求评审时群里一堆 agent 回复刷屏，用户要自己拼结论。
2. 现状互@协作（agent 回复里 @ 另一 agent）触发的回复也进群，agent 之间的分歧讨论过程污染群时间线。
3. 用户已有「与单个群成员 agent 影子直聊」能力，但 agent 相互之间没有等价的私聊通道。

## 方案要点

- 群级开关 `consensus_mode`（默认关，零回归）+ `consensus_timeout_seconds`（默认 600s）。
- 多 @ 时建汇总任务（新表 `agent_group_consensus_tasks`，JSONB 成员明细 + deadline）：汇总人独立分析（不进群）→ 被咨询成员意见经收口钩子定向注入汇总人（busy steering）→ 全员终态或超时后注入收口指令 → 汇总人 [[GROUP]] 总结段唯一进群出口。
- 互@触发改私聊语义：回复注入发起方影子会话，防环护栏沿用；协作轮在投影层按 turn metadata 强制拦截（[[GROUP]] 也拦），不依赖 agent 自觉。
- 协调状态卡（channel='system' 落库 + 同 log_id 更新重发）全程可见可回放；后台 sweeper 30s 扫超时强制收口，最坏 10 分钟群里必有结论。
- daemon 侧零改动；前端：向导/设置开关、状态卡渲染、api-types 重生成。

## 决策依据

decisions.md D-001 ~ D-008（用户逐条确认）；design.md（含 Design Grill 修正补遗 §12）。

## 不在范围内（Non-Goals）

- 不做独立汇总进度查询 API（状态卡走现有 logs 流）。
- 不做 agent 间私聊独立会话形态（注入发生在成员既有影子会话内）。
- 不做收口轮失败自动重试与汇总人人工接管（后续增量）。
- 不改动 daemon 侧。

## 影响

backend：agent 模型/迁移、group 子域（messages/mentions/shadow/consensus 新文件）、run_sync group_bridge/submit_steps、main.py 挂载 sweeper；frontend：group-chat 三组件 + api-types；daemon：零改动。既有互@测试按 D-004 语义变更更新断言。
