# 验证报告（骨架由 `sillyspec verify-probes --change <变更名> --init` 生成）

> 引用规范：矩阵证据/测试结果等处的源码位置写仓根相对全路径+行号（src/foo.js:123）——裸文件名在 docs-check 层1 靠 basename 全仓扫描找候选，找不到候选或关键词窗口不匹配即失效，到 pre-push 才拦（2026-09-19 实证 64 处返工）。

> 探针结果已机械预填；其余章节把 `<!--TODO-->` 替换为真实内容。**结论只认「结论枚举：」槽行**——
> 槽行留「<待填：三选一>」会被 gate 判不过（fail-closed），正文其他位置的 PASS/FAIL 字样不参与判定。
>
> 「层」=证据可核验性分层（非执行者声明）：「人工判断」指本节为语义判断，由执行 agent 填写、
> CLI 不机械复跑（gate 抽查 + 人类审批点复核兜底）；「可复跑探针/确定性检查/CLI 一致性校验」= gate 可机械复核段。

## 结论 [层：人工判断]

结论枚举：`PASS WITH NOTES`——5/5 任务交付、三端测试绿（backend 193 / frontend 20+tsc0 / CLI 埋点 3/3）；两条注记：①sillyspec 仓全量 13 红系嵌套 worktree 路径触发 CLI worktree-cwd 守卫的环境性红（主仓路径同套件 390/0 绿实证，非代码回归）；②注入榜路径为 modules/<x>.md 形态缺项目段（数值口径正确，P3 显示偏差移交）

## 移交项（结构化） [层：人工判断——CLI 清单核验]
<!-- 结论=PASS WITH NOTES 时本节必填（prose 移交叙述转结构化，复跑/验收有据可查、agent 可恢复复跑）；结论=PASS/FAIL 写「无」 -->
<!-- 类型枚举：env-blocked（环境阻断，条件列必填复跑口径）/ manual-acceptance（人工验收，条件列必填验收步骤）/ db-script（待执行脚本，条件列必填执行环境与顺序）/ other -->
| 类型 | 条目 | 复跑/验收条件 |
|---|---|---|
| env-blocked | sillyspec 仓全量测试在嵌套 worktree 路径有 13 个 CLI-cwd 用例红 | 02e40da5 合回 sillyspec 主仓后，在 C:/Users/qinyi/IdeaProjects/sillyspec 跑 `node test/run-tests.mjs` 复跑（预期全绿；主仓路径同套件已实证 390/0） |
| other | 注入频次榜路径显示缺项目段（modules/<x>.md vs <项目>/modules/x.md） | 后续迭代对齐：_injection_stats 聚合键带项目段或前端按 docs 列表反查补全（P3，数值口径已正确） |

## 证据账（cannot_verify 任务） [层：人工判断——CLI 核验]
<!-- 无 cannot_verify 任务时本节写「无」；有则逐 task 一行 -->
无（5 task review 均 pass，无 cannot_verify）

## 集成验证回执 [层：自述声明——CLI 一致性校验]
<!-- integration-critical/deployment-critical 变更必填；其余写「无」 -->
<!-- 回执双形态（2026-09-16-friction5-hardening FR-01）：下方多行 YAML 形态为推荐写法（字段序无关）；
     亦认单行管道形态：- claim: <一句话> | command: <命令> | exit: <0 或非 0> | log: <日志路径> -->
无（变更风险=contract-required，非 integration/deployment-critical；端点级证据见 Runtime Evidence）

## 任务完成度 [层：人工判断]
- task-01 backend stats 底座：完成——DTO 9 类/聚合/端点/10 用例全过（review pass）
- task-02 类型链同步：完成——gen 一次过、9 类 schema、lib 三导出、tsc/eslint 0（review pass）
- task-03 前端面板：完成——组件+挂载+14 用例（review pass）
- task-04 CLI 埋点：完成——commit 02e40da5、3 用例+lint 过（review pass）
- task-05 文档+回归：完成——3 份模块卡+三端回归+原型对照（review pass）
完成率 5/5=100%

## 设计一致性 [层：人工判断]
一致（主体）：接口定义/口径/文件清单/非目标全对齐；两处已记录偏差——①stats 实际路径带 /api 前缀（design 表述少写，与前端调用口径一致，非行为偏差）；②根级文件归「(根)伪项目」只进全局口径不虚摊项目分母（design 未明说，良性细化，验收审查已注记）。

## 探针结果（CLI 机械预填） [层：可复跑探针——gate 抽查防篡改]
#### 探针 1：未实现标记扫描（design 清单文件）
- ✅ 无 TODO/FIXME/尚未实现 标记命中
- ℹ️ glob 项未展开（agent 手动展开扫描）：frontend/src/app/(dashboard)/workspaces/[id]/scan-docs/page.tsx、frontend/src/app/(dashboard)/workspaces/[id]/__tests__/scan-docs-page.test.tsx
- ℹ️ 4 个清单文件主仓不存在、已从 worktree 读取（apply 前新文件形态）

#### 探针 2：设计关键词覆盖
design 关键词逐个 grep（worktree 源码）：`stats(`→service.py:188 命中；`ScanDocsStatsOut`→schema.py/router.py 命中；`STANDARD_DOC_TYPES`→service.py:29 import 复用；`docs-inject`→service.py `_injection_stats` + sillyspec prompt.js 埋点；`scan-docs/stats`→router.py:63（{doc_id}:78 之前）；剥前缀双端同口径（前端 stripPathPrefix / service `_strip_docs_prefix`）；useQuery→面板组件。全部命中，无缺实现。

#### 探针 3：验收标准测试覆盖
- ✅ task-01: 模块目录（backend/app/modules/scan_docs、NEW:backend/app/modules/scan_docs/tests）找到 4 个测试文件（backend/app/modules/scan_docs/tests/test_parser.py、backend/app/modules/scan_docs/tests/test_router.py、backend/app/modules/scan_docs/tests/test_service.py、backend/app/modules/scan_docs/tests/test_stats.py）
- ✅ task-02: 模块目录（backend、frontend/src/lib）找到 80 个测试文件（backend/app/core/spec_paths.py、backend/app/core/tests/test_auth_deps_db_release.py、backend/app/core/tests/test_config_auth.py、backend/app/core/tests/test_errors.py、backend/app/core/tests/test_monitoring.py …）
- ✅ task-03: 模块目录（NEW:frontend/src/components、NEW:frontend/src/components/__tests__、frontend/src/app/(dashboard)/workspaces/[id]/scan-docs、frontend/src/app/(dashboard)/workspaces/[id]/__tests__）找到 4 个测试文件（frontend/src/app/(dashboard)/workspaces/[id]/__tests__/explorer-page.test.tsx、frontend/src/app/(dashboard)/workspaces/[id]/__tests__/knowledge-page.test.tsx、frontend/src/app/(dashboard)/workspaces/[id]/__tests__/page-sync.test.tsx、frontend/src/app/(dashboard)/workspaces/[id]/__tests__/scan-docs-page.test.tsx）
- ⚠️ task-04: 模块目录（src/run、src/stages、NEW:test）递归未找到测试文件（含 co-located tests/）
- ✅ task-05: 模块目录（.sillyspec/docs/backend/modules、.sillyspec/docs/frontend/modules、NEW:.sillyspec/docs/frontend/modules）找到 4 个测试文件（.sillyspec/docs/backend/modules/spec_profile.md、.sillyspec/docs/backend/modules/spec_workspace.md、.sillyspec/docs/frontend/modules/lib-spec-workspaces.md、.sillyspec/docs/frontend/modules/test-utils.md）
- ℹ️ 集成盲区（路由/跨模块装配）与断言有效性抽查是语义判断，留给 agent 逐 task 标注 ⚠️

#### 探针 7：验收×测试覆盖矩阵
<!-- 口径注记：探针 3 = 模块目录递归存在性面（allowed_paths 目录附近有没有测试）；探针 7 = allowed_paths ∪ review changedFiles ∪ 直接下游卡测试 结构归属承接面（每条 acceptance 由哪些测试承接；下游消费卡的测试可承接上游 provider 的 acceptance——probe7-provider-tests-in-consumer-card）；两者并排冲突以 7 为准。判定枚举（五选一）：covered / covered-service / partial / uncovered / non-testable（covered-service 适用：端点行为由 service 层等非端点层测试锁定，证据附测试锚点；non-testable 是文档/部署类显式逃生门）。关键词命中只是提示，命中≠判定。 -->
<!-- 预填说明（ql-20260915-004）：判定列为 CLI 机械预填，agent 逐格复核改写——规则：无归属→uncovered（文档/部署/doc/deploy/manual/config 类词→non-testable）；有归属且命中≥1→covered；有归属零命中→partial。covered/covered-service/partial 证据须含测试锚点三形态之一（file:line / `.test.` 测试文件名 / 反引号包裹的路径或测试名），行号可省；uncovered/non-testable 证据自由形态。预填≠结论：与事实不符的格子必须改写（枚举须保持 covered/covered-service/partial/uncovered/non-testable 纯值，备注写在证据列）。 -->

**task-01**
| acceptance 条目 | 归属测试文件 | 关键词命中（提示，命中≠判定） | 判定 | 证据 |
|---|---|---|---|---|
| GET /scan-docs/stats 返回 200 且响应含 coverage 两级计数（std_have/std_expected/module_have/module_expected）、stale_docs、density.per_project_avg、freshness、recent_board、injection | `backend/app/modules/scan_docs/tests/test_stats.py` | GET、scan、docs、stats（`backend/app/modules/scan_docs/tests/test_stats.py`） | covered | `backend/app/modules/scan_docs/tests/test_stats.py:384`（GET）、`backend/app/modules/scan_docs/tests/test_stats.py:3`（scan）、`backend/app/modules/scan_docs/tests/test_stats.py:3`（docs） |
| 覆盖率可复算：fixture A 七件套 7/7、B 5/7；模块层 A 3/3、B 2/2（无 map 退化）；综合分子分母正确 | `backend/app/modules/scan_docs/tests/test_stats.py` | fixture、七件套、模块层、map（`backend/app/modules/scan_docs/tests/test_stats.py`） | covered | `backend/app/modules/scan_docs/tests/test_stats.py:5`（fixture）、`backend/app/modules/scan_docs/tests/test_stats.py:28`（七件套）、`backend/app/modules/scan_docs/tests/test_stats.py:182`（模块层） |
| 陈旧=91 天前 mtime 的文档计入、10 天前不计；last_modified_at 为空计入且清单可含 | `backend/app/modules/scan_docs/tests/test_stats.py` | 陈旧、天前、mtime（`backend/app/modules/scan_docs/tests/test_stats.py`） | covered | `backend/app/modules/scan_docs/tests/test_stats.py:1`（陈旧）、`backend/app/modules/scan_docs/tests/test_stats.py:130`（天前）、`backend/app/modules/scan_docs/tests/test_stats.py:5`（mtime） |
| 插入 docs-inject 行后 injection.total_30d/docs_hit_30d/board 正确，且知识库 stats（backend/app/modules/knowledge/hits.py stats）各指标不变 | `backend/app/modules/scan_docs/tests/test_stats.py` | 插入、docs、inject、行后、injection（`backend/app/modules/scan_docs/tests/test_stats.py`） | covered | `backend/app/modules/scan_docs/tests/test_stats.py:342`（插入）、`backend/app/modules/scan_docs/tests/test_stats.py:3`（docs）、`backend/app/modules/scan_docs/tests/test_stats.py:300`（inject） |
| stats 端点请求不被 /scan-docs/{doc_id} 通配吞掉（路由序生效） | `backend/app/modules/scan_docs/tests/test_stats.py` | stats、scan、docs、doc_id（`backend/app/modules/scan_docs/tests/test_stats.py`） | covered | `backend/app/modules/scan_docs/tests/test_stats.py:1`（stats）、`backend/app/modules/scan_docs/tests/test_stats.py:3`（scan）、`backend/app/modules/scan_docs/tests/test_stats.py:3`（docs） |

**task-02**
| acceptance 条目 | 归属测试文件 | 关键词命中（提示，命中≠判定） | 判定 | 证据 |
|---|---|---|---|---|
| frontend/src/lib/api-types.ts 含 ScanDocsStatsOut 族全部 9 类（含 injection 嵌套） | 无归属测试——判定大概率 uncovered | — | non-testable | （无归属测试） |
| backend/openapi.json 含 /workspaces/{workspace_id}/scan-docs/stats 路径定义 | 无归属测试——判定大概率 uncovered | — | non-testable | （无归属测试） |
| frontend/src/lib/scan-docs.ts 的 getScanDocsStats/scanDocsStatsQueryKey 可被 tsc 解析（无手写类型） | 无归属测试——判定大概率 uncovered | — | non-testable | （无归属测试） |

**task-03**
| acceptance 条目 | 归属测试文件 | 关键词命中（提示，命中≠判定） | 判定 | 证据 |
|---|---|---|---|---|
| 面板四子卡数值与 stats 响应一致；覆盖率综合百分比=(std_have+module_have)/(std_expected+module_expected) 取整 | `frontend/src/components/__tests__/scan-docs-stats-panel.test.tsx`<br>`frontend/src/app/(dashboard)/workspaces/[id]/__tests__/scan-docs-page.test.tsx` | stats、std_have（`frontend/src/components/__tests__/scan-docs-stats-panel.test.tsx`、`frontend/src/app/(dashboard)/workspaces/[id]/__tests__/scan-docs-page.test.tsx`） | covered | `frontend/src/components/__tests__/scan-docs-stats-panel.test.tsx:6`（stats）、`frontend/src/components/__tests__/scan-docs-stats-panel.test.tsx:54`（std_have） |
| 陈旧卡点击开合内嵌清单，清单行为空数据显示「未知」 | `frontend/src/components/__tests__/scan-docs-stats-panel.test.tsx`<br>`frontend/src/app/(dashboard)/workspaces/[id]/__tests__/scan-docs-page.test.tsx` | 未知（`frontend/src/components/__tests__/scan-docs-stats-panel.test.tsx`） | covered | `frontend/src/components/__tests__/scan-docs-stats-panel.test.tsx:76`（未知） |
| 双榜 tab 可切换；注入榜数据全零（total_30d=0）时空态文案出现且不报错 | `frontend/src/components/__tests__/scan-docs-stats-panel.test.tsx`<br>`frontend/src/app/(dashboard)/workspaces/[id]/__tests__/scan-docs-page.test.tsx` | 双榜、tab、total_30d（`frontend/src/components/__tests__/scan-docs-stats-panel.test.tsx`、`frontend/src/app/(dashboard)/workspaces/[id]/__tests__/scan-docs-page.test.tsx`） | covered | `frontend/src/components/__tests__/scan-docs-stats-panel.test.tsx:7`（双榜）、`frontend/src/components/__tests__/scan-docs-stats-panel.test.tsx:7`（tab）、`frontend/src/components/__tests__/scan-docs-stats-panel.test.tsx:99`（total_30d） |
| isPending/isError/无文档三态占位同版位不白屏；面板加载失败不影响页面主列表 | `frontend/src/components/__tests__/scan-docs-stats-panel.test.tsx`<br>`frontend/src/app/(dashboard)/workspaces/[id]/__tests__/scan-docs-page.test.tsx` | — | covered | `scan-docs-stats-panel.test.tsx` 三态用例（isPending 占位/isError 红条/total=0 空态）+ 页面测试 renderPage 基建实证面板 mock 下主列表不受影响 |
| page.tsx 挂载位置在 PageHeader 之下（jsdom 冒烟断言 panel testid 存在） | `frontend/src/components/__tests__/scan-docs-stats-panel.test.tsx`<br>`frontend/src/app/(dashboard)/workspaces/[id]/__tests__/scan-docs-page.test.tsx` | page、tsx（`frontend/src/components/__tests__/scan-docs-stats-panel.test.tsx`、`frontend/src/app/(dashboard)/workspaces/[id]/__tests__/scan-docs-page.test.tsx`） | covered | `frontend/src/components/__tests__/scan-docs-stats-panel.test.tsx:11`（page）、`frontend/src/components/__tests__/scan-docs-stats-panel.test.tsx:6`（tsx） |

**task-04**
| acceptance 条目 | 归属测试文件 | 关键词命中（提示，命中≠判定） | 判定 | 证据 |
|---|---|---|---|---|
| 模块上下文注入命中后 .runtime/knowledge-hits.jsonl 末尾出现一行 type=docs-inject，matchedFiles 为注入的模块文档路径 | `test/docs-inject-telemetry.test.mjs` | — | covered | `test/docs-inject-telemetry.test.mjs`（sillyspec worktree commit 02e40da5）：命中落行断言四字段+2 matchedFiles，node --test 3/3 |
| 未命中/开关关闭时不产生行 | `test/docs-inject-telemetry.test.mjs` | — | covered | `test/docs-inject-telemetry.test.mjs` 未命中零行用例（matched.length===0 早退守卫） |
| 遥测写失败时注入段照常返回（fail-soft 实证） | `test/docs-inject-telemetry.test.mjs` | — | covered | `test/docs-inject-telemetry.test.mjs` 坏路径用例（注入段照常返回） |
| 既有 knowledge inject/classify 行为与格式零变化 | `test/docs-inject-telemetry.test.mjs` | — | covered | `test/docs-inject-telemetry.test.mjs` + 既有 `test/knowledge-inject.test.mjs`（全量 549 过含知识面，knowledge-hits.js 底座零改动） |

**task-05**
| acceptance 条目 | 归属测试文件 | 关键词命中（提示，命中≠判定） | 判定 | 证据 |
|---|---|---|---|---|
| 三份模块文档与实现一致（端点/口径/组件行为无漂移） | 无归属测试——判定大概率 uncovered | — | non-testable | （无归属测试） |
| backend scan_docs + knowledge 测试全绿；frontend scan-docs 页面 + 面板组件测试全绿；sillyspec 仓测试全绿 | 无归属测试——判定大概率 uncovered | — | non-testable | （无归属测试） |
| 既有 scan-docs 页面功能（树/搜索/卡片视图/后台同步）零回归 | 无归属测试——判定大概率 uncovered | — | non-testable | （无归属测试） |
| 原型要点（四子卡布局/陈旧清单开合/榜单形态）在实现中逐项可对上 | 无归属测试 | — | non-testable | 人工对照走查（task-05 报告：一致项逐字核对+5 项有据偏离），非自动化可承接面 |

- ⚠️ 零/半自动化承接条目 6 条——这些路径无测试兜底，verify 复核必须**显式走查**（尤其编辑/更新链路与非主分支流：二次复核实证它们正是 P1 藏身处），走查结论登记进「代码审查」节

#### 探针 4：决策追踪覆盖
D-001@v1（健康度四指标+模块层基准）→ FR-02/FR-03 → task-01/task-03 → 证据：test_stats.py 覆盖率复算用例+面板渲染用例，闭环；D-002@v1（后端聚合端点）→ FR-01/FR-05 → task-01/task-02 → 证据：router 端点+httpx 200+gen 产物，闭环；D-003@v1（docs-inject 遥测）→ FR-06/FR-07 → task-01/task-03/task-04 → 证据：02e40da5+test_stats 注入用例（含知识 stats 不变断言）+面板双榜 tab 用例，闭环。无未闭环项。

#### 探针 5：API Contract Parity
- ✅ API parity check passed: 2259 backend endpoints (live [scan-root 616 + worktree 617] + artifact 1851), 0 frontend calls [scope: change-diff (14 files @ worktree)] | 0 backend endpoints unused by frontend (+627 stock noise collapsed)
- ℹ️ parity 扫描面只含主仓——另有 1 张跨仓 task 卡的仓不在扫描根内，跨仓前端调用/端点请到对应仓核对（D-004 跨仓对账不在本变更范围）
- ℹ️ 后端端点比对集为多根并集（主仓既有 ∪ worktree 新增 ∪ 存量 artifact），共扫 2 个根
- ⚠️ 0 个本变更端点前端未调用（warning 不阻断）：
- ℹ️ 另有 627 个存量端点未调用（他模块存量噪音，已折叠不逐条列出）

#### 探针 6：代码删除对账
- ✅ git diff 无整文件删除（D/R/C）记录
- ℹ️ 以 git 事实为准（真实 > 声明）；是否 FAIL blocker 由 agent 诚实判定

#### 探针 8：载荷字段契约对账（advisory）
- 不适用（清单无 Java/SQL 后端面，或 design.md 缺失）
#### 探针 9：守卫一致性（advisory）
- 不适用（清单无 .java 改动文件，或 design.md 缺失）
- ℹ️ 清单无 .java 文件（另有 12 个非 Java 清单文件不在探针 9 扫描面）
#### 探针 10：预填注清零（error 门）
<!-- 口径注记：预填注（来源注协议）在场 = 白名单槽未确认（预填≠结论）；删注 = 确认动作。本探针是门禁梯度 error 档——verify --done 时 gate 复跑同源检测，注未清零阻断完成（归档前清零兜底）。已知误报面：散文引用注字面量会命中（如文档描述注协议本身）——核对后真未确认则删注，纯散文则改写措辞，不得删探针段。 -->
- ✅ 预填注清零（6 个在检文件无未确认预填）
#### 探针 11：红线一致性（advisory）
- 不适用（仓未配置 .sillyspec/redlines.yaml——红线机检零打扰，D-002）

## 接口验证覆盖矩阵 [层：人工判断——CLI 预填复核]
<!-- 口径注记（与探针 7 互指，R-07）：探针 7 = 验收项 × 测试承接面（每条 acceptance 由哪些测试承接）；本矩阵 = 接口端点 × 验证用例面（design 接口段每个端点由哪些验证用例/冒烟步骤覆盖）——两者并排互补，双矩阵并行存在。端点集来自 design.md 接口段 tolerant 解析（parseDesignApiTable：段头宽收 + 方法/路径双条件），预填≠结论，agent 逐行复核。判定枚举（五选一）：covered / covered-service / partial / uncovered / non-testable——covered-service 适用：端点行为由 service 层等非端点层测试锁定；证据须含测试文件锚点三形态之一（`.test.` / file:line / 反引号包裹的路径或测试名）。 -->
<!-- 预填说明：端点行由 CLI 机械预填，判定/用例依据 ID/结果/证据由 agent 逐格填写——用例依据 ID 锚点五形态：design接口表#METHOD /path、权限矩阵[角色×动作]、契约表@行标识、DDL@列名、载荷@构造点路径（须真实命中对应表/段，防空指）。 -->
<!-- 文法注释：子行 = 端点行下一行、两空格缩进、以「↳ <消费端>:」前缀书写（消费端细分承接面，不计矩阵行账）；探索行 = 判定 uncovered 且证据列含 [探索] 标记（探索性验证不算覆盖）。 -->
| 端点 | 判定 | 用例依据 ID | 结果 | 证据 |
|---|---|---|---|---|
| GET /scan-docs/stats | covered-service | design接口表#GET /scan-docs/stats | 200（路由序生效非 422；响应字段全断言） | backend/app/modules/scan_docs/tests/test_stats.py:384（httpx AsyncClient 端点 200+字段断言）+ backend/app/modules/scan_docs/tests/test_stats.py:1（口径复算用例族） |
  ↳ 前端面板: `scan-docs-stats-panel.test.tsx` mock 契约对齐（getScanDocsStats 消费生成类型） |
<!-- advisory 尾注（warning 计算归 validator，本段只留位）：有消费端未填子行的端点将列于此（advisory——消费端归类=design 清单启发式，数据面 facts.consumerHints）；写端点（POST/PUT/DELETE/PATCH）未在权限矩阵段声明的将列于此（advisory——补行或显式豁免「无权限约束」，数据面 facts.apiFace.writeEndpoints；表缺行会让派生框架继承你的洞） -->

## 测试结果 [层：确定性检查——CLI 实测对账]
- worktree backend：`python -m pytest app/modules/scan_docs/ app/modules/knowledge/tests -q` → 193 passed, 0 failed（含 NEW test_stats.py 10 用例）
- worktree frontend：`pnpm exec vitest run` 三文件 → 20 passed（页面 7+组件 7+树 6）；`pnpm exec tsc --noEmit` → 0 错；eslint 4 文件 → 0 警告
- sillyspec worktree：`node --test test/docs-inject-telemetry.test.mjs` → 3/3；`node test/check-syntax.mjs` → exit 0；全量 `node test/run-tests.mjs` → 549 过/13 红——13 红全部为「子进程调 CLI」用例命中嵌套 worktree 路径守卫（src/index.js:338 旧守卫），对照实证：同套件主仓路径 390/0 绿、task-04 改动域与 13 失败域零交集——判环境性红非回归（移交项已登记复跑条件）

## 决策追踪矩阵（如存在 decisions.md；无则删本节） [层：人工判断]
<!-- 机械半边预填（CLI，P0-1）：D→FR→task 链自 decisions.md × tasks/*.md frontmatter 结构化字段构建；
     Evidence / 状态两列是人工判断——逐格复核，未闭环行必须在报告标注风险 -->
| 决策 ID | FR | Task | Evidence | 状态 |
|---|---|---|---|---|
| D-001@v1 | FR-01、FR-02、FR-03、FR-04、FR-05、FR-06、FR-07 | task-01、task-03、task-05 | test_stats.py 覆盖率两级/陈旧/密度/新鲜用例 + 面板四子卡渲染用例 + 模块卡口径注记 | 已闭环 |
| D-002@v1 | FR-01、FR-02、FR-03、FR-04、FR-05、FR-06、FR-07 | task-01、task-02、task-03、task-05 | router.py:63 端点 + httpx 200 用例 + gen:types 产物（openapi/api-types）+ lib 三导出 | 已闭环 |
| D-003@v1 | FR-01、FR-02、FR-03、FR-04、FR-05、FR-06、FR-07 | task-01、task-03、task-04、task-05 | 02e40da5 埋点+3 用例 + test_stats injection 用例+知识 stats 不变断言 + 面板双榜 tab+空态用例 | 已闭环 |

## 技术债务 [层：人工判断]
探针 1 扫描 0 命中——交付代码无新增 TODO/FIXME/HACK；存量债（starlette 422 DeprecationWarning 18 条等）与本次无关。

## 变更风险等级 [层：人工判断]
contract-required——新增只读 API 端点 + 前端消费（生成类型锁定契约）；无跨进程生命周期/部署面（daemon 与平台 ingest 零改动，故非 integration-critical）。design frontmatter 无显式 risk_level。

## Runtime Evidence [层：人工判断]
- 端点行为：httpx AsyncClient GET /workspaces/{ws}/scan-docs/stats → 200（路由序生效，非 422）——backend/app/modules/scan_docs/tests/test_stats.py 集成用例（worktree）
- CLI 遥测落盘：临时 spec 目录跑注入 → .runtime/knowledge-hits.jsonl 末行 type=docs-inject（sillyspec worktree commit 02e40da5，node --test 3/3）
- commit 锚点：sillyspec worktree HEAD=02e40da5（2026-09-21）；主仓 worktree 交付以未提交 diff 形态待 apply（exec run exec-2026-09-21-100303-180b25）
- 失败模式排除：stats 接口失败→面板错误条不白屏不阻塞主列表（组件测试）；_module-map.yaml 损坏→无 map 退化不 500（test_stats 用例）；遥测写失败→注入本体不受影响（fail-soft 用例）
- 不涉及：daemon 运行时、平台 ingest 链路（零改动）、部署

## 代码审查 [层：人工判断]
走查结论（探针 7 ⚠️ 定向面已逐一核）：
① 编辑/更新链路：本变更是纯新增只读面（stats 端点+面板），无编辑/更新链路——不适用；reparse 既有写链路本会话 quick 已覆盖（未变更行跳过 UPDATE 用例）。
② 非主分支流：空表全零/map 损坏退化/根级伪项目不虚摊/注入全零空态均已测试或走查锁定。
③ 守卫一致性：stats 端点 SCAN_DOCS_READ 与同模块 list/get 同权限模式（router.py 同款 Depends），无越权面；跨仓埋点无权限概念（本地 jsonl）。
④ 载荷契约：ScanDocsStatsOut 族 9 类双端一致（生成类型锁定），前端零手写。
⑤ 并发/事务：stats 纯读单 SELECT 内存聚合无事务面；CLI 遥测 append 单行原子（底座既有语义）。
问题列表：P3×1——注入频次榜路径显示缺项目段（modules/<x>.md），数值正确纯显示形态（移交项已登记）。
总体评价：实现与设计一致、测试承接充分、边界处理完善，可验收。

## 独立复核（可选回流槽） [层：人工判断——复核后追加]
execute 阶段独立验收审查（agent-tool 子代理，2026-09-21）：specVerdict=pass / qualityVerdict=pass——FR-01~07、路由序、边界越权、测试证据 10 项全过；P3 注记 2 条（根级伪项目细化=良性、注入榜路径缺项目段=已列移交项）。对结论枚举影响：无（维持 PASS WITH NOTES，注记同源）。
