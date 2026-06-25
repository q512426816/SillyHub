---
author: qinyi
created_at: 2026-06-25T17:08:00
---

# Verify Result：interactive-idle-timeout-fix

> 变更：`2026-06-25-interactive-idle-timeout-fix`
> 验收对象：worktree（`.sillyspec/.runtime/worktrees/2026-06-25-interactive-idle-timeout-fix/`）
> 验收依据：design.md / requirements.md（FR-1~7, SC-1~6）/ decisions.md（D-001@v1/002/003@v1）

## 验收结论：✅ CONDITIONAL_PASS

实现符合 design，6 task 全部落地，测试全绿。条件：需 `sillyspec worktree apply` 合并主仓库后做端到端确认（scan 真实跑完不再撞 idle 的实机验证，受限于本机无完整 scan 运行环境，留作后续实机验收）。

## FR / SC 验收矩阵

| 需求 | 验收方式 | 结果 |
|---|---|---|
| FR-1 idle 默认禁用 | task-01 双守卫（start:1200 + _scanIdle:1249）+ task-04 测试 | ✅ |
| FR-2 env 逃生口 | task-01 env 解析保留 + task-04 SC-4 测试（env=1800 恢复） | ✅ |
| FR-3 scan 完成主动 end | task-03 钩子 + task-05 test_scan_run_complete_ends_session | ✅ |
| FR-4 stage 完成主动 end | task-03 钩子 + task-05 test_stage_run_complete_ends_session | ✅ |
| FR-5 多轮对话不自动 end | task-03 should_end 排除非 platform-managed + task-05 test_multiturn_chat_not_ended | ✅ |
| FR-6 end 失败不阻塞 lease | task-03 try/except warn + task-05 test_end_session_failure / test_no_agent_session_id_skips | ✅ |
| FR-7 手动链路不变 | 无改动（前端 endSession / backend end_session HTTP / FR-05 协议均未动） | ✅ 回归 |
| SC-1 scan 完成主动 end | task-05 断言 end_session 被调 + session 转 ended | ✅ |
| SC-2 长 turn 不误杀 | task-04 SC-2 测试（推进 3600s 不 end） | ✅ |
| SC-3 多轮手动结束 | 回归（手动链路未动） | ✅ |
| SC-4 idle 默认不启动 + env 恢复 | task-04 默认禁用 + SC-4 逃生口测试 | ✅ |
| SC-5 stage 完成主动 end | task-05 test_stage_run_complete_ends_session | ✅ |
| SC-6 end 失败 lease 仍 completed | task-05 test_end_session_failure_does_not_block_lease | ✅ |

## 测试结果（verify 独立重跑）

| 套件 | 用例数 | 结果 |
|---|---|---|
| daemon session-manager-idle-disabled.test.ts | 5 | ✅ passed |
| daemon session-idle-scanner.test.ts（含 AC-11 断言更新） | 19 | ✅ passed |
| backend test_lease_service.py::TestCompleteLeaseEndSession | 5 | ✅ passed |
| backend test_lease_service.py（全量，回归） | 48 | ✅ passed |
| backend test_interactive_lifecycle_patch.py（回归） | 24 | ✅ passed |

质量扫描：daemon `pnpm lint` 无 session-manager 报错；backend ruff（ci-check hook 覆盖）。

## 实现与 design 偏差（均为合理优化）

1. **task-02 简化**：design 原计划新造 `_end_session_for_completed_lease` 方法，实现改为直接复用现有 `facade.end_session`（经 `lease.runtime_id → DaemonRuntime.user_id` 作 `actor_runtime_owner_id`，走 runtime 归属校验路径）。零重复收口代码，符合 design 意图，不影响契约。
2. **`_scanIdle` 守卫补充**：design 未显式提及，实现发现光改 `DEFAULT_IDLE_TIMEOUT_SEC=0` 不够——`scanOnce()` 显式调用时 `idleSec > 0` 永真仍会 end。补 `if (_idleTimeoutSec <= 0) return` 守卫。这是 design Phase1 "默认不启动" 意图的必要补全。

## 根因修复验证

| 根因 | 修复 | 验证 |
|---|---|---|
| daemon idle 误判长 turn 为空闲 | D-001@v1 默认禁用 + 双守卫 | task-04 SC-2（3600s 不 end）✅ |
| backend scan 完成不主动 end_session | D-002@v1 complete_lease 钩子 | task-05 scan→end 断言 ✅ |

原始 bug 场景（agent-run-812ebea3.log：scan 30min 被杀）经修复后：idle 不再自动触发 + scan 完成主动 end，双重保证不再误杀。

## 遗留与风险

| 项 | 等级 | 说明 |
|---|---|---|
| 实机端到端验收 | 中 | 单测覆盖完整，但 scan 真实跑完不再撞 idle 的实机验证留作 apply 后确认（本机无完整 scan 运行环境） |
| 残留 review.json | 低 | task-09~16 多余 review.json（调试遗留），不影响功能，archive 前清理 |
| 断网+hang 极端泄漏 | 低 | D-003@v1 已接受，容忍，靠用户手动清理 |
| SillySpec 工具契约坑 | 低 | parseWavesFromPlan 要求 checkbox 在 `## Wave N` 下，文档未说明（建议记 docs/sillyspec/） |

## worktree 待 apply

7 个未应用变更，apply 后合并主仓库：
- sillyhub-daemon/src/interactive/session-manager.ts（改）
- backend/app/modules/daemon/lease/service.py（改）
- sillyhub-daemon/tests/interactive/session-manager-idle-disabled.test.ts（新增）
- sillyhub-daemon/tests/interactive/session-idle-scanner.test.ts（改）
- backend/app/modules/daemon/tests/test_lease_service.py（改）
- .sillyspec/docs/multi-agent-platform/modules/sillyhub-daemon.md（改）
- meta.json（sillyspec 自动生成）
