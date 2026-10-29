---
author: flow-machine-draft
created_at: 2026-10-29T05:06:35.340Z
---
# 需求规格（Requirements）— 2026-10-29-engine-live-perception

## 功能需求

### FR-01: daemon 三引擎心跳源——长操作期间按引擎能力产出实时心跳

覆盖决策：D-001@v1
Given 会话轮内模型正在生成工具参数（如写大文件）或等待首包
When Claude（input_json_delta 字符计数）/ codex（token_usage_updated 权威值）/ zcode（遥测 chunkLength，实测覆盖面不足则降级）各引擎中途信号到达
Then daemon **必须**节流 1s 产出一条 turn_heartbeat 心跳消息（kind ∈ awaiting_first_token/generating，precision 标 estimated/authoritative，est_chars 字符口径 string.length，估算系数 3.5 字符/token），轮收尾**必须**停发并清零计数器（fail-soft：心跳源异常静默停发不影响轮次收敛）。

#### 场景：Claude 大文件写入

Given Claude 引擎模型正在流式生成 Edit 大参数（input_json_delta 持续到达）
Then 每秒至多一条心跳（kind=generating, estimated, est_chars 累计），轮结束清零

#### 场景：zcode 遥测不覆盖工具参数流（降级）

Given spike 实测 zcode stream.chunk 不覆盖工具参数生成期
Then zcode 心跳降级为 awaiting_first_token 活跃脉冲（结论落 design 注记），通道契约不变

### FR-02: backend 心跳端点不落库直发 + 三端键名逐字对齐

覆盖决策：D-001@v1
Given daemon 经 onTurnMessage 鸭子消息上报 turn_heartbeat_report
When daemon.ts 拦截并 POST turn-heartbeat 端点（照抄 turn_phase 先例）
Then backend notify 端点（越权防护照抄 notify_turn_phase）**必须**经 Redis SSE 直发前端且**禁止**落库 AgentRunLog；SSE 载荷键名（kind/est_tokens/precision/source/parent_tool_use_id/timestamp）daemon/backend/frontend 三端**必须**逐字对齐同提交（D-backend-039 铁律）。

#### 场景：心跳不膨胀日志表

When 心跳以 1s/条持续 5 分钟（长会话）
Then AgentRunLog 表零新增行，SSE 正常收到每条心跳

### FR-03: 前端等待三态 + 估算补显 + main 优先选主

覆盖决策：D-001@v1
承接: FR-frontend-064
Given 轮内跑马灯等待条目渲染（最新真实条目非 running）
When 心跳状态到达（main 心跳）或无心跳
Then 等待条目**必须**呈现三态——无心跳=「等待模型响应 · Ns」（现状不变）；awaiting_first_token=「正在等待模型响应 · 已发送上下文」；generating=「正在生成大段内容 · 已产出约 N token」；估算值**必须**带「约」+弱化灰与权威值视觉区分，权威 usage 落定后补显消失；心跳持续 >30s **必须**追加「大内容可能需要几分钟」；子代理心跳（parent_tool_use_id 非空）**禁止**驱动主会话跑马灯（路由子代理卡片）。

#### 场景：估算与权威值区分

Given generating 心跳持续（est_tokens=12000）
Then 显示「已产出约 12,000 token」（灰），段落结束权威 ↓54,160 更新后估算补显消失

#### 场景：主/子代理并发

Given 主 agent 与子代理同时长操作（两路心跳并发）
Then 主会话跑马灯只显示 main 心跳，子代理卡片显示子代理心跳，互不抖动

### FR-04: 估算值零污染聚合

覆盖决策：D-001@v1, D-002@v1
Given 心跳消息流经 daemon 事件通道与 backend
Then 估算值/心跳**禁止**进入 usage 台账（liftSessionUsage）、预算软切断、计费聚合、ctx 环与 tok/s 分子——既有 usage 消费面行为**必须**零变化。

#### 场景：预算切断阈值不受心跳影响

Given 心跳持续产出 est_tokens 累计值
Then aggregateSessionUsage/checkBudgetCutoff 输入与无心跳时完全一致

### FR-05: 无心跳兼容回退（brownfield）

覆盖决策：D-001@v1
Given 旧 daemon / 历史会话 / 心跳链路任一环失败
Then 前端无心跳状态**必须**回落现状纯计时等待条目（FR-frontend-064 行为零回归）；心跳刷新 lastEventAt **禁止**（语义=最后真实内容事件）。

#### 场景：旧 daemon 会话

Given daemon 未升级（无 turn_heartbeat SSE 事件）
Then 等待条目行为与本变更前完全一致

### FR-06: 测试与静态检查全绿

Given 本变更落地
Then daemon 三引擎心跳源用例、backend 端点用例、前端三态/选主/落定即隐用例**必须**全部通过且既有相关测试零回归；触及项目 tsc/eslint 0 error。

## 测试绑定（每条 FR 至少一行——`FR-NN: test/路径「用例名」`）

FR-01: sillyhub-daemon/tests/interactive/claude-events.test.ts「input_json_delta 心跳计数/节流/轮收尾清零」；sillyhub-daemon/tests/interactive/zcode-events.test.ts「遥测 chunkLength 累计与降级路径」；sillyhub-daemon/tests/interactive/codex-app-server-driver.test.ts「token_usage_updated 桥接心跳」
FR-02: backend/app/modules/daemon/tests/test_turn_heartbeat_events.py「turn_heartbeat SSE 直发不落库」（端点测试实际落位于模块内 tests，对齐 test_turn_phase_events.py 先例）
FR-03: frontend/src/components/daemon/__tests__/turn-live-marquee.test.tsx「等待三态与估算补显（FR-03）」（用例并入跑马灯测试正家；main 选主另由 session-panel/__tests__/turn-heartbeat-state.test.tsx 覆盖）
FR-04: sillyhub-daemon/tests/interactive/claude-events.test.ts「心跳消息不进 usage 台账聚合」
FR-05: frontend/src/components/daemon/__tests__/turn-live-marquee.test.tsx「无心跳 → 现状纯计时文案（零回归）」
FR-06: 不适用：静态检查为 tsc/eslint 命令面，聚合于收口实测
