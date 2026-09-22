---
author: qinyi
created_at: 2026-09-22 11:25:23
generated_by: sillyspec-fourpiece-init
change: 2026-09-22-session-fork-continuation
---

# 决策记录（Decisions）

<!-- 增量落盘：每解决一个有实现影响的问题当场追加一条（格式见 brainstorm Step 3 模板）；幂等按 D-xxx@vN 判重 -->
<!-- 引用规范：evidence 等处的源码位置写仓根相对全路径+行号（src/foo.js:123）——裸文件名在 docs-check 层1 靠 basename 全仓扫描找候选，找不到候选或关键词窗口不匹配即失效，到 pre-push 才拦（2026-09-19 实证 64 处返工） -->

## D-001@v1: 通用会话分叉为纲，handoff 续接为特例后置
- type: premise
- priority: P0
- status: accepted
- source: user
- question: 分叉能力是 sillyspec handoff 专用还是通用会话能力？
- answer: 用户明确要通用：「这个能力我想更通用点，不光 handoff 指令才能用，正常会话中我也想要能随时选择具体某个时间点会话去做分叉继续对话」。handoff 自动续接定位为该通用能力的「机械选点」特例，不阻塞通用路径交付。
- normalized_requirement: 分叉入口对任意普通会话可用（不依赖 sillyspec 变更上下文）；选点 UX 引擎无关；handoff 特例后置独立交付。
- impacts: [FR-01]
- evidence: 用户原话（2026-09-22 本变更前置 explore 第 4 轮）；代码事实 sillyhub-daemon/src/interactive/session-manager/persistence.ts:456-465（现状 resume 仅整会话、无选点）

## D-002@v1: 分叉溯源 UX = 子代理式「块 + 点击浮层看原会话」
- type: boundary
- priority: P1
- status: accepted
- source: user
- question: 分叉会话如何回看被分叉的原会话？
- answer: 用户要「类似子代理这样，点击可以看原会话信息」——复用分身浮层形态（WorkerSessionOverlay 内嵌完整 SessionPanel），方向反过来指向父会话；多跳分叉呈链式可逐级回看。
- normalized_requirement: 分叉会话内提供常驻溯源块（分叉自哪个会话、锚在哪轮），点击以浮层打开原会话完整记录；组件复用 frontend/src/components/daemon/session-panel/worker-session-overlay.tsx 既有形态。
- impacts: [FR-05]
- evidence: frontend/src/components/daemon/session-panel/worker-session-overlay.tsx:40-83（通用浮层仅吃 subSessionId+onClose）；用户原话（explore 第 3 轮）

## D-003@v1: 分叉点粒度 = 轮（AgentRun）边界
- type: term
- priority: P0
- status: accepted
- source: code
- question: 「具体某个时间点」映射到什么数据粒度？
- answer: 平台数据模型一轮=一个 AgentRun（轮次序=run 创建序是既有语义），引擎侧 Claude resumeSessionAt 以消息 UUID 为锚——平台选点粒度定为轮边界（第 N 轮后分叉），引擎锚点由该轮末尾消息映射派生，不发明新粒度。
- normalized_requirement: 选点 UI 以轮为单位；分叉语义=新会话继承截至第 N 轮（含）的全部上下文，第 N+1 轮起两侧独立。
- impacts: [FR-02]
- evidence: backend/app/modules/agent/model.py:45-115（AgentRun=轮）；backend/app/modules/daemon/router/session_insights.py:306-311（轮次序语义注释）；sillyhub-daemon/node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts:1886-1892（resumeSessionAt 消息 UUID 语义）

## D-004@v1: 引擎两档——claude 原生真分叉 + codex/pi 种子式降级
- type: architecture
- priority: P0
- status: accepted
- source: user
- question: v1 各引擎分叉语义怎么定？
- answer: 用户拍板「claude 真分叉 + 其余种子式」——claude 走 SDK resumeSessionAt+forkSession 真截断；codex/pi 用「截至分叉点的前情转述作首条消息」降级（新会话读到的是转述而非原生历史）。能力位按引擎分档，UI 明确标注两档语义差异。
- normalized_requirement: ProviderCaps 增分叉能力位（区分原生/种子两档，三端生成单源）；claude 分叉后新会话上下文=截断原生历史；codex/pi 分叉=转述种子；前端按能力位出按钮+降级标注。
- impacts: [FR-03, FR-04]
- evidence: sillyhub-daemon/node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts:1886-1930（resumeSessionAt/resumeDropsTurn）与 :1548-1551（forkSession）；sillyhub-daemon/src/interactive/providers.ts（PROVIDER_CAPS 15 键三端生成单源）；用户回答（2026-09-22 AskUserQuestion）
- 故障面: 种子档被误当真分叉——前情细节有损（转述≠原文），UI 不标注会引发「模型忘了」误报；能力位取值错误会让 codex/pi 走到原生参数路径直接失败
- 退役判据: codex/pi 引擎出现原生任意点恢复能力时，该档能力位置 true 并退役种子链路

## D-005@v1: 原会话分叉后保留可继续（git 语义）
- type: boundary
- priority: P1
- status: accepted
- source: user
- question: 分叉后原会话 A 的状态？
- answer: 用户选「保留可继续」——分叉对原会话零状态影响，两边并行各聊各的；防双活约束不适用于通用分叉场景，handoff 特例的「交接后冻结」语义由后置变更另行定义。
- normalized_requirement: 分叉动作不修改原会话任何字段（状态/当前轮/指针）；原会话可继续正常对话；分叉记录单向挂在子会话侧。
- impacts: [FR-02]
- evidence: 用户回答（2026-09-22 AskUserQuestion）

## D-006@v1: handoff 自动续接不并入本变更
- type: boundary
- priority: P0
- status: accepted
- source: user
- question: handoff 阶段边界自动切窗是否本期交付？
- answer: 用户选「不并入，后置独立变更」——本变更只交付通用手动分叉闭环（选点→分叉→谱系展示→溯源回看）；handoff 触发器、种子链、sillyspec CLI --json 补种子字段全部后置。
- normalized_requirement: 本变更不含任何 sillyspec handoff 集成与自动触发；变更验收面不包含机械切窗场景。
- impacts: [FR-01]
- evidence: 用户回答（2026-09-22 AskUserQuestion）

## D-007@v1: 分叉执行链路 = 方案C（backend 主导管道扩展 + pi 原生 fork 接线）
- type: architecture
- priority: P0
- status: accepted
- source: user
- question: 分叉执行链路架构选型（A=backend主导管道扩展 / B=daemon统一fork RPC文件手术 / C=A+pi原生接线）
- answer: 用户选方案C——以方案A为基座（backend 主导：claude 走既有 create-with-resume 管道加 fork 参数透传 resumeSessionAt+forkSession，daemon 不新增协议消息；种子组装在 backend 读库），追加 pi 原生 fork 接线：pi RPC 的 fork/switch_session 截断语义先 spike 实测，能截断则 pi 原生档、不能则退种子档；codex v1 种子档。
- normalized_requirement: 执行链路 backend 主导（lease.metadata 扩展 fork 字段 → daemon 既有 resume 链 → driver 参数，无新 WS 协议消息）；pi 定档以 spike 断言「能否截断到指定消息」为前置门，spike 结论落盘后再锁 FR 档位。
- impacts: [FR-03, FR-04]
- evidence: 用户回答（2026-09-22 方案选择轮，AskUserQuestion）；pi RPC fork 命令线索 sillyhub-daemon/src/interactive/pi-rpc-driver.ts:780-782（注释「平台明确未接」）；claude 侧先例 sillyhub-daemon/src/interactive/claude-sdk-driver.ts:476-479（forkSession 生产使用）
- 故障面: pi spike 失败退种子档（预期内降级）；pi fork 若实为「整文件分叉无截断」而误标原生档 → 分叉点语义错误，必须以 spike 断言截断行为定档
- 退役判据: codex 后续版本提供任意点恢复 API 时升原生档，退役种子链路
