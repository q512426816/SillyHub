---
author: qinyi
created_at: 2026-10-25 09:48:17
generated_by: sillyspec-fourpiece-init
---
# 任务清单（Tasks）— 2026-10-25-trajectory-source-model

> 初稿，plan 阶段按 Wave/依赖细化后为准。

- [x] task-00: revert 前端启发式代码（77ba0588b / c93aafc84：TEAM_DISPATCH_PREFIXES / isTeamDispatchText / meta.systemBrief 及其用例）；验证：revert 后 from-turn-views 既有用例（除启发式三用例外）全绿
- [x] task-01: backend 注入点盖戳——主控简报轮 team_brief（inject/control 链）、Worker 首轮 worker_dispatch（create.py）、后台通知 agent_notice（mission_context.py 两调用点）；验证：backend 盖戳 pytest 用例全绿
- [x] task-02: backend submit_steps metadata 白名单透传（turn_trigger / chain 既有键 / reason）+ session_header channel 落库归类；验证：透传与白名单丢弃用例全绿
- [x] task-03: daemon 轮边界快照采集（driver-factory 取数：systemPrompt 配置段 / allowedTools / mcpServers 名称）+ 会话级缓存字段级比较（initial / change）；验证：采集与比较 vitest 用例全绿
- [x] task-04: daemon 快照上报（submitMessages 携带 session_header 日志消息，metadata.reason）；验证：上报消息形态用例全绿
- [x] task-05: frontend TURN_TRIGGER_META 补三行 + logsToTurns 装配 session_header → request_header 段（prev 取同会话前一条快照，不进轮块流）；验证：装配用例全绿
- [x] task-06: frontend 轨迹系统行——request_header 段 → kind=system + meta.headerChange，四态文案（初始/系统提示词/工具/双变更），diff 前端做；验证：from-turn-views 四态用例全绿
- [x] task-07: 三端回归——backend 相关 pytest、daemon vitest、frontend 轨迹目录 vitest + tsc；验证：零失败、类型检查退出 0
