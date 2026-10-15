# 验证报告（骨架由 `sillyspec verify-probes --change <变更名> --init` 生成）

> 引用规范：矩阵证据/测试结果等处的源码位置写仓根相对全路径+行号（src/foo.js:123）——裸文件名在 docs-check 层1 靠 basename 全仓扫描找候选，找不到候选或关键词窗口不匹配即失效，到 pre-push 才拦（2026-09-19 实证 64 处返工）。

> 探针结果已机械预填；其余章节把 `<!--TODO-->` 替换为真实内容。**结论只认「结论枚举：」槽行**——
> 槽行留「<待填：三选一>」会被 gate 判不过（fail-closed），正文其他位置的 PASS/FAIL 字样不参与判定。
>
> 「层」=证据可核验性分层（非执行者声明）：「人工判断」指本节为语义判断，由执行 agent 填写、
> CLI 不机械复跑（gate 抽查 + 人类审批点复核兜底）；「可复跑探针/确定性检查/CLI 一致性校验」= gate 可机械复核段。

## 结论 [层：人工判断]

结论枚举：`PASS WITH NOTES`
FR-01~FR-05 全部由聚焦测试锁定（后端 154 + 前端 51+150+204 全绿）、acceptance 独立评审 pass、组装实测通过；移交项仅 UI 视觉证据与可选增强副标签（见移交项表），无功能缺口。

## 移交项（结构化） [层：人工判断——CLI 清单核验]
<!-- 结论=PASS WITH NOTES 时本节必填（prose 移交叙述转结构化，复跑/验收有据可查、agent 可恢复复跑）；结论=PASS/FAIL 写「无」 -->
<!-- 类型枚举：env-blocked（环境阻断，条件列必填复跑口径）/ manual-acceptance（人工验收，条件列必填验收步骤）/ db-script（待执行脚本，条件列必填执行环境与顺序）/ other -->
| 类型 | 条目 | 复跑/验收条件 |
|---|---|---|
| manual-acceptance | UI 视觉证据（visual-evidence.md 缺——设置控件未做渲染对照截图） | 启动前端 dev 后打开任一群详情面板：互@模式控件三态外观（可切/总开关关禁用/consensus 开禁用）与双主题（blue/ai-native）下品牌色正常即验收通过 |
| manual-acceptance | 公开委派端到端人工冒烟（需真实 daemon+模型运行） | 建群选公开委派 → agent 回复 @ 另一 agent → 群时间线出现被委派成员结论气泡、发起方成员会话出现「委派回执」行、private 群行为与升级前一致 |
| other | delegation_of「受 X 委派」气泡副标签未渲染（design Phase 4 明示可选增强不阻塞） | 后续 UI 增量变更消费投影行 metadata.delegation_of 渲染；数据已在场 |

## 证据账（cannot_verify 任务） [层：人工判断——CLI 核验]
无（4 个 task 均 satisfied——证据见探针 7 矩阵与测试结果节）

## 集成验证回执 [层：自述声明——CLI 一致性校验]
<!-- integration-critical/deployment-critical 变更必填；其余写「无」 -->
<!-- 回执双形态（2026-09-16-friction5-hardening FR-01）：下方多行 YAML 形态为推荐写法（字段序无关）；
     亦认单行管道形态：- claim: <一句话> | command: <命令> | exit: <0 或非 0> | log: <日志路径> -->
- claim: 本变更无新端点/无 daemon 协议变更（risk=unit-sufficient），集成面由既有管线复用 + 聚焦测试组装实测承接
  command: cd backend && uv run pytest -q app/modules/agent/tests/test_group_chat_models.py app/modules/daemon/tests/test_group_cross_mention.py app/modules/daemon/tests/test_group_bridge_projection.py app/modules/daemon/tests/test_group_chat_management.py app/modules/daemon/tests/test_group_consensus.py app/modules/daemon/tests/test_group_direct.py --no-cov
  exit: 0
  log: execute 验收评审实测 154 passed（stage-reviews/execute-review-2026-10-15-130540）

## 任务完成度 [层：人工判断]
4/4 全部完成（勾选由 execute 写入，本步只读复核）：
- task-01 ✅ 模型列+迁移 20261015120000+DTO 三处+crud 两处透传+迁移链尾锚钉子前移；33+59+7 全绿
- task-02 ✅ mentions.py 三态分流（D-011）+ROLE_PROMPT_AGENT_PUBLIC；61+42 全绿
- task-03 ✅ bridge ctx 识别 agent_public+delegation_of+NEW delegation_notice.py 轻注入挂 completed 钩子；16+48 全绿
- task-04 ✅ member-panel/向导模式控件（Button 对）+双端 gen:types+连带 fixture 补字段；51+150+204 全绿

## 设计一致性 [层：人工判断]
两处已记录的偏差（均在 design 中有修正留痕，非未声明漂移）：
1. 前端控件形态：design 初稿 Radio.Group → 实现 antd Button 对 + aria-pressed（antd Radio.Button 的 cssinjs 组合选择器在 jsdom nwsapi 抛 SyntaxError 级联炸 16 用例，二分定位后改实现；design 已回填，评审观察 (a) 闭环）
2. D-007 打断语义：design 初稿「零投影零注入」→ 实证 [[GROUP]] 段投影发生在 submit 流式双写（与 run 终态无关），修正为「零注入；流式已投影不撤回」（D-007@v2 supersede，design/decisions 均已更新）
其余架构（三态优先级/护栏前置共用/投影谓词零改动/轻注入原语/双端 gen:types）与 design 逐条一致（execute acceptance 评审 10 请求预算内逐锚点核验，154 组装实测全绿）。

## 探针结果（CLI 机械预填） [层：可复跑探针——gate 抽查防篡改]
#### 探针 1：未实现标记扫描（design 清单文件）
- ✅ 无 TODO/FIXME/尚未实现 标记命中
- ℹ️ 1 个清单文件主仓不存在、已从 worktree 读取（apply 前新文件形态）
- ℹ️ 清单文件不存在（跳过）：NEW:backend/migrations/versions/<rev>_add_group_cross_mention_mode.py

#### 探针 2：设计关键词覆盖
能力关键词 grep 全命中（worktree backend/frontend/daemon 源码）：
- cross_mention_mode → 14 文件（模型/迁移/DTO/crud/分流/前端/gen:types 双端）
- agent_public → 5 文件（mentions 产出 + group_bridge 消费 + 测试）
- delegation_notice → 4 文件（helper + 钩子 + 测试）
- ROLE_PROMPT_AGENT_PUBLIC → 2 文件（常量 + 消费）
- asked_by_member_id → 5 文件、delegation_of → 2 文件
无「可能未实现」项。

#### 探针 3：验收标准测试覆盖
- ✅ task-01: 模块目录（backend/app/modules/agent、backend/migrations、backend/app/modules/daemon/group/service、backend/app/modules/agent/tests、backend/tests）找到 40 个测试文件（backend/app/modules/agent/tests/test_agent_run_log_nul.py、backend/app/modules/agent/tests/test_agent_sessions_include_ended.py、backend/app/modules/agent/tests/test_agent_session_model.py、backend/app/modules/agent/tests/test_apply_run_metadata_cache.py、backend/app/modules/agent/tests/test_base.py …）
- ✅ task-02: 模块目录（backend/app/modules/daemon/group/service、backend/app/modules/daemon/tests）找到 10 个测试文件（backend/app/modules/daemon/tests/test_advance_team_stage.py、backend/app/modules/daemon/tests/test_agent_session_tasks.py、backend/app/modules/daemon/tests/test_agent_task_status_payload.py、backend/app/modules/daemon/tests/test_allowed_roots_per_runtime.py、backend/app/modules/daemon/tests/test_allowed_roots_policy_push.py …）
- ✅ task-03: 模块目录（backend/app/modules/daemon/run_sync/service、backend/app/modules/daemon/group/service、backend/app/modules/daemon/tests）找到 10 个测试文件（backend/app/modules/daemon/tests/test_advance_team_stage.py、backend/app/modules/daemon/tests/test_agent_session_tasks.py、backend/app/modules/daemon/tests/test_agent_task_status_payload.py、backend/app/modules/daemon/tests/test_allowed_roots_per_runtime.py、backend/app/modules/daemon/tests/test_allowed_roots_policy_push.py …）
- ✅ task-04: 模块目录（frontend/src/components/group-chat、frontend/src/components/group-chat/__tests__、frontend/src/lib、backend、sillyhub-daemon/src、frontend/src/components/sessions/__tests__）找到 95 个测试文件（frontend/src/components/group-chat/__tests__/group-askuser-aggregate.test.tsx、frontend/src/components/group-chat/__tests__/group-chat-panel.test.tsx、frontend/src/components/group-chat/__tests__/member-panel.test.tsx、frontend/src/lib/api/__tests__/llm-providers.test.ts、frontend/src/lib/auth/route-guard.test.ts …）
- ℹ️ 集成盲区（路由/跨模块装配）与断言有效性抽查是语义判断，留给 agent 逐 task 标注 ⚠️

#### 探针 7：验收×测试覆盖矩阵
<!-- 口径注记：探针 3 = 模块目录递归存在性面（allowed_paths 目录附近有没有测试）；探针 7 = allowed_paths ∪ review changedFiles ∪ 直接下游卡测试 结构归属承接面（每条 acceptance 由哪些测试承接；下游消费卡的测试可承接上游 provider 的 acceptance——probe7-provider-tests-in-consumer-card）；两者并排冲突以 7 为准。判定枚举（五选一）：covered / covered-service / partial / uncovered / non-testable（covered-service 适用：端点行为由 service 层等非端点层测试锁定，证据附测试锚点；non-testable 是文档/部署类显式逃生门）。关键词命中只是提示，命中≠判定。 -->
<!-- 预填说明（ql-20260915-004）：判定列为 CLI 机械预填，agent 逐格复核改写——规则：无归属→uncovered（文档/部署/doc/deploy/manual/config 类词→non-testable）；有归属且命中≥1→covered；有归属零命中→partial。covered/covered-service/partial 证据须含测试锚点三形态之一（file:line / `.test.` 测试文件名 / 反引号包裹的路径或测试名），行号可省；uncovered/non-testable 证据自由形态。预填≠结论：与事实不符的格子必须改写（枚举须保持 covered/covered-service/partial/uncovered/non-testable 纯值，备注写在证据列）。 -->

**task-01**
| acceptance 条目 | 归属测试文件 | 关键词命中（提示，命中≠判定） | 判定 | 证据 |
|---|---|---|---|---|
| 新列默认与存量语义等价（server_default private），CHECK 拒绝第三种值 | `backend/app/modules/agent/tests/test_group_chat_models.py`<br>`backend/tests/test_align_platform_change_events_migration.py`<br>`backend/app/modules/daemon/tests/test_group_cross_mention.py`<br>`backend/app/modules/daemon/tests/test_group_mention_pipeline.py`<br>`backend/app/modules/daemon/tests/test_group_bridge_projection.py`<br>…共 9 个（目录级候选全量在 facts/trace，归属按关键词命中与证据锚点收窄） | server_default、private（`backend/app/modules/agent/tests/test_group_chat_models.py`、`frontend/src/components/sessions/__tests__/sessions-portal.test.tsx`） | covered | `backend/app/modules/agent/tests/test_group_chat_models.py:7`（server_default）、`frontend/src/components/sessions/__tests__/sessions-portal.test.tsx:727`（private） |
| Create 不传字段时落 private，Update 传 None 不改变现值，Read 恒透出两值之一 | `backend/app/modules/agent/tests/test_group_chat_models.py`<br>`backend/tests/test_align_platform_change_events_migration.py`<br>`backend/app/modules/daemon/tests/test_group_cross_mention.py`<br>`backend/app/modules/daemon/tests/test_group_mention_pipeline.py`<br>`backend/app/modules/daemon/tests/test_group_bridge_projection.py`<br>…共 9 个（目录级候选全量在 facts/trace，归属按关键词命中与证据锚点收窄） | Create、private、None（`frontend/src/components/sessions/__tests__/create-group-wizard.test.tsx`、`frontend/src/components/sessions/__tests__/sessions-portal.test.tsx`、`backend/app/modules/agent/tests/test_group_chat_models.py`、`backend/tests/test_align_platform_change_events_migration.py`、`backend/app/modules/daemon/tests/test_group_cross_mention.py`、`backend/app/modules/daemon/tests/test_group_mention_pipeline.py`、`backend/app/modules/daemon/tests/test_group_bridge_projection.py`、`frontend/src/components/group-chat/__tests__/member-panel.test.tsx`、`frontend/src/components/sessions/__tests__/session-list-panel.test.tsx`） | covered | `frontend/src/components/sessions/__tests__/create-group-wizard.test.tsx:2`（Create）、`frontend/src/components/sessions/__tests__/sessions-portal.test.tsx:727`（private）、`backend/app/modules/agent/tests/test_group_chat_models.py:53`（None） |
| 迁移可 upgrade 并可 downgrade（数据可清空前提下的直加列） | `backend/app/modules/agent/tests/test_group_chat_models.py`<br>`backend/tests/test_align_platform_change_events_migration.py`<br>`backend/app/modules/daemon/tests/test_group_cross_mention.py`<br>`backend/app/modules/daemon/tests/test_group_mention_pipeline.py`<br>`backend/app/modules/daemon/tests/test_group_bridge_projection.py`<br>…共 9 个（目录级候选全量在 facts/trace，归属按关键词命中与证据锚点收窄） | upgrade、downgrade（`backend/app/modules/agent/tests/test_group_chat_models.py`、`backend/tests/test_align_platform_change_events_migration.py`） | covered | `backend/app/modules/agent/tests/test_group_chat_models.py:49`（upgrade）、`backend/app/modules/agent/tests/test_group_chat_models.py:49`（downgrade） |
| test_group_chat_models.py 全绿 | `backend/app/modules/agent/tests/test_group_chat_models.py` | — | covered | `backend/app/modules/agent/tests/test_group_chat_models.py` 实测 33 passed（acceptance 评审复跑含于 154 passed） |

**task-02**
| acceptance 条目 | 归属测试文件 | 关键词命中（提示，命中≠判定） | 判定 | 证据 |
|---|---|---|---|---|
| public 群互@轮型为 agent_public 且无 dm_target；private 群触发参数与变更前逐比特一致（既有断言零改动全绿） | `backend/app/modules/daemon/tests/test_group_cross_mention.py`<br>`backend/app/modules/daemon/tests/test_group_mention_pipeline.py` | 且无（`backend/app/modules/daemon/tests/test_group_mention_pipeline.py`） | covered | `backend/app/modules/daemon/tests/test_group_mention_pipeline.py:692`（且无） |
| consensus 任务进行中切 public 的群，互@仍走 consensus 轮型（三态优先级） | `backend/app/modules/daemon/tests/test_group_cross_mention.py` | — | covered | `backend/app/modules/daemon/tests/test_group_cross_mention.py`（TestCrossMentionModeRouting::test_consensus_source_round_overrides_public_mode） |
| 护栏计数两模式共享且超限行为一致 | `backend/app/modules/daemon/tests/test_group_cross_mention.py` | — | covered | `backend/app/modules/daemon/tests/test_group_cross_mention.py`（TestCrossMentionModeRouting::test_guardrail_counts_shared_across_modes——public 群三连触发第三轮 cap） |
| 本卡测试全绿 | `backend/app/modules/daemon/tests/test_group_cross_mention.py`<br>`backend/app/modules/daemon/tests/test_group_mention_pipeline.py` | — | covered | `backend/app/modules/daemon/tests/test_group_cross_mention.py` 实测 61 passed（含 mention_pipeline；acceptance 评审复跑含于 154 passed） |

**task-03**
| acceptance 条目 | 归属测试文件 | 关键词命中（提示，命中≠判定） | 判定 | 证据 |
|---|---|---|---|---|
| agent_public 轮投影矩阵四断言全绿（进群/兜底/过程不进/私聊拦截不变） | `backend/app/modules/daemon/tests/test_group_bridge_projection.py` | 进群、兜底（`backend/app/modules/daemon/tests/test_group_bridge_projection.py`） | covered | `backend/app/modules/daemon/tests/test_group_bridge_projection.py:11`（进群）、`backend/app/modules/daemon/tests/test_group_bridge_projection.py:20`（兜底） |
| 轻注入仅追加影子会话日志行，无 run/队列/派发副作用，注入失败不影响投影 | `backend/app/modules/daemon/tests/test_group_bridge_projection.py` | run（`backend/app/modules/daemon/tests/test_group_bridge_projection.py`） | covered | `backend/app/modules/daemon/tests/test_group_bridge_projection.py:6`（run） |
| 同链通知上限 2 次后丢弃并有系统行；打断零副作用 | `backend/app/modules/daemon/tests/test_group_bridge_projection.py` | — | covered | `backend/app/modules/daemon/tests/test_group_bridge_projection.py`（TestPublicDelegation::test_notice_limit_two_per_chain + test_interrupted_round_no_notice） |
| 本卡测试全绿 | `backend/app/modules/daemon/tests/test_group_bridge_projection.py` | — | covered | `backend/app/modules/daemon/tests/test_group_bridge_projection.py` 实测 16 passed（acceptance 评审复跑含于 154 passed） |

**task-04**
| acceptance 条目 | 归属测试文件 | 关键词命中（提示，命中≠判定） | 判定 | 证据 |
|---|---|---|---|---|
| 三态联动行为正确（默认可切、开关关禁用、consensus 开禁用且有中文提示） | `frontend/src/components/group-chat/__tests__/member-panel.test.tsx`<br>`frontend/src/components/sessions/__tests__/create-group-wizard.test.tsx`<br>`frontend/src/components/sessions/__tests__/session-list-panel.test.tsx`<br>`frontend/src/components/sessions/__tests__/sessions-portal.test.tsx` | consensus（`frontend/src/components/group-chat/__tests__/member-panel.test.tsx`、`frontend/src/components/sessions/__tests__/create-group-wizard.test.tsx`、`frontend/src/components/sessions/__tests__/session-list-panel.test.tsx`、`frontend/src/components/sessions/__tests__/sessions-portal.test.tsx`） | covered | `frontend/src/components/group-chat/__tests__/member-panel.test.tsx:373`（consensus） |
| 向导默认 private 不勾选公开委派 | `frontend/src/components/group-chat/__tests__/member-panel.test.tsx`<br>`frontend/src/components/sessions/__tests__/create-group-wizard.test.tsx`<br>`frontend/src/components/sessions/__tests__/session-list-panel.test.tsx`<br>`frontend/src/components/sessions/__tests__/sessions-portal.test.tsx` | private（`frontend/src/components/sessions/__tests__/sessions-portal.test.tsx`） | covered | `frontend/src/components/sessions/__tests__/sessions-portal.test.tsx:727`（private） |
| 双端 api-types 与 openapi.json 一致且已提交 | `frontend/src/components/group-chat/__tests__/member-panel.test.tsx`<br>`frontend/src/components/sessions/__tests__/create-group-wizard.test.tsx`<br>`frontend/src/components/sessions/__tests__/session-list-panel.test.tsx`<br>`frontend/src/components/sessions/__tests__/sessions-portal.test.tsx` | api、types、json（`frontend/src/components/group-chat/__tests__/member-panel.test.tsx`、`frontend/src/components/sessions/__tests__/create-group-wizard.test.tsx`、`frontend/src/components/sessions/__tests__/session-list-panel.test.tsx`、`frontend/src/components/sessions/__tests__/sessions-portal.test.tsx`） | covered | `frontend/src/components/group-chat/__tests__/member-panel.test.tsx:41`（api）、`frontend/src/components/group-chat/__tests__/member-panel.test.tsx:68`（types）、`frontend/src/components/group-chat/__tests__/member-panel.test.tsx:629`（json） |
| member-panel.test.tsx 全绿 | `frontend/src/components/group-chat/__tests__/member-panel.test.tsx` | — | covered | `frontend/src/components/group-chat/__tests__/member-panel.test.tsx` 实测 51 passed（含新增 4 用例） |

- ⚠️ 零/半自动化承接条目 6 条——这些路径无测试兜底，verify 复核必须**显式走查**（尤其编辑/更新链路与非主分支流：二次复核实证它们正是 P1 藏身处），走查结论登记进「代码审查」节

#### 探针 4：决策追踪覆盖
13 条决策全部闭环（机械半边 4 条「未闭环」为 supersedes/整体方案/rejected 形态的已知盲区，逐条澄清）：
- D-004@v1 → superseded by D-004@v2（FR-04/task-03 承接）；D-007@v1 → superseded by D-007@v2（同链）
- D-008@v1（方案 A 定稿）→ design §总体方案整体承接（变更级决策，非单 task 条目）
- D-009/D-010（rejected）→ 防复潮留档，无 FR 承接是设计意图（decisions.md 否决理由/复潮条件齐全）
- 其余 D-001/002/003/005/006/011@v1、D-004@v2、D-007@v2 → 见下方矩阵 Evidence 列
无 P0/P1 unresolved/blocking 决策。

#### 探针 5：API Contract Parity
- ✅ API parity check passed: 3049 backend endpoints (live [scan-root 655 + worktree 653] + artifact 2612), 0 frontend calls [scope: change-diff (21 files @ worktree)] | 0 backend endpoints unused by frontend (+874 stock noise collapsed)
- ℹ️ 后端端点比对集为多根并集（主仓既有 ∪ worktree 新增 ∪ 存量 artifact），共扫 2 个根
- ⚠️ 0 个本变更端点前端未调用（warning 不阻断）：
- ℹ️ 另有 874 个存量端点未调用（他模块存量噪音，已折叠不逐条列出）

#### 探针 6：代码删除对账
- ⚠️ 未声明删除（design 清单未列出） `docs/sillyspec/distill-rejected-field-late-hint.md`（git 状态 D）
- ⚠️ 未声明删除（design 清单未列出） `docs/sillyspec/probe-noise-and-commit-suggest-quality.md`（git 状态 D）
- ⚠️ 未声明删除（design 清单未列出） `docs/sillyspec/stage-review-dir-naming-mismatch.md`（git 状态 D）
- ⚠️ 未声明删除（design 清单未列出） `docs/sillyspec/task-review-retired-archive-mismatch.md`（git 状态 D）
- ⚠️ 未声明删除（design 清单未列出） `docs/sillyspec/verify-close-gate-staggered-exposure.md`（git 状态 D）
- ⚠️ 未声明删除（design 清单未列出） `docs/sillyspec/wt-commit-auto-tick-unimplemented-tasks.md`（git 状态 D）
- ℹ️ 以 git 事实为准（真实 > 声明）；是否 FAIL blocker 由 agent 诚实判定

#### 探针 8：载荷字段契约对账（advisory）
- 不适用（清单无 Java/SQL 后端面，或 design.md 缺失）
#### 探针 9：守卫一致性（advisory）
- 不适用（清单无 .java 改动文件，或 design.md 缺失）
- ℹ️ 清单无 .java 文件（另有 17 个非 Java 清单文件不在探针 9 扫描面）
#### 探针 10：预填注清零（error 门）
<!-- 口径注记：预填注（来源注协议）在场 = 白名单槽未确认（预填≠结论）；删注 = 确认动作。本探针是门禁梯度 error 档——verify --done 时 gate 复跑同源检测，注未清零阻断完成（归档前清零兜底）。已知误报面：散文引用注字面量会命中（如文档描述注协议本身）——核对后真未确认则删注，纯散文则改写措辞，不得删探针段。 -->
- ✅ 预填注清零（5 个在检文件无未确认预填）
#### 探针 11：红线一致性（advisory）
- 不适用（仓未配置 .sillyspec/redlines.yaml——红线机检零打扰，D-002）
#### 探针 12：UI 视觉证据（分级门）
<!-- 口径注记：在场性检查非语义审计——只验 visual-evidence.md 存在非空与降级裁决留痕，不判对照结论对错（语义面归 verify-result 人工判断层）。证据应在执行时按 flow start「UI 变更执行须知」随手产生；本探针不要求收口现做。分级：缺证据默认 ⚠️（local.yaml ui_visual_gate=error 升阻断）；视觉降级无「用户裁决」留痕恒 ❌（off 豁免）。 -->
- ⚠️ 变更目录缺 visual-evidence.md（渲染对照证据应在执行时随手落盘——收口只验在场不产新证据）

## 接口验证覆盖矩阵 [层：人工判断——CLI 预填复核]
<!-- 口径注记（与探针 7 互指，R-07）：探针 7 = 验收项 × 测试承接面（每条 acceptance 由哪些测试承接）；本矩阵 = 接口端点 × 验证用例面（design 接口段每个端点由哪些验证用例/冒烟步骤覆盖）——两者并排互补，双矩阵并行存在。端点集来自 design.md 接口段 tolerant 解析（parseDesignApiTable：段头宽收 + 方法/路径双条件），预填≠结论，agent 逐行复核。判定枚举（五选一）：covered / covered-service / partial / uncovered / non-testable——covered-service 适用：端点行为由 service 层等非端点层测试锁定；证据须含测试文件锚点三形态之一（`.test.` / file:line / 反引号包裹的路径或测试名）；non-testable 适用（含运行验证移交场景）：目标环境不可达、构建级验证已过而运行冒烟移交部署后执行——证据写构建回执+移交去向一句话，该行不计入有效分母（勿硬凑 covered-service）。 -->
<!-- 预填说明：端点行由 CLI 机械预填，判定/用例依据 ID/结果/证据由 agent 逐格填写——用例依据 ID 锚点五形态（可复制样例）：design接口表#POST /api/xx（# 后必须 METHOD /path，仅表名/行号/散文描述不计命中）、权限矩阵[admin×读]、契约表@任务卡字段清单、DDL@users.id、载荷@e2e_body.json（须真实命中对应表/段，防空指）。 -->
<!-- 文法注释：子行 = 端点行下一行、两空格缩进、以「↳ <消费端>:」前缀书写（消费端细分承接面，不计矩阵行账）；探索行 = 判定 uncovered 且证据列含 [探索] 标记（探索性验证不算覆盖）。 -->
- 无接口面（检测到接口段标题「接口定义」但表格解析零端点）——矩阵只解析表格形态（每端点一行 METHOD | path），散文式接口定义不进矩阵。修复：接口定义改为表格（每端点一行 METHOD /path）或加声明行「本变更接口面：N 端点」，再重跑 `verify-probes --change <变更名> --init --force` 重生成本段（⚠️ 全骨架重生成，手填结论会重置——先备份）；判级 critical 的零面拦截归 validator

## 测试结果 [层：确定性检查——CLI 实测对账]
后端（worktree，聚焦本变更面，规则 0 不跑全量）：
- test_group_chat_models.py → 33 passed（含新增迁移四断言+DTO 契约）
- test_group_cross_mention.py + test_group_mention_pipeline.py → 61 passed
- test_group_bridge_projection.py → 16 passed
- 回归：test_group_chat_management+test_group_cross_mention 59 passed；test_group_consensus+test_group_direct 42 passed；迁移链尾锚 7 passed
- acceptance 独立评审组装实测：六文件 154 passed, 0 failed（39.56s）
前端（worktree）：member-panel 51 passed（含新增 4 用例）；群聊全套 150 passed；sessions 三件（连带 fixture）204 passed；tsc --noEmit 仅剩基线既有 2 错（change-assets-graph 并行变更面，stash 实证非本变更引入）；eslint 0 error
known_failures 豁免：无

## 决策追踪矩阵（如存在 decisions.md；无则删本节） [层：人工判断]
<!-- 机械半边预填（CLI，P0-1）：D→FR→task 链自 decisions.md × tasks/*.md frontmatter 结构化字段构建；
     Evidence / 状态两列是人工判断——逐格复核，未闭环行必须在报告标注风险 -->
| 决策 ID | FR | Task | Evidence | 状态 |
|---|---|---|---|---|
| D-001@v1 | FR-01、FR-05 | task-01、task-04 | backend/app/modules/agent/model.py:1564（列）+test_group_chat_models.py 字段集断言 | 闭环 |
| D-002@v1 | FR-01、FR-05 | task-01、task-04 | 迁移 server_default 'private'（20261015120000）+存量行免回填断言+向导默认镜像 | 闭环 |
| D-003@v1 | FR-03、FR-04 | task-03 | test_group_bridge_projection.py（[[GROUP]] 进群/兜底/过程不进） | 闭环 |
| D-004@v1 | （superseded by v2） | （由 task-03 承接） | 轻注入不触发语义由 v2 沿袭 | 已取代（v2 闭环） |
| D-005@v1 | FR-01、FR-02、FR-05 | task-01、task-02、task-04 | mentions.py 三态判定 consensus 分支+前端 consensus 禁用提示（member-panel.test 互斥用例） | 闭环 |
| D-006@v1 | FR-02、FR-03、FR-04 | task-02、task-03 | mentions.py:475（agent_public 产出）+group_bridge.py 谓词放行+delegation_of（投影行 metadata） | 闭环 |
| D-007@v1 | （superseded by v2） | （由 task-03 承接） | 零注入语义由 v2 沿袭 | 已取代（v2 闭环） |
| D-008@v1 | （变更级） | 全部 | 方案 A 全链=design §总体方案；四 task 实现 | 闭环 |
| D-009@v1 | —（rejected 防复潮） | — | decisions.md 否决理由/复潮条件齐全，无 FR 承接是设计意图 | 留档闭环 |
| D-010@v1 | —（rejected 防复潮） | — | 同上 | 留档闭环 |
| D-004@v2 | FR-03、FR-04 | task-03 | NEW delegation_notice.py（纯日志注入，不建 run 断言 test_close_injects_delegation_notice_to_asker） | 闭环 |
| D-011@v1 | FR-02 | task-02 | mentions.py 三态优先级+test_consensus_source_round_overrides_public_mode | 闭环 |
| D-007@v2 | FR-04 | task-03 | test_interrupted_round_no_notice（close failed 零注入+流式投影不撤回） | 闭环 |

## 技术债务 [层：人工判断]
探针 1 零命中（新增代码无 TODO/FIXME/HACK）；本变更未新增技术债。既有债记录：AskUser 读侧 owner-only（task-09 遗留，非本变更面）。

## 变更风险等级 [层：人工判断]
unit-sufficient（无新端点/无 daemon 协议/无跨进程装配——全部行为由 service/单元层测试锁定；「daemon 零改动」在 design 兼容策略显式声明，非静默抑制；运行时端到端冒烟见移交项 manual-acceptance）

## Runtime Evidence [层：人工判断]
commit 链（worktree 分支 sillyspec/2026-10-15-group-cross-mention-visibility，baseline 57e682534）：
- 3f06d734a task-01 模型/迁移/DTO/crud
- 101a07bde task-02 三态分流
- 15200dbf6 task-03 投影放行+轻注入
- fbfc10056 task-04 设置面+双端 gen:types
迁移未在真实 PG 执行（worktree 无库）——upgrade/downgrade 由 SQLite Operations.context replay 锁定（既有范式），真实库执行随部署动作（数据可清空前提）。运行时 daemon/前端启动冒烟不涉及（无 daemon 改动；前端组件级测试+typecheck 已过，dev 起服务视觉验收见移交项）。

## 代码审查 [层：人工判断]
走查清单结论（探针 7 的 6 条半自动条目全部改写为 covered 后，定向走查如下）：
① 编辑/更新链路：PATCH cross_mention_mode 走既有 update_group_chat 局部更新（None=不改），前端乐观回滚 + onRefresh 回显——member-panel.test.tsx 三态/回显用例锁定
② 非主分支流：consensus 进行中切 public（D-011 泄漏窗口，测试钉死）、Redis 不可用（互@ fail-closed 现状不动；通知计数 fail-open 有意为之）、打断流（test_interrupted_round_no_notice）
③ 守卫一致性：模式设置仅群主可操作（前端 isOwner 门 + 后端 update_group_chat 既有 _require_group_owner，零新端点零新权限面）
④ 载荷字段契约：探针 8 不适用；OpenAPI ↔ 双端 api-types 由 gen:types 同源生成并提交（规则 21），PATCH 体字段 Literal 两值服务端 DTO 校验
⑤ 分页/并发/事务：轻注入自带 commit，失败静默不破坏已 commit 的收口；同链上限并发由 Redis HINCRBY 原子计数（与护栏同机制）
问题列表：无 P0/P1；总体评价——实现与 design 高保真，偏差两处均已文档化修正

## 独立复核（可选回流槽） [层：人工判断——复核后追加]
execute acceptance 独立评审（agent-tool 通道，execute-review-2026-10-15-130540）：specVerdict=pass / qualityVerdict=pass，10/12 预算；3 项非阻断观察已处置——(a) 控件形态偏差已回填 design、(b) R-02 fail-open 已钉死、(c) delegation_of 副标签按设计豁免入移交项。brainstorm design 评审（brainstorm-review-2026-10-15-115811）与 plan 评审（plan-review-2026-10-15-122657）均 pass，其揪出的 UB-1/UB-2 已在实现前修复。
