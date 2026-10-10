# 验证报告（骨架由 `sillyspec verify-probes --change <变更名> --init` 生成）

> 引用规范：矩阵证据/测试结果等处的源码位置写仓根相对全路径+行号（src/foo.js:123）——裸文件名在 docs-check 层1 靠 basename 全仓扫描找候选，找不到候选或关键词窗口不匹配即失效，到 pre-push 才拦（2026-09-19 实证 64 处返工）。

> 探针结果已机械预填；其余章节把 `<!--TODO-->` 替换为真实内容。**结论只认「结论枚举：」槽行**——
> 槽行留「<待填：三选一>」会被 gate 判不过（fail-closed），正文其他位置的 PASS/FAIL 字样不参与判定。
>
> 「层」=证据可核验性分层（非执行者声明）：「人工判断」指本节为语义判断，由执行 agent 填写、
> CLI 不机械复跑（gate 抽查 + 人类审批点复核兜底）；「可复跑探针/确定性检查/CLI 一致性校验」= gate 可机械复核段。

## 结论 [层：人工判断]

结论枚举：`PASS WITH NOTES`（三侧触及面测试全绿 + CLI 实测门双绿 + 三层独立审查双 pass；未做真实会话运行时冒烟——集成实测未跑触发 PASS 封顶①，移交项登记 manual-acceptance）

## 移交项（结构化） [层：人工判断——CLI 清单核验]
<!-- 结论=PASS WITH NOTES 时本节必填（prose 移交叙述转结构化，复跑/验收有据可查、agent 可恢复复跑）；结论=PASS/FAIL 写「无」 -->
<!-- 类型枚举：env-blocked（环境阻断，条件列必填复跑口径）/ manual-acceptance（人工验收，条件列必填验收步骤）/ db-script（待执行脚本，条件列必填执行环境与顺序）/ other -->
| 类型 | 条目 | 复跑/验收条件 |
|---|---|---|
| manual-acceptance | 真实会话端到端观察：向 codex / pi 引擎各发一轮，确认轮**运行中**轮尾出现实时 tok/s、轮终态速度仍在（cursor 轮如实无速度） | 平台会话页发起带工具调用的轮；daemon+backend+frontend 为本地开发栈 |
| manual-acceptance | codex 时钟回拨专属用例补齐（QA P3：三处 Math.max(0) 守卫在场但无反例用例钉住） | sillyhub-daemon/tests/interactive/codex-app-server-driver.test.ts 增 setSystemTime 回拨用例 |

## 证据账（cannot_verify 任务） [层：人工判断——CLI 核验]
<!-- 无 cannot_verify 任务时本节写「无」；有则逐 task 一行 -->
无（6/6 任务均有实现 commit 与测试证据，无 cannot_verify）

## 集成验证回执 [层：自述声明——CLI 一致性校验]
<!-- integration-critical/deployment-critical 变更必填；其余写「无」 -->
<!-- 回执双形态（2026-09-16-friction5-hardening FR-01）：下方多行 YAML 形态为推荐写法（字段序无关）；
     亦认单行管道形态：- claim: <一句话> | command: <命令> | exit: <0 或非 0> | log: <日志路径> -->
- 无（变更未判 integration/deployment-critical；真实会话运行时观察已登记移交项 manual-acceptance）
<!-- smoke 机器段缺态：not-configured（commands.smoke 未配置——配置 local.yaml 后下次 verify 亲跑并自动注入机器段）source: cli-noai-smoke -->

## 任务完成度 [层：人工判断]
6/6 完成（tasks.md 全勾，逐任务 wt-commit + 六卡 review pass）：
- task-01 完成（9f595351）：AgentEventUsage.api_duration_ms + schema 放行 + usageToEventUsage 守卫，4 用例
- task-02 完成（b9777dd4）：claude 桶计时四要素，22 用例（含时钟回拨反例）
- task-03 完成（5118b487）：codex 生成窗口 + _usageDelta 单点搭车，70 用例
- task-04 完成（32f589d5）：pi text_delta 锚/message_end 折叠（接入路径落地，降级未触发），91 用例
- task-05 完成（55209fd8）：backend max 累积 + 仅增不减写回 + SSE 增键，13 用例（新增 5）
- task-06 完成（3009d68f）：onTokens 接线 + 门控放宽 + 测试改写，前端相关批全绿

## 设计一致性 [层：人工判断]
整体一致（execute QA review.json 逐 FR pass）。两处语义等价微调（QA 判定留档）：
- FR-01「result 折叠残段」实现为「锚间折叠 + onTurnEnd 丢弃残段」——每次 flush 已携带活窗口故上报值完整，终态权威值由 close 覆盖兜底；
- FR-02 codex 锚定层从 raw item/started 上移到归一化事件层——窗口语义等价。
良性清单偏差：service/__init__.py 零改动（PublishIntent 在 submit_commit.py 直接构造，intent 装配透传落位该文件）。

## 探针结果（CLI 机械预填） [层：可复跑探针——gate 抽查防篡改]
#### 探针 1：未实现标记扫描（design 清单文件）
- ✅ 无 TODO/FIXME/尚未实现 标记命中
- ℹ️ 清单文件不存在（跳过）：backend/app/modules/daemon/tests

#### 探针 2：设计关键词覆盖
能力关键词逐个 grep 实现确认（worktree）：
- `api_duration_ms`：sillyhub-daemon/src/types.ts:112（契约）、src/interactive/claude-events.ts（pendingUsage 搭车）、src/interactive/codex-app-server-driver.ts（_usageDelta）、src/interactive/pi-rpc-driver.ts（turnUsage 搭车）✅
- `duration_api_ms`：backend submit_commit.py（仅增不减写回）、publish.py（tokens/summary 增键）、frontend session-sse.ts（envelope）✅
- `generatingSince` / `turnApiDurationMs`：codex driver + pi driver（窗口状态）✅
- `callStartMs`：claude-events.ts PartialBucket（锚点）✅
- 前端门控：frontend/src/components/daemon/turn-speed.ts turnTokenSpeedText（双值即显示）✅

#### 探针 3：验收标准测试覆盖
- ✅ task-01: 模块目录（sillyhub-daemon/src、sillyhub-daemon/src/interactive、sillyhub-daemon/tests/interactive）找到 11 个测试文件（sillyhub-daemon/src/spec-sync.ts、sillyhub-daemon/tests/interactive/claude-driver-close-contract.test.ts、sillyhub-daemon/tests/interactive/claude-events.test.ts、sillyhub-daemon/tests/interactive/claude-sdk-driver-canuse.test.ts、sillyhub-daemon/tests/interactive/claude-sdk-driver-content-blocks.test.ts …）
- ✅ task-02: 模块目录（sillyhub-daemon/src/interactive、sillyhub-daemon/tests/interactive）找到 10 个测试文件（sillyhub-daemon/tests/interactive/claude-driver-close-contract.test.ts、sillyhub-daemon/tests/interactive/claude-events.test.ts、sillyhub-daemon/tests/interactive/claude-sdk-driver-canuse.test.ts、sillyhub-daemon/tests/interactive/claude-sdk-driver-content-blocks.test.ts、sillyhub-daemon/tests/interactive/claude-sdk-driver-glm-passthrough.test.ts …）
- ✅ task-03: 模块目录（sillyhub-daemon/src/interactive、sillyhub-daemon/tests/interactive）找到 10 个测试文件（sillyhub-daemon/tests/interactive/claude-driver-close-contract.test.ts、sillyhub-daemon/tests/interactive/claude-events.test.ts、sillyhub-daemon/tests/interactive/claude-sdk-driver-canuse.test.ts、sillyhub-daemon/tests/interactive/claude-sdk-driver-content-blocks.test.ts、sillyhub-daemon/tests/interactive/claude-sdk-driver-glm-passthrough.test.ts …）
- ✅ task-04: 模块目录（sillyhub-daemon/src/interactive、sillyhub-daemon/tests/interactive）找到 10 个测试文件（sillyhub-daemon/tests/interactive/claude-driver-close-contract.test.ts、sillyhub-daemon/tests/interactive/claude-events.test.ts、sillyhub-daemon/tests/interactive/claude-sdk-driver-canuse.test.ts、sillyhub-daemon/tests/interactive/claude-sdk-driver-content-blocks.test.ts、sillyhub-daemon/tests/interactive/claude-sdk-driver-glm-passthrough.test.ts …）
- ✅ task-05: 模块目录（backend/app/modules/daemon/run_sync/service、backend/app/modules/daemon/tests）找到 10 个测试文件（backend/app/modules/daemon/tests/test_advance_team_stage.py、backend/app/modules/daemon/tests/test_agent_session_tasks.py、backend/app/modules/daemon/tests/test_agent_task_status_payload.py、backend/app/modules/daemon/tests/test_allowed_roots_per_runtime.py、backend/app/modules/daemon/tests/test_allowed_roots_policy_push.py …）
- ✅ task-06: 模块目录（frontend/src/lib/daemon、frontend/src/components/daemon、frontend/src/components/daemon/session-panel、frontend/src/components/daemon/__tests__）找到 10 个测试文件（frontend/src/components/daemon/__tests__/activity-catalog.test.tsx、frontend/src/components/daemon/__tests__/agent-log-card.test.tsx、frontend/src/components/daemon/__tests__/agent-replay-body.test.tsx、frontend/src/components/daemon/__tests__/agent-task-card-lifecycle.test.tsx、frontend/src/components/daemon/__tests__/agent-task-card.test.tsx …）
- ℹ️ 集成盲区（路由/跨模块装配）与断言有效性抽查是语义判断，留给 agent 逐 task 标注 ⚠️

#### 探针 7：验收×测试覆盖矩阵
<!-- 口径注记：探针 3 = 模块目录递归存在性面（allowed_paths 目录附近有没有测试）；探针 7 = allowed_paths ∪ review changedFiles ∪ 直接下游卡测试 结构归属承接面（每条 acceptance 由哪些测试承接；下游消费卡的测试可承接上游 provider 的 acceptance——probe7-provider-tests-in-consumer-card）；两者并排冲突以 7 为准。判定枚举（五选一）：covered / covered-service / partial / uncovered / non-testable（covered-service 适用：端点行为由 service 层等非端点层测试锁定，证据附测试锚点；non-testable 是文档/部署类显式逃生门）。关键词命中只是提示，命中≠判定。 -->
<!-- 预填说明（ql-20260915-004）：判定列为 CLI 机械预填，agent 逐格复核改写——规则：无归属→uncovered（文档/部署/doc/deploy/manual/config 类词→non-testable）；有归属且命中≥1→covered；有归属零命中→partial。covered/covered-service/partial 证据须含测试锚点三形态之一（file:line / `.test.` 测试文件名 / 反引号包裹的路径或测试名），行号可省；uncovered/non-testable 证据自由形态。预填≠结论：与事实不符的格子必须改写（枚举须保持 covered/covered-service/partial/uncovered/non-testable 纯值，备注写在证据列）。 -->

**task-01**
| acceptance 条目 | 归属测试文件 | 关键词命中（提示，命中≠判定） | 判定 | 证据 |
|---|---|---|---|---|
| usage 含合法 api_duration_ms → usageToEventUsage 输出带同值键 | `sillyhub-daemon/tests/interactive/claude-events.test.ts`<br>`sillyhub-daemon/tests/interactive/codex-app-server-driver.test.ts`<br>`sillyhub-daemon/tests/interactive/pi-rpc-driver.test.ts`<br>`backend/app/modules/daemon/tests/test_run_sync_ctx_tokens.py`<br>`frontend/src/components/daemon/__tests__/turn-speed.test.ts`<br>`frontend/src/components/daemon/__tests__/turn-timeline-token-speed.test.tsx` | usage（`sillyhub-daemon/tests/interactive/claude-events.test.ts`、`sillyhub-daemon/tests/interactive/codex-app-server-driver.test.ts`、`sillyhub-daemon/tests/interactive/pi-rpc-driver.test.ts`、`backend/app/modules/daemon/tests/test_run_sync_ctx_tokens.py`） | covered | `sillyhub-daemon/tests/interactive/claude-events.test.ts:7`（usage） |
| usage 无该键 → 输出对象无该键（FR-04 场景：旧事件零影响） | `sillyhub-daemon/tests/interactive/claude-events.test.ts`<br>`sillyhub-daemon/tests/interactive/codex-app-server-driver.test.ts`<br>`sillyhub-daemon/tests/interactive/pi-rpc-driver.test.ts`<br>`backend/app/modules/daemon/tests/test_run_sync_ctx_tokens.py`<br>`frontend/src/components/daemon/__tests__/turn-speed.test.ts`<br>`frontend/src/components/daemon/__tests__/turn-timeline-token-speed.test.tsx` | usage、无该键、场景（`sillyhub-daemon/tests/interactive/claude-events.test.ts`、`sillyhub-daemon/tests/interactive/codex-app-server-driver.test.ts`、`sillyhub-daemon/tests/interactive/pi-rpc-driver.test.ts`、`backend/app/modules/daemon/tests/test_run_sync_ctx_tokens.py`） | covered | `sillyhub-daemon/tests/interactive/claude-events.test.ts:7`（usage）、`backend/app/modules/daemon/tests/test_run_sync_ctx_tokens.py:13`（无该键）、`sillyhub-daemon/tests/interactive/pi-rpc-driver.test.ts:1280`（场景） |
| schema safeParse 对带键/不带键 usage 均通过 | `sillyhub-daemon/tests/interactive/claude-events.test.ts`<br>`sillyhub-daemon/tests/interactive/codex-app-server-driver.test.ts`<br>`sillyhub-daemon/tests/interactive/pi-rpc-driver.test.ts`<br>`backend/app/modules/daemon/tests/test_run_sync_ctx_tokens.py`<br>`frontend/src/components/daemon/__tests__/turn-speed.test.ts`<br>`frontend/src/components/daemon/__tests__/turn-timeline-token-speed.test.tsx` | schema、safeParse、usage（`sillyhub-daemon/tests/interactive/claude-events.test.ts`、`sillyhub-daemon/tests/interactive/codex-app-server-driver.test.ts`、`sillyhub-daemon/tests/interactive/pi-rpc-driver.test.ts`、`backend/app/modules/daemon/tests/test_run_sync_ctx_tokens.py`） | covered | `sillyhub-daemon/tests/interactive/claude-events.test.ts:16`（schema）、`sillyhub-daemon/tests/interactive/claude-events.test.ts:16`（safeParse）、`sillyhub-daemon/tests/interactive/claude-events.test.ts:7`（usage） |

**task-02**
| acceptance 条目 | 归属测试文件 | 关键词命中（提示，命中≠判定） | 判定 | 证据 |
|---|---|---|---|---|
| 单调用 12.5s：flush usage.api_duration_ms ≈12500 量级、随 delta 单调增（FR-01 场景） | `sillyhub-daemon/tests/interactive/claude-events.test.ts` | flush、usage（`sillyhub-daemon/tests/interactive/claude-events.test.ts`） | covered | `sillyhub-daemon/tests/interactive/claude-events.test.ts:10`（flush）、`sillyhub-daemon/tests/interactive/claude-events.test.ts:7`（usage） |
| 两调用夹工具：累计=两生成窗口之和（锚间折叠天然排除工具时间） | `sillyhub-daemon/tests/interactive/claude-events.test.ts` | 累计（`sillyhub-daemon/tests/interactive/claude-events.test.ts`） | covered | `sillyhub-daemon/tests/interactive/claude-events.test.ts:380`（累计） |
| 折叠不出负值（时钟回拨钳 0） | `sillyhub-daemon/tests/interactive/claude-events.test.ts` | — | covered | 专属用例「时钟回拨：折叠钳 0 不出负值」（claude-events.test.ts，setSystemTime 回拨断言 200） |

**task-03**
| acceptance 条目 | 归属测试文件 | 关键词命中（提示，命中≠判定） | 判定 | 证据 |
|---|---|---|---|---|
| 两段生成夹 20s 工具：api_duration_ms = 两生成窗口之和 | `sillyhub-daemon/tests/interactive/codex-app-server-driver.test.ts` | 工具（`sillyhub-daemon/tests/interactive/codex-app-server-driver.test.ts`） | covered | `sillyhub-daemon/tests/interactive/codex-app-server-driver.test.ts:64`（工具） |
| 无锚 completed 不折叠；负值钳 0 | `sillyhub-daemon/tests/interactive/codex-app-server-driver.test.ts` | completed（`sillyhub-daemon/tests/interactive/codex-app-server-driver.test.ts`） | covered | `sillyhub-daemon/tests/interactive/codex-app-server-driver.test.ts:11`（completed） |
| turn 收尾残段折叠 | `sillyhub-daemon/tests/interactive/codex-app-server-driver.test.ts` | turn（`sillyhub-daemon/tests/interactive/codex-app-server-driver.test.ts`） | covered | `sillyhub-daemon/tests/interactive/codex-app-server-driver.test.ts:11`（turn） |

**task-04**
| acceptance 条目 | 归属测试文件 | 关键词命中（提示，命中≠判定） | 判定 | 证据 |
|---|---|---|---|---|
| 接入路径：两段 assistant message_end 的 api_duration_ms = 两生成窗口之和 | `sillyhub-daemon/tests/interactive/pi-rpc-driver.test.ts` | assistant、message_end（`sillyhub-daemon/tests/interactive/pi-rpc-driver.test.ts`） | covered | `sillyhub-daemon/tests/interactive/pi-rpc-driver.test.ts:249`（assistant）、`sillyhub-daemon/tests/interactive/pi-rpc-driver.test.ts:249`（message_end） |
| 降级路径：pi usage 事件不带 api_duration_ms 键（旧形态零变化），留档可查 | `sillyhub-daemon/tests/interactive/pi-rpc-driver.test.ts` | 降级路径、usage、事件不带（`sillyhub-daemon/tests/interactive/pi-rpc-driver.test.ts`） | covered | `sillyhub-daemon/tests/interactive/pi-rpc-driver.test.ts:34`（降级路径）、`sillyhub-daemon/tests/interactive/pi-rpc-driver.test.ts:30`（usage）、`sillyhub-daemon/tests/interactive/pi-rpc-driver.test.ts:269`（事件不带） |

**task-05**
| acceptance 条目 | 归属测试文件 | 关键词命中（提示，命中≠判定） | 判定 | 证据 |
|---|---|---|---|---|
| 先 12000 后 8000 → latest 保持 12000（FR-05 场景） | `backend/app/modules/daemon/tests/test_run_sync_ctx_tokens.py` | 保持（`backend/app/modules/daemon/tests/test_run_sync_ctx_tokens.py`） | covered | `backend/app/modules/daemon/tests/test_run_sync_ctx_tokens.py:274`（保持） |
| DB 现值 15000、新 submit 累计 8000 → 列保持 15000（仅增不减） | `backend/app/modules/daemon/tests/test_run_sync_ctx_tokens.py` | 现值、submit、列保持、仅增不减（`backend/app/modules/daemon/tests/test_run_sync_ctx_tokens.py`） | covered | `backend/app/modules/daemon/tests/test_run_sync_ctx_tokens.py:309`（现值）、`backend/app/modules/daemon/tests/test_run_sync_ctx_tokens.py:6`（submit）、`backend/app/modules/daemon/tests/test_run_sync_ctx_tokens.py:274`（列保持） |
| daemon 未上报 → tokens 事件无 duration_api_ms 键（FR-06 场景） | `backend/app/modules/daemon/tests/test_run_sync_ctx_tokens.py` | daemon、tokens（`backend/app/modules/daemon/tests/test_run_sync_ctx_tokens.py`） | covered | `backend/app/modules/daemon/tests/test_run_sync_ctx_tokens.py:7`（daemon）、`backend/app/modules/daemon/tests/test_run_sync_ctx_tokens.py:1`（tokens） |
| 非 None → tokens 事件带 duration_api_ms | `backend/app/modules/daemon/tests/test_run_sync_ctx_tokens.py` | None、tokens（`backend/app/modules/daemon/tests/test_run_sync_ctx_tokens.py`） | covered | `backend/app/modules/daemon/tests/test_run_sync_ctx_tokens.py:11`（None）、`backend/app/modules/daemon/tests/test_run_sync_ctx_tokens.py:1`（tokens） |

**task-06**
| acceptance 条目 | 归属测试文件 | 关键词命中（提示，命中≠判定） | 判定 | 证据 |
|---|---|---|---|---|
| running 轮 output=625、duration=12500 → 显示 · 50 tok/s（FR-07 场景 1） | `frontend/src/components/daemon/__tests__/turn-speed.test.ts`<br>`frontend/src/components/daemon/__tests__/turn-timeline-token-speed.test.tsx` | running、output、显示、tok（`frontend/src/components/daemon/__tests__/turn-speed.test.ts`、`frontend/src/components/daemon/__tests__/turn-timeline-token-speed.test.tsx`） | covered | `frontend/src/components/daemon/__tests__/turn-speed.test.ts:42`（running）、`frontend/src/components/daemon/__tests__/turn-speed.test.ts:50`（output）、`frontend/src/components/daemon/__tests__/turn-speed.test.ts:3`（显示） |
| running 轮 duration 缺失 → 只显示 token 计数（FR-07 场景 2） | `frontend/src/components/daemon/__tests__/turn-speed.test.ts`<br>`frontend/src/components/daemon/__tests__/turn-timeline-token-speed.test.tsx` | running、缺失、token（`frontend/src/components/daemon/__tests__/turn-speed.test.ts`、`frontend/src/components/daemon/__tests__/turn-timeline-token-speed.test.tsx`） | covered | `frontend/src/components/daemon/__tests__/turn-speed.test.ts:42`（running）、`frontend/src/components/daemon/__tests__/turn-speed.test.ts:50`（缺失）、`frontend/src/components/daemon/__tests__/turn-speed.test.ts:2`（token） |
| 终态行为与上变更完全一致 | `frontend/src/components/daemon/__tests__/turn-speed.test.ts`<br>`frontend/src/components/daemon/__tests__/turn-timeline-token-speed.test.tsx` | — | covered | turn-speed.test.ts「失败/中止轮数据齐同样显示」+ turn-timeline-token-speed.test.tsx 终态与缺数据用例 |

- ⚠️ 零/半自动化承接条目 2 条——这些路径无测试兜底，verify 复核必须**显式走查**（尤其编辑/更新链路与非主分支流：二次复核实证它们正是 P1 藏身处），走查结论登记进「代码审查」节

#### 探针 4：决策追踪覆盖
无 decisions.md（决策并入 design 风险与自审节；Grill P2 写回守卫裁决已落实为 submit_commit 仅增不减款并被跨批用例钉住）。

#### 探针 5：API Contract Parity
- ✅ API parity check passed: 1697 backend endpoints (live [scan-root 636 + worktree 636] + artifact 1272), 0 frontend calls [scope: change-diff (18 files @ worktree)] | 0 backend endpoints unused by frontend (+422 stock noise collapsed)
- ℹ️ 后端端点比对集为多根并集（主仓既有 ∪ worktree 新增 ∪ 存量 artifact），共扫 2 个根
- ⚠️ 0 个本变更端点前端未调用（warning 不阻断）：
- ℹ️ 另有 422 个存量端点未调用（他模块存量噪音，已折叠不逐条列出）

#### 探针 6：代码删除对账
- ✅ git diff 无整文件删除（D/R/C）记录
- ℹ️ 以 git 事实为准（真实 > 声明）；是否 FAIL blocker 由 agent 诚实判定

#### 探针 8：载荷字段契约对账（advisory）
- 不适用（清单无 Java/SQL 后端面，或 design.md 缺失）
#### 探针 9：守卫一致性（advisory）
- 不适用（清单无 .java 改动文件，或 design.md 缺失）
- ℹ️ 清单无 .java 文件（另有 19 个非 Java 清单文件不在探针 9 扫描面）
#### 探针 10：预填注清零（error 门）
<!-- 口径注记：预填注（来源注协议）在场 = 白名单槽未确认（预填≠结论）；删注 = 确认动作。本探针是门禁梯度 error 档——verify --done 时 gate 复跑同源检测，注未清零阻断完成（归档前清零兜底）。已知误报面：散文引用注字面量会命中（如文档描述注协议本身）——核对后真未确认则删注，纯散文则改写措辞，不得删探针段。 -->
- ✅ 预填注清零（7 个在检文件无未确认预填）
#### 探针 11：红线一致性（advisory）
- 不适用（仓未配置 .sillyspec/redlines.yaml——红线机检零打扰，D-002）
#### 探针 12：UI 视觉证据（分级门）
<!-- 口径注记：在场性检查非语义审计——只验 visual-evidence.md 存在非空与降级裁决留痕，不判对照结论对错（语义面归 verify-result 人工判断层）。证据应在执行时按 flow start「UI 变更执行须知」随手产生；本探针不要求收口现做。分级：缺证据默认 ⚠️（local.yaml ui_visual_gate=error 升阻断）；视觉降级无「用户裁决」留痕恒 ❌（off 豁免）。 -->
- ⚠️ 变更目录缺 visual-evidence.md（渲染对照证据应在执行时随手落盘——收口只验在场不产新证据）

## 接口验证覆盖矩阵 [层：人工判断——CLI 预填复核]
<!-- 口径注记（与探针 7 互指，R-07）：探针 7 = 验收项 × 测试承接面（每条 acceptance 由哪些测试承接）；本矩阵 = 接口端点 × 验证用例面（design 接口段每个端点由哪些验证用例/冒烟步骤覆盖）——两者并排互补，双矩阵并行存在。端点集来自 design.md 接口段 tolerant 解析（parseDesignApiTable：段头宽收 + 方法/路径双条件），预填≠结论，agent 逐行复核。判定枚举（五选一）：covered / covered-service / partial / uncovered / non-testable——covered-service 适用：端点行为由 service 层等非端点层测试锁定；证据须含测试文件锚点三形态之一（`.test.` / file:line / 反引号包裹的路径或测试名）。 -->
<!-- 预填说明：端点行由 CLI 机械预填，判定/用例依据 ID/结果/证据由 agent 逐格填写——用例依据 ID 锚点五形态（可复制样例）：design接口表#POST /api/xx（# 后必须 METHOD /path，仅表名/行号/散文描述不计命中）、权限矩阵[admin×读]、契约表@任务卡字段清单、DDL@users.id、载荷@e2e_body.json（须真实命中对应表/段，防空指）。 -->
<!-- 文法注释：子行 = 端点行下一行、两空格缩进、以「↳ <消费端>:」前缀书写（消费端细分承接面，不计矩阵行账）；探索行 = 判定 uncovered 且证据列含 [探索] 标记（探索性验证不算覆盖）。 -->
- 无接口面（检测到接口段标题「接口契约」但表格解析零端点）——矩阵只解析表格形态（每端点一行 METHOD | path），散文式接口定义不进矩阵。修复：接口定义改为表格（每端点一行 METHOD /path）或加声明行「本变更接口面：N 端点」，再重跑 `verify-probes --change <变更名> --init --force` 重生成本段（⚠️ 全骨架重生成，手填结论会重置——先备份）；判级 critical 的零面拦截归 validator

## 测试结果 [层：确定性检查——CLI 实测对账]
- CLI 实测（noAI 质量扫描，动态子集 7 文件）：exit 0（15.7s）——test-result.json 落 .runtime/verify-runs/20261010124404/
- CLI 实测 lint（ruff check+format+mypy / frontend lint / daemon typecheck）：exit 0（7.1s）
- 本会话手动批：daemon 3 文件 183/183、backend 2 文件 40/40、frontend 5 文件 38/38（worktree 内跑，日志 .runtime/logs/wave-test-*.log）
- known_failures 豁免：0 条命中

## 决策追踪矩阵

无 decisions.md（决策并入 design「风险与死路/自审」节；Grill P2 写回守卫裁决已落实为 submit_commit 仅增不减款并被跨批用例钉住——证据 backend/app/modules/daemon/tests/test_run_sync_ctx_tokens.py::test_cross_batch_monotonic_write_back）。

## 技术债务 [层：人工判断]
- 新增代码 TODO/FIXME/HACK：0（探针 1 ✅）
- 遗留（advisory）：① codex 时钟回拨专属反例用例缺（QA P3，守卫在场，移交项登记）；② cursor 引擎逐调用计时未接（design 显式边界，非债）；③ visual-evidence.md 未落（探针 12 ⚠️——本变更为轮尾文本级追加，渲染断言即证据，无布局/降级面）

## 变更风险等级 [层：人工判断]
unit-sufficient（design.md frontmatter 无 risk_level 显式声明——非显式声明路径；CLI 判级输入=文件路径×声明面，verify 门未报 evidence:true 命中）。理由：全部行为面由三侧单元/组件测试锁定（daemon 183 含时钟注入计时用例、backend 13、frontend 38），无 schema 迁移、无新端点、无部署面；运行时集成观察经移交项 manual-acceptance 显式登记（不作静默降级）。

## Runtime Evidence [层：人工判断]
不涉及（未启动长驻进程、未打真实端点请求；触发核心路径的证据=三侧测试与 CLI 实测回执，见测试结果节）。失败模式排除：旧 daemon 缺键→daemon/后端双层反例用例钉住不伪造不报错；cursor 未计时→前端 null 门控用例钉住只显示 token 计数。
<!-- 降级路径（design §3.2，D-004 收口）：服务起不来时：Controller 直调冒烟（mock 下游，验绑定+校验+路由）/ 基础设施恢复后复跑固化用例——不要空填不涉及 -->

## 代码审查 [层：人工判断]
总体：三层独立审查（brainstorm Grill / plan review / execute QA）全部双 pass 无 blocker；QA 实测复跑三侧全绿。问题列表：P3×1（codex 时钟回拨专属用例缺，移交项登记）。
零覆盖路径走查（探针 7 两处 partial 复核）：
- task-02「折叠不出负值」：实际有专属用例（claude-events.test.ts「时钟回拨：折叠钳 0 不出负值」，setSystemTime 回拨断言 200）——预填 partial 系关键词未命中，改判 covered；
- task-06「终态行为与上变更完全一致」：turn-speed.test.ts「失败/中止轮数据齐同样显示」+ turn-timeline-token-speed.test.tsx 终态/缺数据用例覆盖——改判 covered。
①编辑/更新链路：onTokens ?? 链不覆盖已收值（page/dialog 双处同守卫）有测试；②非主分支流：群聊影子流不经本链路（cursor 引擎 v1 不接，design 留档）；③守卫一致性：不适用（无新端点/权限面）；④载荷字段契约：探针 8 不适用（无 Java/SQL 面），SSE 键契约由 session-sse envelope 类型与 sync 测试钉住；⑤并发/原子性：跨轮回退由仅增不减写回用例钉住，桶并发由 max 累积口径（与 tokens 同构）覆盖。

## 独立复核（可选回流槽） [层：人工判断——复核后追加]
execute QA 独立子代理（review.json 于 .runtime/stage-reviews/execute-review-2026-10-10-203205/）：spec/quality 双 pass，findings 仅 P3×1（codex 回拨用例缺，已登记移交项）；无 P1/P2，结论枚举不受影响。
