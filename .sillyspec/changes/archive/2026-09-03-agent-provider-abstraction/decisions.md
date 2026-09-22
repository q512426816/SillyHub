---
author: qinyi
created_at: 2026-09-03 23:20:00
---

# 决策记录（Decisions）

## D-001@v1: 实施路线——渐进下沉（双轨兼容）而非契约替换或最小注册表
- type: architecture
- priority: P0
- status: accepted
- source: user
- question: 通用 agent 接入抽象（P1 事件契约 + P2 注册表/能力矩阵）采用哪种实施路线？A 渐进下沉（事件契约双轨兼容）/ B 契约替换（一步到位删旧协议）/ C 最小注册表（跳过事件契约）
- answer: 方案A 渐进下沉。driver 内归一化吐 AgentEvent，backend/前端双轨兼容新旧两种事件格式，验证稳定后再退役旧文本协议（退役为后续 change）
- normalized_requirement: ①每个 Wave 独立可验收、Claude 链路随时可回退；②旧 `[ASSISTANT]` 文本协议在双轨期保持兼容不扩展新能力；③终态是旧协议退役，双轨是过渡手段不是终态
- impacts: [FR-01, FR-02, FR-03]
- evidence: 用户 AskUserQuestion 方案选择轮（2026-09-03），对比表见 brainstorm 会话；multica 调研结论支撑（统一事件通道是其 23 agent 滚雪球的根基，本方案继承该模式但以双轨降低切换风险）

## D-002@v1: 会话级信号的承载方式——status 事件 subtype + 有状态归一化器，raw 降格为调试通道
- type: architecture
- priority: P1
- status: accepted
- source: design-grill
- question: SessionManager._onMessage 现有 10+ 类会话级消费（bash/plan/task_notification/system-init→agentSessionId/codex thread_started/depth 状态机）依赖 raw SDK 消息形状，事件契约如何承载而不丢语义？
- answer: ①会话级信号全部事件化为 status 型 + subtype 枚举（session_started/bash_status/plan_mode/agent_task_status/task_notification），SessionManager 改按 subtype 分发；②depth 状态机等跨消息状态由有状态归一化器类（ClaudeEventNormalizer，每会话实例）内部维护；③envelope.raw 仅在 SILLYHUB_DEBUG_RAW_EVENTS=1 时携带，下游禁止依赖（cli.ts 的 SDKMessage 接线随之演进）
- normalized_requirement: driver 契约演进后 SessionManager/daemon.ts/cli.ts 对 provider raw 消息形状的依赖清零；现 _onMessage 每类会话逻辑在 status subtype 分发表中有对应项（plan 任务含对账表）
- impacts: [FR-02, FR-04]
- evidence: Grill B-02/CC-14/CC-15（session-manager.ts:4557-4866 十余类消费面实读；cli.ts:752-771 类型接线）；design.md v2 §5.1/§7

## D-003@v1: usage 实时透传语义——任意携带 usage 的事件即更新，不限 turn_result
- type: consistency
- priority: P1
- status: accepted
- source: design-grill
- question: design v1 写"usage 按 turn_result 更新"，但现行为在 partial flush 中途即实时更新 AgentRun token 并透传 SSE summary——照 v1 执行即回归
- answer: 对齐现行为：任意携带 usage 的 AgentEvent（含 partial text/thinking flush 事件）→ daemon lift → backend 更新 agent_runs token 统计 + SSE summary 实时透传（现链路锚点 daemon.ts:3564-3586、service.py:357-370）
- normalized_requirement: golden fixture 覆盖 usage 断言（partial 中途与 turn 终态两处）；SSE summary token 字段回归测试
- impacts: [FR-02]
- evidence: Grill B-03/CC-16（session-manager.ts:5895-5987 attachUsage 实读）；design.md v2 §5.1/§7.5/R-07

## D-004@v1: partial override 撤回的事件化表达——override:true + segment_id
- type: architecture
- priority: P1
- status: accepted
- source: design-grill
- question: 现协议用 [ASSISTANT_OVERRIDE]/[THINKING_OVERRIDE] 文本信号触发"按 segment_id DELETE 已落库 partial 再写完整行"，AgentEvent 8 型联合无该信号承载
- answer: text/thinking 事件增加可选 override:boolean——true 表示替换同 segment_id 已落库 partial 行；backend 行为对齐现有 stale 撤回链（DELETE by (run_id, segment_id) → INSERT）。partial/override 归一化逻辑移植自 daemon session-manager 现实现（非 backend _extract_sdk_messages，后者对 stream_event 恒返回空）
- normalized_requirement: golden 三源对照覆盖 partial→override→撤回全链路（backend 展开行 + daemon flush 行 + 落库行联合语义）
- impacts: [FR-02, FR-05]
- evidence: Grill B-01/CC-03/CC-17（service.py:3474-3476 stream_event 空 return；session-manager.ts:5864-5988 flush 链实读）；design.md v2 §5.1/§7/§7.5/R-01

## D-005@v1: AgentEvent v2 契约补遗——status 增 thinking_tokens 子类型、usage 增 ctx_tokens 字段
- type: consistency
- priority: P1
- status: accepted
- source: code
- question: task-03 实现对照真实链路发现两处契约缺口——①legacy 链路发 [SYSTEM:thinking_tokens] 行（thinking token 计数）但 AgentStatusSubtype 六值枚举无承载，新轨会静默丢弃；②现 SSE summary 有 ctx_tokens（上下文环大小）实时透传但 AgentEventUsage 封闭 4 字段，zod 剥离多余键，新轨轮内环实时显示缺失
- answer: 契约微扩：AgentStatusSubtype += 'thinking_tokens'；AgentEventUsage += ctx_tokens?: number。归一化器对应产出（thinking_tokens 子类型事件、usage 差分携带 ctx_tokens）
- normalized_requirement: 双轨期新旧两轨的可见信息集合一致（Claude 零回归目标 2 的推论）；task-13 双路径等价测试覆盖这两个信号
- impacts: [FR-01, FR-02, task-03, task-12, task-13]
- evidence: task-03 实现报告未决问题 1/2（session-manager PARTIAL_FLUSH_MS/ctx_tokens 现链路实读）；design §7.5 ctx_tokens 透传注释

## D-006@v1: 双轨渲染已知改进差异的取舍——主 agent Task tool_result 配对（新轨 call_id 优先）与 cache_* 完整帧聚合（新轨更全）
- type: compatibility
- priority: P2
- status: accepted
- source: code
- question: 双路径等价测试暴露两处新旧轨差异：①主 agent 的 Task tool_result 行（无 parent 归属）——旧轨邻近退化落到子代理的工具卡（错卡渲染），新轨 call_id 精确落 Task 卡（语义正确）；②完整消息帧的 cache_* tokens——旧轨 flat stamp 被 inner 优先分支覆盖导致从不落库（隐性缺陷），新轨事件短名化后正常聚合
- answer: 均接受为已知改进差异（新轨行为更正确），以豁免/可执行登记形式固化（dual-path fixture 豁免 #2 + TestDocumentedFormatDivergences/§2 差异冻结测试），不要求新轨复刻旧轨缺陷；旧轨本身零改动（回退轨保真）
- normalized_requirement: 差异必须有测试冻结（任一侧语义变化即红灯）；旧轨行为一字不改；后续退役旧轨时该差异自然消失
- impacts: [FR-04, task-12, task-13]
- evidence: task-13 回修报告残留仲裁（旧轨 normalize.ts:1241-1264 无 call_id 通道实证）；task-12 不一致 1（service.py:3526-3531/1283-1284 实读）
