---
author: qinyi
created_at: 2026-07-13T16:30:42
---

# 提案 — 修复交互式会话僵尸状态

## 为什么做

交互式会话（AgentSession）的 `status` 字段与底层 run 生命周期脱钩。runtimes 页面大量显示"待处理"僵尸会话（本机 PG 实测 7 个 `status=pending`，背后 run 早已 `completed/failed/killed`），误导用户以为有会话在等处理。点进去发现内容早凉了。

## 现有方案为什么不够（4 个具体痛点）

1. **批量创建即弃**：`dispatch_to_daemon`（scan/stage/mission worker/quick-chat 经它）用 raw SQL 写 `agent_sessions(status='pending', turn_count=0)` 独立 commit，从不激活——daemon 接手后 session 永远停在 pending。
2. **轮次完成不收口（主因）**：`close_interactive_run` 回写 run 终态但全程不碰 session 表；gap-4 的 `end_session` 链路只在 idle/错误/手动/stage-complete_lease 触发，普通对话 turn 完成永不触发。
3. **kill 悬空**：`cancel_lease` 只 set run=killed + lease=cancelled，不碰 `session.status`；`MissionControl.cancel` 同理。
4. **无兜底**：设计文档的"30min idle 自动 end"（task-07 D-004）从未接线，main.py lifespan 无后台扫描；无批量清理工具。

## 本次做什么（方案A：backend 集中回写，daemon 零改动）

- **病灶B（含A）**：`close_interactive_run` 按反向判定回写 session 终态——多轮对话（`spec_strategy=='interactive' AND change_id is None`）保持 active 等下一轮；其余单轮任务收口 ended/failed。统一覆盖所有创建路径（D-001 病灶A 并入）。
- **病灶C**：`cancel_lease` interactive 分支 + `MissionControl.cancel` 收口 session=ended（kill=正常终止）。
- **数据清理**：alembic data migration 按规则一次性清理历史僵尸。

## 不在范围内（Non-Goals）

- 不接线 backend idle sweep（病灶D，D-007）——多轮对话 daemon 离线时可能长期 active，靠手动 end + daemon 侧 `_scanIdle` 兜底。
- 不改 AgentSession 状态机枚举、不加 session_kind 字段（D-002@v2 复用 spec_strategy+change_id）。
- 不改 sillyhub-daemon 任何代码（D-006）。
- 不做历史兼容（CLAUDE.md 规则 11，可重置开发/测试数据）。

## 兼容策略

- 零 API/表结构变更，前端/daemon 无感知。
- 已部署旧 daemon 兼容：session 终态回写在 backend 收 notifyRunResult 后触发，不依赖 daemon 新功能。
- 幂等（D-005）：重复/并发的 turn result / 手动 end 不覆盖已 ended/failed session。

## 实现路径

`scale: large` → 完整四件套（design/decisions/proposal/requirements/tasks），下一步 `sillyspec run plan --change 2026-07-13-fix-interactive-session-zombie` 拆 Wave/Task 实现计划。
