---
author: WhaleFall
created_at: 2026-07-31T10:05:00
task: archive
type: module-impact
---

# 模块影响分析（Module Impact）— daemon 心跳卡死 + 回复重复修复

> 变更 `2026-07-30-daemon-heartbeat-dedup-fix`（含 task-14 跨调用 DELETE 补丁）

## 三重交叉验证

| 来源 | 范围 |
|---|---|
| 声明范围（proposal/design §6 文件清单） | sillyhub-daemon（policy + daemon.ts + session-manager.ts）+ backend（run_sync/service.py）；task-14 追加 agent/model.py + migration |
| 任务范围（tasks.md/plan.md task-01~14） | 同上 + 各模块 tests |
| 真实变更（git diff main...HEAD，worktree 分支） | 见下表（已排除 .sillyspec/ 文档） |

**以 git diff 为准**，三重一致，无遗漏、无超范围。

## 真实变更文件（git diff main...HEAD）

```
backend/app/modules/agent/model.py                                          (task-14)
backend/app/modules/daemon/run_sync/service.py                              (task-08 + task-14)
backend/app/modules/daemon/tests/test_run_sync_assistant_override.py        (task-12 + task-14)
backend/migrations/versions/202608310900_agent_run_log_segment_id.py        (task-14 新增)
sillyhub-daemon/src/daemon.ts                                               (task-03/04/09)
sillyhub-daemon/src/interactive/session-manager.ts                          (task-05/06/07 + type 修复 + DEBUG 清理)
sillyhub-daemon/src/policy/path-utils.ts                                    (task-02)
sillyhub-daemon/src/policy/runtime-policy.ts                                (task-01)
sillyhub-daemon/tests/{daemon-multi-runtime,daemon/sync-allowed-roots,interactive/session-manager,interactive/session-manager.partial-dedup,policy/daemon-policy-update,policy/path-utils,policy/runtime-policy}.test.ts
```

## 模块影响矩阵

| 模块 | 影响类型 | 相关文件 | 更新内容摘要 | needs_review |
|------|----------|----------|-------------|-------------|
| agent | 数据结构变更 | `backend/app/modules/agent/model.py` + `migrations/versions/202608310900_*.py` | AgentRunLog 加 `segment_id` 列（String 200, nullable, indexed）；partial 行写值、complete 行 NULL；migration down=`202607301000`。供 backend override 跨调用 DELETE 已落库 partial | false |
| daemon | 逻辑变更 | `backend/app/modules/daemon/run_sync/service.py` + `sillyhub-daemon/src/{daemon,interactive/session-manager,policy/runtime-policy,policy/path-utils}.ts` + 两端 tests | **卡死**：PolicyCache.set 去 resolveRealPath 统一归一口径 + isPathUnderAnyRoot 判定时 realpath（下沉）+ _syncAllowedRoots 短路 + 口径点统一。**重复**：daemon emit [ASSISTANT_OVERRIDE] + segmentId（含 type 修复）+ backend override 删 partial；task-14 补跨调用 `_revoke_committed_partials`（select+session.delete 已 commit partial）。DEBUG 日志清理 | false |

## 未匹配文件

| 文件 | 说明 |
|---|---|
| `docs/sillyspec/brainstorm-reopen-step-state-desync.md`、`docs/sillyspec/plan-wave-task-checkbox-format.md` | SillySpec 工具坑笔记（规则 15），非产品模块 |
| `meta.json` | sillyspec worktree 元数据，非产品模块 |

## 跨模块影响

- **agent ↔ daemon**：AgentRunLog（agent 模块表）的 segment_id 列由 daemon run_sync（daemon 模块）写入 + override 时 DELETE。两模块协同，本次一并改。
- **不改**：前端、API schema/DTO（segment_id 是 DB-only，不入响应）、thinking 机制本身、lease/session/agent_run 状态机、PPM。

## needs_review 汇总

agent / daemon 两模块本次改动明确（设计 + 实跑验证均闭环），needs_review = false。建议 step 3 同步更新 `modules/agent.md`（AgentRunLog 新字段）+ `modules/daemon.md`（卡死口径 + 重复 override 跨调用 DELETE 机制）。
