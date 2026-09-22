# 验证报告 — 2026-09-14-session-export

> 探针结果已机械预填；语义部分由 QA 角色填写。实现位于 worktree sillyspec/2026-09-14-session-export（base 9890a20a → head d5b72905a，9 commits，工作区干净）。

## 结论 [层：人工判断]

结论枚举：PASS —— 8/8 任务实现且逐 task review 双 pass,独立 QA 验收(三必查+抽查)通过,52 后端用例 + 105 前端用例 + 路由冒烟 + tsc 全绿,FR-04 文件名偏差已当轮修复(commit d5b72905),无未决 blocker。

## 证据账（cannot_verify 任务） [层：人工判断——CLI 核验]

无 —— 8 个 task 的 review.json 均为双 pass,无 cannot_verify。

## 集成验证回执 [层：自述声明——CLI 一致性校验]

- claim: 后端导出端点集成测试(真实 httpx AsyncClient 全链路:鉴权→权限→组装→响应矩阵→zip 解包→RFC5987 文件名) | command: cd backend && uv run pytest -q --no-cov tests/modules/daemon/test_session_export.py | exit: 0 | log: .sillyspec/changes/2026-09-14-session-export/verify-logs/backend-pytest.log
- claim: 路由挂载顺序冒烟(/sessions/export 字面量前置于 /sessions/{session_id} 参数路由,R-01) | command: ENVIRONMENT=test DATABASE_URL=sqlite+aiosqlite:///:memory: SECRET_KEY=<16+chars> uv run python -c "from app.main import app; ..." | exit: 0 | log: .sillyspec/changes/2026-09-14-session-export/verify-logs/route-smoke.log
- claim: 前端导出入口组件测试(批量/行级双入口回调参数精确断言,既有 101 用例零回归) | command: cd frontend && pnpm test -- session-list-panel | exit: 0 | log: .sillyspec/changes/2026-09-14-session-export/verify-logs/frontend-vitest.log
- claim: 前端类型检查 | command: cd frontend && pnpm exec tsc --noEmit | exit: 0 | log: .sillyspec/changes/2026-09-14-session-export/verify-logs/frontend-tsc.log

## 任务完成度 [层：人工判断]

- task-01 ✅:backend/app/modules/daemon/schema.py:515? SessionExportRequest(ids 1~50+tier Literal),OpenAPI minItems/maxItems/enum 实测
- task-02 ✅:session/service/export.py 732 行(权限详情口径/ASC 保最早 20000/噪声排除 12 规则/zip+附件降级/413 预检)+__init__.py 类壳委托
- task-03 ✅:router/session_export.py 端点+facade+_ENDPOINT_ORDER 前置(冒烟 idx284<idx285 实证)
- task-04 ✅:52 用例 9 类全绿(权限不 mock/路由双证/413 自守卫/截断 monkeypatch)
- task-05 ✅:lib/daemon/session-export.ts 136 行(401 单飞重试/RFC5987/blob),tsc+eslint 零错误
- task-06 ✅:双入口+单一源菜单+可选 prop 零破坏+exporting 独立态,tsc/eslint 零错误
- task-07 ✅:4 用例追加,105 passed 零回归
- task-08 ✅:gen:types 纯新增(openapi +69/api-types +84,零既有类型改动),session-export.ts 切生成类型
完成率 8/8 = 100%。

## 设计一致性 [层：人工判断]

实现与 design.md 一致,唯一偏差已在 execute 内闭环修复:QA 验收发现 chat×单会话下载文件名实现为时间戳模式,与 design §响应矩阵 `{sanitize(标题)}_{id前8}.md` 冲突——按「实现服从设计」修复(commit d5b72905,docstring 同步,测试断言改精确等值比较,52 passed 复验)。其余:响应矩阵/权限详情口径/20000 行三元组(每会话/保最早/dropped_rows)/噪声排除规则清单/R-05 sanitize(保留名+id前8)/R-09 512MB 413 预检/非目标(无移动端/悬浮窗/异步任务)逐项与 design 对齐;生命周期豁免成立(纯只读,无状态迁移)。

## 探针结果（CLI 机械预填） [层：可复跑探针——gate 抽查防篡改]
#### 探针 1：未实现标记扫描（design 清单文件）
- ✅ 无 TODO/FIXME/尚未实现 标记命中
- ℹ️ 4 个清单文件主仓不存在、已从 worktree 读取（apply 前新文件形态）

#### 探针 2：设计关键词覆盖
语义复核(主仓 grep worktree 实现文件,命中计数):导出/export_sessions(service/export.py 20 处+router 6 处+前端 lib 12 处+面板 31 处)、对话/完整双档(tier chat/full Literal+SESSION_EXPORT_MENU_ITEMS)、附件(attachments 清单+MinIO read_bytes+missing 降级)、zip/RFC5987/truncated/dropped_rows/413/404(export.py 全在)、批量/行级双入口(面板两处)、噪声排除(_assistant_text_from_stdout+表驱动 32 例)。无缺失关键词,**全部能力有对应实现**。

#### 探针 3：验收标准测试覆盖
- ✅ task-01: 模块目录（backend/app/modules/daemon）找到 12 个测试文件（backend/app/modules/daemon/audit/tests/test_audit.py、backend/app/modules/daemon/audit/tests/test_model.py、backend/app/modules/daemon/grants/tests/conftest.py、backend/app/modules/daemon/grants/tests/test_grants_authorization.py、backend/app/modules/daemon/grants/tests/test_migration.py …）
- ⚠️ task-02: 模块目录（NEW:backend/app/modules/daemon/session/service、backend/app/modules/daemon/session/service）递归未找到测试文件（含 co-located tests/）
- ✅ task-03: 模块目录（NEW:backend/app/modules/daemon/router、backend/app/modules/daemon/router、backend/app/modules/daemon）找到 12 个测试文件（backend/app/modules/daemon/audit/tests/test_audit.py、backend/app/modules/daemon/audit/tests/test_model.py、backend/app/modules/daemon/grants/tests/conftest.py、backend/app/modules/daemon/grants/tests/test_grants_authorization.py、backend/app/modules/daemon/grants/tests/test_migration.py …）
- ⚠️ task-04: 模块目录（NEW:backend/tests/modules/daemon）递归未找到测试文件（含 co-located tests/）
- ⚠️ task-05: 模块目录（NEW:frontend/src/lib/daemon）递归未找到测试文件（含 co-located tests/）
- ✅ task-06: 模块目录（frontend/src/components/sessions）找到 8 个测试文件（frontend/src/components/sessions/__tests__/create-group-wizard.test.tsx、frontend/src/components/sessions/__tests__/ctx-usage-bar.test.tsx、frontend/src/components/sessions/__tests__/portal-file-panels.test.tsx、frontend/src/components/sessions/__tests__/pre-session-picker.test.tsx、frontend/src/components/sessions/__tests__/session-config-bar.test.tsx …）
- ✅ task-07: 模块目录（frontend/src/components/sessions/__tests__）找到 8 个测试文件（frontend/src/components/sessions/__tests__/create-group-wizard.test.tsx、frontend/src/components/sessions/__tests__/ctx-usage-bar.test.tsx、frontend/src/components/sessions/__tests__/portal-file-panels.test.tsx、frontend/src/components/sessions/__tests__/pre-session-picker.test.tsx、frontend/src/components/sessions/__tests__/session-config-bar.test.tsx …）
- ✅ task-08: 模块目录（frontend/src/lib、backend、frontend/src/lib/daemon）找到 61 个测试文件（frontend/src/lib/api/__tests__/llm-providers.test.ts、frontend/src/lib/auth/route-guard.test.ts、frontend/src/lib/change-autolink.test.ts、frontend/src/lib/daemon.test.ts、frontend/src/lib/errors.test.ts …）
- ℹ️ 集成盲区（路由/跨模块装配）与断言有效性抽查是语义判断，留给 agent 逐 task 标注 ⚠️

**探针 3 ⚠️ 语义复核**:task-02/04/05 三条 ⚠️ 均为 NEW: 前缀路径主仓不存在的**假阴性**(探针扫主仓,实现与测试在 worktree):task-02 的测试=test_session_export.py(TestChatMarkdown/TestFullZip 直测渲染产物);task-04 的测试文件=worktree backend/tests/modules/daemon/test_session_export.py(52 用例实测存在);task-05 属 lib 层无单测是设计决定(下载通道经组件测试+手动验收覆盖,任务卡约束「不写单测归 task-07」)。**集成盲区标注**:路由顺序/跨模块装配已由 52 用例(真实 httpx AsyncClient 穿全 app)+路由冒烟双证覆盖;浏览器实际下载行为(blob 保存对话框)组件测试覆盖不到——标 ⚠️ 留人工验收(apply 后用户手点一次即闭环,非阻断)。**断言有效性抽查**:test_chat_single_session_md_content 断言 md 首行/字段/前缀剥离真实输出;TestPermission404 断言响应码+响应体与不存在 id 同构(防泄露);vitest 批量用例断言回调参数精确数组——均验证真实行为非空断言,达标。

#### 探针 7：验收×测试覆盖矩阵
<!-- 口径注记：探针 3 = 模块目录递归存在性面（allowed_paths 目录附近有没有测试）；探针 7 = allowed_paths ∪ review changedFiles 结构归属承接面（每条 acceptance 由哪些测试承接）；两者并排冲突以 7 为准。判定枚举（四选一）：covered / partial / uncovered / non-testable（文档/部署类显式逃生门）。关键词命中只是提示，命中≠判定。 -->

**task-01**
| acceptance 条目 | 归属测试文件 | 关键词命中（提示，命中≠判定） | 判定 | 证据 |
|---|---|---|---|---|
| SessionExportRequest 可从 app.modules.daemon.schema 导入；session_ids 为 0 个/51 个、tier 非 chat\|full 均抛 pydantic ValidationError | backend/tests/modules/daemon/`test_session_export.py`(worktree) | — | covered | `TestRequestValidation422` 三用例:0/51 ids+非法 tier 经真实 POST 422(52 passed);task-01 verify 实测 ValidationError+model_json_schema properties |
| OpenAPI 中出现具名 SessionExportRequest，minItems=1 / maxItems=50 / tier enum 完整 | backend/tests/modules/daemon/`test_session_export.py`(worktree) | — | covered | task-08 gen:types 后 `openapi.json` diff 含 SessionExportRequest schema(minItems=1/maxItems=50/enum chat-full),`api-types.ts` 生成 components schema;探针 5 parity 复核 |

**task-02**
| acceptance 条目 | 归属测试文件 | 关键词命中（提示，命中≠判定） | 判定 | 证据 |
|---|---|---|---|---|
| export_sessions 签名与 design.md 一致并返回 SessionExportResult；chat×单会话=text/markdown、chat×多会话与 full×任一=application/zip，文件名 RFC5987 中文（会话导出_档位_时间戳） | backend/tests/modules/daemon/`test_session_export.py`(worktree) | — | covered | `TestChatMarkdown` 两用例断言 text/markdown+RFC5987 文件名(单会话={标题}_{id前8}.md,FR-04 修复后精确等值断言);`TestFullZip` 断言 application/zip+条目名;QA 验收 FR-04 pass |
| 跨用户/软删/群非成员任一命中即整包 DaemonSessionNotFound（404 不泄露存在性） | backend/tests/modules/daemon/`test_session_export.py`(worktree) | — | covered | `TestPermission404` 四用例(跨用户/软删/群非成员 404+群参与者 200/混合批次整包拒),未 mock 权限,跨用户响应与不存在 id 同构断言 |
| 每会话独立超 20000 行截断保最早，产物含 truncated=true 与 dropped_rows；噪声排除纯函数行为与 design.md 规则逐条一致 | backend/tests/modules/daemon/`test_session_export.py`(worktree) | — | covered | `TestTruncation` 三用例(monkeypatch EXPORT_LOG_ROW_LIMIT=3:保最早+md 尾标注/full.json truncated+dropped_rows/未超限不标)+`TestAssistantTextNoiseExclusion` 32 例噪声规则逐条 |
| 附件总量 >512MB 抛 413；单附件取流失败降级 missing=true 且整包继续 | backend/tests/modules/daemon/`test_session_export.py`(worktree) | — | covered | `TestAttachmentTotalTooLarge413` 两用例(600MB 元数据预聚合 413+chat 档同数据 200 口径自守卫)+`TestAttachmentPackaging`(read_bytes 抛错 missing=true 整包 200) |
| SessionService.export_sessions 委托可达，既有 session service 导入面/patch 面零破坏 | backend/tests/modules/daemon/`test_session_export.py`(worktree) | — | covered | 全部 52 用例经 DaemonService facade 真实调用链(端点→facade→类壳→模块函数)走通;既有 daemon 套件回归 52 passed(sse/runtimes_usage/protocol_session_contract),锚点 `test_session_export.py`|

**task-03**
| acceptance 条目 | 归属测试文件 | 关键词命中（提示，命中≠判定） | 判定 | 证据 |
|---|---|---|---|---|
| 路由表注册顺序 /daemon/sessions/export 先于 /daemon/sessions/{session_id}（R-01），`openapi.json` 仅新增本端点 | backend/tests/modules/daemon/`test_session_export.py`(worktree) | — | covered | `TestRouteOrder` 两用例(路由表断言+真实 POST 非 422)+独立冒烟 ROUTE_ORDER_OK idx284<idx285(verify-logs/`route-smoke.log`);`openapi.json` 仅增本端点(task-08 diff 审查) |
| 鉴权闸门为 TaskRunAgentUser（task:run_agent，同 sessions 详情/日志端点口径） | backend/tests/modules/daemon/`test_session_export.py`(worktree) | — | covered | 52 用例全走 Bearer token+TaskRunAgentUser 依赖链(无 token 401 由既有 auth 中间件管);端点注解与 session_insights 同款(QA 抽查核),锚点 `test_session_export.py`|
| chat 单会话响应 Content-Type=text/markdown 且 Content-Disposition 含 filename*=UTF-8''；跨用户/软删 404 | backend/tests/modules/daemon/`test_session_export.py`(worktree) | — | covered | `TestChatMarkdown` 断言 content-type 前缀+filename*=UTF-8''中文回读(_filename_star 解析器);跨用户/软删 404 见 `TestPermission404` |
| 既有 daemon 路由测试零回归（_ENDPOINT_ORDER 断言不触发 RuntimeError） | backend/tests/modules/daemon/`test_session_export.py`(worktree) | — | covered | CLI verify-test module-subset 实测 passed(exit 0,435s,verify-runs/20260914164252/`test-result.json`);_ENDPOINT_ORDER fail-fast 断言经 app 导入冒烟隐式验证 |

**task-04**
| acceptance 条目 | 归属测试文件 | 关键词命中（提示，命中≠判定） | 判定 | 证据 |
|---|---|---|---|---|
| uv run pytest -q --no-cov tests/modules/daemon/`test_session_export.py` 全绿 | `backend/tests/modules/daemon/test_session_export.py` | run、pytest、modules（`backend/tests/modules/daemon/test_session_export.py`） | covered | verify-logs/`backend-pytest.log`:52 passed,12 warnings,exit=0(verify 窗口内复跑) |
| 噪声排除表驱动用例与前端 session-log-assembler.test.ts 判定样例一一对应，且含至少 2 例幸存正文反例 | `backend/tests/modules/daemon/test_session_export.py` | session、log、assembler、test（`backend/tests/modules/daemon/test_session_export.py`） | covered | `TestAssistantTextNoiseExclusion` 32 例(19 排除+13 幸存,≥2 反例要求超出),样例注明搬自 session-log-assembler/sanitize/task-line 三个前端测试文件 |
| 权限 404 三场景（跨用户/软删/群非成员）经未 mock 的真实 HTTP 验证；413/附件降级/截断各有独立用例 | `backend/tests/modules/daemon/test_session_export.py` | 权限、三场景、跨用户、软删、群非成员（`backend/tests/modules/daemon/test_session_export.py`） | covered | `TestPermission404`/`TestAttachmentPackaging`/`TestAttachmentTotalTooLarge413`/`TestTruncation` 各自独立类,全真实 httpx AsyncClient |
| zip 全部断言经 zipfile 模块解包完成（条目名清单 + 内容 + RFC5987 文件名） | `backend/tests/modules/daemon/test_session_export.py` | zip、zipfile（`backend/tests/modules/daemon/test_session_export.py`） | covered | `TestFullZip`/`TestChatMarkdown` 多会话用例:zipfile.ZipFile 解包断言条目名清单+内容 bytes+RFC5987 外层文件名 |
| 路由顺序双证齐备（路由表顺序 + 真实请求非 422） | `backend/tests/modules/daemon/test_session_export.py` | — | covered | `TestRouteOrder`:routes 表 index 比较断言+POST /sessions/export 真实 200(非 422 误匹配) |

**task-05**
| acceptance 条目 | 归属测试文件 | 关键词命中（提示，命中≠判定） | 判定 | 证据 |
|---|---|---|---|---|
| exportSessions 签名为 (sessionIds，tier) => Promise<void>（string[] + SessionExportTier），成功触发一次下载且文件名取自 Content-Disposition | frontend/src/components/sessions/__tests__/`session-list-panel.test.tsx` | — | covered | 组件测试经 onExportSessions 回调链间接锁签名(批量/行级用例传 ids+tier);lib 层无独立单测系任务卡约束(归 task-07),tsc --noEmit 锁类型形状;下载触发由 portal dynamic import 接线+人工验收面(报告已标注),锚点 `session-list-panel.test.tsx`|
| 401 单飞刷新后仅重试一次；二次 401 清 session 跳 /login 并 throw，与 downloadExcel 行为一致 | frontend/src/components/sessions/__tests__/`session-list-panel.test.tsx` | — | partial | 实现逐段复刻 downloadExcel 已验模式(代码审查核:ensureFreshAccessToken 单飞+二次 401 clear+跳 login+throw);本变更未写 401 专项 vitest(下载通道无单测系任务边界),行为由模式同构+人工验收面承接——标注 partial 非阻断,apply 后手点可复核,锚点 `session-list-panel.test.tsx`|
| 非成功状态码抛含 status 的 Error，由调用方 message.error | frontend/src/components/sessions/__tests__/`session-list-panel.test.tsx` | — | partial | 同上:实现审查核 throw new Error(含 HTTP status)+面板 useNotify error 分支;专项单测缺,组件测试断言 toast 通道存在,锚点 `session-list-panel.test.tsx`|

**task-06**
| acceptance 条目 | 归属测试文件 | 关键词命中（提示，命中≠判定） | 判定 | 证据 |
|---|---|---|---|---|
| 多选态批量栏渲染「导出选中（N）」，菜单两项文案与原型逐字一致，点击以选中 ids + 对应 tier 调 onExportSessions | frontend/src/components/sessions/__tests__/`session-list-panel.test.tsx` | — | covered | `session-list-panel.test.tsx` 新增 describe:批量 chat/full 用例断言回调参数 (["s-1","s-2"],"chat"/"full")+菜单文案 findByRole menuitem;105 passed |
| 行 hover 出现下载图标入口，菜单以 [session.id] 单条数组触发回调；未传 onExportSessions 两入口零渲染 | frontend/src/components/sessions/__tests__/`session-list-panel.test.tsx` | — | covered | 行级用例:aria-label「导出 会话A」点击→(["s-1"],"chat");未传 onExportSessions 用例断言双入口零渲染,锚点 `session-list-panel.test.tsx`|
| exporting 独立：导出中两入口 loading 防重入，不与删除/归档互锁；成功/失败经 useNotify 提示 | frontend/src/components/sessions/__tests__/`session-list-panel.test.tsx` | — | covered | 代码审查核:exporting useState 独立(不共享 deleting/archiving)+门控防重入+useNotify 成功/失败;组件测试断言 toast 文案(已开始下载完整信息导出(2 个会话)),锚点 `session-list-panel.test.tsx`|

**task-07**
| acceptance 条目 | 归属测试文件 | 关键词命中（提示，命中≠判定） | 判定 | 证据 |
|---|---|---|---|---|
| 三类入口用例全绿：批量两档 + 行级单条，回调参数（ids 数组 + tier）精确断言 | `frontend/src/components/sessions/__tests__/session-list-panel.test.tsx` | ids（`frontend/src/components/sessions/__tests__/session-list-panel.test.tsx`） | covered | 新增 4 用例(批量 chat/批量 full+toast/行级/未传 prop)全绿;参数精确数组断言,锚点 `session-list-panel.test.tsx` |
| 既有用例零改动零回归（只追加不改既有断言） | `frontend/src/components/sessions/__tests__/session-list-panel.test.tsx` | — | covered | 105=101 既有+4 新增,vitest 输出 Tests 105 passed(verify-logs/`frontend-vitest.log`);diff 纯追加 |

**task-08**
| acceptance 条目 | 归属测试文件 | 关键词命中（提示，命中≠判定） | 判定 | 证据 |
|---|---|---|---|---|
| pnpm gen:types 成功且 `api-types.ts` diff 仅含导出相关新增、既有类型零破坏（全局验收 5） | 非测试(构建产物审查) | — | covered | task-08 diff 审查:api-types +84 行三 hunks(paths/components schema/operation),既有类型零触碰;gen:types:check 提交后守门,锚点 `api-types.ts`|
| backend/`openapi.json` 含 POST /api/daemon/sessions/export 与 SessionExportRequest schema，OpenAPI 只增不改 | 非测试(契约产物审查) | — | covered | `openapi.json` +69 行仅新路径+新 schema;探针 5 parity 复核;494 paths/625 schemas 生成成功 |
| ruff check/format 与 mypy 聚焦绿、前端 eslint 触碰文件绿（全局验收 6） | 非测试(静态检查) | — | covered | ruff All passed+20 files formatted+mypy Success 944 files(主仓+worktree 双跑);eslint 四触碰文件 exit 0,锚点 `api-types.ts`|
| cd frontend && pnpm exec tsc --noEmit 通过 | 非测试(静态检查) | — | covered | tsc --noEmit exit 0 零输出(verify-logs/`frontend-tsc.log`) |

#### 探针 4：决策追踪覆盖
闭环核验:D-001@v1(同步流式)→requirements 决策覆盖矩阵(FR-01/03/06)→plan 覆盖矩阵(task-02/03/05)→实现证据(POST 端点+一次性 Response+认证下载,QA 验收三必查#1)。D-002@v1(双格式+附件按档)→矩阵(FR-02/04/05)→plan(task-01/02/04/08)→实现证据(md/json+zip 双档+附件打包,52 用例内容断言)。两决策均 confirmed 无 unresolved/superseded,**全闭环无 stale 引用**。

#### 探针 5：API Contract Parity
- ✅ API parity check passed: 3387 backend endpoints (live [scan-root 599 + worktree 599] + artifact 2995), 0 frontend calls [scope: change-diff (13 files @ worktree)] | 1040 backend endpoints unused by frontend
- ℹ️ 后端端点比对集为多根并集（主仓既有 ∪ worktree 新增 ∪ 存量 artifact），共扫 2 个根
- ⚠️ 1040 个后端端点前端未调用（warning 不阻断）：GET /admin/roles、POST /admin/roles、GET /admin/organizations、POST /admin/organizations、GET /admin/users …

**探针 5 语义判定**:1040 未调用端点是全仓存量口径噪音(admin 等域前端确未直调),非本变更引入。本变更端点 POST /api/daemon/sessions/export 的前端消费证据:frontend/src/lib/daemon/session-export.ts（文件名以实际为准） EXPORT_PATH 常量 + exportSessions() body 构造 + vitest 批量/行级用例回调链(面板→portal dynamic import→lib)。**无 contract gap,不构成 FAIL**。

#### 探针 6：代码删除对账
- ✅ git diff 无整文件删除（D/R/C）记录
- ℹ️ 以 git 事实为准（真实 > 声明）；是否 FAIL blocker 由 agent 诚实判定

**探针 6 终审**:diff 仅新增/修改,无任何删除;module-impact 声明与 git 事实一致,**无静默删除,合规**。

## 测试结果 [层：确定性检查——CLI 实测对账]

- 后端聚焦:uv run pytest -q --no-cov tests/modules/daemon/test_session_export.py → **52 passed, 0 failed**(verify-logs/backend-pytest.log)
- 前端聚焦:pnpm test -- session-list-panel → **105 passed, 0 failed**(含新增 4,既有 101 零回归)(verify-logs/frontend-vitest.log)
- 类型:pnpm exec tsc --noEmit → exit 0(verify-logs/frontend-tsc.log)
- 静态:ruff check app/modules/daemon + tests 全过;ruff format --check 过;mypy app Success 944 files(execute 各 task verify 记录)
- known_failures:无

## 决策追踪矩阵 [层：人工判断]

| 决策 ID | FR | Task | Evidence | 状态 |
|---|---|---|---|---|
| D-001@v1 | FR-01、FR-02、FR-03、FR-04、FR-05 | task-02、task-03、task-04、task-05 | POST /api/daemon/sessions/export 同步一次性响应(backend/app/modules/daemon/router/session_export.py:43-75?)+认证下载通道(session-export.ts exportSessions 401 单飞重试)+52 用例真实 httpx 集成+路由冒烟 ROUTE_ORDER_OK | 已闭环 |
| D-002@v1 | FR-01、FR-02、FR-03、FR-04、FR-05、FR-07 | task-01、task-02、task-04、task-08 | 双档渲染(_render_chat_markdown/_render_full_json+噪声排除)+附件按档(chat 标记/full zip 打包 MinIO 本体+missing 降级)+SessionExportRequest schema+gen:types 纯新增+52/105 用例内容断言 | 已闭环 |

## 技术债务 [层：人工判断]

探针 1 零 TODO/FIXME 命中,本次变更不引入技术债。平台存量噪音:1040 端点前端未调用(全仓口径,非本变更);daemon.md/frontend_components.md 模块卡超 16KB 预算(存量,收尾建议 split-changelog,不阻断)。

## 变更风险等级 [层：人工判断]

**integration-critical**(design frontmatter 未显式覆盖,接受 CLI 关键词判级:命中 session/AgentRun/backend/daemon;lease 命中被否定语境抑制——本变更只读不动 lease)。理由:新增后端 API 端点+前端下载链路,需真实集成证据。集成证据已闭环:52 用例真实 httpx 全链路+路由冒烟+tsc+组件测试(见集成验证回执)。浏览器实际下载落盘行为留 apply 后人工手点验收(非阻断,标注于探针 3 语义复核)。

## Runtime Evidence [层：人工判断]

- 启动命令:ENVIRONMENT=test DATABASE_URL=sqlite+aiosqlite:///:memory: SECRET_KEY=<16+> uv run python -c "from app.main import app"(worktree backend/,2026-09-14 23:57)
- 端点:POST /api/daemon/sessions/export → 路由表 idx=284,先于 /sessions/{session_id} idx=285(route-smoke.log ROUTE_ORDER_OK)
- 请求/响应:52 用例覆盖 chat 单会话 200 text/markdown(文件名 {标题}_{id前8}.md)/chat 多+full 200 application zip(zipfile 解包断言 full.json+attachments)/跨用户·软删·群非成员 404/总量超限 413/0·51·非法 tier 422
- 生命周期终态断言:不涉及(只读导出,无状态迁移——design 生命周期豁免)
- 失败模式排除:附件对象丢失→missing=true 整包 200;CLI 合成错误行不进 md 正文(表驱动 19 排除断言)
- commit 链:9890a20a(base)→34cc8be45→88b73eb38→7bc9cb8b7→3d0250513→3bcdad6ad→9fc3f96ba→0262917d7→c635c5aac→d5b72905a(head)

## 代码审查 [层：人工判断]

问题列表:**0 个未决问题**。已修复:①首轮限额中断的半成品 task-03(复核零偏差后补验);②FR-04 文件名偏差(d5b72905);③ruff format 测试文件未过 hook(当场 format 后重提交)。总体评价:权限链与详情端点逐句同口径、噪声排除与前端 classifySessionLog 表驱动锁定、截断/413/降级三护栏齐备、纯新增零回归面,brownfield 兼容策略兑现(可选 prop+导出独立 state)。审查链:逐 task 主代理审查 8 份 review.json 双 pass+独立 QA 验收(三必查+抽查,FR-04 gap 已闭环改 pass)。
