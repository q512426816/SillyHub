---
author: qinyi
created_at: 2026-06-25T15:42:00
---

# Decisions

## D-001@v1: 移除 daemon idle 自动回收

- **type**: architecture
- **status**: accepted
- **source**: user
- **question**: idle 回收误杀工作中长 turn，是修正活动判定后保留，还是整体移除？
- **answer**: 整体移除（默认禁用）。用户决策：不堆叠自动超时机制，session 终态靠完成驱动 end + 用户手动，不靠 idle 兜底。
- **normalized_requirement**: `session-manager.ts` 的 `_idleTimer` 默认不启动；`DEFAULT_IDLE_TIMEOUT_SEC` = 0；`startIdleMonitor` 增 `>0` 守卫；env `SESSION_IDLE_TIMEOUT_SEC>0` 可启用逃生口。
- **impacts**: [FR-1, FR-2, task-daemon-idle, verify-SC-2/SC-4]
- **evidence**: 用户对话式探索回答（brainstorm step 6）；`session-manager.ts:1188/1194/182/259-265`

## D-002@v1: scan/stage 完成主动 end_session

- **type**: architecture
- **status**: accepted
- **source**: code
- **question**: scan 完成后 daemon session 残留 active 撞 idle，如何根治？
- **answer**: backend `complete_lease` 收尾链末尾对 scan run（`change_id=None` + `spec_strategy=platform-managed`）和 stage run（`change_id` 非空）主动调 `end_session`，经 D-006 facade 委托 + FR-05 `session_end` 链路关闭 daemon session。
- **normalized_requirement**: `complete_lease` 增完成收尾钩子；`agent_session_id` 取自 `AgentRun.agent_session_id` 字段（非 lease metadata）；失败 try/except warn 不阻塞。
- **impacts**: [FR-3, FR-4, FR-5, task-backend-end, verify-SC-1/SC-5/SC-6]
- **evidence**: `lease/service.py:278` complete_lease 无 end 调用；`model.py:195` AgentRun.agent_session_id 字段；`context.py:64` lease metadata session_id 同源；`change/service.py:1358` stage independent session

## D-003@v1: 不引入绝对上限 / 新增自动超时机制

- **type**: boundary
- **status**: accepted
- **source**: user
- **question**: 移除 idle 后是否需要绝对硬上限兜底防 agent 死循环？
- **answer**: 不引入。卡死靠用户手动终止（链路已确认可用）。断网 + hang 极端泄漏场景容忍。
- **normalized_requirement**: 不新增任何自动超时 / 绝对上限逻辑；手动终止链路（前端 interactive-session-panel 结束会话 + backend FR-05 + daemon SessionManager.end）保持不变。
- **impacts**: [非目标, verify-SC-3]
- **evidence**: 用户对话式探索回答；前端 `interactive-session-panel.tsx:562/714` endSession；backend `DAEMON_MSG_SESSION_END` FR-05

## Grill 交叉审查修正记录

- **一致性修正**：design 接口定义原写"从 `lease.metadata_` 取 `agent_session_id`"，与代码不符。`agent_session_id` 是 `AgentRun` 独立字段（`model.py:195`），lease metadata 里是 `session_id`（`context.py:64`）同源。已统一改为读 `agent_run.agent_session_id`。
- **可行性确认**：stage 是否复用 session —— 代码确认 `change/service.py:1358` 注释 "independent session"，stage 每步独立 session，stage 完成主动 end 安全，风险降级。
