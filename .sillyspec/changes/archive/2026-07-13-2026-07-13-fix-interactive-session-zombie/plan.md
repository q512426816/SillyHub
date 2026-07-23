---
author: qinyi
created_at: 2026-07-13T16:58:19
plan_level: full
---

# 实现计划（Plan）— 修复交互式会话僵尸状态

> 来源：design.md（§5 总体方案 / §6 文件清单 / §7 接口 / §7.5 契约表 / §10 风险）、decisions.md（D-001~D-009）、requirements.md（FR-1~4 / AC-1~5）、tasks.md（初稿）。
> plan_level=full 依据：跨 5 模块（daemon/session + run_sync + lease_service + migrations + frontend）+ AgentSession 状态机回写 + alembic DB data migration。

## Spike 前置验证

无 Spike。技术方案经 Design Grill 已验证全部关键假设（ask_user_only 字段缺失已修正 D-002@v2、:1039 时序已修正 D-009、alembic head 官方核实单 head、cancel_lease 分支边界已核实 D-008）。方案确定，直接进 Wave。

## Wave 1（并行，无依赖）

- [x] task-01: 新增辅助函数 `_apply_session_terminal_status` + 单测（覆盖：FR-1, D-002@v2, D-005）✅ 15 passed + mypy/ruff 绿
- [x] task-02: 新增 alembic data migration 清历史僵尸 + 单测（覆盖：FR-3, D-004, R-04）✅ 11 passed + alembic 单 head 接链 + 回归 6 passed

## Wave 2（依赖 Wave 1 task-01）

- [x] task-03: close_interactive_run 接入 session 终态回写 + 单测（覆盖：FR-1, D-001, D-009, R-01）✅ 4 passed + 回归 25 passed + mypy/ruff 绿
- [x] task-04: cancel_lease interactive 分支收口 session + 单测（覆盖：FR-2, D-003, D-008, R-03）✅ 6 passed + 回归 25 passed（2 pre-existing build_claim_payload 债与 task-04 无关）

## Wave 3（依赖 Wave 2）

- [x] task-05: 前端 pending 文案"待处理"→"启动中" + 快照同步（覆盖：FR-4，P2 可选）✅ typecheck 绿 + session-list-layout 9 passed（本地 SESSION_STATUS_LABELS 改，不动全局 status-labels.ts）
- [x] task-06: 全量回归 + verify DB 实测无僵尸（覆盖：AC-1~5, NFR-3）✅ AC-1 DB 实测 pending 7→0（active 26/ended 8/failed 2/pending 0，migration apply 成功 alembic_version=20260713_fix_session_zombie，backend healthy）/ 全量 2605 passed（4 pre-existing spec_transport+build_claim_payload 既有债与本次无关 / 1 orphan 测试隔离 bug 已修用 test 内 now）/ 回归 test_interactive_lifecycle_patch 25 passed

## 任务总表

| 编号 | 任务 | Wave | 优先级 | 依赖 | 覆盖 FR/D | allowed_paths |
|---|---|---|---|---|---|---|
| task-01 | 新增 `_apply_session_terminal_status` + 5类case单测 | W1 | P0 | — | FR-1, D-002@v2, D-005 | backend/app/modules/daemon/session/service.py; backend/app/modules/daemon/tests/test_apply_session_terminal_status.py |
| task-02 | alembic data migration 清僵尸 + 映射单测 | W1 | P0 | — | FR-3, D-004, R-04 | backend/migrations/versions/20260713_fix_session_zombie.py; backend/tests/test_session_zombie_migration.py |
| task-03 | close_interactive_run 接入回写 + 4case单测 | W2 | P0 | task-01 | FR-1, D-001, D-009, R-01 | backend/app/modules/daemon/run_sync/service.py; backend/app/modules/daemon/tests/test_close_interactive_run_session_status.py |
| task-04 | cancel_lease interactive 收口 + 回归单测 | W2 | P0 | task-01 | FR-2, D-003, D-008, R-03 | backend/app/modules/daemon/lease_service.py; backend/app/modules/daemon/tests/test_cancel_lease_session.py |
| task-05 | 前端 pending 文案改"启动中" + 快照 | W3 | P2 | — | FR-4 | frontend/src/components/daemon/session-list-layout.tsx; frontend/src/components/daemon/__tests__/session-list-layout.test.tsx |
| task-06 | 全量回归 + verify DB 实测 | W3 | P0 | task-01,02,03,04 | AC-1~5, NFR-3 | backend/app/modules/daemon/session/service.py（验证入口，不改源码） |

## 关键路径

task-01 → task-03 → task-06（最长路径，决定交付周期）。task-02 与 task-01 并行（W1），task-04 与 task-03 并行（W2，均依赖 task-01），task-05 独立（P2 可后置）。

## 全局验收标准

- [ ] backend `uv run pytest -q --cov=app --cov-fail-under=60` 全绿（含新增 4 个测试文件）
- [ ] backend `uv run ruff check . && uv run ruff format --check . && uv run mypy app` 全绿
- [ ] task-05 做则 frontend `pnpm test` + `pnpm typecheck` 全绿
- [ ] **AC-1**：DB 实测 `SELECT count(*) FROM agent_sessions WHERE status='pending' AND deleted_at IS NULL` 仅含真正 dispatch 中瞬时行（背后 run 为 running/pending），无僵尸
- [ ] **AC-2**：close_interactive_run 回写 4 case 通过（单轮 ended / 单轮 failed / 多轮 active / 幂等）
- [ ] **AC-3**：cancel_lease interactive 收口 session=ended；stage cancel / scan cancel 回归不破坏现有生命周期
- [ ] **AC-4**：data migration 映射正确性测试通过（4 类 run 终态 + 孤儿）
- [ ] **AC-5**：零回归——test_interactive_lifecycle_patch / test_interactive_session_placement / change-detail-session 全绿
- [ ] （brownfield 兼容）已部署旧 daemon 不受影响（session 终态回写在 backend 收 notifyRunResult 后触发，daemon 零改动 D-006）
- [ ] （brownfield 兼容）零 API/表结构变更，前端无感知

## 覆盖矩阵（decisions.md 当前版本 D-xxx@vN / FR）

| ID | 覆盖任务 | 验收证据 |
|---|---|---|
| D-001@v1（病灶A并B） | task-03 | AC-2（close_interactive_run 回写覆盖批量路径 pending session） |
| D-002@v2（反向判定） | task-01 | test_apply_session_terminal_status 5 类 case |
| D-003@v1（kill→ended） | task-04 | test_cancel_lease_session interactive 收口 |
| D-004@v1（迁移映射） | task-02 | test_session_zombie_migration 4 类映射 |
| D-005@v1（幂等守卫） | task-01, task-03, task-04 | 各测试含幂等 case |
| D-006@v1（daemon 零改动） | 全局 | allowed_paths 无 sillyhub-daemon/* 文件 |
| D-007@v1（不接 idle sweep） | 非目标 | 无 lifespan 后台任务 task（§3 N1） |
| D-008@v1（cancel 覆盖所有 interactive lease） | task-04 | test_cancel_lease_session stage/scan cancel 回归 case |
| D-009@v1（commit 前新 query） | task-03 | test_close_interactive_run_session_status + 代码审查 :929 commit 同事务 |
| FR-1（close_interactive_run 回写） | task-01, task-03 | AC-2 |
| FR-2（cancel_lease 收口） | task-04 | AC-3 |
| FR-3（数据迁移） | task-02 | AC-4 |
| FR-4（前端文案） | task-05 | frontend 快照 |

## 自检（plan-postcheck 预审）

- [x] 每个 task 有编号（task-01~06）
- [x] 每个 task 在 Wave 下有 checkbox（`- [ ] task-XX:` 格式）
- [x] Wave 分组和依赖标注（W1 并行 / W2 依赖 task-01 / W3 依赖 W2）
- [x] 任务总表含优先级 + 依赖 + allowed_paths，**无估时列**
- [x] 关键路径标注（task-01→task-03→task-06）
- [x] 全局验收标准具体可验证（AC-1~5 + 兼容条款）
- [x] 覆盖矩阵含全部当前版本 D-001~D-009（D-002@v2，v1 superseded 不单列）+ FR-1~4
- [x] 无 P0/P1 unresolved blocker（decisions 全 accepted）
- [x] brownfield 兼容性条款（旧 daemon + 零 API/表结构变更）
- [x] 无实现细节（接口签名/代码示例在 task-NN.md）
- [x] plan.md 文件清单与 design.md §6 一致（8 源码文件全覆盖：task-01 service.py / task-03 run_sync/service.py + test / task-04 lease_service.py + test / task-02 migration + test / task-05 session-list-layout.tsx）
- [x] 跨任务契约：task-01 产出 `_apply_session_terminal_status(run, session)` 被 **task-03**（close_interactive_run）消费（expects_from 对账通过，task-03 needs ⊆ task-01 provides）；**task-04**（cancel_lease）kill 固定 ended 直接 set（D-003，辅助函数对 run.status='killed' 返 failed 不适用），**不消费 task-01 契约**，depends_on [task-01] 仅作 W2 执行排序（无 expects_from，postcheck 不校验）
- [x] 文件覆盖：design §6 每个源码文件均被 ≥1 task allowed_paths 覆盖
