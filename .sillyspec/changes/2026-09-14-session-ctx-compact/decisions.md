---
author: qinyi
created_at: 2026-09-14 10:52:03
---

# 决策记录 — 2026-09-14-session-ctx-compact

## D-001@v1：v1 范围=仅手动触发按钮（三引擎），自动压缩配置不纳管

- type: scope
- status: confirmed
- source: user
- question: 压缩功能 v1 范围怎么定？
- answer: 用户选「仅手动触发」——上下文环浮层加「压缩上下文」按钮，caps 第 12 键 compact 门控（claude/pi/codex=true，cursor=false）；自动压缩维持各引擎自身默认行为（pi set_auto_compaction / claude autoCompactThreshold / codex AutoCompactTokenLimit）不纳管，留二期。
- normalized_requirement: 手动压缩按钮（caps 门控）+ driver 级压缩触发 + 压缩事件可见；无自动压缩配置管理。
- impacts: daemon drivers + 控制通道 + backend 端点 + frontend 按钮 + caps 三端；不含各引擎压缩设置管理。
- evidence: brainstorm step 3 AskUserQuestion 轮（2026-09-14）。
- priority: high
- 模块域: sillyhub-daemon, frontend, backend

## D-002@v1：触发时机=仅 turn 空闲可压（轮中禁用）

- type: definition
- status: confirmed
- source: user
- question: 压缩按钮的触发时机约束？（pi compact 会先 abort 在跑的轮）
- answer: 用户选「仅空闲时可压」——turn running 时按钮禁用（提示「轮运行中」），turn 空闲后才可压缩；不打断用户正在跑的任务（各引擎原生 /compact 也都是空闲交互语义）。
- normalized_requirement: 前端按 turn 状态禁用；daemon 侧 compact 控制入口对 running 轮拒绝（防御性双保险，不只靠 UI）。
- impacts: frontend 按钮态 + session-manager compact 守卫。
- evidence: brainstorm step 3 AskUserQuestion 轮（2026-09-14）。
- priority: high
- 模块域: sillyhub-daemon, frontend

## D-003@v1：接入架构=专用压缩控制通道（方案 A），否决 inject 文本复用（B）与每引擎端点（C）

- type: architecture
- status: confirmed
- source: design
- question: 平台如何把「压缩」动作送达各引擎？
- answer: 方案 A——专用语义通道：backend `POST /api/daemon/sessions/{id}/compact` → WS 控制消息 SESSION_COMPACT（对齐既有 SESSION_INJECT 派发形态）→ session-manager 新 compact 控制入口（running 拒绝守卫）→ 按 provider 分派：claude=内部转 inject 文本 `/compact`（SDK 处理 slash）；pi=`_sendCommand {type:'compact'}`（复用通用命令通道，结构化回执）；codex=`thread/compact/start {threadId}`；cursor=无（caps false 前端不渲染 + daemon 拒绝）。压缩边界事件透传为系统提示行（pi compaction_start/end、claude compact_boundary、codex thread/compacted）。
- normalized_requirement: ①caps 第 12 键 compact 三端贯通（D-001 关联）；②专用控制链路而非文本复用；③事件可见性（系统提示行 + pi 回执数据展示）。
- impacts: protocol.ts CONTROL_KIND + daemon 路由 + session-manager + 三 driver + 三归一化器事件映射 + backend 端点/schema + frontend API/按钮/门控。
- evidence: 方案对比轮（brainstorm step 4）：B（inject 文本 /compact）仅 claude 有效——pi 的 prompt 文本 /compact 只会当普通文本送模型、codex turn/start input 文本同理，无法覆盖三引擎；C（每引擎独立端点）违背统一抽象且 caps 无处消费。A 是唯一三引擎可达且语义干净的路径。
- priority: high
- 否决理由: B 数据形态不可行（两引擎不认文本命令）；C 违背 caps 统一抽象。
- 复潮条件: 若未来引擎全部支持文本 slash 通道可重评 B 的轻量性。
- 模块域: sillyhub-daemon, frontend, backend

## D-003@v2：接入架构 v2——claude=backend inject 复用 / pi=控制命令+回执 / codex=控制命令+新 pending 机制；呈现=端点响应通知

- type: architecture
- status: confirmed
- supersedes: D-003@v1
- source: design-grill
- question: v1 方案的 task_notification 事件呈现链（Grill X-f 双层断裂）与 claude run 归属（X-a 自相矛盾）如何修？
- answer: ①claude 定案走 backend inject 服务复用（prompt="/compact"，原生建 run、/compact 轮在会话流天然可见，daemon 零改动）；②pi/codex 走 SESSION_COMPACT 控制命令 + 控制结果回传（backend 轮询 15s），pi 回执数字进端点响应；③呈现改为前端通知三分型（pi 带数字/codex 受理/claude 已发送），放弃会话流系统提示行（task_notification 通道 daemon 侧三重拦截+唤醒注入副作用、前端侧瞬时事件不渲染，双层不可行）；④引擎内部 compaction 通知维持现状不透传。
- normalized_requirement: FR-02 双分路 / FR-03 inject 复用 / FR-04-05 控制命令 / FR-07 响应通知；NG-04/NG-07。
- impacts: 同 design v2 文件清单（含 Grill X-d 补的 protocol.py/control_commands.py；移除 control-dispatcher.ts）。
- evidence: Grill review X-a/X-b/X-c/X-d/X-f 实核锚点（background-tasks.ts:201-261/session-stream.ts:318/session-log-assembler.ts:297/turn-control.ts:157/events.ts:53-68 等）。
- priority: high
- 否决理由: v1 task_notification 呈现链双层断裂；claude driver 内入队与不建 run 矛盾。
- 复潮条件: 前端引入会话流系统事件渲染能力后可重评流内呈现。
- 模块域: sillyhub-daemon, frontend, backend

## D-004@v1：反馈呈现=端点响应回执 + 前端通知三分型

- type: definition
- status: confirmed
- source: design-grill
- question: 压缩结果如何让用户感知（v1 会话流系统行被 X-f 否决后）？
- answer: 端点响应承载回执，前端按 provider 分型通知：pi「已压缩：X → 约 Y tokens」（数字来自 RPC response）/ codex「已触发上下文压缩」（受理无数字）/ claude「已发送 /compact（压缩轮运行中）」（流程可见性由会话流中的 /compact 轮本身承载）；失败通知带 error 原文（如 pi "Nothing to compact"）。
- normalized_requirement: FR-06/07；CompactResult→控制结果→SessionCompactResponse 字段链。
- impacts: backend DTO + frontend mutation 通知 + 无会话流改动。
- evidence: Grill X-f（现呈现链不可行）+ sdk.d.ts:3191-3213（claude 边界帶数字但 v1 不透传）。
- priority: high
- 模块域: frontend, backend

## D-003@v3：pi/codex 结果回传定案 ws RPC（send_rpc + registerRpcHandler），砍 SESSION_COMPACT 控制机器

- type: architecture
- status: confirmed
- supersedes: D-003@v2（仅回传机制部分，其余维持）
- source: design-grill-recheck
- question: v2 的「控制命令结果经 ack 回传 + backend 轮询」被复审证伪（ack 全链 ids-only/表无 result 列/handlers 无返回值通道），回执链如何承载？
- answer: 复用既有 ws RPC 请求-结果通道：backend 端点 ws_hub.send_rpc(daemon_id, 'session_compact', {session_id}, timeout=15)（ws_hub.py:502-560，DaemonRpcTimeout/Offline/RemoteError 异常齐备）；daemon 侧 registerRpcHandler('session_compact')（daemon.ts:6438-6456 既有四先例）→ sessionManager.compact → CompactResult 即 RPC result。SESSION_COMPACT 控制机器三件套（backend protocol.py/control_commands.py + daemon protocol.ts/daemon.ts 三点接线）全部弃用；「无 schema 迁移 / control-dispatcher 零改动」在 v3 下为真。
- normalized_requirement: FR-02 pi/codex 路 = ws RPC；Wave B/C 与文件清单按 v3 收敛。
- impacts: 较 v2 净减 4 文件改动（protocol.py/control_commands.py/protocol.ts + daemon.ts 三点变单点）。
- evidence: 复审 RC-4（P0-3 证伪锚点）+ 本轮主代理实读 send_rpc/registerRpcHandler 先例。
- priority: high
- 模块域: sillyhub-daemon, backend
