---
author: qinyi
created_at: 2026-06-22T15:40:00+08:00
---

# 模块影响分析：daemon-service-split

> 变更：`2026-06-22-daemon-service-split`
> 方法：三重交叉验证（proposal/design 声明范围 × tasks/plan 任务范围 × git diff 真实变更，以 git diff 为准）
> git diff 来源：sillyspec 分支 commit `1a64f0ea`（本变更纯改动，26 文件）

---

## 影响矩阵

| 模块 | 影响类型 | 相关文件（count）| 更新内容摘要 | needs_review |
|------|----------|----------------|-------------|-------------|
| daemon | 逻辑变更 + 新增 | `app/modules/daemon/**`（20 文件）| `DaemonService` 巨石（~3324 行）拆 5 子域子包（runtime/lease/run_sync/session/patch）+ facade 化（3324→536）；异常类迁子包 + facade re-export 31 符号；8 测试 patch 目标跟随（get_redis/build_claim_payload 迁子包模块） | false |
| agent | 测试调整 | `app/modules/agent/tests/test_dispatch_metadata.py`（1 文件）| `_build_claim_payload` 调用改用 `lease.context.build_claim_payload` 模块级 API（task-06 迁移后 facade 删除该私有方法）；删 unused DaemonService import | false |

### daemon 模块文件明细（20）
- 新增 5 子包：`runtime/{__init__,service}.py`、`lease/{__init__,service,context}.py`、`run_sync/{__init__,service}.py`、`session/{__init__,service}.py`、`patch/{__init__,service}.py`（11 文件）
- 修改 facade：`service.py`（re-export 块 + 41 委托 + __init__ lazy import）
- 测试 patch 跟随：`tests/test_interactive_lifecycle_patch.py`、`test_lease_service.py`、`test_session_delete_active.py`、`test_session_permissions.py`、`test_session_recovery.py`、`test_session_service.py`、`test_session_sse.py`、`test_session_user_log.py`（8 文件，get_redis/build_claim_payload patch 目标跟随代码物理位置 D-006）

---

## 未匹配文件（文档/治理，非代码模块）

| 文件 | 类型 | 说明 |
|------|------|------|
| `.sillyspec/docs/backend/modules/daemon.md` | 模块文档 | 契约摘要 facade 化 + 变更记录追加（task-08）|
| `.sillyspec/changes/2026-06-22-daemon-service-split/{decisions,design,plan}.md` | 变更治理文档 | D-005/D-006 新增 + design §7.2/§5.2 补充 + plan checkbox |
| `.sillyspec/changes/2026-06-19-fix-interactive-daemon-lifecycle/tasks.md` | 跨变更通知 | W4 task-06 加注释：recover_*/confirm/mark 迁至 session/service.py（design §10 R3 协调）|

---

## 交叉验证结论

- **声明范围**（design §6 文件清单）：5 子包新增 + service.py 修改 + daemon.md 文档 + lease_service.py 不动 — 与真实一致。
- **任务范围**（plan/tasks task-01~08）：allowed_paths 覆盖 daemon 模块 + daemon.md + changeDir 文档 — 与真实一致。
- **真实变更**（git diff 1a64f0ea）：26 文件，全部在 daemon 模块（20）+ agent 测试（1）+ 文档（5）— 无范围蔓延。
- **范围外验证**：`router.py` / `lease_service.py` / `permission_service.py` / `ws_hub.py` / `model.py` / `schema.py` 零改动（D-002/D-003 铁证，git diff 确认空）。

无 needs_review=true 项，全部影响明确。
