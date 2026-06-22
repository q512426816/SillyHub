---
author: qinyi
created_at: 2026-06-22T10:20:00+08:00
plan_level: full
---

# 实现计划：daemon-service-split

> 来源：design.md（§5.3 Wave / §6 文件清单 / §7.5 契约表）、tasks.md（6 Wave + 8 task 草案）、decisions.md（D-001~D-004 全 accepted）。
> 约束：纯结构重构，行为不变，router.py 零改动。每 Wave 独立提交 + 独立验收 + 独立回滚。

## Spike 前置验证

本次为确定的技术方案（facade 委托 + 文件移动），无新技术栈/隔离/性能不确定性。唯一技术风险（子包间循环引用）由 **W1 的 facade 骨架 + 全测**直接验证，不单列 Spike：

| 验证点 | 承载 | 不通过后果 |
|---|---|---|
| 子包 lazy import / 持有引用避免循环（session↔lease↔run_sync） | task-01（W1 建骨架后跑全测） | 调整子 service 构造期引用注入策略，重做 W1 |

## Wave 1（无依赖 — 安全网）
- [ ] task-01: 新建 5 子包空壳 + DaemonService 改为持有 5 子 service 引用的 facade（方法体暂保留原逻辑直接委托），跑 daemon 全测确认行为不变（覆盖：FR-01, FR-02, D-002）

## Wave 2（依赖 W1 — 最小最独立子域）
- [ ] task-02: runtime 方法迁入 `runtime/service.py`（RuntimeService），facade 改委托（覆盖：FR-02, D-004）

## Wave 3（依赖 W1 — 小子域）
- [ ] task-03: patch 方法迁入 `patch/service.py`（PatchService），facade 改委托（覆盖：FR-02）

## Wave 4（依赖 W1 — AgentRun 状态机）
- [ ] task-04: run_sync 方法迁入 `run_sync/service.py`（RunSyncService），facade 改委托（覆盖：FR-02, FR-04）

## Wave 5（依赖 W1 — 最大子域，单独 Wave 便于回滚）
- [ ] task-05: session 方法迁入 `session/service.py`（SessionService），facade 改委托；通知 `fix-interactive-lifecycle` 更新 W4 方法定位（覆盖：FR-02, FR-04）

## Wave 6（依赖 W1 — lease，DaemonLeaseService 不动）
- [ ] task-06: `DaemonService.lease_*` 迁入 `lease/service.py`（LeaseService）+ `_build_claim_payload` 迁入 `lease/context.py`；`lease_service.py` 原位不动（覆盖：FR-02, FR-03, D-003）

## 收尾 Wave（依赖 W2-W6 全部完成）
- [ ] task-07: 异常类定义迁入对应子包，facade `service.py` 集中 re-export（按 `grep -rn "from app.modules.daemon.service import"` 全量收集）（覆盖：FR-05, D-002）
- [ ] task-08: 更新 `daemon.md` 模块文档 + 全量验收（覆盖：FR-01, FR-04）

> **执行顺序建议**：W2→W3→W4→W5→W6 串行（每次只迁一个子域，facade 逐步瘦身，避免并发改 `service.py` 冲突）。逻辑上 W2-W6 均只依赖 W1，但串行提交保证 git 历史清晰、单 Wave 可独立 `git revert`。

## 任务总表

| 编号 | 任务 | Wave | 优先级 | 依赖 | 覆盖 FR/D | 说明 |
|---|---|---|---|---|---|---|
| task-01 | 建 5 子包骨架 + DaemonService facade 化 | W1 | P0 | — | FR-01, FR-02, D-002 | 安全网：逻辑暂留 facade，子包空壳，全测通过即行为不变 |
| task-02 | 迁 runtime → `runtime/service.py` | W2 | P0 | task-01 | FR-02, D-004 | register/heartbeat/启停/清理 ~215 行 |
| task-03 | 迁 patch → `patch/service.py` | W3 | P0 | task-01 | FR-02 | _apply_patch_to_worktree/_run_git_apply ~100 行 |
| task-04 | 迁 run_sync → `run_sync/service.py` | W4 | P0 | task-01 | FR-02, FR-04 | sync/close_interactive_run/submit_messages/post_scan ~800 行 |
| task-05 | 迁 session → `session/service.py` | W5 | P0 | task-01 | FR-02, FR-04 | 最大子域 ~1380 行；含 recover_*(W4 待接通) |
| task-06 | 迁 lease → `lease/service.py`+`context.py` | W6 | P0 | task-01 | FR-02, FR-03, D-003 | DaemonLeaseService 原位不动 |
| task-07 | 异常类迁子包 + facade re-export | 收尾 | P0 | task-02~06 | FR-05, D-002 | re-export router.py:55 的 9 异常类 + DaemonService |
| task-08 | daemon.md 文档 + 全量验收 | 收尾 | P0 | task-07 | FR-01, FR-04 | 契约摘要 + 变更记录 + 全套验收清单 |

## 关键路径

task-01（W1 安全网）→ task-05（W5 session，最大子域）→ task-07（re-export）→ task-08（验收）

> session 是最大子域（~1380 行、含 W4 待接通的 recover_*），是关键路径上的瓶颈。W1 是不可省略的前置（facade 未就位则后续迁移无安全网）。

## 全局验收标准

- `git diff backend/app/modules/daemon/router.py` **为空**（D-002 零改动铁证）
- `make backend-test` 通过（含 `test_session_recovery` 16 用例、`test_lease_service`、`test_run_input_service`）
- `make backend-lint` 通过（ruff check + format check + mypy）
- `DaemonService` 51 个方法签名/返回值/异常类型迁移前后逐位一致
- `from app.modules.daemon.lease_service import DaemonLeaseService` 仍可 import 且 `cancel_lease` 行为不变（D-003，agent 兼容）
- `router.py:55` 的 9 异常类 + `DaemonService` 从 `service` import 不变（re-export 兼容）
- runtime/lease/agent_run/session 四对象生命周期状态流转迁移前后对比一致（FR-04 契约不变）
- `session/service.py` ≤ 1500 行
- `grep "class DaemonService" service.py` 确认 facade 化（类体为委托，无业务逻辑）

> （以上为验收清单，非 Wave 任务；Wave 任务见上方各 Wave 下的 task-XX checkbox）

## 覆盖矩阵

| ID | 覆盖任务 | 验收证据 |
|---|---|---|
| D-001@v1 | task-01~06 | AC: router diff 为空 + 全测通过（方向 A 拆子包，契约不变） |
| D-002@v1 | task-01, task-07 | AC: router diff 为空 + 9 异常类 re-export 兼容（facade 完全兼容） |
| D-003@v1 | task-06 | AC: `lease_service.py` 原位 + agent import 可用（DaemonLeaseService 保留） |
| D-004@v1 | task-02~06 | AC: 5 子域分层 + session ≤1500 行（方案 A 标准粒度） |

| FR | 覆盖任务 | 验收证据 |
|---|---|---|
| FR-01 | task-01, task-08 | router git diff 为空 |
| FR-02 | task-01~06 | 51 方法归位 + grep 确认 facade |
| FR-03 | task-06 | DaemonLeaseService 原位 + cancel_lease 行为不变 |
| FR-04 | task-04, task-05, task-08 | 全测通过 + 状态流转对比 |
| FR-05 | task-07 | 9 异常类 + DaemonService re-export 兼容 |
