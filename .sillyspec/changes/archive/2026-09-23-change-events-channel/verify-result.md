# 验证报告（骨架由 `sillyspec verify-probes --change <变更名> --init` 生成）

> 引用规范：矩阵证据/测试结果等处的源码位置写仓根相对全路径+行号（src/foo.js:123）——裸文件名在 docs-check 层1 靠 basename 全仓扫描找候选，找不到候选或关键词窗口不匹配即失效，到 pre-push 才拦（2026-09-19 实证 64 处返工）。

## 结论 [层：人工判断]

结论枚举：`PASS WITH NOTES`——全部 FR 验收通过（后端 260 模块测试/前端 5 组件测试/tsc/ruff/mypy/端到端 curl 全绿，红线双侧落实）；唯一 NOTE 是浏览器视觉级目验移交人工（组件行为已由 vitest 机器断言，见移交项）。

## 移交项（结构化） [层：人工判断——CLI 清单核验]
| 类型 | 条目 | 复跑/验收条件 |
|---|---|---|
| manual-acceptance | 变更详情页「观测事件」折叠卡浏览器目验（真实琥珀色视觉/30s 轮询刷新体感/provisional 徽标悬停 tooltip） | 部署后打开任一变更详情页：推 2 条 severity=warning 事件 → 卡片默认展开+角标 2+琥珀行；悬停 provisional 徽标见「旁路观测信号，非流程真相」；挂机 30s 见轮询刷新。行为已由 vitest 5 用例机器断言，本项为视觉级增强确认 |

## 证据账（cannot_verify 任务） [层：人工判断——CLI 核验]

无（8 任务 review 全部 pass，无 cannot_verify）。

## 集成验证回执 [层：自述声明——CLI 一致性校验]
- claim: 端到端真实集成：SQLite dev 后端（worktree HEAD 6609c7bb）起服后 curl 模拟 watcher 全链路——401 鉴权 / 推 5 条乱序（2 warning）/ GET 正序 / 重放去重 / since 增量 / 422 全部实测通过
  command: uvicorn app.main:app --port 8901 + curl POST/GET /api/changes/2026-09-23-change-events-channel/events
  exit: 0
  log: 本报告 Runtime Evidence 节（完整请求/响应实录，服务已停）

## 任务完成度 [层：人工判断]

8/8 全部完成（tasks.md checkbox 全勾，review 8/8 pass，worktree 9 commits 8e847c24..1f3373d5）：
- task-01 ORM+迁移+conftest：完成（12 列新表+对称迁移，D-008 head 修正）
- task-02 schema+service：完成（5 模型+append_events/list_events）
- task-03 router 两端点：完成（83 行纯追加）
- task-04 pytest：完成（16 用例五组含红线反例）
- task-05 gen:types：完成（openapi 366 行+api-types 245 行+listChangeEvents）
- task-06 组件+挂载：完成（ChangeEventsCard+aside 挂载）
- task-07 vitest：完成（5 用例四组）
- task-08 端到端验收：完成（curl 全序列+红线 grep 零命中）

## 设计一致性 [层：人工判断]

一致（一处已裁决偏差 + 两处实现内防御性微调，均有 decisions/注释留痕）：
1. **D-008@v1 迁移 down_revision**：design 原文 20260920220000 → 实际接 20260922194500（任务卡成稿后主仓 merge 53a5c5c9d 入链 session_fork 迁移；按原文会裂双 head break alembic upgrade）。已记 decisions.md D-008 并同步 design 文件清单行。
2. task-02 防御性微调：修剪排序末位加 id 消歧 / since naive 归一 UTC（X-07 方言防御）/ model_config 用文件既有 dict 形态——均为先例同源，不改语义。
3. verify 期补充：design 接口段补「本变更接口面：2 端点」声明表（探针 5 解析需要，正文语义不变）；task-01 卡 decision_ids 补 D-008 回指（矩阵闭环）。

## 探针结果（CLI 机械预填） [层：可复跑探针——gate 抽查防篡改]
#### 探针 1：未实现标记扫描（design 清单文件）
- ✅ 无 TODO/FIXME/尚未实现 标记命中
- ℹ️ glob 项未展开（agent 手动展开扫描）：frontend/src/app/(dashboard)/workspaces/[id]/changes/[cid]/page.tsx——人工展开复核：该文件本变更仅 import+挂载两处 diff（+9 行），无未实现标记
- ℹ️ 4 个清单文件主仓不存在、已从 worktree 读取（apply 前新文件形态）——符合预期（worktree 内新建，apply 后落主仓）

#### 探针 2：设计关键词覆盖
逐关键词 grep worktree 实现确认（全部命中）：
- `dedup_key`：model.py（列+约束）/service.py（_change_event_dedup_key+预取）✅
- `provisional`：model.py 列/schema.py（接收忽略）/service.py（恒 True）/组件（徽标）✅
- `since`：router.py（Query+fromisoformat）/service.py（严格大于）/changes.ts（参数）✅
- `5000`/`CHANGE_EVENTS_MAX_ROWS`：service.py 常量+修剪逻辑 ✅
- `shpsync_`：router.py 两端点鉴权依赖（_write_auth/_read_auth→auth.py 三路分流）✅
- `warning`：组件 severity===​"warning" 高亮+角标 ✅
- `platform_change_events`：model.py/迁移/test/conftest 四处一致 ✅

#### 探针 3：验收标准测试覆盖
（CLI 预填保留如上——目录存在性面全绿，无复核异议）

#### 探针 7：验收×测试覆盖矩阵
<!-- 口径注记：探针 3 = 模块目录递归存在性面（allowed_paths 目录附近有没有测试）；探针 7 = allowed_paths ∪ review changedFiles ∪ 直接下游卡测试 结构归属承接面（每条 acceptance 由哪些测试承接；下游消费卡的测试可承接上游 provider 的 acceptance——probe7-provider-tests-in-consumer-card）；两者并排冲突以 7 为准。判定枚举（五选一）：covered / covered-service / partial / uncovered / non-testable（covered-service 适用：端点行为由 service 层等非端点层测试锁定，证据附测试锚点；non-testable 是文档/部署类显式逃生门）。关键词命中只是提示，命中≠判定。 -->

**task-01**
| acceptance 条目 | 归属测试文件 | 关键词命中（提示，命中≠判定） | 判定 | 证据 |
|---|---|---|---|---|
| PlatformChangeEventORM 落 model.py 且 ruff/mypy 过 | `backend/app/modules/platform_sync/tests/test_change_events.py` | 表结构经 conftest create_all 建表后由 16 用例读写 | covered | `backend/app/modules/platform_sync/tests/test_change_events.py:115`（落库字段核对用例）+ ruff/mypy 实测过（本报告测试结果节） |
| alembic upgrade head 成功建表（本地 SQLite 测试库由 conftest create_all 覆盖，迁移文件结构对称可逆） | 无归属测试 | — | non-testable | 迁移可逆性由 task-01 子代理实测（stamp→upgrade→downgrade→upgrade 全链，见 execute review）；verify 阶段只读铁律不重跑 DDL |
| conftest 建表清单含新表，platform_sync 既有测试不回归 | `backend/app/modules/platform_sync/tests/`（全模块） | — | covered | `backend/app/modules/platform_sync/tests/` 260 passed（verify 时点实测，含既有 244+新增 16） |

**task-02**
| acceptance 条目 | 归属测试文件 | 关键词命中（提示，命中≠判定） | 判定 | 证据 |
|---|---|---|---|---|
| 同 dedup_key 二次推送跳过且 deduplicated 计数正确（FR-02） | `backend/app/modules/platform_sync/tests/test_change_events.py` | deduplicated | covered | `test_replay_same_batch_deduplicated`、`test_repush_with_cli_id_dedup_by_id`、`test_intra_batch_same_dedup_key_inserts_once` |
| 超 5000 条触发修剪保留最新 5000（FR-03） | 同上 | 5000 | covered | `test_cap_5000_trims_oldest`（5005 条→count=5000+最旧修剪断言） |
| since 增量不含边界行、正序稳定（FR-04） | 同上 | since | covered | `test_list_since_strictly_greater_excludes_boundary`、`test_list_returns_ts_ascending` |

**task-03**
| acceptance 条目 | 归属测试文件 | 关键词命中（提示，命中≠判定） | 判定 | 证据 |
|---|---|---|---|---|
| POST 无凭据 401 / shk_live_·JWT 403 / shpsync_ 200（鉴权矩阵 FR-01） | `backend/app/modules/platform_sync/tests/test_change_events.py` | 401/403 | covered | `test_events_push_no_auth_returns_401`、`test_events_push_apikey_auth_403`、`test_events_push_jwt_auth_403`、`test_cross_workspace_scope_isolation` + e2e curl 实测 401 |
| GET since 无效格式 422、合法增量正序（FR-04） | 同上 | 422 | covered | `test_list_invalid_since_returns_422`（execute 独立审查建议补）+ e2e curl 实测 422 |

**task-04**
| acceptance 条目 | 归属测试文件 | 关键词命中（提示，命中≠判定） | 判定 | 证据 |
|---|---|---|---|---|
| 五组用例全部通过（≥13 用例） | `backend/app/modules/platform_sync/tests/test_change_events.py` | 用例 | covered | 16 passed；锚点 backend/app/modules/platform_sync/tests/test_change_events.py:115 |

**task-05**
| acceptance 条目 | 归属测试文件 | 关键词命中（提示，命中≠判定） | 判定 | 证据 |
|---|---|---|---|---|
| api-types.ts 含 ChangeEventItem/ChangeEventPushOk 等新 schema 类型；pnpm typecheck 过 | 无归属测试（类型生成物） | — | covered | `frontend/src/lib/api-types.ts` 含 5 个 ChangeEvent* 类型（grep 实证）+ `pnpm typecheck` 零错误（本报告测试结果节） |
| gen:types 二次运行无漂移 | 无归属测试 | — | non-testable | 生成物确定性比对（task-05 子代理 sha256 逐字节一致，execute review 记录）——非测试用例可承接，实测记录在本报告测试结果节 |

**task-06**
| acceptance 条目 | 归属测试文件 | 关键词命中（提示，命中≠判定） | 判定 | 证据 |
|---|---|---|---|---|
| 折叠行为（缺省收起/有 warning 展开）+ 高亮 + 徽标 + 角标全落地（FR-05/06） | `frontend/src/components/changes/detail/__tests__/change-events-card.test.tsx` | warning/badge | covered | 5 用例：默认展开/收起+角标计数+warning testid+琥珀类名+provisional 徽标 title（`change-events-card.test.tsx`） |
| pnpm typecheck/lint 过 | 无归属测试 | — | non-testable | 静态检查非测试用例（typecheck 零错误/lint 零告警实测记录在本报告测试结果节） |

**task-07**
| acceptance 条目 | 归属测试文件 | 关键词命中（提示，命中≠判定） | 判定 | 证据 |
|---|---|---|---|---|
| 四组用例全绿 | `frontend/src/components/changes/detail/__tests__/change-events-card.test.tsx` | — | covered | 5 passed；锚点 frontend/src/components/changes/detail/__tests__/change-events-card.test.tsx |

**task-08**
| acceptance 条目 | 归属测试文件 | 关键词命中（提示，命中≠判定） | 判定 | 证据 |
|---|---|---|---|---|
| GET 正序且去重；面板高亮徽标角标正确（用户验收原文全项） | `backend/app/modules/platform_sync/tests/test_change_events.py` + `change-events-card.test.tsx` | 正序/去重 | covered | 锚点 backend/app/modules/platform_sync/tests/test_change_events.py:192（正序）+ change-events-card.test.tsx（高亮/徽标/角标）；e2e curl 实测见 Runtime Evidence；浏览器视觉目验移交 |
| 模块级 pytest/vitest/tsc/mypy 全绿（local.yaml commands 口径，仅相关面） | 全部相关面 | — | covered | 锚点 backend/app/modules/platform_sync/tests/test_change_events.py + change-events-card.test.tsx；实测 260+5+tsc/mypy/ruff 全绿记录在本报告测试结果节 |

- ⚠️ 零/半自动化承接条目复核说明：预填 15 条 uncovered 经逐格改写为 covered/non-testable——本变更是纯新增链路（无编辑/更新既有资源路径），承接面在 test_change_events.py 16 用例+组件 5 用例+e2e，见上方矩阵与代码审查节走查。

#### 探针 4：决策追踪覆盖
D-001~D-008 全闭环（Evidence/状态见下方决策追踪矩阵；D-008 已补 task-01 回指）。

#### 探针 5：API Contract Parity
- ✅ API parity check passed: 3519 backend endpoints (live [scan-root 618 + worktree 620] + artifact 3117), 0 frontend calls [scope: change-diff (13 files @ worktree)] | 48 backend endpoints unused by frontend (+1005 stock noise collapsed)
- ℹ️ 后端端点比对集为多根并集（主仓既有 ∪ worktree 新增 ∪ 存量 artifact），共扫 2 个根
- ⚠️ 48 个本变更端点前端未调用（warning 不阻断）：GET /changes、GET /changes/-/spec-manifest、POST /changes/-/spec-sync、GET /changes/-/spec-bundle、POST /quicklog-entries …
- 复核：⚠️ 列举的 48 端点是 platform_sync 模块既有 CLI 端点（spec-sync/quicklog/agent-logs 等，消费方是 sillyspec CLI 不是前端）；**本变更新增两端点中 GET /api/changes/{name}/events 已由前端 `listChangeEvents` 调用**（frontend/src/lib/changes.ts），POST 端点消费方是 CLI watcher（设计如此）——无真缺口。
- ℹ️ 另有 1005 个存量端点未调用（他模块存量噪音，已折叠不逐条列出）

#### 探针 6：代码删除对账
- ⚠️ 未声明删除（design 清单未列出） `docs/sillyspec/quick-gate-并行全流程变更脏文件误伤.md`（git 状态 D）
- 复核：非本变更删除——主仓 git status 快照显示该删除与 `?? docs/sillyspec/finished/quick-gate-同名.md` 未跟踪新增同时在场（并行会话把活跃坑文档移入 finished/ 的收尾动作），与本变更文件面（platform_sync/frontend changes/迁移）零交集。非 FAIL blocker。

#### 探针 8：载荷字段契约对账（advisory）
- 不适用（清单无 Java/SQL 后端面，或 design.md 缺失）
#### 探针 9：守卫一致性（advisory）
- 不适用（清单无 .java 改动文件，或 design.md 缺失）
- ℹ️ 清单无 .java 文件（另有 13 个非 Java 清单文件不在探针 9 扫描面）
#### 探针 10：预填注清零（error 门）
- ✅ 预填注清零（9 个在检文件无未确认预填）
#### 探针 11：红线一致性（advisory）
- 不适用（仓未配置 .sillyspec/redlines.yaml——红线机检零打扰，D-002）

## 接口验证覆盖矩阵 [层：人工判断——CLI 预填复核]
| 端点 | 判定 | 用例依据 ID | 结果 | 证据 |
|---|---|---|---|---|
| POST /api/changes/{name}/events | covered | DDL@platform_change_events.dedup_key | 16 用例中 9 个 POST 用例+e2e curl 全绿 | DDL@platform_change_events.dedup_key（design 数据模型节表列）；锚点 backend/app/modules/platform_sync/tests/test_change_events.py:115 + Runtime Evidence curl 实录 |
| GET /api/changes/{name}/events | covered | DDL@platform_change_events.ts | 7 个 GET 用例+e2e curl 全绿 | DDL@platform_change_events.ts（design 数据模型节表列）；锚点 backend/app/modules/platform_sync/tests/test_change_events.py:192 + Runtime Evidence |
↳ 前端消费端: `listChangeEvents`（frontend/src/lib/changes.ts）→ ChangeEventsCard useQuery（30s 轮询）——行为由 `change-events-card.test.tsx` 5 用例锁定
↳ CLI 消费端: sillyspec watcher.js pushEventsToPlatform（工具仓，本变更不改；其 404 静默降级语义由本端点上线自然修复）

## 测试结果 [层：确定性检查——CLI 实测对账]

verify 时点（2026-09-23，worktree HEAD 1f3373d5）：
1. `cd backend && uv run pytest app/modules/platform_sync/tests/ -q --no-cov` → **260 passed**（含本变更 test_change_events.py 16 用例；无失败无豁免）
2. `cd frontend && pnpm test -- change-events-card` → **5 passed**（渲染/告警高亮/空态/角标计数与展开收起）
3. `cd frontend && pnpm typecheck`（tsc --noEmit）→ **零错误**
4. execute 时点已过（FR-12 不重复执行，证据在 execute review）：ruff check + ruff format --check + mypy app（972 files）全过；alembic 迁移可逆性实测过
5. 端到端 curl：全绿（详见 Runtime Evidence）

## 决策追踪矩阵（如存在 decisions.md；无则删本节） [层：人工判断]
| 决策 ID | FR | Task | Evidence | 状态 |
|---|---|---|---|---|
| D-001@v1 | FR-01、FR-04 | task-03 | 端点落 platform_sync（router.py:384-460 两路由），鉴权复用 _write_auth/_read_auth + _read_args | 已闭环 |
| D-002@v1 | FR-01、FR-02、FR-03、FR-04 | task-01、task-02、task-04 | model.py uq_platform_change_events_dedup 三列约束 + service.py _change_event_dedup_key + 去重三用例 | 已闭环 |
| D-003@v1 | FR-01、FR-02、FR-03、FR-04 | task-01、task-02 | ts DateTime(timezone=True) 列 + schema ge=1e12 + service fromtimestamp 归一 + router since fromisoformat | 已闭环 |
| D-004@v1 | FR-01、FR-02、FR-03、FR-04、FR-05、FR-06、FR-07 | task-01、task-06、task-08 | provisional 恒 True（service 硬编码+测试反例）+ 组件只读零 mutation + task-08 红线 grep 零命中 | 已闭环（红线双侧落实） |
| D-005@v1 | FR-01、FR-02、FR-03、FR-04 | task-02、task-04 | CHANGE_EVENTS_MAX_ROWS=5000 + 插入后修剪 + test_cap_5000_trims_oldest | 已闭环 |
| D-006@v1 | FR-05、FR-06、FR-07 | task-06、task-07 | ChangeEventsCard useQuery 30s/aside 挂载 + vitest 5 用例 | 已闭环 |
| D-007@v1 | FR-01、FR-02、FR-03、FR-04 | task-02、task-04 | schema extra=ignore/可选字段/detail 截 2000 + 落库字段核对用例 | 已闭环 |
| D-008@v1 | FR-02、FR-03 | task-01 | 迁移 down_revision=20260922194500（AST 全链验证唯一 head）+ docstring 注明实证依据 | 已闭环（执行期裁决） |

## 技术债务 [层：人工判断]

探针 1 零命中——本变更新增代码无 TODO/FIXME/HACK。既有技术债未触碰（CONCERNS.md 无 platform_sync 相关红黄区）。

## 变更风险等级 [层：人工判断]

**integration-critical**（design 命中 backend/session 关键词——事件端点承接外部 CLI watcher 推送，跨进程集成面）。集成证据已补：Runtime Evidence 节真实 uvicorn 起服 + curl 全链路实录（满足集成级「端到端」字面证据门）。非 deployment-critical（无启动入口/部署面改动）。

## Runtime Evidence [层：人工判断]

真实启动 + 端到端实录（2026-09-23 05:26-05:30 本地，服务已停）：

1. **启动**：worktree backend（HEAD 6609c7bb）`DATABASE_URL=sqlite+aiosqlite:///C:/tmp/events-e2e.db SECRET_KEY=<test> uv run uvicorn app.main:app --port 8901` → `/api/health` 200 `{"db":"ok"}`（redis down 不影响事件链路，degraded 可用）；health 回显 commit_sha=6609c7bb22 确认 worktree 代码生效。
2. **鉴权**：无凭据 `POST /api/changes/2026-09-23-change-events-channel/events` → **401**。
3. **推送**：shpsync_ token POST 5 条（乱序 ts、2 条 severity=warning 含 rule/id）→ `{"accepted":5,"deduplicated":0}`。
4. **正序**：GET → total=5，ts 序 1758566000000→6001→6003→6005→6007（ASC: True），warning 2 条 severity 回显、provisional 全 True。
5. **去重**：同批重放 → `{"accepted":0,"deduplicated":5}`；GET 仍 total=5。
6. **增量**：GET ?since=<第 4 条 ts ISO> → 3 条（6003/6005/6007，严格大于不含边界）。
7. **422**：GET ?since=not-a-date → 422。
8. **红线**：service append_events/list_events 段与组件 grep 零 notify/approval/publish/mutation 命中（详见 task-08 review evidence）。

## 代码审查 [层：人工判断]

走查清单结论（探针 7 ⚠️ 定向面）：
- ① 编辑/更新链路：**不涉及**——append-only 表无 update 路径（dedup 跳过不覆盖有专测）；前端纯只读展示。
- ② 非主分支流：批内同键去重分支（test_intra_batch_same_dedup_key_inserts_once 覆盖）、workspace None 403 防御分支（quicklog 范式同款）、scope 双参 fail-closed 分支（list_events 两者均 None 返回空）均已走查+有实现。
- ③ 守卫一致性：写端点操作人=token 派生 workspace（与 quicklog/spec-sync 同资源同模式，无越权面）；GET 端点 _read_args 与同模块四读端点同一 scope 翻译，无漂移。
- ④ 载荷字段契约：ChangeEventItem 9 字段与 ORM 列/前端 api-types 三方一致（gen:types 生成链保证）；请求 id 与响应 id 同名异义已在两处 docstring 显式区分。
- ⑤ 分页/并发/事务原子性：上限修剪与插入同一 commit（单事务）；并发插入竞态瞬时超限无害（下次插入再修，D-005 故障面已声明）；count 含 autoflush 新行语义正确。
- 总体评价：实现与设计逐条对齐，无 P1/P2 缺陷；execute 阶段独立审查（agent_c8a96bc4）9 项 checklist 全 pass，其指出的 since 422 用例缺口已补（第 16 用例）。

## 独立复核（可选回流槽） [层：人工判断——复核后追加]

execute 阶段 Stage Review（独立子代理 agent_c8a96bc4，acceptance 型）结论回流：specVerdict=pass / qualityVerdict=pass，9 项 checklist（FR-01~07/兼容/决策落实/测试质量）全 pass，无 P1/P2 缺陷；唯一非阻塞建议（since 422 自动化用例）已修复并提交（1f3373d5）。对结论枚举无影响。
