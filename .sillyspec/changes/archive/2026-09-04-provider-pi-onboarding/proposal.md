---
author: qinyi
created_at: 2026-09-04 10:45:00
---

# 提案书（Proposal）

## 动机

平台交互式 provider 仅 claude/codex。用户要求接入 PI 作为第三引擎并对齐 Claude 全部能力；本变更同时是 2026-09-03-agent-provider-abstraction 抽象层的**档C 首个实战验收**（onboarding §5 十二步清单的真实走查）。

## 关键问题

1. PI 仅在批量路径可用（pi_json 适配器）；交互式（inject/interrupt/审批/resume 长会话）无 driver。
2. "全部功能"需逐项落定：8 项 caps 哪些原生/可桥/暂缺（D-002 桥接补齐+如实标记）。
3. 抽象层承诺"新增 provider 不改 SessionManager/daemon/backend/前端"——需要真实接入验证并暴露盲区（Grill 已抓出装配层与可选性白名单两处真实必改点）。

## 变更范围

- **PiRpcDriver**（新）：`pi --mode rpc` 长驻 JSONL 双向（LF 严格分帧）；prompt/steer/follow_up 三模式 inject、abort 打断、get_state 合成 session_started、agent_settled 收敛、extension_ui_request 自动取消、--session-id/switch_session resume。
- **PiEventNormalizer**（新）：rpc 事件流 → AgentEvent v2（复用契约管线，daemon/backend/前端上报链零改动）。
- **注册与门控**：providers.ts pi 条目（family=pi_json）+ 三端 caps 镜像 + cli.ts 装配行 + 前端引擎白名单两处 + detector minVersion。
- **subagent 实证任务**：examples 扩展 vendor/路径解析+事件形状实测，达标翻 true 否则如实 false。
- **onboarding 案例锚**：档C 12 步 PI 实战勾选记录 + 顺修档B 第 8/10 步盲区。

## 不在范围内（显式清单）

- 不做 MCP 桥接（pi 无原生 MCP，caps=false，用户已确认）
- 不做 edit_patch 合成（pi 无结构化 patch，前端 LCS 回退可用）
- 不动群聊引擎白名单（create-group-wizard/member-panel，记后续）
- 不动批量 pi_json 适配器；不接 omp 等 pi 族 fork
- 零 DB 迁移、零 OpenAPI 变化

## 成功标准（可验证）

- 档C 12 步清单全过（onboarding §5 勾选记录）
- 真实 PI 会话冒烟：创建→工具执行（Bash/Edit）→partial 流式→usage 实时→inject 追加→interrupt→resume 断开重连，双轨落库（agent_event 行）+SSE 渲染正常
- caps 三端对齐守护测试过（pi 键含入 EXPECTED_PROVIDERS）；mcp/edit_patch/permission_dialog/subagent(实证前) 如实 false 且 UI 正确隐藏
- claude/codex 既有测试零回归
