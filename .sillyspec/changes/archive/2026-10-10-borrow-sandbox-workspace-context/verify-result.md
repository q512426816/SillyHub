# 验证报告（骨架由 `sillyspec verify-probes --change <变更名> --init` 生成）

> 引用规范：矩阵证据/测试结果等处的源码位置写仓根相对全路径+行号（src/foo.js:123）。

## 结论 [层：人工判断]

结论枚举：PASS WITH NOTES——本变更 4 任务相关面测试全绿（backend 40 pytest + daemon 13 vitest + tsc 0 错）、独立 QA 验收 10/10、write-guard 零 diff 红线实测成立；notes 为环境与人工项（见移交项）：①daemon 既有测试文件 kind-dispatch 等在系统代理黑洞下超时（环境归因，主仓 HEAD 对照复现，非本变更回归）；②真实借用会话端到端效果（沙箱 AGENTS.md 被 agent 读到）需部署后人工抽查。

## 移交项（结构化） [层：人工判断——CLI 清单核验]

| 类型 | 条目 | 复跑/验收条件 |
|---|---|---|
| env-blocked | daemon-kind-dispatch.test.ts 等 20 用例超时（系统代理黑洞 npm 流量，daemon.start() 每例拖 30-60s；主仓 HEAD 对照同超时=环境归因非回归） | 关闭系统代理或放行 npm 流量后 `cd sillyhub-daemon && pnpm exec vitest run tests/daemon-kind-dispatch.test.ts`；或按 uncategorized 知识条目推广 vi.mock runPreflight 修法（候选独立小变更） |
| manual-acceptance | 借用会话端到端感知效果（agent 基于 AGENTS.md 答出工作区名/代码路径） | 部署 backend+daemon 新版到测试环境后，用 180024 类账号在 workflow 工作区开借用会话问「这是什么工作区/代码在哪」，并抽查沙箱根 AGENTS.md 内容与写守卫仍拦截沙箱外写 |
| other | task-03 探针 7 partial 行：camel 形态 claim payload 键（borrowWorkspaceContext）无直测（三级兜底与 workspaceSlug 先例同构机械等价，snake 形态集成已测） | 后续变更顺手在 sillyhub-daemon/tests/daemon-borrow-sandbox.test.ts 加一例 camel 键集成用例（claim payload 喂 borrowWorkspaceContext 断言 AGENTS.md 落盘）即清账 |

## 证据账（cannot_verify 任务） [层：人工判断——CLI 核验]

无（verify-required-evidence.json 缺席，2026-09-26 起 Task Review 退役停写；无 cannot_verify 任务）。

## 集成验证回执 [层：自述声明——CLI 一致性校验]

- claim: backend 借用产键面测试全绿（placement 三标记点 + Workspace 缺行边界 + 非借用零回归）
  command: cd backend && uv run pytest -q --no-cov app/modules/agent/tests/test_placement_borrow_integration.py
  exit: 0
  log: 27 passed（execute 期实录，/tmp/t01-test2.log）
- claim: claim payload 透传面测试全绿（含 batch 不透传反例）
  command: cd backend && uv run pytest -q --no-cov app/modules/daemon/lease/tests/test_init_claim_tokens.py
  exit: 0
  log: 13 passed（/tmp/t02-test2.log）
- claim: daemon 渲染纯函数 + marker 落盘三态集成全绿（有键渲染/无键不写/写失败 fail-open）+ 类型检查
  command: cd sillyhub-daemon && pnpm exec vitest run tests/borrow-sandbox-context.test.ts tests/daemon-borrow-sandbox.test.ts && pnpm typecheck
  exit: 0
  log: 7+6 passed + tsc 0 错（/tmp/t03-test.log、/tmp/t04-test4.log、/tmp/t04-tsc.log）
<!-- smoke 机器段缺态：not-configured（commands.smoke 未配置——配置 local.yaml 后下次 verify 亲跑并自动注入机器段）source: cli-noai-smoke -->

## 任务完成度 [层：人工判断]

4/4 全部完成：task-01 ✅（loader+stamp 第 4 参+三标记点接线+AC9 5 用例，commit d83602302）；task-02 ✅（白名单透传+3 用例，commit 3a5761d2f）；task-03 ✅（LeaseCtx 字段+归一化双读+渲染纯函数+7 用例，commit f2b166794）；task-04 ✅（marker 落盘 fail-open+3 集成用例，commit f724a739a）。worktree 分支 sillyspec/2026-10-10-borrow-sandbox-workspace-context，ea376aa08..HEAD 共 768 行增量 9 文件。

## 设计一致性 [层：人工判断]

一致（独立 QA 验收 review-2026-10-10-182832 逐项核验 10/10）。合理细节调整 3 条（QA note 在案，非偏差）：tech_stack 数组 join 用顿号「、」；缺 root_path 落「未携带」防御行；sandboxRoot 写入产出指引（接口签名本含该参数）。写隔离红线：git diff sillyhub-daemon/src/interactive/ 0 文件（D-003 实测成立）。

## 探针结果（CLI 机械预填） [层：可复跑探针——gate 抽查防篡改]
#### 探针 1：未实现标记扫描（design 清单文件）
- ✅ 无 TODO/FIXME/尚未实现 标记命中
- ℹ️ 2 个清单文件主仓不存在、已从 worktree 读取（apply 前新文件形态）

#### 探针 2：设计关键词覆盖
- `borrow_workspace_context`：backend/app/modules/agent/placement.py（产键 8 处）+ backend/app/modules/daemon/lease/context.py（透传）✅
- `borrowWorkspaceContext`：sillyhub-daemon/src/types.ts（LeaseCtx 字段）+ sillyhub-daemon/src/daemon.ts（归一化双读+marker 消费 5 处）✅
- `AGENTS.md`/`BORROW_CONTEXT_FILENAME`：sillyhub-daemon/src/borrow-sandbox-context.ts（常量+渲染）+ daemon.ts marker 分支落盘 ✅
- `root_path` 只读告知/`禁止写`声明/500 截断/`平台登记数据`：borrow-sandbox-context.ts 模板 + borrow-sandbox-context.test.ts 断言 ✅
- fail-open（`borrow_sandbox_context_write_failed`）：daemon.ts marker 分支内层 try/catch ✅

#### 探针 3：验收标准测试覆盖
- ✅ task-01: 模块目录（backend/app/modules/agent、backend/app/modules/agent/tests、backend/app/modules/workspace）找到 20 个测试文件
- ✅ task-02: 模块目录（backend/app/modules/daemon/lease、backend/app/modules/daemon/lease/tests）找到 1 个测试文件（test_init_claim_tokens.py）
- ✅ task-03: 模块目录（sillyhub-daemon/src、sillyhub-daemon/tests）找到 11 个测试文件
- ✅ task-04: 模块目录（sillyhub-daemon/src、sillyhub-daemon/tests）找到 11 个测试文件
- ℹ️ 集成盲区与断言有效性为语义判断，已在探针 7 逐格复核。

#### 探针 7：验收×测试覆盖矩阵

**task-01**
| acceptance 条目 | 归属测试文件 | 关键词命中（提示，命中≠判定） | 判定 | 证据 |
|---|---|---|---|---|
| 三标记点借用 lease metadata 含 borrow_workspace_context，字段集= design 总体方案字段集，None 值字段不落键 | `backend/app/modules/agent/tests/test_placement_borrow_integration.py` | lease、metadata | covered | `test_ac9_dispatch_borrow_writes_workspace_context`、`test_ac9_interactive_borrow_writes_workspace_context`、`test_ac9_scan_interactive_borrow_writes_workspace_context`（三标记点逐点断言字段集与 None 不落键，backend/app/modules/agent/tests/test_placement_borrow_integration.py） |
| Workspace 行缺失/全 None 字段 → 不写键且派发不抛错 | `backend/app/modules/agent/tests/test_placement_borrow_integration.py` | Workspace、None | covered | `test_ac9_workspace_row_missing_no_context_key`（DELETE 行后断言无键+派发成功+marker 仍在） |
| 非借用 lease metadata 无 borrow_workspace_context 键（零回归） | `backend/app/modules/agent/tests/test_placement_borrow_integration.py` | lease、metadata、零回归 | covered | `test_ac9_own_daemon_no_context_key_zero_regression` |

**task-02**
| acceptance 条目 | 归属测试文件 | 关键词命中（提示，命中≠判定） | 判定 | 证据 |
|---|---|---|---|---|
| 借用 interactive lease 的 claim payload 含 borrow_workspace_context（与 metadata 逐字段一致） | `backend/app/modules/daemon/lease/tests/test_init_claim_tokens.py` | lease、claim、payload | covered | `TestBorrowWorkspaceContextPassthrough::test_interactive_lease_context_passthrough`（ctx 四字段逐字段相等断言） |
| metadata 无键/None → claim payload 无键（缺键穿透不伪造默认值） | `backend/app/modules/daemon/lease/tests/test_init_claim_tokens.py` | metadata、None | covered | `test_interactive_lease_no_context_no_key` + `test_batch_lease_context_not_passthrough`（batch 边界反例） |
| 置于 transport 分支之前：tar 与 shared 两路 return 均携带（断言至少覆盖 shared 默认路） | `backend/app/modules/daemon/lease/tests/test_init_claim_tokens.py` | tar | covered | `test_interactive_lease_context_passthrough` 走 shared 默认路断言命中（默认 transport=shared，context.py:655-661）；tar 路由同函数 fork_mode 先例同位（:624 前），代码位断言由 QA checklist FR-03 复核 |

**task-03**
| acceptance 条目 | 归属测试文件 | 关键词命中（提示，命中≠判定） | 判定 | 证据 |
|---|---|---|---|---|
| 渲染输出含 name/slug/repo/分支/技术栈与真实 root_path，且含「禁止写」边界声明与文尾数据声明（FR-02） | `sillyhub-daemon/tests/borrow-sandbox-context.test.ts` | name、slug、repo | covered | `全字段渲染：元信息 + 真实路径只读声明 + 沙箱产出指引 + 文尾数据声明` 用例（FULL_CTX 七断言） |
| 归一化后 execPayload.borrowWorkspaceContext 在 camel/snake 两种 claim payload 键形态下均可取到 | `sillyhub-daemon/tests/daemon-borrow-sandbox.test.ts` | — | partial | snake 形态集成断言在案（`claim payload 带 borrow_workspace_context → 沙箱根落 AGENTS.md` 用例喂 snake 键走通全链）；camel 形态由同一三级兜底表达式承载（daemon.ts:9515-9520，与 workspaceSlug :9511 先例逐字同构，机械等价）但无 camel 直测——记技术债（见技术债务节），非功能风险 |
| 模板为 daemon 固定代码，ctx 值仅数据填充（无拼接执行语义） | `sillyhub-daemon/tests/borrow-sandbox-context.test.ts` | ctx | covered | 模板为 sillyhub-daemon/src/borrow-sandbox-context.ts 固定 lines 数组（QA checklist FR-02 复核：字段仅数据填充）+ `渲染幂等` 用例 |

**task-04**
| acceptance 条目 | 归属测试文件 | 关键词命中（提示，命中≠判定） | 判定 | 证据 |
|---|---|---|---|---|
| 借用 lease（marker+context）认领后沙箱根有 AGENTS.md（FR-04 主路径） | `sillyhub-daemon/tests/daemon-borrow-sandbox.test.ts` | 借用、lease、marker | covered | `claim payload 带 borrow_workspace_context → 沙箱根落 AGENTS.md（含 root_path 只读声明）` 用例（existsSync+readFileSync 内容五断言） |
| 无 context 键不写文件；渲染/写失败仅 warn 不阻塞 session（FR-04 fail-open） | `sillyhub-daemon/tests/daemon-borrow-sandbox.test.ts` | — | covered | `claim payload 无 borrow_workspace_context → 不写 AGENTS.md` + `AGENTS.md 写失败（同名目录占位）→ 仅 warn 不阻塞 session（fail-open）`（后例同时断言 registerBorrowSandbox 照常登记=写隔离不受影响） |
| 非借用 lease 路径零变化（既有 B 组零回归用例保持绿） | `sillyhub-daemon/tests/daemon-borrow-sandbox.test.ts` | 非借用、lease | covered | 既有 `非借用 lease（rootPath=普通路径）→ registerBorrowSandbox 不调用，cwd=rootPath（零回归）` 用例本轮回绿（6/6） |

- ⚠️ 零/半自动化承接条目已逐条走查改判（上方两行 partial→covered 一行 + 保留 partial 一行带技术债登记），走查结论进「代码审查」节。

#### 探针 4：决策追踪覆盖
D-001@v1（深度）→ FR-01/02 字段集含 root_path（placement loader + 渲染模板真实路径节）闭环；D-002@v1（载体）→ task-01/02/03 键名链四跳逐字一致（QA checklist 第 6 条）闭环；D-003@v1（写隔离红线）→ write-guard 0 diff + 模板固定 daemon 侧闭环；D-004@v1（fail-open）→ 内层 try/catch warn + fail-open 用例闭环；D-005@v1（双向兼容）→ 缺键三面反例（metadata 无键/payload 无键/不写文件）闭环。全部闭环，无 stale 引用（decisions.md 无 superseded 条目）。

#### 探针 5：API Contract Parity
- ✅ API parity check passed: 632 backend endpoints (live [scan-root 636 + worktree 636] + artifact 0), 0 frontend calls [scope: change-diff (9 files @ worktree)]（本变更无端点/前端改动，符合 design「0 端点」声明）

#### 探针 6：代码删除对账
- ✅ git diff 无整文件删除（D/R/C）记录

#### 探针 8：载荷字段契约对账（advisory）
- 不适用（清单无 Java/SQL 后端面）
#### 探针 9：守卫一致性（advisory）
- 不适用（清单无 .java 改动文件）
#### 探针 10：预填注清零（error 门）
- ✅ 预填注清零（5 个在检文件无未确认预填）
#### 探针 11：红线一致性（advisory）
- 不适用（仓未配置 .sillyspec/redlines.yaml）
#### 探针 12：UI 视觉证据（分级门）
- ⚠️ 变更目录缺 visual-evidence.md——本变更无前端/UI 文件（design 清单 9 文件全为 backend/daemon/测试），无渲染对照面，视觉证据不适用（降级理由留痕，非缺失风险）

## 接口验证覆盖矩阵 [层：人工判断——CLI 预填复核]

| 端点 | 判定 | 用例依据 ID | 结果 | 证据 |
|---|---|---|---|---|
| 本变更接口面：0 端点（agent 声明） | non-testable | design.md 接口定义节「0 端点（无对外 API/DTO 改动）」 | 无端点变更 | 内部契约键由探针 7 矩阵承接（backend 产→daemon 消费双端测试） |

## 测试结果 [层：确定性检查——CLI 实测对账]

- backend：`uv run pytest -q --no-cov app/modules/agent/tests/test_placement_borrow_integration.py` → 27 passed（含 AC9 新 5 例）；`uv run pytest -q --no-cov app/modules/daemon/lease/tests/test_init_claim_tokens.py` → 13 passed（含新 3 例）
- daemon：`pnpm exec vitest run tests/borrow-sandbox-context.test.ts` → 7 passed；`pnpm exec vitest run tests/daemon-borrow-sandbox.test.ts` → 6 passed（三态）；`pnpm typecheck` → 0 错
- lint：`uv run ruff check/format` 改动文件全过；daemon tsc strict 0 错
- 相关面回归：session-manager-borrow-sandbox.test.ts passed；daemon-kind-dispatch.test.ts 20 用例超时=环境归因（主仓 HEAD 对照同超时，见移交项），known_failure 豁免理由：系统代理黑洞 npm 流量（reg query ProxyEnable=1/ProxyServer=127.0.0.1:7897 实证），与本变更 diff 无交集
- 全量测试未跑（CLAUDE.md 规则 0，留 CI）

## 决策追踪矩阵（如存在 decisions.md；无则删本节） [层：人工判断]

| 决策 ID | FR | Task | Evidence | 状态 |
|---|---|---|---|---|
| D-001@v1 | FR-01、FR-02、FR-03 | task-01、task-03 | placement.py `_BORROW_WORKSPACE_CONTEXT_FIELDS` 9 字段含 root_path；渲染模板「真实代码目录（只读）」节 + 可以读/禁止写声明 | 已闭环 |
| D-002@v1 | FR-01、FR-02、FR-03、FR-05 | task-01、task-02、task-03 | 键名链 borrow_workspace_context（snake）/borrowWorkspaceContext（camel）四跳逐字一致（QA checklist 第 6 条 + 集成用例喂 snake 键走通） | 已闭环 |
| D-003@v1 | FR-02、FR-03、FR-04、FR-05 | task-03、task-04 | write-guard/session-manager 0 diff（git diff interactive/ 0 文件）；模板固定于 sillyhub-daemon/src/borrow-sandbox-context.ts | 已闭环 |
| D-004@v1 | FR-02、FR-04、FR-05 | task-04 | daemon.ts marker 分支内层 try/catch warn `borrow_sandbox_context_write_failed` + 同名目录占位 fail-open 用例 | 已闭环 |
| D-005@v1 | FR-01、FR-02、FR-03、FR-04、FR-05 | task-01、task-02、task-04 | 三面缺键反例：test_ac9_own_daemon_no_context（metadata）+ test_interactive_lease_no_context_no_key（payload）+ 无 context 不写文件（daemon） | 已闭环 |

## 技术债务 [层：人工判断]

- 新增 TODO/FIXME/HACK：0（探针 1 无命中）。
- 登记 1 条：camel 形态 claim payload 键（borrowWorkspaceContext）无直测（三级兜底与 workspaceSlug 先例同构机械等价，snake 形态集成已测）——后续顺手在 daemon-borrow-sandbox.test.ts 加一例 camel 键即可清账。
- 测试卫生 1 条（QA note）：daemon-borrow-sandbox.test.ts 个别 root_path 字面量风格可再统一（自洽通过不影响断言有效性）。
- 环境债（非本变更引入）：daemon 测试对系统代理敏感（见移交项 env-blocked）。

## 变更风险等级 [层：人工判断]

contract-required——backend↔daemon 内部数据契约（lease metadata 单键四跳）变更，双端协同部署后新行为才完整生效；兼容策略（D-005@v1 缺键穿透）保证混布安全（旧 daemon 忽略新键、旧 backend 无键=现状），无 schema/API/表结构变更，回退=不部署即回现状。design.md frontmatter 无 risk_level 显式声明。

## Runtime Evidence [层：人工判断]

- worktree 分支 sillyspec/2026-10-10-borrow-sandbox-workspace-context，4 commit：d83602302（task-01）/ f2b166794（task-03）/ 3a5761d2f（task-02）/ f724a739a（task-04），基 ea376aa08。
- 测试实录命令与结果见「测试结果」节（三条集成验证回执）；daemon tsc --noEmit 0 错。
- 运行时组件触碰：backend 派发链（placement/context）+ daemon 认领链（归一化/marker 分支）——均为既有进程内路径追加，无新进程/端口/生命周期事件；「不涉及」启动命令/端点请求响应（无端点变更）。
- 真实借用会话运行时验证（沙箱 AGENTS.md 被 agent CLI 实际加载）= manual-acceptance 移交项（部署后抽查）。

## 代码审查 [层：人工判断]

- 独立 QA 验收审查（review-2026-10-10-182832，acceptance 双 pass 10/10）覆盖风格/bug/安全/冗余：风格（ruff/tsc/ESM 后缀/中文注释惯例）✅；安全（写隔离红线 0 diff、间接注入面截断+数据声明）✅；冗余（渲染纯函数单点、loader 单点）✅。
- 零覆盖路径走查（探针 7 ⚠️ 条目）：①camel 键形态——三级兜底表达式与 workspaceSlug 先例（daemon.ts:9511）逐字同构，snake 全链集成已测，机械等价性成立，列 partial+技术债非阻断；②fail-open 分支——同名目录占位用例实测 EISDIR 路径走 warn 不阻塞，registerBorrowSandbox 照常（写隔离不受上下文失败影响的 D-003 语义）✅。
- 守卫一致性：无端点改动，不适用操作人/权限对比；写守卫（唯一 enforcement）0 改动。
- 并发/事务面：AGENTS.md 写入为一次性 per-run 沙箱（slug 含 run_id），幂等覆盖写，无共享态。

## 独立复核（可选回流槽） [层：人工判断——复核后追加]

execute 阶段独立 QA 验收审查（review-2026-10-10-182832，general-purpose 子代理，9/15 请求预算）：specVerdict=pass / qualityVerdict=pass，10/10 checklist（FR-01~05、键名链、反例测试、R-04 三点、生命周期、write-guard 红线），0 blocker，3 条合理细节调整 note。对结论枚举的影响：无（支撑 PASS WITH NOTES）。
