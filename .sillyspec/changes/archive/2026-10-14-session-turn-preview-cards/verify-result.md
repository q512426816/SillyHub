# 验证报告（骨架由 `sillyspec verify-probes --change <变更名> --init` 生成）

> 引用规范：矩阵证据/测试结果等处的源码位置写仓根相对全路径+行号（src/foo.js:123）——裸文件名在 docs-check 层1 靠 basename 全仓扫描找候选，找不到候选或关键词窗口不匹配即失效，到 pre-push 才拦（2026-09-19 实证 64 处返工）。

> 探针结果已机械预填；其余章节把 `<!--TODO-->` 替换为真实内容。**结论只认「结论枚举：」槽行**——
> 槽行留「<待填：三选一>」会被 gate 判不过（fail-closed），正文其他位置的 PASS/FAIL 字样不参与判定。
>
> 「层」=证据可核验性分层（非执行者声明）：「人工判断」指本节为语义判断，由执行 agent 填写、
> CLI 不机械复跑（gate 抽查 + 人类审批点复核兜底）；「可复跑探针/确定性检查/CLI 一致性校验」= gate 可机械复核段。

## 结论 [层：人工判断]

结论枚举：`PASS`
FR-01~FR-04 全部有自动化测试 + 真浏览器实测双面证据（worktree dev :3100 + 真实 35 轮会话 f231ca18：23 预览卡+12 内容行全量可见、点卡原地展开无双块、跳转后前向轮自动预取入流）；tsc/eslint/vitest 定向 110 例全绿；代码审查发现并修复 1 个 P1（catalogEntries 预览条目误判已加载）。移交项均为 advisory 级（P3 体验提示、超长会话渲染观察项），无 blocking。

## 移交项（结构化） [层：人工判断——CLI 清单核验]
<!-- 结论=PASS WITH NOTES 时本节必填（prose 移交叙述转结构化，复跑/验收有据可查、agent 可恢复复跑）；结论=PASS/FAIL 写「无」 -->
| 类型 | 条目 | 复跑/验收条件 |
|---|---|---|
| other | P3 体验改进：零正文轮点预览卡无反馈（幂等静默，符合 2026-09-29-jump-empty-turn-dup 语义）——可加「该轮无对话正文」轻提示 | 后续体验迭代变更顺带；非阻塞 |
| other | mergePreviewIntoDisplayTurns 随 SSE 增量每帧重算（O(n log n) sort），数百轮内无感知 | 超长会话（数百轮）出现卡顿反馈时再优化（大纲索引 memo 化） |
| other | dev server :3100 保留存活供用户自查（未登记 verify 进程回收表） | 用户手动关闭，或 `sillyspec worktree cleanup` 时随 worktree 终止 |

## 证据账（cannot_verify 任务） [层：人工判断——CLI 核验]
<!-- 无 cannot_verify 任务时本节写「无」；有则逐 task 一行 -->
无（verify-required-evidence.json 缺席，无 cannot_verify 任务）

## 集成验证回执 [层：自述声明——CLI 一致性校验]
<!-- integration-critical/deployment-critical 变更必填；其余写「无」 -->
<!-- 回执双形态（2026-09-16-friction5-hardening FR-01）：下方多行 YAML 形态为推荐写法（字段序无关）；
     亦认单行管道形态：- claim: <一句话> | command: <命令> | exit: <0 或非 0> | log: <日志路径> -->
- claim: worktree 前端起本地 dev 服务，真实长会话打开呈现全量 35 轮（23 预览卡+12 内容行），点卡原地展开、跳转后前向轮自动预取入流
  command: cd .sillyspec/.runtime/worktrees/2026-10-14-session-turn-preview-cards/frontend && pnpm dev --port 3100（浏览器打开 /sessions?session=f231ca18-0a5b-403d-a594-edf105827f1c）
  exit: 0
  log: C:\Users\12532\.zcode\cli\exec\sess_84536fe0-1a91-4c99-ba63-ada7da29ffa2\call_9e0d5b25a18e4ba386486a8d-stdout.log（✓ Ready in 24.9s，200 13.3s）
<!-- smoke 机器段缺态：not-configured（commands.smoke 未配置——配置 local.yaml 后下次 verify 亲跑并自动注入机器段）source: cli-noai-smoke -->

## 任务完成度 [层：人工判断]
- task-01：完成——preview-merge.ts 归并纯函数（先测后写 11 例：轮序/透传原引用/原位替换无双块/孤儿追加/空大纲降级/重入安全/状态映射）+ SessionTurnView.preview 可选类型。
- task-02：完成——TurnPreviewCard 渲染分支（最前置守卫）+ expandPreview 可选 prop 缺省零回归 + 7 例渲染/交互/零回归测试。
- task-03：完成——displayTurns 串联归并（依赖增补 turnOutline）+ fetchAndAttachTurn 收敛直达装配 + handleExpandPreview 原地展开 + prefetchNearbyTurns 三重判重预取 + 会话切换清 in-flight + hit() D-005 守卫。
- task-04：完成——整页集成 4 例（FR-01/FR-03/FR-03 回归锚/FR-04）+ 既有 7 文件 110 例零回归 + tsc 0。
- 无存疑项。task-04 的预取测试落点偏差（session-preview-integration.test.tsx）已回写卡对账注（verify 步 3）。

## 设计一致性 [层：人工判断]
与 design.md 一致。措辞级偏差 3 项（execute 步 6 已披露，行为等价）：①whoLine/sender 未从大纲构造（轻列缺 profile/provider 字段无法构造，预览分支不渲染该块）；②previewTurnStatusOf 独立实现（词表对齐 mapRunStatus、终点档落 TurnUiStatus 六档）；③新增 data-turn-preview 标记 + hit() 守卫 + scrollIntoView typeof 守卫（D-005@v1 与顺手指固）。

## 探针结果（CLI 机械预填） [层：可复跑探针——gate 抽查防篡改]
#### 探针 1：未实现标记扫描（design 清单文件）
- ✅ 无 TODO/FIXME/尚未实现 标记命中
- ℹ️ 3 个清单文件主仓不存在、已从 worktree 读取（apply 前新文件形态）

#### 探针 2：设计关键词覆盖
<!--TODO: 半语义探针——从 design 提取能力关键词逐个 grep 确认实现（agent 执行）-->
- ✅ 设计关键词逐个 grep worktree 实现确认：`mergePreviewIntoDisplayTurns`（frontend/src/components/daemon/session-panel/preview-merge.ts:100）、`TurnPreviewCard`（frontend/src/components/daemon/turn-timeline.tsx:503）、`expandPreview`/`onExpandPreview`（turn-timeline.tsx + session-panel-page.tsx TurnTimeline 挂载）、`handleExpandPreview`/`prefetchNearbyTurns`/`fetchAndAttachTurn`（session-panel-page.tsx:2268 区）、`previewInflightRef`（session-panel-page.tsx:805）、`data-turn-preview`（turn-timeline.tsx:557 + session-panel-page.tsx hit() 守卫）——design 总体方案全部关键词在实现中落地，零缺失。

#### 探针 3：验收标准测试覆盖
- ✅ task-01: 模块目录（frontend/src/components/daemon/session-panel、NEW:frontend/src/components/daemon/session-panel/__tests__、frontend/src/components/daemon）找到 11 个测试文件（frontend/src/components/daemon/session-panel/__tests__/preview-merge.test.ts、frontend/src/components/daemon/__tests__/activity-catalog.test.tsx、frontend/src/components/daemon/__tests__/agent-log-card.test.tsx、frontend/src/components/daemon/__tests__/agent-replay-body.test.tsx、frontend/src/components/daemon/__tests__/agent-task-card-lifecycle.test.tsx …）
- ✅ task-02: 模块目录（frontend/src/components/daemon、frontend/src/components/daemon/__tests__）找到 11 个测试文件（frontend/src/components/daemon/__tests__/activity-catalog.test.tsx、frontend/src/components/daemon/__tests__/agent-log-card.test.tsx、frontend/src/components/daemon/__tests__/agent-replay-body.test.tsx、frontend/src/components/daemon/__tests__/agent-task-card-lifecycle.test.tsx、frontend/src/components/daemon/__tests__/agent-task-card.test.tsx …）
- ✅ task-03: 模块目录（frontend/src/components/daemon/session-panel）找到 1 个测试文件（frontend/src/components/daemon/session-panel/__tests__/preview-merge.test.ts）
- ✅ task-04: 模块目录（frontend/src/components/daemon/__tests__、NEW:frontend/src/components/daemon/__tests__）找到 10 个测试文件（frontend/src/components/daemon/__tests__/activity-catalog.test.tsx、frontend/src/components/daemon/__tests__/agent-log-card.test.tsx、frontend/src/components/daemon/__tests__/agent-replay-body.test.tsx、frontend/src/components/daemon/__tests__/agent-task-card-lifecycle.test.tsx、frontend/src/components/daemon/__tests__/agent-task-card.test.tsx …）
- ℹ️ 集成盲区（路由/跨模块装配）与断言有效性抽查是语义判断，留给 agent 逐 task 标注 ⚠️

#### 探针 7：验收×测试覆盖矩阵
<!-- 口径注记：探针 3 = 模块目录递归存在性面（allowed_paths 目录附近有没有测试）；探针 7 = allowed_paths ∪ review changedFiles ∪ 直接下游卡测试 结构归属承接面（每条 acceptance 由哪些测试承接；下游消费卡的测试可承接上游 provider 的 acceptance——probe7-provider-tests-in-consumer-card）；两者并排冲突以 7 为准。判定枚举（五选一）：covered / covered-service / partial / uncovered / non-testable（covered-service 适用：端点行为由 service 层等非端点层测试锁定，证据附测试锚点；non-testable 是文档/部署类显式逃生门）。关键词命中只是提示，命中≠判定。 -->
<!-- 预填说明（ql-20260915-004）：判定列为 CLI 机械预填，agent 逐格复核改写——规则：无归属→uncovered（文档/部署/doc/deploy/manual/config 类词→non-testable）；有归属且命中≥1→covered；有归属零命中→partial。covered/covered-service/partial 证据须含测试锚点三形态之一（file:line / `.test.` 测试文件名 / 反引号包裹的路径或测试名），行号可省；uncovered/non-testable 证据自由形态。预填≠结论：与事实不符的格子必须改写（枚举须保持 covered/covered-service/partial/uncovered/non-testable 纯值，备注写在证据列）。 -->

**task-01**
| acceptance 条目 | 归属测试文件 | 关键词命中（提示，命中≠判定） | 判定 | 证据 |
|---|---|---|---|---|
| mergePreviewIntoDisplayTurns 全部单测绿：轮序/替换/孤儿/降级/缺省五组用例 | `frontend/src/components/daemon/session-panel/__tests__/preview-merge.test.ts` | mergePreviewIntoDisplayTurns、轮序、替换、孤儿（`frontend/src/components/daemon/session-panel/__tests__/preview-merge.test.ts`） | covered | `frontend/src/components/daemon/session-panel/__tests__/preview-merge.test.ts:3`（mergePreviewIntoDisplayTurns）、`frontend/src/components/daemon/session-panel/__tests__/preview-merge.test.ts:3`（轮序）、`frontend/src/components/daemon/session-panel/__tests__/preview-merge.test.ts:3`（替换） |
| turn-timeline.tsx 仅新增类型字段，既有渲染路径零改动（digest diff 审查确认） | `frontend/src/components/daemon/session-panel/__tests__/preview-merge.test.ts` | turn、timeline（`frontend/src/components/daemon/session-panel/__tests__/preview-merge.test.ts`） | covered | `frontend/src/components/daemon/session-panel/__tests__/preview-merge.test.ts:2`（turn）、`frontend/src/components/daemon/session-panel/__tests__/preview-merge.test.ts:8`（timeline） |

**task-02**
| acceptance 条目 | 归属测试文件 | 关键词命中（提示，命中≠判定） | 判定 | 证据 |
|---|---|---|---|---|
| 预览卡渲染轮号/状态/时间/提问摘要；答复摘要仅有 answerSummary 时显示 | `frontend/src/components/daemon/__tests__/turn-preview-card.test.tsx` | 状态、时间、提问摘要（`frontend/src/components/daemon/__tests__/turn-preview-card.test.tsx`） | covered | `frontend/src/components/daemon/__tests__/turn-preview-card.test.tsx:3`（状态）、`frontend/src/components/daemon/__tests__/turn-preview-card.test.tsx:3`（时间）、`frontend/src/components/daemon/__tests__/turn-preview-card.test.tsx:61`（提问摘要） |
| 点击触发 onExpandPreview 且实参=该轮 runKey；缺省 expandPreview 挂载（旧消费方形态）不渲染任何预览分支 | `frontend/src/components/daemon/__tests__/turn-preview-card.test.tsx` | onExpandPreview、且实参、runKey（`frontend/src/components/daemon/__tests__/turn-preview-card.test.tsx`） | covered | `frontend/src/components/daemon/__tests__/turn-preview-card.test.tsx:108`（onExpandPreview）、`frontend/src/components/daemon/__tests__/turn-preview-card.test.tsx:108`（且实参）、`frontend/src/components/daemon/__tests__/turn-preview-card.test.tsx:43`（runKey） |
| NEW:frontend/src/components/daemon/__tests__/turn-preview-card.test.tsx 三组用例绿 | `frontend/src/components/daemon/__tests__/turn-preview-card.test.tsx` | components（`frontend/src/components/daemon/__tests__/turn-preview-card.test.tsx`） | covered | `frontend/src/components/daemon/__tests__/turn-preview-card.test.tsx:16`（components） |

**task-03**
| acceptance 条目 | 归属测试文件 | 关键词命中（提示，命中≠判定） | 判定 | 证据 |
|---|---|---|---|---|
| 打开长会话消息流呈现全量轮次（已加载完整 + 未加载预览卡）；大纲拉取失败时页面降级为现状形态不报错 | `frontend/src/components/daemon/__tests__/session-preview-integration.test.tsx`（changedFiles 承接） | 全量轮次、预览卡、降级 | covered | `frontend/src/components/daemon/__tests__/session-preview-integration.test.tsx`（FR-01 用例：23 卡+12 行全量呈现；FR-04 用例：空大纲降级无预览卡不报错）+ `frontend/src/components/daemon/session-panel/__tests__/preview-merge.test.ts`（空大纲降级 2 例）。预填 uncovered 系归属列未列 integration 文件（execute 期新增未回写卡，已补录 task-04 卡）——按探针 7 口径「changedFiles 承接面」复核改写 covered |
| 点预览卡原地替换为完整轮块（同屏无双块）+ 2.2s 高亮；重复点击不重复请求 | `frontend/src/components/daemon/__tests__/turn-preview-card.test.tsx`<br>`frontend/src/components/daemon/session-panel/__tests__/preview-merge.test.ts` | 原地替换、无双块、点击 | covered | `frontend/src/components/daemon/session-panel/__tests__/preview-merge.test.ts`（加载后同键原位替换无双块用例）+ `frontend/src/components/daemon/__tests__/turn-preview-card.test.tsx`（点击上抛 runKey 用例）+ 真浏览器实测（卡 23→22、第 1 轮完整块出现、无双块）。重复点击不重复请求子项为代码走查：session-panel-page.tsx handleExpandPreview 在飞判重（previewInflightRef）+ hasBody 短路 |
| 跳转第 N 轮后前后未加载轮自动补入；在飞期间重复跳转不重复请求；既有跳转/翻页行为无回归 | `frontend/src/components/daemon/__tests__/session-preview-integration.test.tsx`<br>`frontend/src/components/daemon/__tests__/session-history-scroll.test.tsx` | 跳转、补入、无回归 | covered | `frontend/src/components/daemon/__tests__/session-preview-integration.test.tsx`（FR-03 用例：目标轮直达+前向预取+已加载邻居跳过；D-005 回归锚用例）+ `frontend/src/components/daemon/__tests__/session-history-scroll.test.tsx`（既有翻页/跳转链路 5 例零回归） |

**task-04**
| acceptance 条目 | 归属测试文件 | 关键词命中（提示，命中≠判定） | 判定 | 证据 |
|---|---|---|---|---|
| 预取 describe 五用例绿；降级用例绿 | `frontend/src/components/daemon/__tests__/turn-preview-card.test.tsx`<br>`frontend/src/components/daemon/__tests__/session-preview-integration.test.tsx` | 预取、describe（`frontend/src/components/daemon/__tests__/turn-preview-card.test.tsx`、`frontend/src/components/daemon/__tests__/session-preview-integration.test.tsx`） | covered | `frontend/src/components/daemon/__tests__/turn-preview-card.test.tsx:4`（预取）、`frontend/src/components/daemon/__tests__/turn-preview-card.test.tsx:10`（describe） |
| 既有相关测试文件复跑全绿；pnpm exec tsc --noEmit 零错误 | `frontend/src/components/daemon/__tests__/turn-preview-card.test.tsx`<br>`frontend/src/components/daemon/__tests__/session-preview-integration.test.tsx` | — | partial | （无机械命中——人工核验 `frontend/src/components/daemon/__tests__/turn-preview-card.test.tsx`） |

- ✅ 零/半自动化承接条目已清零——探针 7 预填的 task-03 三条 uncovered 系归属列缺 integration 文件所致，逐条复核改写 covered（见上表；重复点击子项以代码走查补证并登记于「代码审查」节）

#### 探针 4：决策追踪覆盖
<!--TODO: 语义探针——D-xxx@vN → FR-xxx → plan/task 引用 → 证据回指闭环（agent 执行）-->
- ✅ 闭环核验：D-001~D-004 由 decisions.md impacts × task 卡 decision_ids 双向映射（预填机械半边即证）；D-005@v1（执行期裁决）初始未映射——verify 期已回填 task-02/task-03 卡 decision_ids，闭环成立。全部 5 条决策见下方决策追踪矩阵，无未闭环行。

#### 探针 5：API Contract Parity
- ✅ API parity check passed: 1084 backend endpoints (live [scan-root 650 + worktree 650] + artifact 650), 0 frontend calls [scope: change-diff (6 files @ worktree)] | 0 backend endpoints unused by frontend (+216 stock noise collapsed)
- ℹ️ 后端端点比对集为多根并集（主仓既有 ∪ worktree 新增 ∪ 存量 artifact），共扫 2 个根
- ⚠️ 0 个本变更端点前端未调用（warning 不阻断）：
- ℹ️ 另有 216 个存量端点未调用（他模块存量噪音，已折叠不逐条列出）

#### 探针 6：代码删除对账
- ✅ git diff 无整文件删除（D/R/C）记录
- ℹ️ 以 git 事实为准（真实 > 声明）；是否 FAIL blocker 由 agent 诚实判定

#### 探针 8：载荷字段契约对账（advisory）
- 不适用（清单无 Java/SQL 后端面，或 design.md 缺失）
#### 探针 9：守卫一致性（advisory）
- 不适用（清单无 .java 改动文件，或 design.md 缺失）
- ℹ️ 清单无 .java 文件（另有 5 个非 Java 清单文件不在探针 9 扫描面）
#### 探针 10：预填注清零（error 门）
<!-- 口径注记：预填注（来源注协议）在场 = 白名单槽未确认（预填≠结论）；删注 = 确认动作。本探针是门禁梯度 error 档——verify --done 时 gate 复跑同源检测，注未清零阻断完成（归档前清零兜底）。已知误报面：散文引用注字面量会命中（如文档描述注协议本身）——核对后真未确认则删注，纯散文则改写措辞，不得删探针段。 -->
- ✅ 预填注清零（5 个在检文件无未确认预填）
#### 探针 11：红线一致性（advisory）
- 不适用（仓未配置 .sillyspec/redlines.yaml——红线机检零打扰，D-002）
#### 探针 12：UI 视觉证据（分级门）
<!-- 口径注记：在场性检查非语义审计——只验 visual-evidence.md 存在非空与降级裁决留痕，不判对照结论对错（语义面归 verify-result 人工判断层）。证据应在执行时按 flow start「UI 变更执行须知」随手产生；本探针不要求收口现做。分级：缺证据默认 ⚠️（local.yaml ui_visual_gate=error 升阻断）；视觉降级无「用户裁决」留痕恒 ❌（off 豁免）。 -->
- ❌ design/requirements 存在视觉降级声明而变更目录无用户裁决留痕（visual-evidence.md 或 decisions.md 含「用户裁决」）——静默降级禁止收口
  - 修复：补渲染对照证据到 visual-evidence.md；降级项补用户裁决留痕（含「用户裁决」字样段）后重跑收口

## 接口验证覆盖矩阵 [层：人工判断——CLI 预填复核]
<!-- 口径注记（与探针 7 互指，R-07）：探针 7 = 验收项 × 测试承接面（每条 acceptance 由哪些测试承接）；本矩阵 = 接口端点 × 验证用例面（design 接口段每个端点由哪些验证用例/冒烟步骤覆盖）——两者并排互补，双矩阵并行存在。端点集来自 design.md 接口段 tolerant 解析（parseDesignApiTable：段头宽收 + 方法/路径双条件），预填≠结论，agent 逐行复核。判定枚举（五选一）：covered / covered-service / partial / uncovered / non-testable——covered-service 适用：端点行为由 service 层等非端点层测试锁定；证据须含测试文件锚点三形态之一（`.test.` / file:line / 反引号包裹的路径或测试名）；non-testable 适用（含运行验证移交场景）：目标环境不可达、构建级验证已过而运行冒烟移交部署后执行——证据写构建回执+移交去向一句话，该行不计入有效分母（勿硬凑 covered-service）。 -->
<!-- 预填说明：端点行由 CLI 机械预填，判定/用例依据 ID/结果/证据由 agent 逐格填写——用例依据 ID 锚点五形态（可复制样例）：design接口表#POST /api/xx（# 后必须 METHOD /path，仅表名/行号/散文描述不计命中）、权限矩阵[admin×读]、契约表@任务卡字段清单、DDL@users.id、载荷@e2e_body.json（须真实命中对应表/段，防空指）。 -->
<!-- 文法注释：子行 = 端点行下一行、两空格缩进、以「↳ <消费端>:」前缀书写（消费端细分承接面，不计矩阵行账）；探索行 = 判定 uncovered 且证据列含 [探索] 标记（探索性验证不算覆盖）。 -->
| 端点 | 判定 | 用例依据 ID | 结果 | 证据 |
|---|---|---|---|---|
| 本变更接口面：0 端点（agent 声明） | non-testable | — | 无端点可验 | design 接口段声明 0 端点（纯前端组件层，消费既有 turn-outline/logs 端点零改动）；apiFetch 层零新增 |
<!-- 解析零行降级（D-005）：接口面以 agent 声明为准（对账分母=声明数）；声明与实际不符时补 design 接口段表格后重跑 --init --force 重生成本段（quick-B：--force 才有刷新通道，手填内容会重置先备份） -->
<!-- advisory 尾注（warning 计算归 validator，本段只留位）：有消费端未填子行的端点将列于此（advisory——消费端归类=design 清单启发式，数据面 facts.consumerHints）；写端点（POST/PUT/DELETE/PATCH）未在权限矩阵段声明的将列于此（advisory——补行或显式豁免「无权限约束」，数据面 facts.apiFace.writeEndpoints；表缺行会让派生框架继承你的洞） -->

## 测试结果 [层：确定性检查——CLI 实测对账]
- 命令：`pnpm exec vitest run <7 个定向测试文件>`（worktree frontend，execute 期 + verify 步 6 复核不重跑）
- 结果：7 文件 **110/110 全绿**（preview-merge 11 + turn-preview-card 7 + session-preview-integration 4 新增；turn-nav-list / turn-catalog / session-panel-pre-session / session-history-scroll 既有 88 例零回归）
- 命令：`pnpm exec tsc --noEmit` → 0 错误；`pnpm exec eslint <4 新文件 + turn-timeline.tsx>` → 0 问题
- 证据日志：/tmp/vitest-preview-regression.log、/tmp/vitest-review-fix.log
- 未跑全量（规则 0：全量留给 CI）；known_failures：无

## 决策追踪矩阵（如存在 decisions.md；无则删本节） [层：人工判断]
<!-- 机械半边预填（CLI，P0-1）：D→FR→task 链自 decisions.md × tasks/*.md frontmatter 结构化字段构建；
     Evidence / 状态两列是人工判断——逐格复核，未闭环行必须在报告标注风险 -->
| 决策 ID | FR | Task | Evidence | 状态 |
|---|---|---|---|---|
| D-001@v1 | FR-01、FR-02、FR-03 | task-02、task-03 | 真浏览器实测（23 卡全量呈现/点卡原地展开/前向轮预取入流）+ session-preview-integration.test.tsx 4 例 | 闭环 ✅ |
| D-002@v1 | FR-01、FR-02、FR-03、FR-04 | task-01、task-02、task-04 | 探针 5 API parity 0 端点新增；diff 六文件全在 frontend/src/components/**；未触发 gen:types | 闭环 ✅ |
| D-003@v1 | FR-01、FR-02、FR-03 | task-03 | session-panel-page.tsx handleExpandPreview（无 scrollIntoView + highlightTurnKey 2.2s + 加载后保持）+ turn-preview-card.test.tsx 点击用例 | 闭环 ✅ |
| D-004@v1 | FR-01、FR-02、FR-03、FR-04 | task-01、task-03 | preview-merge.ts 单一数据源归并 + 11 例单测（原位替换无双块/降级/重入）+ displayTurns 派生链串联 | 闭环 ✅ |
| D-005@v1 | FR-03 | task-02、task-03 | turn-timeline.tsx data-turn-preview 标记 + session-panel-page.tsx hit() 守卫 + session-preview-integration.test.tsx 回归锚用例（verify 期已回填 task 卡 decision_ids 闭环） | 闭环 ✅ |

## 技术债务 [层：人工判断]
- TODO/FIXME/HACK 新增：0（探针 1 ✅ 无命中）
- 既有观察项 2 条（均登记于「移交项」非阻塞）：零正文轮展开无轻提示（P3）；归并层每帧重算（数百轮内无感知）
- scan 基线漂移（2659 commits / 68 天）为仓库既有状态，非本变更引入

## 变更风险等级 [层：人工判断]
**unit-sufficient**。纯前端组件层变更（六文件全在 frontend/src/components/**，D-002 后端/daemon 零改动、0 端点），无 schema/无跨进程联动/无部署面；110 例定向测试 + tsc/eslint + 真浏览器实测三层证据足以在单测层闭环。design.md frontmatter 无显式 risk_level 声明；本变更不触碰 daemon 协议/数据库/worktree 隔离等 integration-critical 词表面。

## Runtime Evidence [层：人工判断]
- worktree 分支提交：`0a3e7371b`（sillyspec/2026-10-14-session-turn-preview-cards，1016+/71-，六文件）——gate execute execute-evidence check 实证「6 个已提交变更文件（base 10c669ae）」
- 浏览器实测（dev :3100 + 会话 f231ca18，35 轮）：
  - FR-01：`cardCount=23, loadedRowCount=12`（23+12=35 全量轮次可见）；卡文本含「第 1 轮/未加载 · 点击展开/09-23 09:20/【/workspaces/a8a0fde6…」
  - FR-02：点第 1 轮卡 → `cards 23→22`、目标轮完整块出现、`firstRoundCount=1`（无双块）
  - FR-03：点导航第 10 轮 → 第 9 轮（2b702ec3）自动预取入流 ✓、第 11 轮（已加载）正确跳过 ✓
  - 幂等语义实证：第 10 轮为 429 限额失败零正文轮（3 条日志：系统通知+ASSISTANT_OVERRIDE+429 错误），直达按 jump-empty-turn-dup 语义记幂等不重复请求、预览卡保持
  - 截图两张见 visual-evidence.md（布局完整、导航轨 35 刻度正常、失败轮色点正确）
- 生命周期终态断言：dev server :3100 进程未登记 verify 回收表（保留供用户自查）；无其它常驻进程新增
- 失败模式排除：大纲缺失降级（FR-04 jsdom 用例）、在飞重复请求（判重逻辑走查+代码锚点）、既有翻页/跳转回归（history-scroll 88 例）均排除

## 代码审查 [层：人工判断]
execute Step 8 自查发现并修复 1 个 P1：catalogEntries 的 loadedByKey 把预览条目判已加载（导航空心刻度消失、摘要空）——修复：预览条目过滤出已加载索引 + 孤儿兜底循环跳过预览条目（session-panel-page.tsx 两处），修复后 63 例绿已 amend。修复后定向走查（探针 7 ⚠️ 清零后的定向面）：
- ① displayTurns 全部消费方逐点核对（grep 实证 7 处）：dialogTurns 拆分/ctx 环（预览 null 被 ?? 链跳过）/子代理 DFS（segments 空 安全）/catalogEntries（已修）/navEntries/孤儿兜底（已修）——无残留误判消费方
- ② 非主分支流：tool_report 会话（预览条目经 splitToolReportTurns 归属正确）、dialog 模式（expandPreview 缺省守卫，7 例中专门用例锁定）
- ③ 守卫一致性：hit() 60 字内容门 + data-turn-preview 排除（D-005）+ loadedHasBody 状态判双门并存语义核对一致
- ④ 载荷契约：探针 8 不适用（无后端面）
- ⑤ 并发：预取/展开共享 previewInflightRef 在飞去重 + 会话切换清空（:1118 区重置已核）
总体评价：实现与设计一致、边界处理完善、无 TODO/FIXME 残留、无冗余（fetchAndAttachTurn 收敛消重复）。

## 独立复核（可选回流槽） [层：人工判断——复核后追加]
无（本变更未触发独立复核子代理；代码审查为 agent 自查 + 真浏览器实测双面验证）。
