---
author: qinyi
created_at: 2026-10-29T02:53:00.000Z
---

# 决策记录（Decisions）— 2026-10-29-engine-live-perception

## D-001@v1: 长操作实时感知走独立 turn_heartbeat 事件通道
- type: architecture
- priority: P0
- status: confirmed
- supersedes:
- source: user
- question: 三引擎中途心跳（估算用量/活跃信号）走哪条通道——并入既有 usage_update、新增独立心跳事件、还是不动 daemon 只做前端等待态分级？
- answer: 用户选定方案二（新增独立心跳事件），事件名细化为 turn_heartbeat（防与 hub-client 机器级 heartbeat 同名混淆，命名细化不改变决策语义）。载荷：kind（awaiting_first_token/generating_tool_args/generating_text）+ est_chars/est_tokens + precision（authoritative/estimated）+ source + parent_tool_use_id；不落库只透传、节流 1s、估算系数 3.5 字符/token（三项 agent 代定，用户核阅无异议）。估算值与权威 usage 彻底分道：预算软切断、计费聚合、ctx 环零污染（对齐 2026-08-27「实时/终态口径必须同类」）；前端专道消费，估算补显标「约」+弱化灰、权威值落定即隐。
- normalized_requirement: 长操作期间界面呈现真实实时信号；估算值禁止进入用量聚合/预算/计费/ctx 环；三引擎归一单通道；无心跳时回落现状纯计时。
- impacts: [FR-01, FR-02, FR-03, FR-04, FR-05]
- evidence: 方案选择轮（2026-10-29 本会话 AskUserQuestion 用户亲手选定「方案二」）；机制词检索命中 patterns.md「2026-08-27 会话 token 两套口径」
- 锚点: sillyhub-daemon/src/types.ts:AgentEvent
- 模块域: frontend, sillyhub-daemon, backend
- 故障面: 心跳节流器/计数器轮结束未清理导致跨轮残留（R-02）；估算值误入聚合（R-03，类型级排除防护）
- 退役判据: 引擎侧（Claude SDK/智谱/codex）原生提供流式 usage 增量且覆盖工具参数期时，本心跳桥接层可简化退役

## D-002@v1: 落选——估算并入既有 usage_update 通道
- type: architecture
- priority: P1
- status: rejected
- supersedes:
- source: user
- question: 同 D-001。
- answer: 不采用（用户选定方案二，本条为落选防复潮记录）。
- normalized_requirement: 不适用（rejected）。
- impacts: []
- evidence: 方案对比轮劣势论证 + patterns.md 2026-08-27 条目
- 否决理由: usage 字段语义被估算值污染——预算软切断（liftSessionUsage/aggregateSessionUsage/checkBudgetCutoff）、计费聚合、ctx 环所有既有消费方都需防「估算混入聚合」，漏防一处即钱与切断阈值的事故面；与 2026-08-27「实时/终态口径必须同类」决策正面冲突（轮结束权威值落定必跳变）。
- 复潮条件: usage 消费面收敛到单一展示用途且预算/计费全部改走独立聚合源时成本反转。

## D-003@v1: 落选——纯前端等待态分级（不动 daemon）
- type: architecture
- priority: P2
- status: rejected
- supersedes:
- source: user
- question: 同 D-001。
- answer: 不采用（用户 P0 裁决 C 要求估算数字按引擎能力补显，纯文案不满足）。
- normalized_requirement: 不适用（rejected）。
- impacts: [FR-04]（等待态分级文案部分并入实现；作为 zcode 遥测实测不覆盖时的降级兜底形态，见 design R-01）
- evidence: 方案对比轮 + 用户 P0 裁决（C 选项）
- 否决理由: token 数字全程不动只换文案，不满足用户 P0 裁决 C（估算补显），治标不治本。
- 复潮条件: daemon 侧改动长期不可行（引擎面冻结）时可作为降级兜底单独启用。
