---
author: qinyi
created_at: 2026-06-14T20:57:20
change: 2026-06-14-unified-agent-execution
stage: archive
---

# Module Impact — 统一 Agent 执行路径（Daemon-Only）

## 分析方法（三重交叉验证）

- **真实变更**：`git diff --name-only HEAD~1`（HEAD=be5448b，本变更单 commit），以真实为准。
- **声明范围**：proposal.md §变更范围 + design.md §3 数据流。
- **任务范围**：plan.md 任务总表 + tasks.md Phase 列表。
- **结论**：真实 ⊇ 声明 ≈ 任务。spec_workspace / backend-tests 存在 proposal/design 未单列的连带改动 → 已标 `needs_review`。

剔除变更文档自身（`.sillyspec/changes/**`、`sillyspec.db`、`knowledge/uncategorized.md`），真实代码改动分两大块：

| 代码块 | 文件数 | 模块映射来源 |
|---|---|---|
| `backend/app/modules/**` + `backend/tests/**` | 19 | `docs/backend/modules/_module-map.yaml`（主项目 `docs/SillyHub/modules/_module-map.yaml` 聚合 backend，但**缺 daemon 条目**） |
| `sillyhub-daemon/src/**` + `sillyhub-daemon/tests/**` | 15 | `docs/sillyhub-daemon/modules/_module-map.yaml` |

## 模块影响矩阵

### Backend（`docs/backend/modules/_module-map.yaml`）

| 模块 | 影响类型 | 相关文件 | 更新内容摘要 | needs_review |
|---|---|---|---|---|
| **agent** | 逻辑变更 / 接口变更 / 数据结构变更 / 删除 | `adapters/claude_code.py`(删整文件) · `placement.py` · `service.py` · `router.py` · `schema.py` · `model.py` · `tests/test_execution_context.py`(新) · `tests/test_kill_and_state_mapping.py`(新) · `tests/test_no_online_daemon.py`(新) · `tests/test_adapter_isolation.py` · `tests/test_background_task_lifecycle.py` · `tests/test_dispatch_metadata.py` · `tests/test_kill.py` · `tests/test_router.py` · `tests/test_scan_run_reparse.py` | 删 SERVER 执行路径整文件 + 三条 `_execute_*_background` + `_proc_registry` + kill SIGTERM 链；`decide_backend` 去 SERVER 分支 + 新增 `NoOnlineDaemonError`；`dispatch_to_daemon` 扩 `repo_url/branch/allowed_paths/tool_config/timeout_seconds` 并持久化到 `lease.metadata`（task-03）；新增 `GET /agent-runs/{id}/execution-context` 端点（task-02）；`kill_run` 改道 `cancel_lease`，状态映射单一驱动（task-04） | false（核心范围，proposal/design 明确） |
| **daemon** | 逻辑变更 / 接口变更 / 数据结构变更 | `backend/app/modules/daemon/service.py` | `_build_claim_payload` 透传 bundle 字段；`complete_lease` 写回 AgentRun `total_cost_usd/duration_ms/input_tokens/output_tokens/num_turns/session_id/exit_code` + diff 入库前 `redact_output` 二次脱敏（task-06/07）；`sync_agent_run_status` lease→AgentRun 单一状态驱动（task-04）；`submit_messages`/`complete`/`start` publish 同一 `agent_run:{id}` channel | false |
| **spec_workspace** | 逻辑变更 / 删除 | `bootstrap.py` · `router.py` · `tests/test_bootstrap.py`(-1836 行) | bootstrap agent run 从 `ClaudeCodeAdapter`（SERVER 直执）改为 dispatch 到 `daemon_task_leases`；删除 SERVER 侧元数据写回（`_apply_run_metadata`/`_METADATA_FIELDS`）+ validator/spec_profile 内联引用；test_bootstrap 删 1836 行 SERVER 用例。**属 task-01 删 SERVER 的连带清理，proposal/design 未单列 spec_workspace** | **true** |
| **change**（仅测试） | 删除 | `backend/tests/modules/change/test_auto_dispatch.py`(-266 行) · `backend/tests/modules/agent/test_stage_dispatch.py`(-462) · `backend/tests/modules/agent/test_work_dir_strategy.py`(-92) | 旧 SERVER `dispatch_to_server` / auto_dispatch / work_dir_strategy 测试随 SERVER 路径删除而失效，整体删除。属 task-01 连带影响，proposal/design 未单列 | **true** |

> ⚠️ **map 缺口**：主项目 `docs/SillyHub/modules/_module-map.yaml` 聚合了 backend 各模块，但**未收录 daemon 条目**（`backend/app/modules/daemon/**` 无 paths glob）。本表 daemon 行依据 `docs/backend/modules/_module-map.yaml` 的 daemon 模块定义补全。建议 step 3 sync-module-docs 在主 map 补 daemon 条目（或确认是否刻意下沉到 backend 独立 map）。

### sillyhub-daemon 子项目（`docs/sillyhub-daemon/modules/_module-map.yaml`）

| 模块 | 影响类型 | 相关文件 | 更新内容摘要 | needs_review |
|---|---|---|---|---|
| **task-runner** | 逻辑变更 / 数据结构变更 | `src/task-runner.ts` · `tests/task-runner.test.ts` · `tests/task-runner-provider-dispatch.test.ts` · `tests/task-runner-retry-timeout.test.ts` | claim 后 fetch execution-context 填充 LeaseCtx → CLAUDE.md 写入 + 真实 clone 生效（退役 `repoUrl ?? undefined` 兜底）；`_finish` 透传 stats 到 result（task-06）；B2 超时可配（`lease.metadata.timeout_seconds` > config > 默认）；B3 spawn 级失败重试（清 resumeSessionId / 重试次数入 metadata / is_error 不重试，task-10） | false |
| **daemon** | 逻辑变更 | `src/daemon.ts` · `tests/daemon-parity.test.ts` | `_runLeaseStateMachine` claim 后新增 execution-context fetch 填充 LeaseCtx（task-05）；`completeLease` payload 补 stats（task-06） | false |
| **client**（hub-client） | 接口变更 | `src/hub-client.ts` · `tests/execution-context.test.ts` | 新增 `HubClient.getExecutionContext(agentRunId)`（task-05） | false |
| **backend-stream-json** | 逻辑变更 / 数据结构变更 | `src/adapters/stream-json.ts` · `tests/stats-passthrough.test.ts` | `extractResultStats` 拆 `usage` 为 `input_tokens/output_tokens` 并跨 assistant message 累加（`_accumulatedUsage`），对齐 SERVER `_extract_result_metadata`（task-06） | false |
| **workspace** | 逻辑变更 | `src/workspace.ts` · `tests/diff-truncate.test.ts` | `collectDiff` 增加 `MAX_PATCH_CHARS=50000` 截断（≤51200 避双截断）+ `\n...[truncated]` 尾标 + `stat_summary` 生成（task-07） | false |
| **config** | 配置变更 | `src/config.ts` · `tests/config.test.ts` | 超时默认值配置（B2，task-10 优先级链的兜底层） | false |
| **types** | 数据结构变更 | `src/types.ts` | 新增 `ExecutionContextPayload` 类型（task-05） | false |

## 未匹配文件

| 文件 | 性质 | 说明 | needs_review |
|---|---|---|---|
| **`sillyhub-daemon/src/spawn-env.ts`** | **新增模块** | task-09 B1 token + `tool_config.env` 注入 claude 子进程 env（三层 env 合并）+ `redactEnv` 守卫（密钥不泄漏）。**未在 `docs/sillyhub-daemon/modules/_module-map.yaml` 注册**（新模块），无 module 卡片。proposal §不在范围内曾注明「不补 daemon 子项目模块文档」，本变更延续该决策 | **true** |
| `sillyhub-daemon/tests/spawn-env.test.ts` | 新增测试 | 对应 spawn-env 新模块，随上 | **true** |

## needs_review 汇总（4 项）

1. **spec_workspace 模块**（backend）：SERVER 连带清理，proposal/design 未单列 → 建议确认 bootstrap dispatch 改道是否已纳入后续 spec_workspace 模块卡片维护。
2. **change / agent 旧测试删除**（backend/tests）：818 行旧 SERVER/dispatch 测试删除 → 建议确认无回归覆盖缺口。
3. **主项目 SillyHub module-map 缺 daemon 条目**：本变更 agent→daemon 强耦合改动，主 map 无法识别 daemon 后端模块 → 建议 step 3 补条目或确认下沉策略。
4. **spawn-env.ts 新模块无 module 卡片**：延续 proposal「不补 daemon 子项目模块文档」决策，建议后续独立 scan 补 sillyhub-daemon 模块卡片。

## step 3 sync-module-docs 更新结果（2026-06-14）

| 模块 / 文件 | 目标列（影响类型 / needs_review 原因） | 实际更新 | 状态 |
|---|---|---|---|
| sillyhub-daemon / `modules/spawn-env.md` | 新增模块无卡片（needs_review ④） | **新建卡片**：buildSpawnEnv 三层合并 + redactEnv 守卫 + 泄漏面控制契约 | ✅ 完成 |
| sillyhub-daemon / `_module-map.yaml` | 新增模块未注册 | last_change 更新；task-runner `depends_on` +`spawn-env`；credential `used_by` +`spawn-env`；新增 spawn-env 模块条目（paths/depends_on:[credential]/used_by:[task-runner]） | ✅ 完成 |
| sillyhub-daemon / `modules/client.md` | 接口变更 | `getExecutionContext` 契约行 + 跨 user 归属校验注（403） | ✅ 完成 |
| sillyhub-daemon / `modules/task-runner.md` | 逻辑变更 + 数据结构变更 | TaskRunnerResult.stats 字段；关键逻辑重写（execution-context fetch / buildSpawnEnv / spawnChildWithRetry 超时+重试 / collectDiff 截断 / return stats）；注意事项 env/超时/重试/diff 截断 | ✅ 完成 |
| backend / `modules/agent.md` | 逻辑/接口/数据结构/删除（核心契约变更） | **整篇重写**：daemon-only 架构图 + 关键逻辑（NoOnlineDaemon / dispatch+lease.metadata / execution-context / cancel_lease / 状态映射单一驱动 / diff 收口）+ 对外接口表加 execution-context + 数据流 + 设计决策 + 变更索引；删除 ClaudeCodeAdapter/_proc_registry/SIGTERM 全部过时内容 | ✅ 完成 |
| backend / `_module-map.yaml` agent 条目 | entrypoint + 符号变更 | tags +`daemon-only`；entrypoints +`/api/agent-runs/{run_id}/execution-context`；main_symbols +`NoOnlineDaemonError`/`ExecutionContextResponse`/`render_bundle_to_claude_md` | ✅ 完成 |
| SillyHub / `_module-map.yaml` | 缺 daemon 条目（needs_review ③） | 新增 daemon 模块条目（paths: `backend/app/modules/daemon/**`） | ✅ 完成 |

### needs_review 处置（4 项）

1. **spec_workspace SERVER 连带清理**：bootstrap dispatch 改道 + test 删 1836 行**已实施**（task-01 连带，verify 11/11 绿）。spec_workspace.md 卡片未单独更新（属连带影响，非本变更主线）→ 留待后续 sillyspec scan 补卡片。
2. **change/agent 旧测试删除 818 行**：**已实施**，新测试 `test_execution_context` / `test_kill_and_state_mapping` / `test_no_online_daemon` 覆盖新路径，无回归缺口。
3. **主 map 缺 daemon 条目**：✅ **已解决**（本批 SillyHub 主 map 新增 daemon 条目）。
4. **spawn-env.ts 新模块无卡片**：✅ **已解决**（新建 spawn-env.md + map 注册）。**修订** proposal「不补 daemon 文档」决策：spawn-env 是本变更引入的安全关键模块（token 注入 + redactEnv 守卫），不文档化留缺口。
