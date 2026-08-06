---
author: WhaleFall
created_at: 2026-08-06 15:08:37
---

# 任务清单(Tasks)

> 只列任务名,细节在 plan 阶段(`sillyspec run plan`)展开为 Wave + 依赖关系。

## Wave 1 — 后端:切换触发 + 凭证探测 + 推送
- task-01: 新增凭证探测(`llm_provider/probe.py`)— 轻量请求验 key/base_url
- task-02: 抽取 `resolve_default_provider_config` helper(`lease/context.py`,从 `_inject_provider_config` 重构)
- task-03: `set_default` 改造(探测 → 设默认 → 触发推送;失败回滚)
- task-04: `unset_default` 改造(触发推送 `provider_config=null`)
- task-05: 新增 `notify_provider_switch`(查 active session `status IN ('active','reconnecting')` + 按 daemon_id 分组 + send_session_control)
- task-06: `protocol.py` 新增 `MSG.PROVIDER_CONFIG_CHANGED` 常量 + payload
- task-07: `router/schema` set/unset_default 返回 `SetDefaultResult {switched, affected_sessions, error?}`

## Wave 2 — daemon:接收 + 延迟切换
- task-08: `protocol.ts` 新增 PROVIDER_CONFIG_CHANGED 消息类型 + payload 类型
- task-09: `daemon.ts` WS 分发新增 case → `sessionManager.markPendingSwitch`

## Wave 3 — session-manager:受控重启
- task-10: `types.ts` SessionState 新增 `pendingSwitch` 字段
- task-11: `session-manager` `markPendingSwitch`(空闲立即 reload / 生成中标记)
- task-12: `session-manager` `reloadWithProvider`(close 旧 query + 新 env `driver.start` resume + 替换 state + 重启 consume + 失败保留旧 query)
- task-13: `_onResult` 增加 pendingSwitch 检测 → 触发 reload

## Wave 4 — 前端:切换结果反馈
- task-14: `llm-provider-list.tsx` 切换/停止结果 toast 提示
- task-15: `lib/llm-providers.ts` set/unset default 返回类型对齐
- task-16: `pnpm gen:types` 同步 api-types.ts + openapi.json

## Wave 5 — 测试 + 联调
- task-17: 后端单测(探测 / 查 active session 分组 / 推送调用 / 凭证失败回滚)
- task-18: daemon 单测(markPendingSwitch / _onResult 触发 / reloadWithProvider resume / provider_config=null 回退)
- task-19: 集成测试(启动切换 + 停止回退 + 生成中等待 + 凭证失败回滚)
