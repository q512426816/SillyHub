---
author: qinyi
created_at: 2026-09-19 19:20:00
---

# 决策记录 — 2026-09-19-tool-report-session-replay

背景实证：本变更发起 session（2026-09-19）对阿里云生产库（只读 SELECT）与本机
真实日志文件的逐 harness 实测；核心样本会话 `137ddfff-e612-47b9-9efd-749a3dfb4277`
（origin=tool_report，「本地 · 2026-09-19-ceremony-pricing-five-cuts」，1 主日志
13MB/118 调用 + 5 条 `subagent_agent_` 前缀子代理日志）。

---

## D-001@v1

- type: architecture
- status: confirmed
- source: user
- question: tool_report 纯日志会话（origin=tool_report 且 turn_count===0）的主体形态？（现状：AgentLogSessionBody 渲染日志元数据卡列表，对话内容藏在每条卡「查看内容」320px 嵌套小窗）
- answer: 直接按普通会话样式展示会话时间线，数据源换成 agent 日志对话化消息——复用真组件（TurnTimeline）而非自造相似渲染器
- normalized_requirement: 会话主体 = 会话时间线（TurnTimeline），经适配器把 NormalizedLogMessage[] 映射为 SessionTurnView（thinking/tool→processItems），「对话/全部」视图、轮次导航等会话既有能力直接生效
- impacts: [FR-01, task-frontend-*]
- evidence: 用户原话「应该直接按 会话样式展示，只是数据来源不一样而已」+「开干吧」；frontend/src/components/daemon/agent-log-card.tsx AgentLogSessionBody 现状（容器注释已预留与对话流互换）
- priority: P0
- 锚点: frontend/src/components/daemon/session-panel/session-panel-page.tsx:3474（isToolReportBody 分支）、frontend/src/components/daemon/turn-timeline.tsx:220（SessionTurnView）
- 模块域: frontend

## D-002@v1

- type: architecture
- status: confirmed
- source: user
- question: 一个 tool_report 会话挂多条日志（主会话 + 子代理）时回放正文怎么组织？（实证样本：6 条 = 1 主 + 5 子代理，主日志已含完整叙事、子代理以 Agent 工具调用回流结果）
- answer: 主日志 = 回放正文；子代理日志降级为次级「工作会话」入口（不并入正文，避免同一叙事重复两遍）；主日志多条（同 ctx 多次本地会话）时最新为主、更早折叠
- normalized_requirement: 子代理识别 = session_id/log_path 含 `subagent_agent_` 前缀（zcode 命名约定，实证 6/6 命中）；无前缀者为主日志；次级入口沿用会话面板对子代理工作会话的既有形态（折叠条/任务面板风格）
- impacts: [FR-01, task-frontend-*]
- evidence: 实证=生产库 platform_agent_logs where agent_session_id=137ddfff…（1 条 model-io-sess_c35fa872 主 + 5 条 subagent_agent_*）；主日志中 Agent 工具调用回流子代理结果
- priority: P0
- 锚点: frontend/src/components/daemon/agent-log-card.tsx:877（AgentLogCard 折叠栏——子代理入口可沿用该形态）
- 模块域: frontend

## D-003@v1

- type: architecture
- status: confirmed
- source: user
- question: 自主运行日志里 user 角色消息多为系统注入（实证：主日志 327 段仅 2 条 user 且均为 task-notification；claude-code 343 条 user 行绝大多数为 tool_result 载体/isMeta 注入），按用户气泡渲染会「内容不对」——归一化规则？
- answer: 跨 harness 通则——仅真人输入渲染为用户气泡；task-notification / system-reminder（zcode）、isMeta 与注入上下文（claude-code）、纯 tool_result 载体 user 行（claude-code）归一化为系统事件或工具段
- normalized_requirement: 解析器产出统一增加语义标记（真人 user / 系统事件 / 工具段），前端系统事件以中性徽章行渲染（不复用用户气泡样式）
- impacts: [FR-02, task-daemon-*]
- evidence: 实证=zcode 主日志全量解析（0 真人 user_input，2 条 task-notification）；claude-code 真实文件 6f02be06（343 user 行、isMeta 4、tool_result 载体 331）；用户对回放「内容不对」的原始反馈
- priority: P0
- 锚点: sillyhub-daemon/src/agent-log/parse-zcode-model-io.ts（SYSTEM_REMINDER_BLOCK_RE 剥离先例）
- 模块域: sillyhub-daemon

## D-004@v1

- type: architecture
- status: confirmed
- source: user
- question: token 用量在回放中的可得性？（现状：zcode 日志每次调用含 response.usage 五项 + 顶层 turnId/model/durationMs，但解析器全部丢弃；claude-code message.usage 四项；cursor-agent transcript 不落盘）
- answer: 四层打通——daemon 解析器透传 usage/turn/model/耗时 + 全会话累计 → RPC 返回结构 → 平台 GET /agent-logs/{id}/messages schema → gen:types → 前端映射到 SessionTurnView token 字段与会话用量环；老 daemon 字段可选、缺省显示「未知」；cursor-agent 回放 token 恒「未知」（数据不落盘，非解析器可解）
- normalized_requirement: NormalizedLogMessage 增可选 usage 段；窗口化下累计值必须由 daemon 一并返回（前端对窗口求和必算少）；ctx 口径 = 该轮最后一次调用 inputTokens（zcode inputTokens 已含 cacheRead，与平台 input+cache_read 口径一致）
- impacts: [FR-03, task-daemon-*, task-backend-*, task-frontend-*]
- evidence: 用户原话「还有 token 信息也要能获取到」；实证=zcode 主日志 response.usage 样本（in 513079/cacheRead 511104/out 780）、全会话累计 in 63.66M；claude-code 562/605 assistant 行非零 usage；cursor-agent 96 份 transcript 0 份含 usage 键
- priority: P0
- 锚点: sillyhub-daemon/src/agent-log/parse-zcode-model-io.ts:66（NormalizedLogMessage）、backend/app/modules/platform_sync/router.py:849（messages 端点）
- 模块域: sillyhub-daemon, backend, frontend

## D-005@v1

- type: architecture
- status: confirmed
- source: user
- question: 轮次边界信号？（此前误判 messageOffset 无重置即不可切轮——实证顶层另有 turnId）
- answer: zcode 按顶层 turnId 聚轮（实证 115 次调用聚 3 轮：子代理通知续跑/系统提醒/真人提问各一）；cursor-agent transcript 按 turn_ended 事件切轮；claude-code 按真人 user 消息天然切轮；每轮可挂自己的 token 小计；CLI 命令原文不在任何日志中（边界有、命令文本无），轮起点的「用户气泡」有真人文本用原文、无则用系统事件标记
- normalized_requirement: 解析器透传轮边界（zcode turnId / cursor turn_ended / claude-code user 边界），适配器按边界构造 SessionTurnView 轮
- impacts: [FR-01, FR-03, task-daemon-*]
- evidence: 实证=zcode 主日志 115 行 3 个 turnId（02:15 task-notification 起 / 02:26 system 起 / 03:56 真人「本次变更为什么跑那么久啊…」起）；cursor-agent 96 份中 89 份含 turn_ended
- priority: P1
- 锚点: sillyhub-daemon/src/agent-log/parse-zcode-model-io.ts（extractModelIoLine 需补读顶层字段）
- 模块域: sillyhub-daemon

## D-006@v1

- type: architecture
- status: confirmed
- source: user
- question: harness 覆盖矩阵？（用户要求「不光 zcode 其他 agent 也核对能否正确获取与显示」）
- answer: claude-code-jsonl 新增解析器并注册（对话化 + usage 一起落地，含 D-003 归一化）；cursor-agent CLI transcript 新增扫描上报（~/.cursor/projects/*/agent-transcripts/，现 96 份零上报）+ 新增解析器（结构干净 {role,message} JSONL + turn_ended，非 Claude Code 同构）；cursor IDE store.db（cursor-chat-sqlite）维持不做对话化（blob 库、无 token），但其 409 死胡同需给出像样说明；zcode 既有解析器补 D-004/D-005 字段
- normalized_requirement: 解析器矩阵 = zcode-model-io-jsonl（补字段）+ claude-code-jsonl（新增）+ cursor-agent-transcript（新增，格式串需与扫描上报层约定）；「Claude Code 兼容」按同族不同构处理（共用归一化思路、独立解析器）
- impacts: [FR-02, FR-03, task-daemon-*, task-cli-*]
- evidence: 用户原话「不光 zcode 其他 agent 你也核对下是否能正确获取，以及正确显示」；实证=生产库 harness 分布 zcode 418 / claude-code 4 / cursor 1；本机 96 份 cursor-agent transcript 未上报；store.db 83/247 blob 可读 JSON 但 0 token 字段
- priority: P0
- 锚点: sillyhub-daemon/src/agent-log/registry.ts:57（PARSERS 单项注册表——扩展点）
- 模块域: sillyhub-daemon, sillyspec

## D-008@v1

- type: architecture
- status: confirmed
- source: user
- question: 实现方案取舍——A 前端适配复用 TurnTimeline + 现读链路增强 / B 服务端落库物化轮次 / C 纯前端换皮？
- answer: 方案A——前端适配器把 NormalizedLogMessage[] 映射为 SessionTurnView 喂 TurnTimeline 真组件；daemon zcode 解析器补 usage/turnId/model/累计 + 新增 claude-code、cursor-agent 解析器与 cursor-agent 扫描上报；平台 messages schema 加可选字段 + gen:types；平台库零表结构改动，按需现读
- normalized_requirement: 渲染层单源（TurnTimeline）；数据层按需 RPC 现读（D-007 边界）；token/伪用户归一化均在 daemon 解析器层解决（C 方案被否的根因）
- impacts: [全部 task]
- evidence: 方案选择轮（AskUserQuestion 2026-09-19，用户选「方案A 适配复用（推荐）」）；B 违反 D-007（L3 不进本期）；C 违反 D-001/D-004（token 在 daemon 层被丢弃、前端无解）
- priority: P0
- 锚点: decisions.md D-001/D-004/D-007
- 模块域: frontend, sillyhub-daemon, backend

## D-007@v1

- type: scope
- status: confirmed
- source: user
- question: L3（解析产物落库持久化）与 cursor-agent provider 运行时捕获是否进本期？
- answer: 不进——本期回放沿用按需 RPC 现读（daemon 在线 + 本地文件未被清理为前提）；落库与 provider 化单独决策。附带风险如实呈现：机器离线/本地文件清理（zcode rollout、~/.cursor 每日清理标记）后回放不可用，会话界面需给出明确离线/不可读提示
- normalized_requirement: 本期不做内容持久化；「回放不可用」状态显式化（daemon 离线 / 文件缺失 / 格式不支持三态提示）
- impacts: [FR-01, FR-04]
- evidence: 开干提示词明示「L3 落库与 cursor-agent provider 化单独决策不在本期」，用户「开干吧」无异议；实证=~/.cursor/projects/.agent-data-cleanup-* 每日清理标记
- priority: P1
- 锚点: backend/app/modules/platform_sync/router.py:597（_resolve_agent_log_read_target 现读通道）
- 模块域: backend

---

## 附：harness 覆盖矩阵（实证快照，2026-09-19）

| 数据源 | 上报 | 对话化 | token | 本期动作 |
| --- | --- | --- | --- | --- |
| zcode rollout jsonl + db.sqlite | ✅ 418 条 | ✅ 已有解析器 | 格式有、链路丢弃 | 补 usage/turnId/model/累计 |
| claude-code jsonl | ✅ 4 条 | ❌ 无解析器（原文回落） | 格式有 | 新增解析器（含 usage） |
| cursor-agent CLI transcript | ❌ 96 份零上报 | ❌ | ❌ 不落盘 | 新增上报 + 解析器（token 恒未知） |
| cursor IDE store.db | ✅ 1 条（409 死胡同） | ❌ blob 库 | ❌ | 不做对话化，修提示 |
