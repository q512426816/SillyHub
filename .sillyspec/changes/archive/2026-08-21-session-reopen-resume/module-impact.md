---
author: qinyi
created_at: 2026-08-21 12:09:08
---

# 模块影响分析（Module Impact）— 打通会话重新开启（reopen）链路

## 变更：2026-08-21-session-reopen-resume（打通会话重新开启 reopen 链路）

> plan 阶段首版（实施前）；execute/verify 后由收尾 task-09 复核更新"更新结果"列。

## 模块影响矩阵

| 模块 | 影响类型 | 相关文件 | 更新内容摘要 |
|------|----------|----------|-------------|
| backend（daemon 模块） | 逻辑变更 | backend/app/modules/daemon/run_sync/service.py | task-01：submit_messages 增量回填 AgentSession.agent_session_id（最新值覆盖） |
| backend（daemon 模块） | 数据迁移 | backend/migrations/versions/20260821120000_backfill_session_agent_session_id.py | task-02：存量会话 resume key 一次性回填（+ 独立迁移测试） |
| backend（daemon 模块） | 接口变更 | backend/app/modules/daemon/router.py | task-03：SessionRuntimeRequest 加可选 lease_id（confirm-reconnected / mark-recovery-failed 两端点透传） |
| backend（daemon 模块） | 接口变更 | backend/app/modules/daemon/service.py | task-03：DaemonService 两包装方法透传 lease_id（router→session service 契约链路必经，symbol-impact 已划归） |
| backend（daemon 模块） | 逻辑变更 | backend/app/modules/daemon/session/service.py | task-03：两确认函数 lease_id 校验（不匹配幂等跳过）+ RECONNECTING_RETRY_WINDOW_SEC 常量；task-04：reopen 超时窗口放行 + cwd 空 409（DaemonSessionNoCwd） |
| backend（daemon 模块） | 逻辑变更 | backend/app/modules/daemon/sweep.py（新）+ backend/app/main.py | task-05：reconnecting 超时巡检协程（60s 周期收敛 failed + lease cancelled），lifespan 挂载 |
| backend | Schema 变更 | backend/openapi.json | task-03：SessionRuntimeRequest.lease_id 进 OpenAPI dump（可选字段，向后兼容） |
| sillyhub-daemon | 接口变更 | sillyhub-daemon/src/hub-client.ts | task-06：confirmReconnected/markRecoveryFailed 加可选 opts { leaseId, runtimeId }（F1 参数透传定案，opts?.runtimeId ?? 映射回退） |
| sillyhub-daemon | 逻辑变更 | sillyhub-daemon/src/daemon.ts | task-06：_routeSessionResume 双向确认（成功 confirm / 失败含 SessionAlreadyExists mark-failed）+ 注释修正 |
| sillyhub-daemon | 测试债 | sillyhub-daemon/tests/daemon-session-resume-route.test.ts（+新 confirm 测试文件） | task-06/07：createMockClient 补两 mock；F1 防回归断言四组 |
| frontend | 逻辑变更 | frontend/src/app/(dashboard)/sessions/page.tsx | task-08：reconnecting 本地计时 >240s 显示"重新开启"入口 + 409 错误码中文映射 |
| frontend | 类型再生成 | frontend/src/lib/api-types.ts | task-08：pnpm gen:types（SessionRuntimeRequest 加字段后同步） |
| backend（文档） | 文档更新 | .sillyspec/docs/multi-agent-platform/modules/backend.md、sillyhub-daemon.md | task-09：契约摘要追加本变更条目 |

## 未匹配文件

| 文件路径 | 说明 |
|----------|------|
| （无） | design.md 文件变更清单 8 项全部映射到模块与任务 |

## 更新结果

| 模块文档 | 操作 | 状态 |
|----------|------|------|
| modules/backend.md | 契约摘要追加条目 | ✅ task-09 已完成（worktree 内，随 apply 合入） |
| modules/sillyhub-daemon.md | 契约摘要追加条目 | ✅ task-09 已完成（worktree 内，随 apply 合入） |
| modules/frontend.md | 无契约层变化（仅页面内交互与再生成类型），不更新 | ⏭ 跳过 |
