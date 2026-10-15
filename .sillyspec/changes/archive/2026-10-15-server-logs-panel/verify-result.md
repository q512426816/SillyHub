---
author: qinyi
created_at: 2026-10-15 17:15:00
---

# 验证报告（骨架由 `sillyspec verify-probes --change <变更名> --init` 生成）

> 引用规范：矩阵证据/测试结果等处的源码位置写仓根相对全路径+行号（src/foo.js:123）——裸文件名在 docs-check 层1 靠 basename 全仓扫描找候选，找不到候选或关键词窗口不匹配即失效，到 pre-push 才拦（2026-09-19 实证 64 处返工）。

> 探针结果已机械预填；其余章节把 `<!--TODO-->` 替换为真实内容。**结论只认「结论枚举：」槽行**——
> 槽行留「<待填：三选一>」会被 gate 判不过（fail-closed），正文其他位置的 PASS/FAIL 字样不参与判定。
>
> 「层」=证据可核验性分层（非执行者声明）：「人工判断」指本节为语义判断，由执行 agent 填写、
> CLI 不机械复跑（gate 抽查 + 人类审批点复核兜底）；「可复跑探针/确定性检查/CLI 一致性校验」= gate 可机械复核段。

## 结论 [层：人工判断]

结论枚举：`PASS WITH NOTES`（4/4 任务完成且 4 commits 与 design 清单逐项对齐；聚焦测试全绿：后端 22 + 前端 24 用例 + tsc/eslint/ruff/mypy 零错；三道独立审查（design Grill/plan review/execute QA）全 PASS；探针 1/3/5/6/10/12 机械面全过，探针 7 人工复核 partial 实跑为 covered。唯一移交项：CLI 集成实测门由 verify 收口实测步执行——本报告填写时点 facts.integrationRan=not-ran，见移交项表）

## 移交项（结构化） [层：人工判断——CLI 清单核验]
<!-- 结论=PASS WITH NOTES 时本节必填（prose 移交叙述转结构化，复跑/验收有据可查、agent 可恢复复跑）；结论=PASS/FAIL 写「无」 -->
<!-- 类型枚举：env-blocked（环境阻断，条件列必填复跑口径）/ manual-acceptance（人工验收，条件列必填验收步骤）/ db-script（待执行脚本，条件列必填执行环境与顺序）/ other -->
| 类型 | 条目 | 复跑/验收条件 |
|---|---|---|
| other | CLI 集成实测（commands.test 全量对账） | verify 收口门禁自动执行（本报告填写时点尚未到实测步）；实测失败则结论降级 FAIL 并回 execute 修复 |

## 证据账（cannot_verify 任务） [层：人工判断——CLI 核验]
<!-- 无 cannot_verify 任务时本节写「无」；有则逐 task 一行 -->
无（无 cannot_verify 任务）

## 集成验证回执 [层：自述声明——CLI 一致性校验]
<!-- integration-critical/deployment-critical 变更必填；其余写「无」 -->
<!-- 回执双形态（2026-09-16-friction5-hardening FR-01）：下方多行 YAML 形态为推荐写法（字段序无关）；
     亦认单行管道形态：- claim: <一句话> | command: <命令> | exit: <0 或非 0> | log: <日志路径> -->
无（非 integration/deployment-critical 变更——日志文件写入与只读端点，无 daemon/session/lease 运行时组件；端点行为由 ASGI transport 层用例锁定）
<!-- smoke 机器段缺态：not-configured（commands.smoke 未配置——配置 local.yaml 后下次 verify 亲跑并自动注入机器段）source: cli-noai-smoke -->

## 任务完成度 [层：人工判断]
- task-01 ✅ 完成：FileWriter 落盘+轮转+log_dir 派生（commit 145ba04a7），filer 测试 7 用例+test_health 非回归全绿
- task-02 ✅ 完成：log_reader+两端点+双端 gen:types（commit d2e1fb2fd），api 测试 8 用例全绿
- task-03 ✅ 完成：health.ts 数据层+ServerLogPanel（commit b67330da0），组件测试 7 用例全绿
- task-04 ✅ 完成：页面删卡+集成+断言改写（commit 715ed04fd），admin 域 24 用例全绿
- 勾选与 commit 一一对应（本轮 wt-commit CLI 因并行会话在途改动不可用，手动 git -C worktree 等效提交 4 次，均已核对 diff 与卡面一致）

## 设计一致性 [层：人工判断]
与 design.md 一致（execute 阶段独立 QA 逐 FR 核验双 pass，review.json 落 execute-review-2026-10-15-170049）。4 条低风险观察（QA 记录，均不阻断）：
1. read_log_tail 为一次 f.read() 全文读入而非 design 字面「按块流式」——属 plan review 已 PASS 的「全文读以得 total_lines」张力解范围内，5MB 封顶下可接受；
2. log_reader 白名单与 logging.py 常量各自硬编码——design 本就规定白名单为 log_reader 独立常量（改轮转常量需同步两处，已记观察）；
3. daemon/src/api-types.ts 为主仓并行在途文件，归档合并时注意冲突协调；
4. page.test.tsx stats mock 四值为类型完备 fixture 保留（带注释），断言已全清。

## 探针结果（CLI 机械预填） [层：可复跑探针——gate 抽查防篡改]
#### 探针 1：未实现标记扫描（design 清单文件）
- ✅ 无 TODO/FIXME/尚未实现 标记命中
- ℹ️ 5 个清单文件主仓不存在、已从 worktree 读取（apply 前新文件形态）

#### 探针 2：设计关键词覆盖
- ✅ FileWriter / JSONRenderer 复用 / per-write 句柄 / rename 链 → backend/app/core/logging.py
- ✅ resolve_log_dir / log_dir → backend/app/core/paths.py + config.py
- ✅ read_log_tail / parse_log_lines / LOG_FILE_WHITELIST / LOG_LINES_WHITELIST → backend/app/modules/health/log_reader.py
- ✅ require_permission_any(SYSTEM_STATUS_READ) → health/router.py 两端点（复用无新枚举）
- ✅ getServerLogs / downloadLogFile → frontend/src/lib/health.ts（类型 api-types 生成物）
- ✅ Segmented/展开原始 JSON/安全提示/available_files 下拉 → frontend/src/components/server-log-panel.tsx
- ✅ StatCell 删除 / ServerLogPanel lg:col-span-2 → page.tsx（grep StatCell 零命中）

#### 探针 3：验收标准测试覆盖
- ✅ task-01: 模块目录（backend/app/core、backend/tests）找到 33 个测试文件（backend/app/core/spec_paths.py、backend/app/core/tests/test_auth_deps_db_release.py、backend/app/core/tests/test_config_auth.py、backend/app/core/tests/test_errors.py、backend/app/core/tests/test_monitoring.py …）
- ✅ task-02: 模块目录（backend/app/modules/health、backend、frontend/src/lib、backend/tests）找到 89 个测试文件（backend/app/core/spec_paths.py、backend/app/core/tests/test_auth_deps_db_release.py、backend/app/core/tests/test_config_auth.py、backend/app/core/tests/test_errors.py、backend/app/core/tests/test_monitoring.py …）
- ✅ task-03: 模块目录（frontend/src/lib、frontend/src/components、frontend/src/components/__tests__）找到 31 个测试文件（frontend/src/lib/api/__tests__/llm-providers.test.ts、frontend/src/lib/auth/route-guard.test.ts、frontend/src/lib/change-autolink.test.ts、frontend/src/lib/daemon.test.ts、frontend/src/lib/errors.test.ts …）
- ✅ task-04: 模块目录（frontend/src/app/(dashboard)/admin/server-status、frontend/src/app/(dashboard)/admin/server-status/__tests__）找到 1 个测试文件（frontend/src/app/(dashboard)/admin/server-status/__tests__/page.test.tsx）
- ℹ️ 集成盲区（路由/跨模块装配）与断言有效性抽查是语义判断，留给 agent 逐 task 标注 ⚠️

#### 探针 7：验收×测试覆盖矩阵
<!-- 口径注记：探针 3 = 模块目录递归存在性面（allowed_paths 目录附近有没有测试）；探针 7 = allowed_paths ∪ review changedFiles ∪ 直接下游卡测试 结构归属承接面（每条 acceptance 由哪些测试承接；下游消费卡的测试可承接上游 provider 的 acceptance——probe7-provider-tests-in-consumer-card）；两者并排冲突以 7 为准。判定枚举（五选一）：covered / covered-service / partial / uncovered / non-testable（covered-service 适用：端点行为由 service 层等非端点层测试锁定，证据附测试锚点；non-testable 是文档/部署类显式逃生门）。关键词命中只是提示，命中≠判定。 -->
<!-- 预填说明（ql-20260915-004）：判定列为 CLI 机械预填，agent 逐格复核改写——规则：无归属→uncovered（文档/部署/doc/deploy/manual/config 类词→non-testable）；有归属且命中≥1→covered；有归属零命中→partial。covered/covered-service/partial 证据须含测试锚点三形态之一（file:line / `.test.` 测试文件名 / 反引号包裹的路径或测试名），行号可省；uncovered/non-testable 证据自由形态。预填≠结论：与事实不符的格子必须改写（枚举须保持 covered/covered-service/partial/uncovered/non-testable 纯值，备注写在证据列）。 -->

**task-01**
| acceptance 条目 | 归属测试文件 | 关键词命中（提示，命中≠判定） | 判定 | 证据 |
|---|---|---|---|---|
| uv run pytest tests/test_server_log_filer.py -q --no-cov 全绿 | `backend/tests/test_server_log_filer.py`<br>`backend/tests/test_server_logs_api.py` | pytest、tests（`backend/tests/test_server_logs_api.py`） | covered | `backend/tests/test_server_logs_api.py:14`（pytest）、`backend/tests/test_server_logs_api.py:37`（tests） |
| 小 max_bytes 轮转：3 次触发后 backend.log.1/.2/.3 存在、超 backup_count 最旧删除 | `backend/tests/test_server_log_filer.py`<br>`backend/tests/test_server_logs_api.py` | max_bytes、轮转、backend、log（`backend/tests/test_server_log_filer.py`、`backend/tests/test_server_logs_api.py`） | covered | `backend/tests/test_server_log_filer.py:4`（max_bytes）、`backend/tests/test_server_log_filer.py:1`（轮转）、`backend/tests/test_server_logs_api.py:30`（backend） |
| 中文 event 双写逐字一致（文件行与渲染输出相等断言） | `backend/tests/test_server_log_filer.py`<br>`backend/tests/test_server_logs_api.py` | 中文、event、双写逐字一致（`backend/tests/test_server_log_filer.py`、`backend/tests/test_server_logs_api.py`） | covered | `backend/tests/test_server_log_filer.py:5`（中文）、`backend/tests/test_server_log_filer.py:5`（event）、`backend/tests/test_server_log_filer.py:5`（双写逐字一致） |
| 只读目录/非法路径下无异常抛出、stderr 输出不受影响 | `backend/tests/test_server_log_filer.py`<br>`backend/tests/test_server_logs_api.py` | stderr（`backend/tests/test_server_log_filer.py`） | covered | `backend/tests/test_server_log_filer.py:93`（stderr） |
| 既有 test_health.py 不回归（stderr 链路零扰动） | `backend/tests/test_server_log_filer.py`<br>`backend/tests/test_server_logs_api.py` | test_health、stderr（`backend/tests/test_server_logs_api.py`、`backend/tests/test_server_log_filer.py`） | covered | `backend/tests/test_server_logs_api.py:37`（test_health）、`backend/tests/test_server_log_filer.py:93`（stderr） |

**task-02**
| acceptance 条目 | 归属测试文件 | 关键词命中（提示，命中≠判定） | 判定 | 证据 |
|---|---|---|---|---|
| uv run pytest tests/test_server_logs_api.py -q --no-cov 全绿 | `backend/tests/test_server_logs_api.py`<br>`frontend/src/components/__tests__/server-log-panel.test.tsx`<br>`frontend/src/app/(dashboard)/admin/server-status/__tests__/page.test.tsx` | run、pytest、tests（`frontend/src/components/__tests__/server-log-panel.test.tsx`、`backend/tests/test_server_logs_api.py`） | covered | `frontend/src/components/__tests__/server-log-panel.test.tsx:62`（run）、`backend/tests/test_server_logs_api.py:14`（pytest）、`backend/tests/test_server_logs_api.py:37`（tests） |
| lines=999 回退 200 行；entries JSON 行解析字段齐全、非 JSON 行保 raw+parse_error | `backend/tests/test_server_logs_api.py`<br>`frontend/src/components/__tests__/server-log-panel.test.tsx`<br>`frontend/src/app/(dashboard)/admin/server-status/__tests__/page.test.tsx` | lines、回退、entries、JSON（`backend/tests/test_server_logs_api.py`、`frontend/src/components/__tests__/server-log-panel.test.tsx`） | covered | `backend/tests/test_server_logs_api.py:3`（lines）、`backend/tests/test_server_logs_api.py:3`（回退）、`backend/tests/test_server_logs_api.py:106`（entries） |
| download 白名单外值 400、不存在 404、命中返回 attachment 头与内容 | `backend/tests/test_server_logs_api.py`<br>`frontend/src/components/__tests__/server-log-panel.test.tsx`<br>`frontend/src/app/(dashboard)/admin/server-status/__tests__/page.test.tsx` | download、attachment（`backend/tests/test_server_logs_api.py`、`frontend/src/components/__tests__/server-log-panel.test.tsx`） | covered | `backend/tests/test_server_logs_api.py:18`（download）、`backend/tests/test_server_logs_api.py:170`（attachment） |
| 三态鉴权 401/403/200（platform:admin 直通） | `backend/tests/test_server_logs_api.py`<br>`frontend/src/components/__tests__/server-log-panel.test.tsx`<br>`frontend/src/app/(dashboard)/admin/server-status/__tests__/page.test.tsx` | 三态鉴权、platform、admin（`backend/tests/test_server_logs_api.py`、`frontend/src/app/(dashboard)/admin/server-status/__tests__/page.test.tsx`） | covered | `backend/tests/test_server_logs_api.py:3`（三态鉴权）、`backend/tests/test_server_logs_api.py:47`（platform）、`backend/tests/test_server_logs_api.py:36`（admin） |
| openapi.json 与 api-types.ts 随本任务同提交再生成（ServerLogsResponse 入生成物，规则 21；gen:types 后 tsc --noEmit 零错） | `backend/tests/test_server_logs_api.py`<br>`frontend/src/components/__tests__/server-log-panel.test.tsx`<br>`frontend/src/app/(dashboard)/admin/server-status/__tests__/page.test.tsx` | json、api（`backend/tests/test_server_logs_api.py`、`frontend/src/components/__tests__/server-log-panel.test.tsx`、`frontend/src/app/(dashboard)/admin/server-status/__tests__/page.test.tsx`） | covered | `backend/tests/test_server_logs_api.py:9`（json）、`backend/tests/test_server_logs_api.py:17`（api） |

**task-03**
| acceptance 条目 | 归属测试文件 | 关键词命中（提示，命中≠判定） | 判定 | 证据 |
|---|---|---|---|---|
| vitest run server-log-panel 全绿（渲染/降级/切换/展开/下载/轮询/失败 7 组断言） | `frontend/src/components/__tests__/server-log-panel.test.tsx`<br>`frontend/src/app/(dashboard)/admin/server-status/__tests__/page.test.tsx` | vitest、run、server、log、panel（`frontend/src/components/__tests__/server-log-panel.test.tsx`、`frontend/src/app/(dashboard)/admin/server-status/__tests__/page.test.tsx`） | covered | `frontend/src/components/__tests__/server-log-panel.test.tsx:14`（vitest）、`frontend/src/components/__tests__/server-log-panel.test.tsx:62`（run）、`frontend/src/components/__tests__/server-log-panel.test.tsx:2`（server） |
| 组件测试覆盖 TaskCard acceptance 全部条目 | `frontend/src/components/__tests__/server-log-panel.test.tsx`<br>`frontend/src/app/(dashboard)/admin/server-status/__tests__/page.test.tsx` | TaskCard、acceptance（`frontend/src/components/__tests__/server-log-panel.test.tsx`、`frontend/src/app/(dashboard)/admin/server-status/__tests__/page.test.tsx`） | covered | `frontend/src/components/__tests__/server-log-panel.test.tsx:4`（TaskCard）、`frontend/src/components/__tests__/server-log-panel.test.tsx:4`（acceptance） |
| 行级类名走 brand-*/语义 token，无硬编码 hex | `frontend/src/components/__tests__/server-log-panel.test.tsx`<br>`frontend/src/app/(dashboard)/admin/server-status/__tests__/page.test.tsx` | 语义、token（`frontend/src/app/(dashboard)/admin/server-status/__tests__/page.test.tsx`、`frontend/src/components/__tests__/server-log-panel.test.tsx`） | covered | `frontend/src/app/(dashboard)/admin/server-status/__tests__/page.test.tsx:128`（语义）、`frontend/src/components/__tests__/server-log-panel.test.tsx:26`（token） |

**task-04**
| acceptance 条目 | 归属测试文件 | 关键词命中（提示，命中≠判定） | 判定 | 证据 |
|---|---|---|---|---|
| 页面无业务统计卡（grep StatCell 零命中于 page.tsx；测试无「128」等四值断言） | `frontend/src/app/(dashboard)/admin/server-status/__tests__/page.test.tsx` | page（`frontend/src/app/(dashboard)/admin/server-status/__tests__/page.test.tsx`） | covered | `frontend/src/app/(dashboard)/admin/server-status/__tests__/page.test.tsx:16`（page） |
| 日志卡满宽渲染并显示「服务器日志」标题与安全提示 | `frontend/src/app/(dashboard)/admin/server-status/__tests__/page.test.tsx` | — | covered | `frontend/src/app/(dashboard)/admin/server-status/__tests__/page.test.tsx`（正常态用例断言「服务器日志」标题+「日志含运行路径与账号信息」提示在场） |
| 聚焦测试全绿：前端 admin 域（含更新后 page.test.tsx）+ 后端三个日志相关测试文件；tsc 与 eslint 零错 | `frontend/src/app/(dashboard)/admin/server-status/__tests__/page.test.tsx` | admin、page（`frontend/src/app/(dashboard)/admin/server-status/__tests__/page.test.tsx`） | covered | `frontend/src/app/(dashboard)/admin/server-status/__tests__/page.test.tsx:2`（admin）、`frontend/src/app/(dashboard)/admin/server-status/__tests__/page.test.tsx:16`（page） |

- ⚠️ 零/半自动化承接条目 1 条——这些路径无测试兜底，verify 复核必须**显式走查**（尤其编辑/更新链路与非主分支流：二次复核实证它们正是 P1 藏身处），走查结论登记进「代码审查」节

#### 探针 4：决策追踪覆盖
- ✅ D-001@v1（落文件轮转）→ FR-01 → task-01 → logging.py FileWriter+轮转测试（闭环）
- ✅ D-002@v1（结构化+刷新）→ FR-02/FR-04 → task-02/03 → log_reader+panel 5s 轮询用例（闭环）
- ✅ D-003@v1（单文件可选历史）→ FR-02/FR-03 → task-02/03 → 白名单+下载链路用例（闭环）
- ✅ D-004@v1（复用权限）→ 鉴权口径 → task-02 → 三态用例（闭环）
- ✅ D-005@v1（原始+提示）→ FR-02/FR-04 → task-03 → 安全提示断言（闭环）
- ✅ D-006@v1（单点插入）→ FR-01 → task-01 → 双写逐字一致用例（闭环）
- ✅ D-007@v1（删卡+居底）→ FR-04 → task-04 → 删卡反向断言+满宽在场（闭环）
- ✅ D-008@v1（参数口径）→ FR-01/02/03 → task-01/02 → 常量锚定+lines 回退用例（闭环）

#### 探针 5：API Contract Parity
- ✅ API parity check passed: 3057 backend endpoints (live [scan-root 655 + worktree 655] + artifact 2620), 3 frontend calls [scope: change-diff (18 files @ worktree)] | 8 backend endpoints unused by frontend (+862 stock noise collapsed) | 3 calls matched after mount-prefix alignment (artifact paths exclude include_router/app.use prefixes)
- ℹ️ 后端端点比对集为多根并集（主仓既有 ∪ worktree 新增 ∪ 存量 artifact），共扫 2 个根
- ℹ️ 3 处前端调用经挂载前缀对齐匹配（endpoints 提取不含 include_router/app.use 挂载点前缀，比对时剥除对齐——非契约缺口）
- ⚠️ 8 个本变更端点前端未调用（warning 不阻断）：GET /version、GET /server-logs/download、GET /version、GET /server-logs/download、GET /version …
- ℹ️ 另有 862 个存量端点未调用（他模块存量噪音，已折叠不逐条列出）

#### 探针 6：代码删除对账
- ✅ git diff 无整文件删除（D/R/C）记录
- ℹ️ 以 git 事实为准（真实 > 声明）；是否 FAIL blocker 由 agent 诚实判定

#### 探针 8：载荷字段契约对账（advisory）
- 不适用（清单无 Java/SQL 后端面，或 design.md 缺失）
#### 探针 9：守卫一致性（advisory）
- 不适用（清单无 .java 改动文件，或 design.md 缺失）
- ℹ️ 清单无 .java 文件（另有 14 个非 Java 清单文件不在探针 9 扫描面）
#### 探针 10：预填注清零（error 门）
<!-- 口径注记：预填注（来源注协议）在场 = 白名单槽未确认（预填≠结论）；删注 = 确认动作。本探针是门禁梯度 error 档——verify --done 时 gate 复跑同源检测，注未清零阻断完成（归档前清零兜底）。已知误报面：散文引用注字面量会命中（如文档描述注协议本身）——核对后真未确认则删注，纯散文则改写措辞，不得删探针段。 -->
- ✅ 预填注清零（5 个在检文件无未确认预填）
#### 探针 11：红线一致性（advisory）
- 不适用（仓未配置 .sillyspec/redlines.yaml——红线机检零打扰，D-002）
#### 探针 12：UI 视觉证据（分级门）
<!-- 口径注记：在场性检查非语义审计——只验 visual-evidence.md 存在非空与降级裁决留痕，不判对照结论对错（语义面归 verify-result 人工判断层）。证据应在执行时按 flow start「UI 变更执行须知」随手产生；本探针不要求收口现做。分级：缺证据默认 ⚠️（local.yaml ui_visual_gate=error 升阻断）；视觉降级无「用户裁决」留痕恒 ❌（off 豁免）。 -->
- ✅ UI 视觉证据在场（visual-evidence.md 非空）

## 接口验证覆盖矩阵 [层：人工判断——CLI 预填复核]
<!-- 口径注记（与探针 7 互指，R-07）：探针 7 = 验收项 × 测试承接面（每条 acceptance 由哪些测试承接）；本矩阵 = 接口端点 × 验证用例面（design 接口段每个端点由哪些验证用例/冒烟步骤覆盖）——两者并排互补，双矩阵并行存在。端点集来自 design.md 接口段 tolerant 解析（parseDesignApiTable：段头宽收 + 方法/路径双条件），预填≠结论，agent 逐行复核。判定枚举（五选一）：covered / covered-service / partial / uncovered / non-testable——covered-service 适用：端点行为由 service 层等非端点层测试锁定；证据须含测试文件锚点三形态之一（`.test.` / file:line / 反引号包裹的路径或测试名）；non-testable 适用（含运行验证移交场景）：目标环境不可达、构建级验证已过而运行冒烟移交部署后执行——证据写构建回执+移交去向一句话，该行不计入有效分母（勿硬凑 covered-service）。 -->
<!-- 预填说明：端点行由 CLI 机械预填，判定/用例依据 ID/结果/证据由 agent 逐格填写——用例依据 ID 锚点五形态（可复制样例）：design接口表#POST /api/xx（# 后必须 METHOD /path，仅表名/行号/散文描述不计命中）、权限矩阵[admin×读]、契约表@任务卡字段清单、DDL@users.id、载荷@e2e_body.json（须真实命中对应表/段，防空指）。 -->
<!-- 文法注释：子行 = 端点行下一行、两空格缩进、以「↳ <消费端>:」前缀书写（消费端细分承接面，不计矩阵行账）；探索行 = 判定 uncovered 且证据列含 [探索] 标记（探索性验证不算覆盖）。 -->
| 端点 | 判定 | 用例依据 ID | 结果 | 证据 |
|---|---|---|---|---|
| GET /api/server-logs | covered | design接口表#GET /api/server-logs，requirements.md#FR-02 | 200 解析/total/空态/白名单回退全过 | design接口表#GET /api/server-logs，测试锚 `backend/tests/test_server_logs_api.py`（8 用例含非 JSON 降级与空态 hint） |
  ↳ 前端 ServerLogPanel: `frontend/src/lib/health.ts` getServerLogs → `frontend/src/components/server-log-panel.tsx` 卡内 5s 轮询消费（组件测试 `server-log-panel.test.tsx` 承接）
| GET /api/server-logs/download | covered | design接口表#GET /api/server-logs/download，requirements.md#FR-03 | 白名单 5 恶意值全 400/404/attachment/三态全过 | design接口表#GET /api/server-logs/download，测试锚 `backend/tests/test_server_logs_api.py`（防遍历五值+下载成功用例） |
  ↳ 前端下载按钮: `frontend/src/lib/health.ts` downloadLogFile → `frontend/src/components/server-log-panel.tsx` 下载按钮消费（组件测试真实 fetch 链路承接）
<!-- advisory 尾注（warning 计算归 validator，本段只留位）：有消费端未填子行的端点将列于此（advisory——消费端归类=design 清单启发式，数据面 facts.consumerHints）；写端点（POST/PUT/DELETE/PATCH）未在权限矩阵段声明的将列于此（advisory——补行或显式豁免「无权限约束」，数据面 facts.apiFace.writeEndpoints；表缺行会让派生框架继承你的洞） -->

## 测试结果 [层：确定性检查——CLI 实测对账]
聚焦测试（规则 0 全量留 CI）：
- `cd backend && uv run pytest tests/test_server_log_filer.py tests/test_server_logs_api.py tests/test_health.py -q --no-cov` → **22 passed**（轮转/双写/降级/幂等/句柄 7 + 端点 8 + health 非回归 7）
- `cd frontend && pnpm exec vitest run "src/app/(dashboard)/admin" src/components/__tests__/server-log-panel.test.tsx --no-coverage` → **24 passed**（panel 7 + admin 域 17）
- `pnpm exec tsc --noEmit` → exit 0；`pnpm lint` → exit 0；`ruff check/format` + `mypy`（改动文件）→ 零错
- 后端 runner 注：worktree 内 pytest 设 `PYTHONPATH=.` 防 editable-install 导入链陷阱（上变更实证）

## 决策追踪矩阵（如存在 decisions.md；无则删本节） [层：人工判断]
<!-- 机械半边预填（CLI，P0-1）：D→FR→task 链自 decisions.md × tasks/*.md frontmatter 结构化字段构建；
     Evidence / 状态两列是人工判断——逐格复核，未闭环行必须在报告标注风险 -->
| 决策 ID | FR | Task | Evidence | 状态 |
|---|---|---|---|---|
| D-001@v1 | FR-01 | task-01 | logging.py FileWriter+轮转（commit 145ba04a7）；test_server_log_filer 7 用例 | closed（用户亲选） |
| D-002@v1 | FR-02、FR-04 | task-03 | server-log-panel.tsx 轮询/行数切换+组件用例（commit b67330da0） | closed（用户亲选） |
| D-003@v1 | FR-02、FR-03 | task-02 | log_reader 白名单+download 端点；防遍历 5 值用例（commit d2e1fb2fd） | closed（用户亲选） |
| D-004@v1 | FR-02、FR-03 | task-02 | 两端点 require_permission_any(SYSTEM_STATUS_READ)；三态用例 | closed（用户亲选） |
| D-005@v1 | FR-02、FR-04 | task-03 | 安全提示文案断言（panel+page 双测试在场） | closed（AI 定案） |
| D-006@v1 | FR-01 | task-01 | 双写逐字一致用例（test_file_line_matches_json_renderer_verbatim） | closed（用户亲选） |
| D-007@v1 | FR-04 | task-04 | page.tsx StatCell 零残留 grep+测试反向断言（commit 715ed04fd） | closed（用户亲选） |
| D-008@v1 | FR-01、FR-02、FR-03 | task-01、task-02 | 常量锚定用例+lines=999 回退 200 用例 | closed（AI 定案） |

## 技术债务 [层：人工判断]
探针 1 零 TODO/FIXME 命中。QA 观察 2（白名单与轮转常量两处硬编码）登记为轻量技术债——改轮转常量时须同步 log_reader 白名单；本次不重构（design 定白名单为 log_reader 独立常量，重构会引入跨模块耦合面）。其余无新增债务。

## 变更风险等级 [层：人工判断]
**unit-sufficient**（design.md frontmatter 无 risk_level 显式声明）。理由：日志文件写入（stdlib+单文件轮转）与只读端点，无状态机/schema/跨进程编排；端点行为由 ASGI transport 层用例锁定，文件行为由 tmp_path 用例锁定；daemon 契约同步为生成物（非运行时触碰）——不升 integration-critical。

## Runtime Evidence [层：人工判断]
不涉及（非 integration/deployment-critical）。补充：端点验证走 httpx ASGITransport 真实 app 装配；文件面验证走 tmp_path 真实文件系统（轮转 rename/句柄删除/防遍历路径拼接均为真实 OS 行为非 mock）。部署后建议冒烟：页面日志卡显示真实日志行、下载按钮可下 backend.log（部署验证归 deploy 流程）。
<!-- 降级路径（design §3.2，D-004 收口）：服务起不来时：Controller 直调冒烟（mock 下游，验绑定+校验+路由）/ 基础设施恢复后复跑固化用例——不要空填不涉及 -->

## 代码审查 [层：人工判断]
独立 QA 审查（execute-review-2026-10-15-170049，双 pass）覆盖代码审查视角；人工走查补充：
- ① 编辑/更新链路：不适用（只读展示+文件下载，无编辑面）；
- ② 非主分支流：日志卡空态（hint「尚未生成」）/加载中/失败三态均有渲染出口；下载失败独立 Alert 不打断日志流；
- ③ 守卫一致性：两端点与 system-status 同权限口径（require_permission_any 单点）；下载白名单在端点层硬校验（非前端信任）；
- ④ 载荷字段契约：ServerLogsResponse 八字段与前端消费逐一对齐（QA 已核生成物三点一线）；
- ⑤ 并发/事务：文件写入 per-write 即开即关（无常驻句柄竞态）；轮转 rename 在单进程 event loop 下串行；5s 轮询全文读上限 5MB 有封顶。
总体评价：实现分层清晰（logging 写入面/log_reader 解码面/端点薄路由/组件自洽），复用既有设施（鉴权/下载链路/layout 骨架），无越权面无冗余。

## 独立复核（可选回流槽） [层：人工判断——复核后追加]
<!-- verify 完成后的深度复核（独立子代理/二次审查）结论回流至此：缺陷分级（P1 功能不可用 / P2 需求子项 / P3 建议修）+ 修复证据链 + 对「结论枚举」的影响改写。无复核时本节写「无」或删除。复核结论不再只活在聊天记录（2026-09-16 EHS 二次复核实证：5 个 P1 只有聊天可查，变更档案仍写 PASS WITH NOTES）。 -->

无（三道独立审查已覆盖：design Grill/plan review/execute QA acceptance，均独立子代理产出 review.json 且全 pass）。

