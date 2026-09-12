---
author: qinyi
created_at: 2026-09-12 12:15:13
---

# 决策记录 — 2026-09-12-chat-turn-auto-recovery

格式：id / status: accepted|rejected|superseded / source: user|code|docs / question / answer / impacts / evidence。修正走新版本 D-xxx@v2 + supersedes。

---

- id: D-001
  status: accepted
  source: code
  question: 归类器是否继续维持「仅 claude」（2026-07-29 model-error-visibility D-001）？
  answer: 移除门控，规则体 provider 无关全 agent 生效（classifyClaude→classifyBlob 更名）。
  impacts: FR-1.1；codex/cursor/pi 错误卡从 unknown 变真实类型；claude 零回归。
  evidence: 实证 d4c29d95 三类故障 error_detail 全 {"type":"unknown","retryable":false}（阿里云 agent_runs 查询）；规则本身是关键词 blob 匹配与 agent 无关。

- id: D-002
  status: superseded
  source: user
  question: 429 限额的重置时间如何进协议？
  answer: ModelError 新增 resetAt（TS）/reset_at（wire+DTO）；解析 GLM「将于 YYYY-MM-DD HH:MM:SS 重置」+英文变体；时间按北京时间固定 +08:00 标注，daemon 不做时区推断。
  impacts: FR-1.2/1.3、§5.5 数据流、R-04。
  evidence: 1308 文案时间与北京时间一致（23:16 报「10:03:59 重置」）。

- id: D-003
  status: accepted
  source: code
  question: 静默中断在哪检测？误报怎么办？
  answer: daemon pi-rpc-driver 收敛点（agent_settled 后轮尾无收尾 override 文本→合成 error result）；容忍合法工具收尾轮的误报（一轮 nudge 成本），紧链上限 2 封顶。
  impacts: FR-2、R-01。
  evidence: 22:36/23:52 两轮收敛 completed 且 output_redacted 为中间消息（阿里云实证）；后端从状态不可见，检测只能在 daemon。

- id: D-004
  status: superseded
  source: code
  question: backend 恢复骨架放哪？auth-transient 旧钩子怎么办？
  answer: 泛化为 _maybe_auto_recover_failed_turn，逻辑迁 auto_resume.py 与 9-10 守卫簇同文件；auth 类保留为前置判定行为零回归。
  impacts: FR-3.1、§5.3。
  evidence: close_run_steps.py:609 既有钩子范式（干净轮守卫/防循环/防重复）直接扩展。

- id: D-005
  status: accepted
  source: code
  question: 中断恢复重放什么内容？
  answer: 干净轮（无工具活动）重放原 user_input；有工具活动发「续跑 nudge」（不带原任务——CLI 进程内上下文完整，重放原文诱导从头执行）。
  impacts: FR-3.3/3.4、R-03、§5.3 常量。
  evidence: auth-transient 先例（干净轮重放）；9-10 wrap_resume_prompt 带原文是因 daemon 重启换进程丢上下文，本场景不丢。

- id: D-006
  status: accepted
  source: user
  question: 429 限额到点如何恢复？
  answer: 定时消息（dispatch_at=reset_at+120s，origin=auto_resume:<rid>），到点 sweeper 自动续跑；用户可在定时列表取消。第二问询未作答，按用户「三类全修」选择默认自动继续。
  impacts: FR-3.5、FR-4、R-05、§5.3/5.4。
  evidence: scheduled_send_sweeper 30s 巡检+忙轮转排队+到期补捞语义（scheduled_send.py 头注）。

- id: D-007
  status: accepted
  source: code
  question: 如何防自动恢复风暴？
  answer: 双层链上限——transient 类沿 metadata_.auto_resume_of 紧链回溯上限 2（9-10 D-005 同款）；quota 类单独计数上限 3（限流窗口天然限速，放宽）。
  impacts: FR-3.4/3.5、R-02。
  evidence: 9-10 变更 D-005 既有语义；quota 窗口 ≥5h 间隔不构成风暴面。

- id: D-008
  status: superseded
  source: code
  question: 定时消息如何融入 auto_resume 链？
  answer: agent_session_scheduled_messages 加 origin 列（与 queued_messages.origin 同构）；定时派发路径补 origin 解析+G10 超越守卫+auto_resume_of 打标；忙轮转排队带 origin。
  impacts: FR-4、FR-3.7、R-08、§5.4。
  evidence: queue.py:649-720 排队侧已实现同语义可平移。

- id: D-009
  status: superseded
  source: code
  question: 前端「自动重发中」提示怎么判定才不误导？
  answer: 双信号推导——error_detail 类型/reset_at + 会话当前存在 origin=auto_resume 的 pending 条目（排队∪定时）；有条目才显示自动文案，否则维持默认 hint。
  impacts: FR-5.1、§5.6。
  evidence: 纯类型静态文案在开关关闭/链上限到/排期失败时会显示「将自动继续」而实际不会。

- id: D-010
  status: accepted
  source: code
  question: 空 user_input 轮要恢复吗？
  answer: 不恢复（G0 守卫拦）。无任务语义，nudge 无意义。
  impacts: FR-3.2。
  evidence: d4c29d95 六个空输入 run（bb3e6878 等）completed 且 output 为空。

---

## v2 修订（Grill 独立审查后，2026-09-12）

- id: D-002@v2
  status: accepted
  supersedes: D-002@v1
  source: code
  question: resetAt 英文变体解析（v1：兼容 resets at/will reset）安全吗？
  answer: 收窄：只解析 GLM 中文「将于 … 重置」格式（+08:00 固定标注）；英文变体无时区信息不猜测，返回 null 退化为不排期。
  impacts: FR-1.2、R-04。
  evidence: Grill P2-11——+08:00 blanket 标注作用于英文变体会对非亚洲供应商错位数小时。

- id: D-004@v2
  status: accepted
  supersedes: D-004@v1
  source: code
  question: auth-transient「原样保留行为零回归」（v1）与 G0 全分支守卫矛盾？
  answer: auth 类并入统一判定序：走分支 B 干净轮重放（raw 正则保留）；行为面变化=新增 origin 标记+G0（开关/最新轮/双表幂等）对 auth 生效；开关关闭时 auth 不再自动重投（有意，与全类一致）；测试更新。
  impacts: FR-3.1、§5.3、R-09。
  evidence: Grill P1-3——两要求不可能同时成立；close_run_steps.py:744-758 旧 INSERT 不带 origin。

- id: D-008@v2
  status: accepted
  supersedes: D-008@v1
  source: code
  question: 定时派发落点与 inject 签名（v1 声称 inject_session_as_service 已有 auto_resume_of，零签名改动）？
  answer: 证伪修正：该参在私有 _inject_into_session（inject.py:391），公开 inject_session_as_service（:252-297）须加参 uuid.UUID|None 并转发；派发逻辑实体在 scheduled_send.py:86（非 scheduled_messages.py）；忙轮转排队经 queue.py:186-207 enqueue_message 补 origin 可选参。
  impacts: §5.4、§6 清单、R-08。
  evidence: Grill P0-1/P1-4——源码逐行核实。

- id: D-009@v2
  status: accepted
  supersedes: D-009@v1
  source: code
  question: 前端「父级已有两列表数据」（v1）成立吗？
  answer: 证伪修正：定时数据隔离在 ScheduledMessagesBar 局部 QueryClientProvider（scheduled-messages-bar.tsx:14-19）——需上提父层（两个挂载点）；且排队 DTO（SessionQueueEntry）与定时 DTO（ScheduledMessageRead）均无 origin 字段，后端各补一列透传，前端双信号才有数据源。
  impacts: FR-5.1/5.2、§5.6、§6 清单。
  evidence: Grill P1-6 + session_queue.py:34-70 / schema.py:400-420 核实。

- id: D-011
  status: accepted
  source: code
  question: 主实证断流文案 Stream ended without finish_reason 归哪类？
  answer: provider_error 规则体补断流关键词（stream ended/without finish_reason/stream truncat/silent stream/输出流中断/流中断）——v1 规则体该文案八类均不命中落 unknown，分支 C 不动作，主实证 8/9 拿不到恢复。
  impacts: §5.1、FR-1.1。
  evidence: Grill P0-2——classifier.ts:151-209 逐条核对。
