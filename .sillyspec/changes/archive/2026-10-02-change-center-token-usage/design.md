---
author: qinyi
created_at: 2026-10-02 23:01:24
generated_by: sillyspec-design-init
scale: large  # backend（migration+model+schema+service+router+usage_service）+ frontend（types+组件）+ 双侧测试，跨模块有 schema 变更 → large 走四件套 + plan
---

# 设计文档（Design）— 2026-10-02-change-center-token-usage

## 背景

本地 CLI（ZCode / Claude Code 等）直接本地跑 sillyspec 命令时，会 best-effort 上报日志元信息到平台（`POST /api/agent-logs`，落 `platform_agent_logs` 表），并自动建 `agent_sessions` 行（origin=tool_report，标题「本地 · 变更名」）、经 `change_session_links` 绑定变更（backend/app/modules/platform_sync/service.py:133-158 `_bind_entry_ctx`、:2040-2080 会话建行）。但这些会话的 **token 用量不落库**——`platform_agent_logs` 无任何 token 列，用量只在会话回放时经 backend→daemon WS RPC 实时解析展示（backend/app/modules/platform_sync/router.py:923-983）。

结果：变更中心（变更详情用量卡 + 列表「执行」列 + 快速修复抽屉，2026-08-30-change-center-usage-stats 已交付）的用量聚合只覆盖 `agent_runs` 集合（backend/app/modules/change/usage_service.py:130-151 双锚点 UNION），对本地 CLI 会话恒为空——用户在会话回放页看得到用量，变更中心却看不到。

## 设计目标

1. 本地 CLI 会话的 token 用量**落库**为快照，触发时机挂在既有 agent-logs 上报链路上（方案 A，D-002@v1）。
2. 变更中心（变更 + 快速修复）用量统计**并入**本地 CLI 用量，展示口径与平台执行一致（四维 token + 命中率 + 按模型明细行），totals = Σ by_model 口径守恒。
3. daemon **零改动**（复用回放已有的 RPC 通道与解析器）；上报响应路径**零阻塞、零失败放大**（解析落库 best-effort）。

## 非目标

- 不做成本（total_cost_usd）展示——daemon 解析器不输出成本，现有变更中心口径也不含。
- 不做本地 CLI 的按模型明细——解析器 totalUsage 只有四项累计，无 per-model（YAGNI；未来解析器扩展后再议）。
- 不做 daemon 周期推送任务（方案 B 已否决，D-002@v1）。
- 不改会话回放页——继续走实时解析 RPC，不切换到落库快照。
- 不做历史回填——上线前旧 entry 无快照显示 0，由下次上报自然补齐（全量解析幂等）。

## 拆分判断

单变更不拆分：三段改动（落库链路 / 聚合扩展 / 前端展示）共享同一 schema 变更与口径定义，拆开会造成中间态口径不守恒（有快照无展示、或有桶无数据），耦合度高、总规模中等（约 10 文件），单变更三 Wave 交付即可。无批量模式特征。

## 总体方案

```
CLI（ZCode/Claude Code…本地跑 sillyspec 命令）
  │ best-effort POST /api/agent-logs（既有，不变）
  ▼
backend router push_agent_logs（backend/app/modules/platform_sync/router.py:533-569）
  ├─ 同步：upsert_agent_log_entries 落元信息 + 会话绑定（既有，不变）
  └─ 异步：fire_background_task → usage 快照摄取（新）
        │ 对每个候选 entry（去节流后）
        │   _resolve_agent_log_read_target 两级定位 daemon（复用 router.py:671-751）
        │   send_host_fs_rpc → daemon host_fs.read_agent_log_messages（复用，零 daemon 改动）
        │   取响应 totalUsage 四项（status=parsed 且非 null）
        ▼
      UPDATE platform_agent_logs SET usage_* = 快照, usage_parsed_at = now
        （覆盖写幂等；失败/离线记日志跳过，下次上报补齐）

变更中心查询（既有端点，扩展聚合）
  GET /changes/{cid}/usage、GET /changes 列表摘要、quicklog 两端点
  └─ usage_service 在 run 两段（明细+兜底）外追加「本地段」：
       会话锚点 join platform_agent_logs，会话级二选一（无 agent_runs 行的会话才计），
       SUM 四维 → 「本地 CLI」桶行；totals 合并
```

### Wave 划分

- **Wave 1（存储 + 摄取链路）**：migration 加列 → model/schema → 异步摄取任务（含节流、并发限、失败降级）→ router 挂后台任务 → backend 单测。
- **Wave 2（聚合扩展）**：usage_service 详情/列表/quicklog 加本地段（会话级二选一防双计）→ backend 聚合单测。
- **Wave 3（前端 + 契约）**：`pnpm gen:types` → ChangeUsageCard 本地 CLI 桶行 + 注脚 → 前端组件测试。

## 文件变更清单

| 操作 | 文件路径 | 说明 |
|---|---|---|
| 新增 | NEW:backend/migrations/versions/20261002010000_add_platform_agent_log_usage.py | alembic 迁移：platform_agent_logs 加 5 列（usage_input_tokens / usage_output_tokens / usage_cache_read_tokens / usage_cache_write_tokens 均 nullable BigInteger，usage_parsed_at nullable UTC DateTime） |
| 修改 | backend/app/modules/platform_sync/model.py | AgentSessionLogORM 加上述 5 列（producer：摄取任务；consumer：change/usage_service 聚合） |
| 修改 | backend/app/modules/platform_sync/schema.py | 内部快照结构（摄取任务用）；对外 API DTO 不变 |
| 新增 | NEW:backend/app/modules/platform_sync/usage_ingest.py | 异步摄取服务：候选筛选（节流/存在性/harness）、RPC 解析、覆盖写落库、失败降级记日志 |
| 修改 | backend/app/modules/platform_sync/router.py | push_agent_logs 在 service 返回后 fire_background_task 摄取（不进 service 事务） |
| 修改 | backend/app/modules/change/usage_service.py | 详情 `_aggregate_usage` / 列表 `_summarize_anchor` / quicklog 各加本地段；「本地 CLI」桶并入 by_model |
| 修改 | backend/app/modules/change/schema.py | 注释口径更新（DTO 结构不变，本地段复用 by_model 行，model 字段装桶名） |
| 修改 | frontend/src/components/changes/detail/change-usage-card.tsx | 「本地 CLI」桶绿阶 tag（对齐「未记录」灰阶兜底桶先例 :316-333）+ 请求列「—」处理 + 注脚文案更新 |
| 生成 | frontend/src/lib/api-types.ts | `pnpm gen:types` 再生成（随 backend openapi 变更提交） |
| 生成 | backend/openapi.json | 同上 |
| 新增 | NEW:backend/app/modules/platform_sync/tests/test_usage_ingest.py | 摄取任务单测（节流/降级/幂等覆盖写/离线跳过） |
| 修改 | backend/app/modules/change/tests/test_usage_stats.py | 本地段聚合单测（并入/双计防护/quicklog/列表批量） |
| 修改 | frontend/src/components/changes/detail/ | change-usage-card 组件测试补本地 CLI 桶用例 |

## 接口定义

本变更接口面：0 端点（既有端点行为扩展——POST /api/agent-logs 响应语义不变、usage 端点 DTO 字段集零变化，无新增/删除端点）。

```python
# backend/app/modules/platform_sync/usage_ingest.py（新）
class AgentLogUsageIngestService:
    def __init__(self, session: AsyncSession): ...

    async def ingest_for_push(
        self, workspace_id: uuid.UUID, entries: list[AgentLogEntry]
    ) -> int:
        """上报后异步摄取入口（fire-and-forget task 内调用，自开 session）。

        - 候选筛选：exists=true、agent_session_id 已落库、format 属于
          {'zcode-model-io-jsonl','claude-code-jsonl'}（registry 有解析器且输出
          totalUsage 的格式；cursor 恒 null / codex unsupported 不浪费时间）；
          节流：同 entry 的 size_bytes+mtime_ms 与库中一致 且 usage_parsed_at
          距今 < 300s → 跳过（日志未增长不重复解析）。
        - 并发：asyncio.Semaphore(3) 限并发 RPC；单 entry 复用
          send_host_fs_rpc 默认 30s 超时。
        - 落库：status=parsed 且 totalUsage 非 null → UPDATE 覆盖写五列；
          null/unsupported/too_large/parse_error/离线/超时 → 记 log.info 跳过，
          不抛（best-effort）。返回成功落库 entry 数。
        """
```

**Grill B-1 裁定（scope 构造）**：`_resolve_agent_log_read_target`（backend/app/modules/platform_sync/router.py:704-718）签名要求 `PlatformSyncAuthScope`，后台任务无请求上下文——摄取任务**按 ingest 的 workspace_id 自构造仅含该 workspace 的 scope 对象**复用该函数（其内部只消费 workspace 归属做定位，不做 token 校验）；若实现期发现耦合更深的依赖，降级方案为抽取「entry → daemon_id 两级定位」子 helper 供两处共用（结构等价重构，不改行为）。

```python
# backend/app/modules/change/usage_service.py（扩展，签名不变）
# 详情 _aggregate_usage 追加本地段（伪码）：
#   local_rows = SELECT pal.usage_input_tokens, ... FROM platform_agent_logs pal
#     JOIN agent_sessions s ON pal.agent_session_id = s.id
#     JOIN change_session_links csl ON csl.session_id = s.id AND csl.change_id = <cid>
#     WHERE NOT EXISTS (SELECT 1 FROM agent_runs r WHERE r.agent_session_id = s.id)
#       AND pal.usage_parsed_at IS NOT NULL
#   → SUM 四维并入 totals；桶名「本地 CLI」并入 by_model（api_requests=0，
#     排序按 input+output 降序参与，「未记录」仍恒末位）

# 列表/quicklog 摘要 _summarize_anchor 追加本地段（Grill B-2 补伪码；锚点结构
# 与详情不同——无 run 列，本地段直接 GROUP BY change_id 出每变更加总）：
#   local_sum = SELECT csl.change_id AS group_key,
#       SUM(COALESCE(pal.usage_input_tokens,0)) AS input_tokens, ... 四维
#     FROM platform_agent_logs pal
#     JOIN agent_sessions s ON pal.agent_session_id = s.id
#     JOIN change_session_links csl ON csl.session_id = s.id
#       AND csl.change_id IN (<页内变更 id 列表>)
#     WHERE NOT EXISTS (SELECT 1 FROM agent_runs r WHERE r.agent_session_id = s.id)
#       AND pal.usage_parsed_at IS NOT NULL
#     GROUP BY csl.change_id
#   → 单独一条聚合查询出整页本地段，Python 侧与 run 段摘要按 change_id 合并
#     （token 四维相加；时间三元组/轮次/请求次数不动）。
#   quicklog 摘要同构：锚点换 quicklog_session_links（workspace_id + ql_id 集）。
```

## 生命周期契约表

| 事件 | 发起方 | 接收方 | 必需字段 | 状态变化 |
|---|---|---|---|---|
| agent-logs 上报（既有） | CLI | backend | AgentLogPushRequest | platform_agent_logs upsert（不变） |
| 用量摄取（新） | backend 后台任务 | daemon（WS RPC） | path/format | 无 daemon 侧状态；backend 侧 usage_* 快照 NULL→值 或 值→值（覆盖写幂等，无中间态） |
| 用量落库（新） | backend 后台任务 | DB | 五列快照 | 覆盖写；失败不落（保持旧快照），无回滚语义 |

不涉及 session/lease/claim/heartbeat 状态迁移——摄取任务无状态、无重试队列（下次上报即天然重试）。

## 数据模型

`platform_agent_logs` 加 5 列（一次 migration，nullable，旧行全 NULL）：

| 列 | 类型 | 语义 |
|---|---|---|
| usage_input_tokens | BigInteger NULL | 该日志文件全生命周期累计输入 token（daemon 解析 totalUsage.inputTokens，按调用去重求和口径） |
| usage_output_tokens | BigInteger NULL | 累计输出 token |
| usage_cache_read_tokens | BigInteger NULL | 累计缓存读取 token |
| usage_cache_write_tokens | BigInteger NULL | 累计缓存写入 token（对应 run 侧 cache_creation_tokens 语义） |
| usage_parsed_at | DateTime(UTC) NULL | 快照最后成功落库时间 |

一个 entry = 一个日志文件 = 一份全量快照，覆盖写，无明细子表。

## 兼容策略（brownfield 必填）

- **旧 daemon / 旧 CLI**：未升级 daemon 回 `method_not_found` → 摄取任务捕获跳过（复用回放通道既有异常分类，backend/app/modules/platform_sync/router.py:788-821），上报主流程不受影响。
- **未上报用量的存量 entry**：五列 NULL → 聚合本地段 `usage_parsed_at IS NOT NULL` 过滤自然跳过，变更中心显示与现状一致（不回退、不伪造 0 桶行）。
- **API 兼容**：`/changes` 列表、`/changes/{cid}/usage`、quicklog 端点 DTO 结构不变（本地量并入既有字段），前端不升级也无破坏。
- **回退路径**：migration downgrade 删 5 列；聚合本地段 SQL 空结果时与改造前完全一致。
- **口径守恒**：by_model 新增「本地 CLI」桶行保证 totals = Σ by_model 不变量延续（2026-08-30 变更既立）。

## 风险登记

| 编号 | 风险 | 等级 | 应对策略 |
|---|---|---|---|
| R-01 | 双计：同一会话既有 agent_runs 终态数据（平台派发）又有 platform_agent_logs 快照，两段都 SUM | P0 | 聚合本地段加会话级二选一：`NOT EXISTS (agent_runs WHERE agent_session_id = s.id)`——run 为权威终态，快照只补 run 缺失的会话；单测覆盖混合场景 |
| R-02 | 上报高频导致重复解析（CLI 每条命令上报一次，50 entry 批量） | P1 | 节流：size_bytes+mtime_ms 未变且 300s 内已解析 → 跳过；并发 Semaphore(3)；失败 best-effort 不重试不排队 |
| R-03 | daemon 离线/超时/RPC 失败导致快照滞后 | P1 | 接受滞后（非实时承诺）：跳过记日志，下次上报全量解析幂等补齐；变更中心展示的是落库快照非实时值，注脚声明 |
| R-04 | 解析器能力差异（cursor 恒 null、codex unsupported、超限 too_large——上限值见 sillyhub-daemon/src/host-fs-handler.ts DEFAULT_MAX_CONTENT_BYTES） | P2 | 候选筛选只放行有 totalUsage 的两种 format；null/异常状态一律不落库不报错。备忘（Grill B-3）：全 0 快照 + 无 run 的变更会误触发「尚无关联执行」引导文案（P3 文案偏差，不修） |
| R-05 | 纯本地变更的空态误判：无 run → 时间三元组/轮次/请求全 None/0，hasNoExecution 依赖 totals 全 0 才触发引导文案 | P1 | 纯本地变更 totals 非 0 → 不触发空态；时间/耗时显示「—」、轮次 0 属诚实值（原型场景二），不改 hasNoExecution 判定 |
| R-06 | 后台任务与请求生命周期耦合（请求 session 提前关闭） | P1 | 摄取任务用 get_session_factory() 自开短 session（先例 backend/app/modules/agent/worker_redispatch.py:394-419），fire_background_task 强引用防 GC（backend/app/modules/daemon/_background_tasks.py:44-108） |

## 决策追踪

| 决策 | 覆盖点 | 状态 |
|---|---|---|
| D-001@v1（范围=本地 CLI 会话） | 设计目标 1-2、总体方案（摄取链路+本地段）、R-01 双计防护 | 已覆盖 |
| D-002@v1（方案 A 上报链路顺带解析） | 总体方案（fire-and-forget + WS RPC 复用）、接口定义 ingest_for_push、R-02/R-03/R-06、非目标（否决 B/C 的落点） | 已覆盖 |

## 自审

- [x] 章节齐全（背景/设计目标/非目标/总体方案/文件变更清单/接口定义/风险登记）
- [x] frontmatter 字段齐全（author/created_at/scale=large）
- [x] 引用所有当前版本 D-xxx@v1（决策追踪两行，均标已覆盖）
- [x] 涉及生命周期关键词（daemon/RPC/快照覆盖写）→ 生命周期契约表已填（三行事件矩阵 + 豁免说明）
- [x] UI 原型分级核对：组件级变化（用量卡桶行+注脚）→ 已生成 prototype-change-center-token-usage.html（变更目录内）
- [x] 组合裁定推演：无相互约束的多裁定组合面（D-001 范围与 D-002 触发方式正交）——显式记「无组合约束」
- [x] ⚠️ 自审存疑：R-01 会话级二选一采用「run 权威优先」策略，极端场景（同会话先本地 CLI 跑、后平台派发接管）下本地阶段的量会被整会话丢弃而非叠加——判定为口径特性（与 2026-08-30 D-002「共享会话各显示一次」同族的诚实取舍），若实测感知明显再升级为 entry 级对账
