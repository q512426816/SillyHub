---
author: qinyi
created_at: 2026-06-22T10:12:00+08:00
---

# Tasks — daemon-service-split

> 任务粒度按 Wave 组织。每 Wave 独立提交、独立验证（daemon 全测 + mypy + ruff）、独立回滚。
> 细节（方法逐个映射、import 调整、测试调整）在 plan 阶段展开为子任务。
> 覆盖关系：FR 见 requirements.md，D 见 decisions.md，design 章节（§5.3 Wave / §6 文件清单 / §7.5 契约表）。

---

## W1 — 建 5 子包骨架 + DaemonService facade 化（安全网）

- **task-01**: 新建 5 子包空壳 + DaemonService 改为持有 5 子 service 引用的 facade（方法体暂保留原逻辑直接委托）
  - 文件：`runtime/{__init__,service}.py`、`lease/{__init__,service,context}.py`、`run_sync/{__init__,service}.py`、`session/{__init__,service}.py`、`patch/{__init__,service}.py`、`service.py`（facade 化）
  - 覆盖：FR-01, FR-02 / D-002
  - 验收：daemon 全测通过（此时逻辑仍在 facade，子包为空壳，行为不变是关键安全网）

## W2 — 迁移 runtime（最小、最独立）

- **task-02**: `DaemonService` 的 runtime 方法迁入 `runtime/service.py`（RuntimeService）
  - 方法：register_runtime/heartbeat/get_runtime/list_runtimes/mark_offline/disable_runtime/delete_runtime/enable_runtime/cleanup_stale_runtimes + `_get_owned_runtime`/`_is_recent_heartbeat`
  - 文件：`runtime/service.py`、`service.py`（facade 委托）
  - 覆盖：FR-02 / D-004

## W3 — 迁移 patch（小）

- **task-03**: patch 方法迁入 `patch/service.py`（PatchService）
  - 方法：`_apply_patch_to_worktree`/`_run_git_apply`
  - 文件：`patch/service.py`、`service.py`
  - 覆盖：FR-02

## W4 — 迁移 run_sync

- **task-04**: AgentRun 状态同步方法迁入 `run_sync/service.py`（RunSyncService）
  - 方法：sync_agent_run_status/close_interactive_run/submit_messages + `_run_post_scan_validation`/`_trigger_stage_completion_callback`/`_publish_run_event`
  - 文件：`run_sync/service.py`、`service.py`
  - 覆盖：FR-02, FR-04

## W5 — 迁移 session（最大，单独 Wave 便于回滚）

- **task-05**: AgentSession 方法迁入 `session/service.py`（SessionService）
  - 方法：create_session/inject_session/interrupt_session/end_session/recover_session_after_daemon_restart/confirm_session_reconnected/mark_session_recovery_failed/reopen_session/list_agent_sessions/get_agent_session/delete_agent_session/get_agent_session_logs + `_get_owned_session_for_update`/`_get_current_run`/`_converge_failed_dispatch`/`_converge_crashed_run`/`_assert_no_other_active_run`/`_end_session_for_delete`/`_publish_session_event` + 三个 frozenset（ACTIVE_SESSION/TURN/TERMINAL_TURN_STATUSES）
  - 文件：`session/service.py`、`service.py`
  - 覆盖：FR-02, FR-04
  - 注意：`recover_session_after_daemon_restart` 等是 `fix-interactive-lifecycle` W4 即将接通的方法，迁移后通知该变更更新定位（design §10 R3）

## W6 — 迁移 lease（DaemonLeaseService 不动）

- **task-06**: `DaemonService.lease_*` 迁入 `lease/service.py`（LeaseService）+ `_build_claim_payload` 迁入 `lease/context.py`
  - 方法：create_lease/claim_lease/start_lease/lease_heartbeat/complete_lease/get_lease/list_leases/expire_leases + `_get_lease_and_verify_token`
  - 文件：`lease/service.py`、`lease/context.py`、`lease/__init__.py`（导出 LeaseService）、`service.py`
  - 覆盖：FR-02, FR-03 / D-003
  - 约束：`lease_service.py`（DaemonLeaseService）原位不动

## 收尾 — 异常类 re-export + 文档 + 全量验收

- **task-07**: 异常类定义迁入对应子包，facade `service.py` 集中 re-export
  - 文件：各子包（异常类定义）、`service.py`（re-export 块）
  - 覆盖：FR-05 / D-002
  - 依据：`grep -rn "from app.modules.daemon.service import"` 全量收集被引用符号

- **task-08**: 更新 `daemon.md` 模块文档 + 全量验收
  - 文件：`.sillyspec/docs/backend/modules/daemon.md`（契约摘要 + 变更记录补本变更）
  - 覆盖：FR-01, FR-04
  - 验收清单：`git diff router.py` 为空 / daemon 全测 / mypy / ruff / 51 方法签名对比 / agent import 可用 / session service ≤1500 行
