---
author: qinyi
created_at: 2026-09-07 14:05:00
---
# 模块影响分析（Module Impact）— Agent 会话活性状态推导

## 模块影响矩阵

| 模块 | 影响类型 | 说明 |
|---|---|---|
| sillyhub-daemon:agent-log | 新增 | `src/agent-log/liveness/` 子层 7 文件：types.ts（五态/DeriverIO）/ registry.ts（format→deriver 注册表，仿既有 parser 扩展点）/ derive-zcode-model-io.ts / derive-codex-rollout.ts / derive-claude-code.ts / tailer.ts（周期 10s offset 增量读）/ discovery.ts（三层数据源自发现）；既有 registry.ts 与 parse-zcode-model-io.ts 零修改 |
| sillyhub-daemon:daemon-core | 修改 | daemon.ts 挂接 tailer 生命周期（启动/优雅停止，独立 try 包裹，崩溃不影响主循环与既有 read_agent_log_messages） |
| sillyhub-daemon:hub-client | 修改 | 三职：POST /api/agent-logs/states 批量上报 + GET /api/agent-logs 周期拉登记行（watch list 增强源）+ 第一方 blocked 并入（D-012 优先级，permission resolver pending 优先于日志推导） |
| sillyhub-daemon:tests | 新增 | tests/agent-log/liveness/：三 deriver fixture 单测 + tailer（轮转 reset/预算/fail-open/ended 回收）+ discovery（直算/窄扫/防串台）+ 挂接测试 |
| backend:platform_sync | 修改+新增 | model.py 四列（state/state_derived_at/state_evidence/last_event_at）+ migrations 迁移 + schema.py（AgentLogStatePush/Entry + 响应透传）+ router.py（POST /agent-logs/states）+ service.py（upsert-create origin=liveness-discovered + blocked 段转移检测）+ 3 测试文件 |
| backend:notification | 修改+新增 | type 值 agent_blocked（model String(40) 无迁移）+ schema/service/events 四文件（120s 阈值/段级 dedupe/与 5min auto-deny 同源分级/Redis NOTIFICATIONS_CHANNEL 推）+ test_agent_blocked_notify.py |
| backend:agent | 修改+新增 | mcp_tools.py list_workers 返回值增 liveness 字段 + schema.py；orchestrator.py/mission_context.py 汇入点由 spike-01 实调定位后按需修改（过重则降级 backend 直查 platform_agent_logs，R-03）+ test_mcp_tools.py 增断言 |
| frontend:agent-log-components | 修改 | components/agent-log/ 面板组件 + types.ts：逐行状态徽章 + 推导时间（骨架不变，组件级增量） |
| frontend:session-list/workbench/notifications | 修改 | D-004 两层：会话列表行尾 ~18px 状态小灯 + 悬停详情卡（不新增列）/ 工作台「Agent 状态总览」卡片（分组计数 + 在等人跳转）/ agent_blocked 通知渲染；idle 未读小红点（D-006） |
| frontend:lib | 修改 | api-types.ts 经 pnpm gen:types 再生成（不手写，规则 21） |
| sillyspec（跨仓）:dispatch | 修改 | src/dispatch/backends/sillyhub-mcp.js「终态轮询 + 超时 kill lease」指令段改写：blocked→升级不 kill / working→再等（纯指令模板文本，repo:sillyspec，task-13） |
| docs（.sillyspec modules） | 修改 | 归档时同步：backend.md / sillyhub-daemon.md / frontend.md 变更索引条目（execute/verify 阶段不动，archive 阶段处理） |

## 未匹配文件

| 文件 | 处置说明 |
|---|---|
| backend/openapi.json、frontend/src/lib/api-types.ts | 生成物，task-14 跑 pnpm gen:types 再生成，不手改 |
| .sillyspec/.runtime/stage-reviews/* | 流程运行时产物（审查证据），不入模块映射 |
| sillyhub-daemon/src/agent-log/liveness/ 全部新文件 | 新建子层，归档时并入 agent-log 模块文档 |

## 关联任务

W1：task-01（liveness 基座）/ task-07（backend 四列迁移）；W2：task-02/03/04（zcode deriver/tailer/自发现直算）+ task-08（states 端点）；W3：task-05/06（窄扫/hub-client 三职挂接）+ task-09（通知）+ task-10（codex deriver）；W4：task-11（claude deriver，spike-02 门控）/ task-12（list_workers，spike-01 定汇入点）/ task-14（前端两层）；W5：task-13（跨仓派发模板）；W6：task-15（集成验收）。

## 更新结果

| 目标 | 操作 | 状态 |
|---|---|---|
| （plan 阶段首版，待 execute 后按实际 diff 复核） | — | — |
