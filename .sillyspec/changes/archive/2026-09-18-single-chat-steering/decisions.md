---
author: qinyi
created_at: 2026-09-18 16:55:00
---

# 决策记录 — 2026-09-18-single-chat-steering

格式：id / status: accepted|rejected|superseded / source: user|code|docs / question / answer / normalized_requirement / impacts / evidence。修正走新版本 D-xxx@v2 + supersedes。

---

- id: D-001
- status: accepted
- source: user
- question: 单聊在 agent 忙轮时发消息的默认行为？
- answer: 用户原话「单聊也要这样做」（承接上一轮对 pi 原生 steer 的调研结论：发送不打断当前轮，直接引导注入活跃轮）。忙轮发送 = steering 直注入，不打断当前输出；带配置切换维度（agent_profile/provider/model）的消息保持轮边界语义不变（仍排队/409）。interrupt（立即打断）按钮语义不变。
- normalized_requirement: 单聊发送链路在忙轮时走 steering 注入活跃轮（不建新 run）；「发送即引导」为默认，无额外开关；配置切换类消息与 interrupt 行为零回归。
- impacts: [FR-1, FR-2]
- evidence: 用户轮次 1（会话原话）

- id: D-002
- status: accepted
- source: user
- question: 实现方案与 provider 覆盖范围？（方案 A/B/C 取舍）
- answer: 方案 A：复用群聊 @ 忙轮 busy_strategy=inject 链路（`_inject_mid_turn_into_run`），三家 provider 全接 + 能力降级（pi 已通 / claude 实测 SDK 队列 / codex 驱动接 turn/steer；不支持者自动回落现有排队）。⚠️ 注：方案选择时用户未响应（AskUserQuestion 两轮无作答），按其已表态语义（D-001）+ 推荐默认执行；本决策为可否决默认，用户可在 design 评审或后续阶段改选方案 B/C，走 D-002@v2 + supersedes。
- normalized_requirement: 后端单聊忙轮复用 inject 链路；daemon 按 provider 能力矩阵决定 mid-turn 注入或降级排队；不支持的 provider（如 cursor）不报错、行为与现状一致。
- impacts: [FR-2, FR-3, FR-4]
- evidence: 方案对比见 brainstorm step-4 等待记录；用户未作答事实见进度库 step-3/4 回答

- id: D-003
- status: accepted
- source: code
- question: 三家 provider 的 steering 原生能力与平台接入现状证据？
- answer: 源码/官方文档核实：① pi 0.81.1：rpc `steer` 命令官方语义「当前 assistant turn 工具调用完成后、下一次 LLM 调用前投递」，TUI 原生打字回车即 steering；daemon `pi-rpc-driver.ts` `_sendInject` 已实现 streaming→steer（含 follow_up 降级）——驱动层零改动。② claude-agent-sdk 0.3.247（daemon 本地依赖）：`query({prompt: AsyncIterable})` 同进程多轮，sdk.d.ts 明确 command queue 机制（queued_turn_count / still_queued / cancel_async_message / 「queued user message … absorbed mid-turn」fold 语义）——推送进输入流即可，投递时机由 SDK 决定，需实测验证。③ codex 0.147.0（本机二进制字符串提取）：app-server 协议存在 `turn/steer` 方法（与 turn/start、turn/interrupt 并列，另有 prompt/steer/default 枚举痕迹）；daemon `codex-app-server-driver.ts` 现为轮级串行（等 turn/completed 才消费下一条），需新增 turn/steer 分支并实机探测参数格式。④ cursor 驱动无 steering 证据 → 降级排队。
- normalized_requirement: 能力矩阵驱动 daemon 注入策略：pi=既有 steer、claude=输入流直推+实测、codex=新接 turn/steer、其余=降级排队；codex turn/steer 参数格式未经官方文档确认，plan 阶段须安排实机探测任务。
- impacts: [FR-3, FR-4]
- evidence: sillyhub-daemon/src/interactive/{pi-rpc-driver,claude-sdk-driver,codex-app-server-driver,session-manager}.ts; @anthropic-ai/claude-agent-sdk 0.3.247 sdk.d.ts; codex.exe 0.147.0 二进制字符串; pi docs/rpc.md
