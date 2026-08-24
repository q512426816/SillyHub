---
author: qinyi
created_at: 2026-08-24 07:58:12
change: 2026-08-24-sessions-live-updates
plan_level: full
---

# 实现计划（Plan）：会话列表 SSE 变更信号 + 轮询兜底

## Wave 1（并行，无依赖）
- task-01

## Wave 2（依赖 Wave 1；四任务互不共享文件可并行）
- task-02
- task-03
- task-04
- task-05

## Wave 3（依赖 task-05）
- task-06

## Wave 4（依赖全部）
- task-07

## 任务总表
| 编号 | 任务 | Wave | 优先级 | 依赖 | 覆盖 FR/D | 说明 |
|---|---|---|---|---|---|---|
| task-01 | 后端信号基建：session_events.py 发布辅助+单测 | W1 | P0 | — | FR-01, D-004 | 频道常量+publish_sessions_changed（静默容错） |
| task-02 | SessionService 埋点（8 写入点）+ 埋点单测 | W2 | P0 | task-01 | FR-01a/b/c | 对照 design §3 生命周期契约表 session/service.py 各行 |
| task-03 | 跨模块埋点（run_sync/sweep/lease/platform_sync/agent×2）+ 单测 | W2 | P0 | task-01 | FR-01a/b | 契约表其余行；测试独立文件防与 task-02 冲突 |
| task-04 | SSE 端点 /api/daemon/sessions/events + 端点测试 | W2 | P0 | task-01 | FR-02, D-005 | 订阅+user 过滤+keepalive+清理；骨架抄 stream_session_logs |
| task-05 | 前端订阅客户端 subscribeAgentSessionsEvents | W2 | P0 | — | FR-03 前半 | fetchSse 传输+自实现退避重连（对齐 streamSession） |
| task-06 | 门户接线：信号/重连 → invalidate 前缀 | W3 | P0 | task-05 | FR-03 后半 | SessionsPortal useEffect；卸载关闭 |
| task-07 | 全量回归 + 模块文档同步 | W4 | P0 | task-02,03,04,06 | FR-04, 验收基线 | backend pytest + frontend vitest/tsc/lint + backend.md/frontend.md |

## 关键路径
task-01 → task-02/03/04 → task-07（后端链）；task-05 → task-06 → task-07（前端链）。
两条链在 task-07 汇合。

## 全局验收标准
1. backend pytest 全量通过（含新增 test_session_events / test_session_events_cross / test_sessions_events_stream）
2. frontend vitest 全量 + tsc 0 错 + lint 无新增告警
3. 集成冒烟（task-07 手工验收清单）：本地起服务后，另开会话/触发 CLI 上报 → 打开的会话页左栏秒级出现新条目；kill 会话 → 状态点秒级变化
4. brownfield 兜底不变：断开 SSE（停 Redis 或断网）时列表仍按 10s/30s 轮询刷新（现状行为）
5. 用户隔离：B 用户的会话事件不会出现在 A 用户的 SSE 流（端点测试断言）

## 覆盖矩阵
| ID | 覆盖任务 | 验收证据 |
|---|---|---|
| D-001 lazy refresh | task-02/03/04/05/06 | 埋点只发信号；前端 invalidate 重拉 |
| D-002 三类事件 | task-02/03 | 契约表事件列即事件枚举 |
| D-003 SSE+fetchSse | task-04/05 | 端点 StreamingResponse；前端 fetchSse |
| D-004 Redis 全局频道 | task-01 | SESSIONS_CHANGED_CHANNEL |
| D-005 user_id 过滤 | task-01/04 | 信号带属主；端点过滤下发 |
| D-006 重连补失效 | task-05 | onReconnected → invalidate |
| D-007 轮询保留 | task-07 | 回归断言 sessionListPollInterval 未动 |
| FR-01a/b/c | task-02/03 | 埋点单测逐事件断言 |
| FR-02 | task-04 | 端点测试（过滤/keepalive/清理） |
| FR-03 | task-05/06 | 前端测试（失效/重连/卸载） |
| FR-04 | task-07 | 全局验收第 4 条 |
