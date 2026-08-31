---
author: qinyi
created_at: 2026-08-31 08:10:42
---

# 决策记录（decisions.md）

## D-001@v1: sillyspec 版本上报与远程升级的技术方案
- type: architecture
- priority: P0
- status: accepted
- source: code
- question: 版本信息如何上报、升级指令如何下发、自动升级在哪里执行？
- answer: 采用方案 A——版本与升级状态随 register/heartbeat 心跳上报（仿 pending_update 模式）；手动升级走 WS 即时消息 daemon:sillyspec_update（仿 daemon:self_update 模式，fire-and-forget）；自动定期升级由 daemon 本机定时器执行（默认 1h，忙时推迟）。不采用方案 B（控制指令表排队：与启动 preflight 自动升级冗余、双状态机复杂）与方案 C（RPC 同步：npm install 常超 10s RPC 超时，不可行）。
- normalized_requirement: ① daemon_instances 新增 sillyspec_version / sillyspec_latest_version / sillyspec_update(JSON 状态机) 三列；② 协议字面量 backend protocol.py 与 daemon protocol.ts 逐字对齐 daemon:sillyspec_update；③ 升级状态机 idle→running→success|failed|deferred，经心跳上行，完成后版本号随心跳刷新；④ 自动升级为 daemon 侧定时器，默认间隔 1h，有活跃 lease 时推迟。
- impacts: [FR-1, FR-2, FR-3, FR-4, FR-5]
- evidence: 方案选择轮次（brainstorm step 4/8）。用户在 AskUserQuestion 中未作答（离开），按推荐方案自主推进；推荐依据=三套环节均有既有先例（backend/app/modules/daemon/model.py pending_update 列、protocol.py DAEMON_MSG_SELF_UPDATE、router.py:429 心跳字段 upsert），风险最低；离线场景由 daemon 启动 preflight 自动升级兜底（sillyhub-daemon/src/preflight.ts:248-287）。

## D-002@v1: sillyspec 版本字段的 register/heartbeat 双通道落库语义
- type: consistency
- priority: P1
- status: accepted
- source: design-grill
- question: sillyspec_version/sillyspec_latest_version 在 register 与 heartbeat 中如何落库，才能既兼容旧语义又支持「未安装」状态上报？
- answer: register 直接落值（含 null，无条件写，对齐 runtime/service.py:240-242 既有先例）——这是「本机卸载 sillyspec 后 daemon 重启」能把 NULL 落库的唯一路径；heartbeat 维持兄弟字段语义（非 None 才覆盖，缺省/null=保留——Pydantic 下二者不可区分，router.py:276-281 注释锚定）。
- normalized_requirement: RuntimeService.register_daemon 对 sillyspec_version/sillyspec_latest_version 无条件赋值；heartbeat_daemon 仅在值非 None 时覆盖；机器卡「未安装」红徽标依赖 register 落 null 链路。
- impacts: [backend register/heartbeat upsert, machine-card 未安装态, test_machine_sillyspec.py]
- evidence: Design Grill F1/F6（独立审查 agent_966cb864，2026-08-31）；backend/app/modules/daemon/router.py:276-281、runtime/service.py:240-242。

