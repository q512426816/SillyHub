---
scale: large
tier: independent
---
# design — 用量统计细化到供应商/模型 + 会话页模型级联选择

author: qinyi
created_at: 2026-08-29 02:37:13

## 0. 背景与目标

见 proposal.md。三个子目标：①用量按供应商×模型落库 + 分组展示；②API 调用次数统计（含子代理）；③会话页配置条四块→两块 + 供应商/模型级联。前置：ql-20260829-001/002 已把 token 数值口径修对（result.usage 同源翻倍 / modelUsage 才是全量账），本变更在其之上补维度。

## 总体方案与范围

- **范围（in scope）**：daemon 终态上报扩展（interactive model_usage[]/api_requests、batch model/api_requests）；backend 新明细表落库 + run 既有列填充 + by_provider 统计 + inject_session 扩 model；前端会话配置条四块→两块（供应商级联模型）与运行时用量卡分组明细。
- **总体设计**：复用 ql-20260829-002 已打通的 modelUsage 数据源，daemon 侧只做「明细拆行 + 消息计数」；backend 侧明细表 upsert + 统计 SQL 沿用既有 COALESCE 去重模式；前端两处 UI 改造按原型 prototype-usage-by-provider-model.html。
- **范围外（Non-Goals）**：不做计费核算、不动 pre-session-picker、不动 Codex 供应商锁定、不做供应商模型列表持久化维护。

## 决策与方案选择

关键决策全文见 decisions.md（D-001~D-004），要点：
- D-001：方案 A 完整版（供应商×模型明细表）优于 B 轻量版（只到供应商级）——B 后续补明细要返工。
- D-002：模型候选 = 供应商高级设置既有体系（角色映射/兜底模型/model 去重），不新建模型列表维护。
- D-003：统计展示 = 现有 runtimes 用量卡扩展，不建新页。
- D-004：配置条移除机器/智能体两块，pre-session-picker 不动。
- 设计内补充决策：明细表优于 JSONB 列（双方言 GROUP BY 直白）；调用次数用消息流计数（SDK 无现成字段）；Design Grill 修订两项（§1.2 仅空时填充 llm_provider_id、§4.2 兜底模型快照级同步）。


## 1. 数据模型

### 1.1 新表 `agent_run_model_usage`

| 列 | 类型 | 说明 |
|---|---|---|
| id | Uuid PK | |
| run_id | Uuid FK agent_runs ON DELETE CASCADE | 一次 run 的明细行集合 |
| model | varchar(128) NOT NULL | 模型名（modelUsage key / ProviderConfig.model / "unknown"） |
| input_tokens / output_tokens / cache_read_tokens / cache_creation_tokens | int NOT NULL default 0 | 该模型四维消耗 |
| api_requests | int NOT NULL default 1 | 该模型调用次数（见 §2 口径） |

UNIQUE(run_id, model)；终态 upsert（同 run 同模型覆盖）。迁移一个 alembic revision，head 接 6756e634f119。

**为什么不复用 agent_runs 加 JSON 列**：统计 SQL 需按 model GROUP BY 聚合（PG jsonb 也能做，但明细表对 PG/SQLite 双方言测试更直白，且 run 删除级联干净）。项目未上线无历史包袱（CLAUDE.md 规则 11）。

### 1.2 `agent_runs` 既有列填充（不加列）

`llm_provider_id`（已存在）/ `model`（已存在）：
- **llm_provider_id 现状修正（Design Grill 项2）**：该列并非从未写入——`session/service.py:3359` 在 dispatch 时已按轮写入生效供应商。故终态**不覆盖** llm_provider_id（保留 dispatch 时点的准确值，防切供应商竞态错归因）；仅当为空（batch 路径 / 老数据）时才在 complete_lease 填 lease ProviderConfig 的 provider id。
- **model 列**（确从未写入）在终态填充：interactive 取 model_usage 中 `input+output` 最大行的 model；batch 取 ProviderConfig.model。
- 不回填存量（老 run 归「未记录」桶）。

## 2. 调用次数口径（D-01）

- **定义**：一次 run 内全部模型 API 调用次数，**含 Task 子代理、sidechain**，不含权限分类器等 query-pipeline 之外的内部调用（SDK modelUsage 同口径，天然对齐）。
- **interactive 计数点**：daemon 消息流中每条 `assistant` 消息（SDK 每次模型调用产出一条；子代理消息带 parent_tool_use_id 同样是 assistant 类型）计 1。turn 边界不清零——按 run 累计，随终态上报。
- **batch 计数点**：stream_event `message_start` 事件数（实测 == num_turns，2.1.216 验证）。
- **per-model 拆分**：interactive 按 modelUsage 各模型消耗占比不可知请求数（SDK 不给）——model_usage[].api_requests 用**统一分摊**：run 总 requests 按各模型 input+output 占比四舍五入分配，残差给最大模型（诚实标注：明细表 requests 为估算分摊，run 级 api_requests 为精确值）。batch 单模型无此问题。
- **与套餐计费口径差异**：coding plan「按次数」可能按会话/时间窗合并请求，UI 标注「与套餐计费口径可能略有出入」（FR-02-3）。

## 3. daemon 侧改动

### 3.1 interactive 终态（src/daemon.ts onTurnResult）

payload 新增（复用 ql-20260829-002 的 modelUsage 数据源，不重复解密/解析）：

```
model_usage?: Array<{model: string, input_tokens, output_tokens,
                     cache_read_tokens, cache_creation_tokens}>   // 逐 key 一行
api_requests?: number                                            // 本 run assistant 消息计数
```

- `model_usage` 由 `_aggregateModelUsage` 改造：聚合函数拆两个出口——`_aggregateModelUsage`（现有求和，payload 四维继续用）+ `_modelUsageRows`（明细行，camelCase→snake 映射 + requests 分摊入参）。modelUsage 缺失 → 两字段都不写（老兼容）。
- `api_requests`：daemon 桥接层在 onTurnMessage 处计数（state 上加 per-run 计数器，turn 换 run 时随终态清零；复用 SessionState 或桥接 Map，取实现最小侵入方案）。
- close 覆盖语义：终态 model_usage 只在非空时覆盖 backend 明细（幂等 upsert by (run_id, model)）。

### 3.2 batch 终态（src/task-runner.ts + hub-client.ts）

- complete stats 新增 `model`（lease ProviderConfig.model ?? "unknown"）与 `api_requests`（StreamJsonAdapter 暴露 message_start 计数——adapter 内 `_messageStartCount`，resetAccumulator 一并清零）。
- hub-client completeLease body 透传两字段（undefined 不写）。

## 4. backend 侧改动

### 4.1 终态落库

- `close_interactive_run`（run_sync/service.py）：处理 payload.model_usage / api_requests——明细行 upsert（同 run 先 delete 后 insert，事务内，等价幂等）+ run.llm_provider_id/model 填充。schema（InteractiveRunResultRequest）扩字段。
- `complete_lease`（lease/service.py）：stats.model / api_requests → 单行明细 + run 两列填充。
- 失败兜底：明细落库异常不阻塞 run close（try/except warn，与现有 best-effort 风格一致）。

### 4.2 会话切模型（inject_session 链路）

- `inject_session(..., llm_provider_id, model)` 扩参：model 空串 = 跟随供应商配置；model 非空而供应商为空 → 422（模型依赖供应商）。
- **兜底模型遮蔽规则（Design Grill 项5）**：credential-injector 规则 3 的优先级是 `default_fallback_model ?? c.model`——若供应商配了兜底模型，会话显式选择的 model 会被静默遮蔽。故会话显式选模型时，backend 下发 daemon 的 ProviderConfig 快照**同步将 default_fallback_model 置为所选 model**（快照级覆盖，不动 llm_providers 原配置）；model 空串（默认）时快照原样透传。daemon/credential-injector 仍零改动。
- 会话 ProviderConfig 快照更新 model → daemon SESSION_RELOAD 既有链路（env 注入见上）。
- 会话配置快照 config_snapshot.model 回填展示。

### 4.3 统计 API（runtime/service.py get_runtimes_usage）

响应 `RuntimeUsageRead` 新增 `by_provider: list[ProviderModelUsageRead]`：

```sql
SELECT p.id provider_id, p.name provider_name, u.model,
       SUM(u.input_tokens), SUM(u.output_tokens),
       SUM(u.cache_read_tokens), SUM(u.cache_creation_tokens),
       SUM(u.api_requests)
FROM agent_run_model_usage u
JOIN agent_runs r ON r.id = u.run_id
LEFT JOIN llm_providers p ON p.id = r.llm_provider_id
LEFT JOIN agent_sessions s ON r.agent_session_id = s.id
LEFT JOIN daemon_task_leases l ON r.lease_id = l.id
WHERE COALESCE(s.runtime_id, l.runtime_id) IS NOT NULL
  AND {created_at 比较（同现有方言分支）} >= :since
GROUP BY p.id, p.name, u.model
```

与现有 summary 同窗同去重（COALESCE 双 JOIN）；provider NULL → provider_name='未记录'；model NULL 不存在（明细行 model 恒非空）。summary/daily 原样保留（FR-04-3 零回归）。

## 5. 前端侧改动

### 5.1 session-config-bar（四块→两块+级联）

- 删除「机器」「智能体」两个 Ctrl 块及其数据依赖（useDaemonMachines 在本组件的调用若无他处引用则移除；useActiveSharedAgents 保留——档案共享标识仍用）。
- 供应商 Ctrl 内嵌模型子下拉（供应商选定且非「不指定」时显示）：
  - 候选 = provider.model / default_fallback_model / model_role_mappings[sonnet|opus|fable|haiku].model 去重保序 + 首项「默认（跟随供应商配置）」；
  - 切换提交 injectSession(model)（预会话 provisional 同步暂存）；
  - 当前值 = config_snapshot.model ?? 「默认」。
- Codex 锁定态（D-010）：供应商+模型整块锁定提示不变。
- 布局：两块等宽（沿用现有 Ctrl 样式类，删除后自然收缩，不新造样式）。

### 5.2 runtime-card 用量区分组

- UsageStat 行下方新增「按供应商 / 模型」明细列表（紧凑行：供应商标签 + 模型名 + 四维缩写 + 调用次数 + 计费口径 footnote）；数据来自 usage.by_provider；空态隐藏。
- 图表（RuntimeUsageLineChart）不动。

### 5.3 类型

后端 schema 改动后 `pnpm gen:types` 重生成 api-types.ts + openapi.json 同提交（CLAUDE.md 规则 21）。

## 6. 生命周期契约表

| 事件 | 发起方 | 接收方 | 必需字段 | 状态变化 / 副作用 |
|---|---|---|---|---|
| interactive turn 终态上报 | daemon onTurnResult | backend POST runs/{id}/result | status, is_error, 四维 token, model_usage?, api_requests? | run→completed/failed；明细表 upsert；run.llm_provider_id/model 填充；requests 落 run 级 |
| batch 终态上报 | daemon completeLease | backend complete_lease | status, stats{四维, model?, api_requests?} | 同上（单模型单行） |
| 会话切供应商+模型 | 前端 injectSession | backend inject_session | llm_provider_id（可空串）, model（可空串；非空需供应商） | 会话 ProviderConfig 更新 → daemon SESSION_RELOAD → CLI 重启（ANTHROPIC_MODEL） |
| 用量统计查询 | 前端 runtimes 页 | backend GET /runtimes/usage | window（1d/7d/30d） | 只读；响应新增 by_provider 分组 |
| daemon 老版本终态 | 老 daemon | backend | 无 model_usage/api_requests | 字段缺省 → 明细无行、requests NULL，close 正常（N-01） |

会话/租约/守护进程自身 lifecycle（claim/heartbeat/lease 状态机）不变。

## 7. 文件变更清单

**sillyhub-daemon（仓根相对）**
- sillyhub-daemon/src/daemon.ts
- sillyhub-daemon/src/adapters/stream-json.ts
- sillyhub-daemon/src/task-runner.ts
- sillyhub-daemon/src/hub-client.ts
- sillyhub-daemon/tests/daemon-interactive-bridge.test.ts
- sillyhub-daemon/tests/stats-passthrough.test.ts

**backend（仓根相对）**
- backend/app/modules/agent/model.py
- backend/migrations/versions/20260829010000_add_agent_run_model_usage.py
- backend/app/modules/daemon/schema.py
- backend/app/modules/daemon/router.py
- backend/app/modules/daemon/run_sync/service.py
- backend/app/modules/daemon/lease/service.py
- backend/app/modules/daemon/service.py
- backend/app/modules/daemon/session/service.py
- backend/app/modules/daemon/runtime/service.py
- backend/app/modules/daemon/tests/test_run_sync_model_usage.py
- backend/app/modules/daemon/tests/test_lease_model_usage.py
- backend/app/modules/daemon/tests/test_runtime_usage_by_provider.py
- backend/app/modules/daemon/tests/test_inject_session_model.py

**frontend（仓根相对）**
- frontend/src/components/sessions/session-config-bar.tsx
- frontend/src/components/daemon/runtime-card.tsx
- frontend/src/components/daemon/runtime-card-helpers.tsx
- frontend/src/components/sessions/__tests__/session-config-bar.test.tsx
- frontend/src/app/(dashboard)/runtimes/__tests__/page-usage.test.tsx
- frontend/src/lib/daemon.ts
- frontend/src/lib/api-types.ts
- backend/openapi.json

## 8. 风险登记

- **R-01 requests 分摊是估算**（interactive per-model 无精确请求数源）→ run 级 api_requests 精确、明细行标注估算；后续 SDK 若给 per-model requests 可平滑替换。
- **R-02 会话切模型 = CLI 重启轮**（reload 链路）：与现有切供应商同代价，用户已接受该交互；中断当前轮的守卫（idle 才可切）沿用。
- **R-03 移除机器块丢失机器可见性**：会话页不再显示所属机器（会话列表/机器页仍可见）；用户明确要求移除。
- **R-04 明细表膨胀**：每 run ≤ 模型数行（典型 1-3 行），量级 = agent_runs×3，无需分区。
- **R-05 双方言 SQL**（PG/SQLite）：by_provider 查询沿用 date_trunc/strftime 分支模式，纯 GROUP BY 无方言函数，风险低。
- **R-06 gen:types 债**：schema 改动必须同提交生成类型（规则 21），CI 前端测试 mock 需补 by_provider 字段。
- **R-07 兜底模型遮蔽（Design Grill 项5）**：credential-injector `default_fallback_model ?? model` 优先级会让会话级模型选择对配了兜底模型的供应商静默失效——已用「快照级同步 default_fallback_model = 所选 model」消解（§4.2），verify 阶段补一条真实切换用例确认 env 生效。
- **R-08 终态覆盖 vs dispatch 值（Design Grill 项2）**：llm_provider_id 终态无条件覆盖会把 dispatch 时点准确值改成终态会话当前值（切供应商竞态错归因）——已改为「仅空时填充」（§1.2）。

## 9. 自审 / Self-Review

- 数值口径与 ql-20260829-001/002 一致（modelUsage 全量、result 优先回落、不引入新求和）✓
- upsert 幂等：终态重试（retryTerminal/outbox 补发）同 run 重放安全（delete+insert 事务内）✓
- 老版本 daemon / 老数据三处兼容点（§4.1 兜底、§1.2 不回填、N-01）✓
- Non-Goals 边界（不做计费、不动 pre-session、不动 Codex）明确 ✓
- 前端 mock 债风险（R-06）已登记，verify 阶段跑 module subset 测试对账 ✓
