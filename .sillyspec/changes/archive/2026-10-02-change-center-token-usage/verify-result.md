---
author: qinyi
created_at: 2026-10-03 00:40:00
---

# 验证报告（骨架由 `sillyspec verify-probes --change <变更名> --init` 生成）

> 引用规范：矩阵证据/测试结果等处的源码位置写仓根相对全路径+行号（src/foo.js:123）——裸文件名在 docs-check 层1 靠 basename 全仓扫描找候选，找不到候选或关键词窗口不匹配即失效，到 pre-push 才拦（2026-09-19 实证 64 处返工）。

> 探针结果已机械预填；其余章节把 `<!--TODO-->` 替换为真实内容。**结论只认「结论枚举：」槽行**——
> 槽行留「<待填：三选一>」会被 gate 判不过（fail-closed），正文其他位置的 PASS/FAIL 字样不参与判定。
>
> 「层」=证据可核验性分层（非执行者声明）：「人工判断」指本节为语义判断，由执行 agent 填写、
> CLI 不机械复跑（gate 抽查 + 人类审批点复核兜底）；「可复跑探针/确定性检查/CLI 一致性校验」= gate 可机械复核段。

## 结论 [层：人工判断]

结论枚举：PASS WITH NOTES——4/4 任务实现+聚焦测试全绿（backend 923 + frontend 9 + tsc 0 错 + ruff/mypy 全过）、双独立评审（execute acceptance 8 条目、plan/brainstorm 各一轮）无 P0/P1；notes 为零常驻测试的三条 P3 级注记（alembic 对称性离线验证、Semaphore 并发结构保证、gen:types 契约动作）与两条环境性说明（worktree test_list_files 基线对照排除、verify 阶段 vitest/next 二进制缺件跳过——均非代码失败）。

## 移交项（结构化） [层：人工判断——CLI 清单核验]

| 类型 | 条目 | 复跑/验收条件 |
|---|---|---|
| env-blocked | task-04 前端全量：verify 阶段 deps(auto-jsx) 前端子集与 lint（next 二进制缺件）被 CLI 跳过 | cd frontend && pnpm install 后重跑 `pnpm test`（全量）与 `pnpm lint`；本会话已手动实测组件测试 9/9 与 tsc 0 错（见测试结果节），全量留 CI |
| manual-acceptance | task-02/03/04 真机端到端：本地 CLI 跑 sillyspec 命令上报后，变更中心用量卡出现「本地 CLI」桶 | 部署后任一变更详情页打开用量卡折叠明细，确认快照五列有值时桶行出现（daemon 在线 + 已跑过至少一次上报） |
| db-script | task-01 生产/开发库执行 alembic upgrade head（migration 20261002010000） | 部署时随既有序执行；down 备查 `alembic downgrade 20260930110000`（离线 DDL 对称已实测） |

## 证据账（cannot_verify 任务） [层：人工判断——CLI 核验]

无

## 集成验证回执 [层：自述声明——CLI 一致性校验]

无（风险等级 contract-required 非 integration/deployment-critical；运行时未起真服务，见 Runtime Evidence 节降级说明）
<!-- smoke 机器段缺态：not-configured（commands.smoke 未配置——配置 local.yaml 后下次 verify 亲跑并自动注入机器段）source: cli-noai-smoke -->

## 任务完成度 [层：人工判断]

4/4 完成（tasks.md 勾选与提交证据一一对应）：task-01 存储迁移（45faf445，mypy 990 文件 0 错 + alembic 单 head + 离线 DDL 对称实测）；task-02 摄取链路（3f17dab + 36e0eba，test_usage_ingest 12 用例 + test_agent_log_push 27 用例回归全绿）；task-03 聚合本地段（c2baa792，test_usage_stats 25 用例含双计防护/守恒）；task-04 前端展示（2c7783d3，组件测试 9/9 + tsc 0 错 + 契约同步）。无未完成/存疑项。

## 设计一致性 [层：人工判断]

一致（零偏差）。实现与 design 的三 Wave 方案逐条对齐：fire-and-forget 摄取（含 Grill B-1 scope 自构造裁定）/ 快照五列（列名映射链 cacheWriteTokens→usage_cache_write_tokens 实测锚定）/ 本地段三处入口（含 Grill B-2 列表 GROUP BY 伪码落地）/「本地 CLI」桶（api_requests=0 守恒）/ 前端三分支渲染。非目标未越界：daemon 零文件改动、无成本列、无周期任务、回放页未动、零历史回填。execute 独立验收审查 8 条目（7 pass + 1 gap 已修补）印证。

## 探针结果（CLI 机械预填） [层：可复跑探针——gate 抽查防篡改]
#### 探针 1：未实现标记扫描（design 清单文件）
- ✅ 无 TODO/FIXME/尚未实现 标记命中
- ℹ️ 清单文件不存在（跳过）：frontend/src/components/changes/detail

#### 探针 2：设计关键词覆盖
- 快照五列 → AgentSessionLogORM 落地（backend/app/modules/platform_sync/model.py 五列 + 迁移 20261002010000 五 add_column）✓
- 候选筛选/节流/Semaphore → usage_ingest.py INGEST_FORMATS:44 / INGEST_THROTTLE_WINDOW_S:49 / INGEST_CONCURRENCY:51 ✓
- NOT EXISTS 会话级二选一 → usage_service._local_no_runs_condition ✓（测试 15 用例锚定）
- 「本地 CLI」桶 → _LOCAL_CLI_MODEL 双端一致（usage_service + change-usage-card LOCAL_CLI_MODEL）✓
- fire-and-forget / commit 后挂载 → router.push_agent_logs fire_usage_ingest_for_push（commit :2119 之后）✓
- 覆盖写幂等 / 全降级 → _ingest_one 覆盖五列 + AppError/Exception 双兜底 ✓

#### 探针 3：验收标准测试覆盖
- ✅ task-01: 模块目录（backend/migrations/versions、backend/app/modules/platform_sync）找到 16 个测试文件（backend/migrations/versions/202606100900_create_spec_workspaces.py、backend/migrations/versions/202606101000_create_spec_profile.py、backend/migrations/versions/202606220900_backfill_spec_workspaces.py、backend/migrations/versions/202606230900_repair_spec_root_paths.py、backend/migrations/versions/20260813160000_create_spec_file_manifest.py …）
- ✅ task-02: 模块目录（backend/app/modules/platform_sync、backend/app/modules/platform_sync/tests）找到 10 个测试文件（backend/app/modules/platform_sync/tests/test_agent_blocked_notify.py、backend/app/modules/platform_sync/tests/test_agent_liveness_states_migration.py、backend/app/modules/platform_sync/tests/test_agent_log_attribution.py、backend/app/modules/platform_sync/tests/test_agent_log_content.py、backend/app/modules/platform_sync/tests/test_agent_log_machine.py …）
- ✅ task-03: 模块目录（backend/app/modules/change、backend/app/modules/change/tests）找到 10 个测试文件（backend/app/modules/change/tests/test_approval_notify_session.py、backend/app/modules/change/tests/test_approval_result_notify.py、backend/app/modules/change/tests/test_archive_tab_tombstone_relax.py、backend/app/modules/change/tests/test_assets.py、backend/app/modules/change/tests/test_auto_dispatch_gate.py …）
- ✅ task-04: 模块目录（frontend/src/components/changes/detail、frontend/src/components/changes/detail/__tests__、frontend/src/lib、backend）找到 90 个测试文件（frontend/src/components/changes/detail/__tests__/change-agent-run-log.test.tsx、frontend/src/components/changes/detail/__tests__/change-assets-card.test.tsx、frontend/src/components/changes/detail/__tests__/change-files-card.test.tsx、frontend/src/components/changes/detail/__tests__/change-sessions-card.test.tsx、frontend/src/components/changes/detail/__tests__/change-stage-actions.test.tsx …）
- ℹ️ 集成盲区（路由/跨模块装配）与断言有效性抽查是语义判断，留给 agent 逐 task 标注 ⚠️

#### 探针 7：验收×测试覆盖矩阵
<!-- 口径注记：探针 3 = 模块目录递归存在性面（allowed_paths 目录附近有没有测试）；探针 7 = allowed_paths ∪ review changedFiles ∪ 直接下游卡测试 结构归属承接面（每条 acceptance 由哪些测试承接；下游消费卡的测试可承接上游 provider 的 acceptance——probe7-provider-tests-in-consumer-card）；两者并排冲突以 7 为准。判定枚举（五选一）：covered / covered-service / partial / uncovered / non-testable（covered-service 适用：端点行为由 service 层等非端点层测试锁定，证据附测试锚点；non-testable 是文档/部署类显式逃生门）。关键词命中只是提示，命中≠判定。 -->
<!-- 预填说明（ql-20260915-004）：判定列为 CLI 机械预填，agent 逐格复核改写——规则：无归属→uncovered（文档/部署/doc/deploy/manual/config 类词→non-testable）；有归属且命中≥1→covered；有归属零命中→partial。covered/covered-service/partial 证据须含测试锚点三形态之一（file:line / `.test.` 测试文件名 / 反引号包裹的路径或测试名），行号可省；uncovered/non-testable 证据自由形态。预填≠结论：与事实不符的格子必须改写（枚举须保持 covered/covered-service/partial/uncovered/non-testable 纯值，备注写在证据列）。 -->

**task-01**
| acceptance 条目 | 归属测试文件 | 关键词命中（提示，命中≠判定） | 判定 | 证据 |
|---|---|---|---|---|
| uv run alembic upgrade head 后五列存在且全部 nullable；downgrade -1 后五列消失 | 无归属测试——判定大概率 uncovered | — | partial | 无常驻 pytest；execute 期确定性实测：`alembic upgrade 20260930110000:20261002010000 --sql` 生成 5×ADD COLUMN（BIGINT/TIMESTAMPTZ 全 nullable）+ downgrade 对称 5×DROP COLUMN；`alembic heads` 单 head 20261002010000 无分叉 |
| ORM 列名/类型与迁移一致（mypy 通过，无模型-迁移漂移） | 无归属测试——判定大概率 uncovered | — | partial | 无常驻 pytest；execute 期实测 `uv run mypy app` 990 文件 0 错 + model.py 五列与迁移列逐列人工对账（BigInteger/DateTime(timezone=True) 一致） |

**task-02**
| acceptance 条目 | 归属测试文件 | 关键词命中（提示，命中≠判定） | 判定 | 证据 |
|---|---|---|---|---|
| 摄取成功后 platform_agent_logs 五列非空且 usage_parsed_at 刷新；重复摄取覆盖写幂等 | `backend/app/modules/platform_sync/tests/test_usage_ingest.py` | usage_parsed_at（`backend/app/modules/platform_sync/tests/test_usage_ingest.py`） | covered | `backend/app/modules/platform_sync/tests/test_usage_ingest.py:78`（usage_parsed_at） |
| 全部失败路径（离线/超时/unsupported/too_large/parse_error/null）不抛不重试仅记日志，POST /api/agent-logs 响应不受影响 | `backend/app/modules/platform_sync/tests/test_usage_ingest.py` | unsupported、too_large（`backend/app/modules/platform_sync/tests/test_usage_ingest.py`） | covered | `backend/app/modules/platform_sync/tests/test_usage_ingest.py:166`（unsupported）、`backend/app/modules/platform_sync/tests/test_usage_ingest.py:233`（too_large） |
| 并发不超 Semaphore(3)；节流命中时不发 RPC | `backend/app/modules/platform_sync/tests/test_usage_ingest.py` | RPC（`backend/app/modules/platform_sync/tests/test_usage_ingest.py`） | partial | 节流 covered：`backend/app/modules/platform_sync/tests/test_usage_ingest.py` `test_ingest_throttles_unchanged_recent_snapshot`（命中跳过 + mtime 增长不跳过双断言）；Semaphore(3) 并发上限为结构保证无并发度测试（execute review P3-1 接受，asyncio.Semaphore 语义由标准库保证） |
| 既有 backend/app/modules/platform_sync/tests/test_agent_log_push.py 全部用例不回归（Plan Review X-9：摄取 fire 点在响应后、自开 session，不碰 upsert 断言与 execute 计数——verify 显式跑该文件锚定） | `backend/app/modules/platform_sync/tests/test_usage_ingest.py` | app、modules、platform_sync（`backend/app/modules/platform_sync/tests/test_usage_ingest.py`） | covered | `backend/app/modules/platform_sync/tests/test_usage_ingest.py:31`（app）、`backend/app/modules/platform_sync/tests/test_usage_ingest.py:32`（modules）、`backend/app/modules/platform_sync/tests/test_usage_ingest.py:32`（platform_sync） |

**task-03**
| acceptance 条目 | 归属测试文件 | 关键词命中（提示，命中≠判定） | 判定 | 证据 |
|---|---|---|---|---|
| 混合场景不双计：同会话 runs 与快照并存时聚合值=run 段值（NOT EXISTS 生效） | `backend/app/modules/change/tests/test_usage_stats.py` | 同会话、runs、run（`backend/app/modules/change/tests/test_usage_stats.py`） | covered | `backend/app/modules/change/tests/test_usage_stats.py:1295`（同会话）、`backend/app/modules/change/tests/test_usage_stats.py:618`（runs）、`backend/app/modules/change/tests/test_usage_stats.py:7`（run） |
| totals = Σ by_model（含「本地 CLI」桶 api_requests=0）；本地段不改变时间三元组/轮次/请求次数 | `backend/app/modules/change/tests/test_usage_stats.py` | totals、by_model、本地、CLI、api_requests（`backend/app/modules/change/tests/test_usage_stats.py`） | covered | `backend/app/modules/change/tests/test_usage_stats.py:8`（totals）、`backend/app/modules/change/tests/test_usage_stats.py:7`（by_model）、`backend/app/modules/change/tests/test_usage_stats.py:1216`（本地） |
| 列表批量单查询（无 per-change 本地段查询）；既有聚合用例（并集去重/兜底桶/共享会话）不回归 | `backend/app/modules/change/tests/test_usage_stats.py` | per、change（`backend/app/modules/change/tests/test_usage_stats.py`） | covered | `backend/app/modules/change/tests/test_usage_stats.py:29`（per）、`backend/app/modules/change/tests/test_usage_stats.py:1`（change） |

**task-04**
| acceptance 条目 | 归属测试文件 | 关键词命中（提示，命中≠判定） | 判定 | 证据 |
|---|---|---|---|---|
| 明细表「本地 CLI」行绿阶渲染、请求列「—」、命中率照常；totals 摘要行合并值自动正确（数据侧 task-03 保证） | `frontend/src/components/changes/detail/__tests__/change-usage-card.test.tsx` | 本地、CLI、请求列（`frontend/src/components/changes/detail/__tests__/change-usage-card.test.tsx`） | covered | `frontend/src/components/changes/detail/__tests__/change-usage-card.test.tsx:39`（本地）、`frontend/src/components/changes/detail/__tests__/change-usage-card.test.tsx:184`（CLI）、`frontend/src/components/changes/detail/__tests__/change-usage-card.test.tsx:273`（请求列） |
| 纯本地变更不触发空态文案；取数失败静默降级不回归 | `frontend/src/components/changes/detail/__tests__/change-usage-card.test.tsx` | — | covered | `change-usage-card.test.tsx` 用例「纯本地变更（三元组全 None + totals 非 0）→ 不触发『尚无关联执行』空态」断言空态文案不出现 + 既有用例「取数失败/404 → 渲染『暂无用量数据』边界态，不 throw」回归通过 |
| gen:types 零 diff（或已同步提交且有原因说明） | `frontend/src/components/changes/detail/__tests__/change-usage-card.test.tsx` | — | non-testable | 契约动作非测试承接：execute 期实跑 `pnpm run gen:types`，diff 仅为 schema docstring→openapi description 透传（DTO 字段集零变化，diff 两处 description 均为本变更注释），api-types.ts + openapi.json 已随 commit 2c7783d3 同步提交 |

- ⚠️ 零/半自动化承接条目 4 条——这些路径无测试兜底，verify 复核必须**显式走查**（尤其编辑/更新链路与非主分支流：二次复核实证它们正是 P1 藏身处），走查结论登记进「代码审查」节

#### 探针 4：决策追踪覆盖
- D-001@v1（范围=本地 CLI 会话）→ FR-02/03/04 → task-03（聚合本地段 c2baa792）/task-04（前端桶行 2c7783d3）→ 证据：test_usage_stats 本地段用例 + 组件测试桶行断言——闭环 ✓
- D-002@v1（方案 A 上报链路顺带解析）→ FR-01/02/04 → task-01（快照列 45faf445）/task-02（摄取 3f17dab）/task-03（消费端）→ 证据：test_usage_ingest 12 用例 + push 回归——闭环 ✓
- 无未闭环决策行。

#### 探针 5：API Contract Parity
- ✅ API parity check passed: 2313 backend endpoints (live [scan-root 631] + artifact 1893), 0 frontend calls [scope: change-diff (43 files @ scan-root)] | 24 backend endpoints unused by frontend (+609 stock noise collapsed)
- ⚠️ 24 个本变更端点前端未调用（warning 不阻断）：GET /changes、GET /changes/-/spec-manifest、POST /changes/-/spec-sync、GET /changes/-/spec-bundle、POST /quicklog-entries …
- ℹ️ 另有 609 个存量端点未调用（他模块存量噪音，已折叠不逐条列出）

#### 探针 6：代码删除对账
- ⚠️ 未声明删除（design 清单未列出） `docs/sillyspec/fr-domain-suggest-typo-and-no-split-migration.md`（git 状态 D）
- agent 判定：**非 FAIL blocker**——该 D 与对应 `docs/sillyspec/finished/fr-domain-…md` 新增是并行会话的活跃坑移档动作（git status 快照与 execute 启动时的并行在途提示一致，baseline checkpoint ab149535 已将两文件声明为「非本变更改动」），与本变更 13 文件零交集。
- ℹ️ 以 git 事实为准（真实 > 声明）；是否 FAIL blocker 由 agent 诚实判定

#### 探针 8：载荷字段契约对账（advisory）
- 不适用（清单无 Java/SQL 后端面，或 design.md 缺失）
#### 探针 9：守卫一致性（advisory）
- 不适用（清单无 .java 改动文件，或 design.md 缺失）
- ℹ️ 清单无 .java 文件（另有 13 个非 Java 清单文件不在探针 9 扫描面）
#### 探针 10：预填注清零（error 门）
<!-- 口径注记：预填注（来源注协议）在场 = 白名单槽未确认（预填≠结论）；删注 = 确认动作。本探针是门禁梯度 error 档——verify --done 时 gate 复跑同源检测，注未清零阻断完成（归档前清零兜底）。已知误报面：散文引用注字面量会命中（如文档描述注协议本身）——核对后真未确认则删注，纯散文则改写措辞，不得删探针段。 -->
- ✅ 预填注清零（5 个在检文件无未确认预填）
#### 探针 11：红线一致性（advisory）
- 不适用（仓未配置 .sillyspec/redlines.yaml——红线机检零打扰，D-002）
#### 探针 12：UI 视觉证据（分级门）
<!-- 口径注记：在场性检查非语义审计——只验 visual-evidence.md 存在非空与降级裁决留痕，不判对照结论对错（语义面归 verify-result 人工判断层）。证据应在执行时按 flow start「UI 变更执行须知」随手产生；本探针不要求收口现做。分级：缺证据默认 ⚠️（local.yaml ui_visual_gate=error 升阻断）；视觉降级无「用户裁决」留痕恒 ❌（off 豁免）。 -->
- ⚠️ 变更目录缺 visual-evidence.md（渲染对照证据应在执行时随手落盘——收口只验在场不产新证据）

## 接口验证覆盖矩阵 [层：人工判断——CLI 预填复核]
<!-- 口径注记（与探针 7 互指，R-07）：探针 7 = 验收项 × 测试承接面（每条 acceptance 由哪些测试承接）；本矩阵 = 接口端点 × 验证用例面（design 接口段每个端点由哪些验证用例/冒烟步骤覆盖）——两者并排互补，双矩阵并行存在。端点集来自 design.md 接口段 tolerant 解析（parseDesignApiTable：段头宽收 + 方法/路径双条件），预填≠结论，agent 逐行复核。判定枚举（五选一）：covered / covered-service / partial / uncovered / non-testable——covered-service 适用：端点行为由 service 层等非端点层测试锁定；证据须含测试文件锚点三形态之一（`.test.` / file:line / 反引号包裹的路径或测试名）。 -->
<!-- 预填说明：端点行由 CLI 机械预填，判定/用例依据 ID/结果/证据由 agent 逐格填写——用例依据 ID 锚点五形态（可复制样例）：design接口表#POST /api/xx（# 后必须 METHOD /path，仅表名/行号/散文描述不计命中）、权限矩阵[admin×读]、契约表@任务卡字段清单、DDL@users.id、载荷@e2e_body.json（须真实命中对应表/段，防空指）。 -->
<!-- 文法注释：子行 = 端点行下一行、两空格缩进、以「↳ <消费端>:」前缀书写（消费端细分承接面，不计矩阵行账）；探索行 = 判定 uncovered 且证据列含 [探索] 标记（探索性验证不算覆盖）。 -->
| POST /api/agent-logs | covered-service | `backend/app/modules/platform_sync/tests/test_usage_ingest.py` + `backend/app/modules/platform_sync/tests/test_agent_log_push.py` | pass | 本变更未改端点契约（响应 DTO/鉴权/语义不变），行为扩展（fire 摄取挂载）由接线层测试锁定：`test_usage_ingest.py` `test_push_endpoint_fires_ingest_with_entries`（fire 触发+参数透传+响应 200）+ `test_agent_log_push.py` 27 用例（shpsync_ 鉴权矩阵/落库/幂等整行覆盖回归全绿）。权限沿用既有 shpsync_ 写通道（未触碰鉴权面）
  ↳ 本地 CLI（sillyspec run best-effort 上报方）：任意 2xx 即成功契约不变（`test_agent_log_push.py` 鉴权与幂等用例锁定）；新增 fire 摄取对上报方零感知（异步 best-effort）

## 测试结果 [层：确定性检查——CLI 实测对账]

- backend 聚焦：`uv run pytest app/modules/platform_sync app/modules/change -q --no-cov`（worktree，含 P3-2 修补后）= **923 passed / 2 skipped**；1 deselected = test_files_router::test_list_files（worktree 环境性失败，基线 commit ab149535 上同样失败、主仓通过——非本变更引入，已记档）。
- 摄取单测：test_usage_ingest.py **12 passed**（含 P3-2 补的意外非 AppError 用例）。
- 聚合单测：test_usage_stats.py **25 passed**（20 既有零回归 + 5 本地段新增）。
- push 回归：test_agent_log_push.py **27 passed**（Plan Review X-9 锚定项）。
- frontend 聚焦：`pnpm test -- change-usage-card` = **9 passed**（7 既有更新注脚断言后 + 2 新增）；`tsc --noEmit` = **0 错**。
- lint/静态：`ruff check` + `ruff format`（platform_sync/change 域）全过；`mypy app` 990 文件 0 错。
- CLI noAI 质量扫描（verify Step 2/3 两次亲测）：**全绿**（deps(auto-jsx) 与 lint 因 vitest/next 二进制缺件跳过——环境缺件非代码失败，前端面已由上述手动实测覆盖；known_failures 豁免 0 条使用）。
- 全量测试留 CI（CLAUDE.md 规则 0）。

## 决策追踪矩阵（如存在 decisions.md；无则删本节） [层：人工判断]
<!-- 机械半边预填（CLI，P0-1）：D→FR→task 链自 decisions.md × tasks/*.md frontmatter 结构化字段构建；
     Evidence / 状态两列是人工判断——逐格复核，未闭环行必须在报告标注风险 -->
| 决策 ID | FR | Task | Evidence | 状态 |
|---|---|---|---|---|
| D-001@v1 | FR-02、FR-03、FR-04 | task-03、task-04 | usage_service._local_change_rows_stmt/_local_quicklog_rows_stmt（c2baa792）+ test_usage_stats 本地段 5 用例；change-usage-card LOCAL_CLI_MODEL 桶渲染（2c7783d3）+ 组件测试 | closed |
| D-002@v1 | FR-01、FR-02、FR-04 | task-01、task-02、task-03 | migration 20261002010000 + ORM 五列（45faf445）；usage_ingest.ingest_for_push 全链路（3f17dab）+ test_usage_ingest 12 用例；聚合消费端（c2baa792） | closed |

## 技术债务 [层：人工判断]

探针 1 零命中（无 TODO/FIXME/HACK）。已知注记（均 P3 级、非债务欠账）：① Semaphore(3) 并发上限无并发度测试（结构保证）；② alembic up/down 对称性无常驻 pytest（离线 DDL 实测 + CI 部署序列兜底）；③ exists 过滤 `is not False`（None 放行，比 design 字面略宽——AgentLogEntry.exists 默认 True，实际不可达 None，无害防御）。

## 变更风险等级 [层：人工判断]

**contract-required**：有 DB schema 变更（alembic 迁移 + ORM 对齐）与 openapi description 变化（字段集零变化），但无新端点、无部署编排改动、无运行时协议变更（daemon 零改动）。design frontmatter 无显式 risk_level 声明；「不改 daemon 协议」为非目标声明（非否定语境抑制）。低于 integration-critical（RPC 通道为既有复用，行为由 service 层测试锁定）。

## Runtime Evidence [层：人工判断]

不涉及运行时实机验证（未起 backend/daemon 真进程）——本变更运行时行为（WS RPC 摄取）在测试中经 monkeypatch RPC 层锁定语义（test_usage_ingest 12 用例），真机链路（daemon 在线解析→快照落库→用量卡桶行）移交项 manual-acceptance 待部署后人工验收。关键 commit 链：45faf445 → 3f17dab → c2baa792 → 2c7783d3 → 36e0eba（apply 回主仓，worktree 分支已 tag 锚定 sillyspec-audit/sillyspec/2026-10-02-change-center-token-usage）。

## 代码审查 [层：人工判断]

execute 阶段独立验收子代理（acceptance review，8 条目 7 pass + 1 gap 已修补）+ 主代理 step10 汇总审查双轮覆盖，无 P0/P1 发现。走查定向面（探针 7 ⚠️ 条目）：
- ① 编辑/更新链路：不适用（本变更无编辑流；摄取为 append-only 快照覆盖写，幂等已测）。
- ② 非主分支流：降级四路（离线/超时/unsupported/too_large/null/意外异常）全测；quicklog 侧链路有专测。
- ③ 守卫一致性：摄取后台任务自构造 workspace scope（Grill B-1 裁定），与既有读端点鉴权不冲突（不消费用户凭据，workspace 精确匹配）；usage 端点鉴权未改动（既有 CHANGE_READ + resource-hiding 测试回归通过）。
- ④ 载荷字段契约：openapi diff 仅 description 两处（本变更注释透传），字段集零变化——探针 5 parity pass。
- ⑤ 分页/并发/事务原子性：摄取 commit 在批末单次（gather 后统一 commit）；列表聚合单查询 GROUP BY 无 N+1；上报主事务未被触碰（fire 点在 commit 后）。

## 独立复核（可选回流槽） [层：人工判断——复核后追加]

execute 独立验收子代理结论回流（execute-review-2026-10-03-000939/review.json，verdict 双 pass）：
- P3-1 Semaphore 并发无测试——接受（结构保证，asyncio.Semaphore 标准库语义）。
- P3-2 意外 Exception/502 降级无用例——**已修**（36e0eba 参数化补意外非 AppError 用例，12/12 绿）。
- P3-3 exists `is not False` 宽于 design 字面——接受（默认 True 不可达 None，无害）。
对结论枚举的影响：无（P3 级不改变 PASS WITH NOTES）。
