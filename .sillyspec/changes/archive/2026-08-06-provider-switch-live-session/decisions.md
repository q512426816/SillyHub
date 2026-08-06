---
author: WhaleFall
created_at: 2026-08-06 15:08:37
---

# 决策台账 — 2026-08-06-provider-switch-live-session

> 本次变更的实现/验收级决策。长期术语在 archive/scan 时再提升到 glossary.md。

## D-001@v1 — 触发机制:WS 推送(否决 lease 重claim / 心跳轮询)
- **type**: architecture
- **status**: accepted
- **source**: brainstorm step 4 方案对比 + 用户选择"方案A"
- **question**: 切换供应商后,后端如何把变更通知到持有运行中会话的 daemon?
- **answer**: 后端经 WS 主动推送 `PROVIDER_CONFIG_CHANGED`(复用 `ws_hub.send_session_control` + `_resolve_daemon_id_for_runtime`)。否决 lease 重新 claim(破坏 interactive lease「永不过期 / 终身一次 claim」不变量,风险高);否决心跳轮询(秒~分钟级延迟,切换不及时)。
- **normalized_requirement**: 默认供应商变更后,后端**实时**(非轮询)通知所有持有该用户 active interactive session 的 daemon。
- **impacts**: 后端 set/unset_default 改造、ws_hub 复用 send_session_control、daemon 新增 case、protocol 新增消息类型。
- **evidence**: `ws_hub.py:313` send_session_control;`lease_service.py:550` _send_interactive_cancel(现成模板)、`:596` _resolve_daemon_id_for_runtime;`daemon.ts:2637` case MSG.SESSION_INJECT。
- **priority**: P0

## D-002@v1 — 切换时机:等 turn 边界(否决立即中断)
- **type**: ux-behavior
- **status**: accepted
- **source**: 用户需求澄清(brainstorm step 3)
- **question**: 会话正在生成回复时切换,立即中断还是等完成?
- **answer**: 等当前 turn 完成(SDK result 边界,`_onResult` 收尾点)再重启子进程,**不中断**当前生成。空闲会话立即重启。
- **normalized_requirement**: 切换不中断当前生成中的回复,在 turn 边界生效。
- **impacts**: session-manager 新增 `pendingSwitch` 标记 + `_onResult` 检测;空闲会话立即重启分支。
- **evidence**: `session-manager.ts` `_onResult`(turn 收尾)、`inject`(1864)、`restoreAndReconnect`(2288)。
- **priority**: P0

## D-003@v1 — 凭证失败:保留原供应商 + 回滚(否决会话失败)
- **type**: error-handling
- **status**: accepted
- **source**: 用户需求澄清(brainstorm step 3)
- **question**: 新供应商凭证无效(API Key 错 / 连不上)时怎么办?
- **answer**: `set_default` 前做凭证探测(轻量请求),失败则**不改** `is_default`、**不推送**、运行中会话完全不动,前端提示错误。停止(unset_default)无需探测(目标是回退本机,无新凭证)。
- **normalized_requirement**: 凭证校验失败不破坏运行中会话,保留原供应商。
- **impacts**: 新增凭证探测逻辑;router 返回结构化错误;set_default 失败回滚。
- **evidence**: `llm_provider/service.py:236` set_default。
- **priority**: P0

## D-004@v1 — 停止供应商也热切换(回退本机凭证)
- **type**: scope
- **status**: accepted
- **source**: 用户补充(brainstorm step 5)
- **question**: 停止(unset_default)供应商后,运行中会话怎么办?
- **answer**: 停止也触发热切换:推 `provider_config=null`,daemon 重启时 buildSpawnEnv 第 0 层跳过,子进程用**宿主机 ~/.claude 本机凭证**(cc-switch / 手配)。本机未配则子进程报「未登录」(预期行为,前端提示)。
- **normalized_requirement**: 默认供应商变更事件 = 启动(set) + 停止(unset)**均**触发热切换。
- **impacts**: unset_default 走推送链路;daemon 处理 provider_config=null;前端停止后提示。
- **evidence**: `spawn-env.ts:158-164`(无 provider_config 回退本机 + 不隔离 CLAUDE_CONFIG_DIR);`context.py:124` 未命中 is_default 不下发。
- **priority**: P0

## D-005@v1 — 复用 send_session_control 通道(不新增 ws_hub 方法)
- **type**: implementation
- **status**: accepted
- **source**: 代码调研(brainstorm step 6)
- **question**: 推送走新 ws_hub 方法还是复用现有会话控制通道?
- **answer**: 复用 `ws_hub.send_session_control(daemon_id, MSG.PROVIDER_CONFIG_CHANGED, payload)`,与 SESSION_INJECT/INTERRUPT/END 同通道。参考 `_send_interactive_cancel` 模式。
- **normalized_requirement**: 最小化后端改动,复用已验证的控制消息通道。
- **impacts**: 不新增 ws_hub 方法;protocol 新增 MSG.PROVIDER_CONFIG_CHANGED 常量。
- **evidence**: `ws_hub.py:313` send_session_control;`lease_service.py:550-621` _send_interactive_cancel。
- **priority**: P1

## D-006@v1 — provider_config 构造逻辑抽取复用
- **type**: refactor
- **status**: accepted
- **source**: 代码调研(brainstorm step 6)
- **question**: set_default 时如何构造要下发的 provider_config?
- **answer**: 把 `context.py _inject_provider_config` 中「查默认供应商 + 解密 + 构造中性 ProviderConfig」逻辑抽成可复用 helper(如 `resolve_default_provider_config(session, user_id, agent_kind) -> ProviderConfig | None`),claim 与 set_default 都调。停止时直接传 None。
- **normalized_requirement**: provider_config 构造单一真相源,避免双份逻辑漂移。
- **impacts**: `context.py` 重构(抽 helper);set_default 复用。
- **evidence**: `context.py:124-156` _inject_provider_config。
- **priority**: P1
