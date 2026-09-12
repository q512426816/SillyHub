---
author: qinyi
created_at: 2026-09-12T11:05:30
---

# 需求规范（Requirements）— 2026-09-12-chat-turn-auto-recovery

## FR-1 daemon 错误归类泛化

- FR-1.1 `classifyModelError` 移除「仅 claude」门控：pi / codex / cursor 的
  is_error 轮与 claude 走同一套关键词规则（429+上限→quota_exceeded；裸 429→
  rate_limited；超时→timeout；网络→network；5xx/overloaded→provider_error；
  401/403→auth_failed；兜底 unknown）。claude 行为零回归。
- FR-1.2 `ModelError` 新增可选 `resetAt`（ISO-8601 字符串 | null）：命中
  quota_exceeded 时从错误文本解析重置时间——**只解析 GLM 中文格式**「将于
  YYYY-MM-DD HH:MM:SS 重置」（1308 实证格式，固定 +08:00 标注）；英文变体
  不解析（无时区信息不猜测）；解析失败或非 quota 类 → null。
- FR-1.3 wire 协议：daemon→backend `payload.error` 新增 `reset_at` 键
  （snake_case，序列化处显式映射 TS `resetAt`）；backend `ModelErrorDTO` 新增
  `reset_at: str | None = None` 并随 error_detail JSON 落库。旧 daemon 不传 →
  None；新 daemon 发给旧 backend → pydantic 忽略额外键，双向兼容。
- FR-1.4 provider_error 规则体补断流关键词（`stream ended` / `without
  finish_reason` / `stream truncat` / `silent stream` / `输出流中断` / `流中断`）
  ——主实证 `Stream ended without finish_reason` 从 unknown 归入可重试类。

## FR-2 pi 静默中断检测（daemon）

- FR-2.1 pi-rpc-driver 轮收敛处（`waitAgentSettled` 返回、无 pendingTurnError）
  检测：跟踪 `lastWasFinalText` 与 `turnHadActivity`——**标记翻转收口在
  message_end 边粒度**（override text 事件 → true；message_end 仅产 thinking →
  false；tool_use / tool_result → false；partial text 不翻转标记仅置活动），
  消除 [text,thinking] 同消息排列的健康轮误报。
- FR-2.2 命中条件：无错误 && `lastWasFinalText === false`（唯一条件，plan
  审查后与 design §5.2 定稿对齐）→ 不报 success，改报 error result：
  `subtype='error_during_execution'`、`is_error=true`、result=
  `[silent stream truncation] ...`；归类经 session-manager 既有
  classifyModelError 关键词命中（FR-1.4 断流关键词）→ provider_error/
  retryable=true（driver 不直接挂 modelError——events.ts 会覆写，见 §5.2）。
- FR-2.3 轮内零活动（无事件无 api 调用）的 settle 同样按 FR-2.2 报错（注入后
  什么都没发生=异常）；空载荷轮在 driver E1 已跳过、不产生 result，不受影响。

## FR-3 backend 三分支自动恢复（close 钩子）

- FR-3.1 `_maybe_autoretry_auth_transient_turn` 泛化为
  `maybe_auto_recover_failed_turn`；CLI 合成鉴权错误（raw 正则保留）**并入
  统一判定序**走分支 B 干净轮重放——行为面变化（有意）：新增 origin 标记；
  G0 守卫（开关/最新轮/双表幂等）对 auth 类同样生效；既有防循环/防手动重发
  叠加守卫保留在分支 B 内。
- FR-3.2 总门守卫（全分支共用）：run.status=failed；会话 active；
  `session.config.auto_resume_interrupted` 非 False；run 是会话最新 run；该 run
  有非空 user_input 日志；无同源（origin=auto_resume:<rid>）pending 排队条目
  且无同源 pending 定时条目；全程静默容错不影响已 commit 终态。
- FR-3.3 分支一（瞬时+干净轮）：`error_detail.type ∈ {rate_limited, timeout,
  network, provider_error}` 或 raw 命中 CLI 合成鉴权正则，且该 run 无
  tool_call 日志 → 守卫（对齐 9-10 G5 截断上限 / G6 附件标记，命中降级
  手动）通过后原 prompt 立即入排队消息（origin='auto_resume:<rid>'，
  provider/profile 快照随 run），沿用 auth-transient 既有守卫（防循环紧邻
  前查 / 防用户手动重发重复）。
- FR-3.4 分支二（瞬时+有工具活动）：同上类型但 run 有 tool_call 日志 → 入排队
  「续跑 nudge」提示词（不重放原任务——上下文在 CLI 进程内完整）；紧链上限 2
  （沿 metadata_.auto_resume_of 回溯，含排队与定时两路派发）。
- FR-3.5 分支三（额度+重置时间）：`error_detail.type = quota_exceeded` 且
  `reset_at` 可解析 → 落定时消息（origin='auto_resume:<rid>'，
  dispatch_at=reset_at+120s，prompt=额度恢复型 nudge）；quota 连续自动续跑
  上限 3 次（沿 auto_resume_of 链回溯数 error_detail.type=quota_exceeded 的
  连续节点），达限不再排；无 reset_at → 不自动（仅前端提示）。
- FR-3.6 同一 run 至多产生一个恢复动作（分支互斥，quota 优先判定）。
- FR-3.7 定时派发路径（scheduled_send.py `_dispatch_scheduled_entry`）对
  origin=auto_resume 条目补齐：parse origin → G10 超越守卫（source run 之后
  有更新 run → 条目置 cancelled 跳过）→ `inject_session_as_service` 携带
  auto_resume_of 打标（该公开函数需加参并转发既有私有参）→ 忙轮转排队经
  `queue.enqueue_message` 透传 origin。排队派发路径已有同语义（queue.py
  :648-728），零改动。

## FR-4 数据层

- FR-4.1 `agent_session_scheduled_messages.origin TEXT NULL`（soft-add，
  'auto_resume:<源 run uuid>' = 自动续跑条目；NULL = 用户预约）。线性迁移，
  downgrade 对称。

## FR-5 前端提示

- FR-5.0 数据前提：定时列表查询上提父层（session-panel-page/dialog 两挂载
  点，现状隔离在 ScheduledMessagesBar 局部 QueryClientProvider）；排队/定时
  两列表 DTO 后端各 +origin 字段透传。
- FR-5.1 run-error-item fallbackHint 链按 error_detail 三分支动态推导（依据：
  error_detail.type / reset_at + 会话当前 pending 的 auto_resume 排队/定时条目
  存在性）：瞬时类且有恢复条目 →「上游瞬时故障，已自动重发」；quota+reset_at
  且有定时条目 →「额度耗尽，将于 XX:XX 自动继续（可在定时消息中取消）」；
  silent truncation（raw 标记）且有恢复条目 →「输出流中断，已自动续跑」；
  无恢复条目 → 维持现状默认 hint。
- FR-5.2 定时消息列表对 origin=auto_resume 条目加「自动续跑」徽标（复用既有
  徽标样式；取消=既有 cancel 动作，语义=取消自动继续）。

## NFR

- NFR-1 归类行为面唯一变化=断流关键词修复（各 agent 从 unknown 归
  provider_error）与非 claude agent 获得真实归类——均为修复目标而非回归；
  其余七条规则原文不动、claude 零变化。
- NFR-2 daemon 与 backend 新旧混布四象限全部不炸（协议 soft-add）。
- NFR-3 自动恢复全部复用 9-10 开关（session.config.auto_resume_interrupted），
  关=完全回到手动模式。
- NFR-4 所有新增路径静默容错：恢复失败绝不影响 run 终态与主链。
