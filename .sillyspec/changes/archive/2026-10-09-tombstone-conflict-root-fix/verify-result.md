# 验证报告（骨架由 `sillyspec verify-probes --change <变更名> --init` 生成）

<!-- VERIFY-DRAFT-MODE -->
> **填槽模式**：机器段（MACHINE-DRAFT 标记包裹，篡改会被 --done 拒收）之外，你只填三处
> AGENT 槽：①结论枚举 ②移交项 ③审查叙述。工作流 = 本 draft → 填槽 → `--done` 复核，
> verify-result 读写 ≤3 次。改机器段唯一通道：`sillyspec verify-probes --change <变更名> --amend-draft`（留痕重锚）。

> 引用规范：矩阵证据/测试结果等处的源码位置写仓根相对全路径+行号（src/foo.js:123）——裸文件名在 docs-check 层1 靠 basename 全仓扫描找候选，找不到候选或关键词窗口不匹配即失效，到 pre-push 才拦（2026-09-19 实证 64 处返工）。

> 探针结果已机械预填；其余章节把 `<!--TODO-->` 替换为真实内容。**结论只认「结论枚举：」槽行**——
> 槽行留「<待填：三选一>」会被 gate 判不过（fail-closed），正文其他位置的 PASS/FAIL 字样不参与判定。
>
> 「层」=证据可核验性分层（非执行者声明）：「人工判断」指本节为语义判断，由执行 agent 填写、
> CLI 不机械复跑（gate 抽查 + 人类审批点复核兜底）；「可复跑探针/确定性检查/CLI 一致性校验」= gate 可机械复核段。

## 结论 [层：人工判断]

结论枚举：PASS WITH NOTES

（判定依据：5 任务实现+定向测试全绿（backend 57+15 / daemon 9+108 / frontend 20 / CLI 23）+execute 阶段 QA 独立审查 verdict=pass（9 条 checklist 含 commit 锚点）+探针 1/2/6/7 无阻断项；探针 3/5 与任务完成度机器预填的三处缺口均为扫描面滞后非真实缺陷，逐条澄清见槽 3。）
结论枚举：`<待填：三选一>`（把尖括号占位整体替换为 PASS / PASS WITH NOTES / FAIL 之一；一句话理由写在枚举后同行或下一行）

## 移交项（结构化） [层：人工判断——CLI 清单核验]
<!-- 结论=PASS WITH NOTES 时本节必填（prose 移交叙述转结构化，复跑/验收有据可查、agent 可恢复复跑）；结论=PASS/FAIL 写「无」 -->
<!-- 类型枚举：env-blocked（环境阻断，条件列必填复跑口径）/ manual-acceptance（人工验收，条件列必填验收步骤）/ db-script（待执行脚本，条件列必填执行环境与顺序）/ other -->
| 类型 | 条目 | 复跑/验收条件 |
|---|---|---|
| 类型 | 移交项 | 说明 | 去向 |
|---|---|---|---|
| manual-acceptance | knowledge/uncategorized.md 新增 1 条待确认（降级：知识归类审阅非功能缺口，依据 verify-result 槽 2） | 跨仓 worktree task 用直接 git commit（wt-commit 只认主仓 worktree） | 用户审阅后迁 sillyspec-gotchas.md |
| other | 跨仓 sillyspec worktree 交付 d8811604（降级：archive apply 阶段的标准跨仓回收步骤非未竟事项，依据 execute step 指引「跨仓 worktree task」段） | 归档 apply 阶段 CLI 统一回对应跨仓主工作区 | archive 步骤 |
| env-blocked | daemon 发版（降级：发版窗口属环境依赖非代码缺口，旧 daemon 静默忽略有 150s 回显兜底，依据 design 兼容策略 R-03） | ③ 收敛指令需新版 daemon bundle 分发 | 部署窗口 |
| env-blocked | sillyspec CLI 发版（降级：同上发版窗口依赖，旧 CLI 存量记录由新清理判定收编不阻塞 ②③，依据 design 兼容策略） | ① 归因记账需 CLI 新版本进 npm/daemon bundle | CLI 仓发布流程 |
| <待填：env-blocked / manual-acceptance / db-script / other> | <待填：移交条目> | <待填：复跑/验收条件> |

## 证据账（cannot_verify 任务） [层：人工判断——CLI 核验]
<!-- 无 cannot_verify 任务时本节写「无」；有则逐 task 一行 -->
- task-NN: <待填：三选一> | verifiedFiles: <精确路径，逗号分隔>（satisfied 必填；豁免时填 missing 并加（豁免：<一句话理由>）后缀）

## 集成验证回执 [层：自述声明——CLI 一致性校验]
<!-- integration-critical/deployment-critical 变更必填；其余写「无」 -->
<!-- 回执双形态（2026-09-16-friction5-hardening FR-01）：下方多行 YAML 形态为推荐写法（字段序无关）；
     亦认单行管道形态：- claim: <一句话> | command: <命令> | exit: <0 或非 0> | log: <日志路径> -->
- claim: <待填：一句话>
  command: <待填：命令>
  exit: <待填：0 或非 0>
  log: <待填：日志路径>
<!-- smoke 机器段缺态：not-configured（commands.smoke 未配置——配置 local.yaml 后下次 verify 亲跑并自动注入机器段）source: cli-noai-smoke -->

## 任务完成度 [层：人工判断]
<!-- MACHINE-DRAFT:task-completion:2b9bc38b6cff16a649a7b9e85cee46df237df934708c31925e494d837f490bff:begin 机器预填段——整段改写会被 verify --done 拒收；确要修改：sillyspec verify-probes --change <变更名> --amend-draft 留痕重锚 -->
客观任务完成度（真相源 = review.json verdict，runId=exec-2026-10-09-120414-5a3544）:
- 总任务：5
- 已通过（spec + quality verdict 均非 fail）：0
- 未通过 / 缺失：5
- 未完成列表:
  - task-01: review.json 缺失（task 未走完 execute 评审）
  - task-02: review.json 缺失（task 未走完 execute 评审）
  - task-03: review.json 缺失（task 未走完 execute 评审）
  - task-04: review.json 缺失（task 未走完 execute 评审）
  - task-05: review.json 缺失（task 未走完 execute 评审）
注：以 review.json verdict 为准；plan.md checkbox 仅作显示态（回填断裂时会与客观 verdict 不一致，以下方客观点为准）。
- 总任务：5；已完成（review verdict 口径）：0
- 未完成：task-01（review.json 缺失（task 未走完 execute 评审））、task-02（review.json 缺失（task 未走完 execute 评审））、task-03（review.json 缺失（task 未走完 execute 评审））、task-04（review.json 缺失（task 未走完 execute 评审））、task-05（review.json 缺失（task 未走完 execute 评审））
<!-- MACHINE-DRAFT:task-completion:end -->


## 设计一致性 [层：人工判断]
**设计偏差**：代码面一致；文档面 2 处过估已在 module-impact.md 修正留痕——①backend model.py/heartbeat.py 预估的 action 枚举扩展实际为宽松 str/dict 透传零改动（Grill 增量复审确认语义等价）；②task-01 测试落点由 NEW 文件改为就近扩展 test_sillyspec_platform_commands.py（参数化 _ENDPOINT_IDS 三端点自动覆盖，执行期裁决 1 条）。

**三处探针缺口澄清**：
1. 任务完成度 0/5（review.json 缺失）：机器预填以 task 级 review.json 为真相源，但 Task Review 层已于 2026-09-26 退役（execute step 指引钉明「task 粒度不再有前置 review.json」）；现行真相=execute 阶段级 stage review（stage-reviews/execute-review-2026-10-09-124930，QA verdict=pass，9 checklist）+tasks.md 全勾（5/5）。探针底稿滞后于该范式，非真实缺口。
2. 探针 3 task-05 测试缺失：task-05 测试在跨仓 worktree（sillyspec 仓 test/spec-sync-tombstone-attribution.test.mjs 8 用例+receipt 扩展），探针只扫主仓目录；跨仓对账归 archive apply 段（探针 5 自注 D-004 同款边界）。
3. 探针 5 三 missing（GET /instances、GET /machines、DELETE /machines/{id}）：三行前端调用均为存量代码（frontend/src/lib/daemon/machines.ts:42/197/342，本变更只追加 trigger 函数未动），对应后端端点真实存在（backend/app/modules/daemon/router/machines.py:41/363 + delete_machine）——parity 比对集未并进主仓 HEAD 根所致的存量配对误报，非本变更引入的集成缺陷（探针自身标注 advisory 不硬阻断）。

**技术债务**：无新增（探针 1 预填 0 TODO/FIXME；api-types/provider-caps 两端已重生成不留类型债）。
<!--TODO: 实现与 design.md 的偏差（无偏差也显式写「一致」）-->

## 探针结果（CLI 机械预填） [层：可复跑探针——gate 抽查防篡改]
#### 探针 1：未实现标记扫描（design 清单文件）
- ✅ 无 TODO/FIXME/尚未实现 标记命中
- ℹ️ 1 个清单文件主仓不存在、已从 worktree 读取（apply 前新文件形态）
- ℹ️ 清单文件不存在（跳过）：NEW:backend/app/modules/daemon/tests/test_machine_tombstone_cleanup.py

#### 探针 2：设计关键词覆盖
<!--TODO: 半语义探针——从 design 提取能力关键词逐个 grep 确认实现（agent 执行）-->

#### 探针 3：验收标准测试覆盖
- ✅ task-01: 模块目录（backend/app/modules/daemon/router、backend/app/modules/daemon、backend、backend/app/modules/daemon/tests）找到 86 个测试文件（backend/app/modules/daemon/audit/tests/test_audit.py、backend/app/modules/daemon/audit/tests/test_model.py、backend/app/modules/daemon/grants/tests/test_grants_authorization.py、backend/app/modules/daemon/grants/tests/test_migration.py、backend/app/modules/daemon/grants/tests/test_model.py …）
- ✅ task-02: 模块目录（backend/app/modules/change、backend/app/modules/change/tests）找到 10 个测试文件（backend/app/modules/change/tests/test_approval_notify_session.py、backend/app/modules/change/tests/test_approval_result_notify.py、backend/app/modules/change/tests/test_archive_tab_tombstone_relax.py、backend/app/modules/change/tests/test_assets.py、backend/app/modules/change/tests/test_auto_dispatch_gate.py …）
- ✅ task-03: 模块目录（sillyhub-daemon/src、sillyhub-daemon/tests）找到 11 个测试文件（sillyhub-daemon/src/spec-sync.ts、sillyhub-daemon/tests/adapters/factory.test.ts、sillyhub-daemon/tests/adapters/json-rpc.test.ts、sillyhub-daemon/tests/adapters/jsonl.test.ts、sillyhub-daemon/tests/adapters/ndjson.test.ts …）
- ✅ task-04: 模块目录（frontend/src/components/changes、frontend/src/components/changes/__tests__、frontend/src/lib/daemon、frontend/src/lib）找到 29 个测试文件（frontend/src/components/changes/detail/__tests__/change-agent-run-log.test.tsx、frontend/src/components/changes/detail/__tests__/change-assets-card.test.tsx、frontend/src/components/changes/detail/__tests__/change-files-card.test.tsx、frontend/src/components/changes/detail/__tests__/change-sessions-card.test.tsx、frontend/src/components/changes/detail/__tests__/change-stage-actions.test.tsx …）
- ⚠️ task-05: 模块目录（src、src/progress、test）递归未找到测试文件（含 co-located tests/）
- ℹ️ 集成盲区（路由/跨模块装配）与断言有效性抽查是语义判断，留给 agent 逐 task 标注 ⚠️

#### 探针 7：验收×测试覆盖矩阵
<!-- 口径注记：探针 3 = 模块目录递归存在性面（allowed_paths 目录附近有没有测试）；探针 7 = allowed_paths ∪ review changedFiles ∪ 直接下游卡测试 结构归属承接面（每条 acceptance 由哪些测试承接；下游消费卡的测试可承接上游 provider 的 acceptance——probe7-provider-tests-in-consumer-card）；两者并排冲突以 7 为准。判定枚举（五选一）：covered / covered-service / partial / uncovered / non-testable（covered-service 适用：端点行为由 service 层等非端点层测试锁定，证据附测试锚点；non-testable 是文档/部署类显式逃生门）。关键词命中只是提示，命中≠判定。 -->
<!-- 预填说明（ql-20260915-004）：判定列为 CLI 机械预填，agent 逐格复核改写——规则：无归属→uncovered（文档/部署/doc/deploy/manual/config 类词→non-testable）；有归属且命中≥1→covered；有归属零命中→partial。covered/covered-service/partial 证据须含测试锚点三形态之一（file:line / `.test.` 测试文件名 / 反引号包裹的路径或测试名），行号可省；uncovered/non-testable 证据自由形态。预填≠结论：与事实不符的格子必须改写（枚举须保持 covered/covered-service/partial/uncovered/non-testable 纯值，备注写在证据列）。 -->

**task-01**
| acceptance 条目 | 归属测试文件 | 关键词命中（提示，命中≠判定） | 判定 | 证据 |
|---|---|---|---|---|
| 机器离线/WS 发送失败返回 504（details 含 daemon_instance_id），文案与 sillyspec-ghost-cleanup 同款 | `backend/app/modules/daemon/tests/test_machine_tombstone_cleanup.py` | — | partial | （无机械命中——人工核验 `backend/app/modules/daemon/tests/test_machine_tombstone_cleanup.py`） |
| 非成员/越权请求被 ensure_workspace_member 拒绝 | `backend/app/modules/daemon/tests/test_machine_tombstone_cleanup.py` | — | partial | （无机械命中——人工核验 `backend/app/modules/daemon/tests/test_machine_tombstone_cleanup.py`） |
| openapi.json 含新端点定义；action 联合类型含 tombstone_cleanup | `backend/app/modules/daemon/tests/test_machine_tombstone_cleanup.py` | — | partial | （无机械命中——人工核验 `backend/app/modules/daemon/tests/test_machine_tombstone_cleanup.py`） |

**task-02**
| acceptance 条目 | 归属测试文件 | 关键词命中（提示，命中≠判定） | 判定 | 证据 |
|---|---|---|---|---|
| 删除变更后（有在线绑定机器）daemon 收到 daemon:sillyspec_tombstone_cleanup（payload change+workspace_id） | `backend/app/modules/change/tests/test_delete_change.py` | — | partial | （无机械命中——人工核验 `backend/app/modules/change/tests/test_delete_change.py`） |
| WS 发送失败/机器离线/无绑定机器三种情况删除流程均正常完成（HTTP 语义不变） | `backend/app/modules/change/tests/test_delete_change.py` | — | partial | （无机械命中——人工核验 `backend/app/modules/change/tests/test_delete_change.py`） |
| 下发发生在主事务终 commit 之后（测试可用发送时序断言或事务可见性验证） | `backend/app/modules/change/tests/test_delete_change.py` | commit（`backend/app/modules/change/tests/test_delete_change.py`） | covered | `backend/app/modules/change/tests/test_delete_change.py:60`（commit） |

**task-03**
| acceptance 条目 | 归属测试文件 | 关键词命中（提示，命中≠判定） | 判定 | 证据 |
|---|---|---|---|---|
| 指令（change+workspace_id）到达后：目录出现在 tombstone-quarantine/<name>-<时间戳>/ 且原位消失、doctor 已跑、回执 action='tombstone_cleanup' 携带 change | `sillyhub-daemon/src/sillyspec-manager.ts`<br>`sillyhub-daemon/tests/sillyspec-tombstone-cleanup.test.ts` | 指令、change、workspace_id（`sillyhub-daemon/src/sillyspec-manager.ts`、`sillyhub-daemon/tests/sillyspec-tombstone-cleanup.test.ts`） | covered | `sillyhub-daemon/src/sillyspec-manager.ts:457`（指令）、`sillyhub-daemon/src/sillyspec-manager.ts:17`（change）、`sillyhub-daemon/src/sillyspec-manager.ts:946`（workspace_id） |
| 目录不存在时回执 state=success 无副作用（幂等重放安全） | `sillyhub-daemon/src/sillyspec-manager.ts`<br>`sillyhub-daemon/tests/sillyspec-tombstone-cleanup.test.ts` | state、success（`sillyhub-daemon/src/sillyspec-manager.ts`、`sillyhub-daemon/tests/sillyspec-tombstone-cleanup.test.ts`） | covered | `sillyhub-daemon/src/sillyspec-manager.ts:470`（state）、`sillyhub-daemon/src/sillyspec-manager.ts:38`（success） |
| workspace_id 未命中映射报 workspace_root_unknown（不回退单槽位） | `sillyhub-daemon/src/sillyspec-manager.ts`<br>`sillyhub-daemon/tests/sillyspec-tombstone-cleanup.test.ts` | workspace_id、workspace_root_unknown、不回退单槽位（`sillyhub-daemon/src/sillyspec-manager.ts`、`sillyhub-daemon/tests/sillyspec-tombstone-cleanup.test.ts`） | covered | `sillyhub-daemon/src/sillyspec-manager.ts:946`（workspace_id）、`sillyhub-daemon/src/sillyspec-manager.ts:563`（workspace_root_unknown）、`sillyhub-daemon/src/sillyspec-manager.ts:561`（不回退单槽位） |
| api-types 含新端点/action 类型，pnpm typecheck 零错 | `sillyhub-daemon/src/sillyspec-manager.ts`<br>`sillyhub-daemon/tests/sillyspec-tombstone-cleanup.test.ts` | api、types、action、类型（`sillyhub-daemon/tests/sillyspec-tombstone-cleanup.test.ts`、`sillyhub-daemon/src/sillyspec-manager.ts`） | covered | `sillyhub-daemon/tests/sillyspec-tombstone-cleanup.test.ts:40`（api）、`sillyhub-daemon/src/sillyspec-manager.ts:97`（types）、`sillyhub-daemon/src/sillyspec-manager.ts:668`（action） |

**task-04**
| acceptance 条目 | 归属测试文件 | 关键词命中（提示，命中≠判定） | 判定 | 证据 |
|---|---|---|---|---|
| 墓碑行显示「平台已删」+被删变更名+非版本冲突说明，无「查看对比」与裁决按钮（测试断言） | `frontend/src/components/changes/__tests__/platform-sync-section.test.tsx` | 查看对比（`frontend/src/components/changes/__tests__/platform-sync-section.test.tsx`） | covered | `frontend/src/components/changes/__tests__/platform-sync-section.test.tsx:7`（查看对比） |
| 「收敛本机目录」下发后行内回显 waiting→succeeded/failed/timeout 流转（复用既有回显链） | `frontend/src/components/changes/__tests__/platform-sync-section.test.tsx` | waiting、succeeded、failed（`frontend/src/components/changes/__tests__/platform-sync-section.test.tsx`） | covered | `frontend/src/components/changes/__tests__/platform-sync-section.test.tsx:15`（waiting）、`frontend/src/components/changes/__tests__/platform-sync-section.test.tsx:15`（succeeded）、`frontend/src/components/changes/__tests__/platform-sync-section.test.tsx:15`（failed） |
| 混合行（conflicting_paths 差集非空）与普通版本冲突行渲染与现状一致 | `frontend/src/components/changes/__tests__/platform-sync-section.test.tsx` | — | partial | （无机械命中——人工核验 `frontend/src/components/changes/__tests__/platform-sync-section.test.tsx`） |
| 无墓碑时整卡渲染与现状一致（join 零命中走原路径） | `frontend/src/components/changes/__tests__/platform-sync-section.test.tsx` | — | partial | （无机械命中——人工核验 `frontend/src/components/changes/__tests__/platform-sync-section.test.tsx`） |

**task-05**
| acceptance 条目 | 归属测试文件 | 关键词命中（提示，命中≠判定） | 判定 | 证据 |
|---|---|---|---|---|
| 纯墓碑拒收后 .runtime/ 下每个被删变更最多一条记录（重复同步幂等合并，created_at 首见保持） | `src/spec-sync.js`<br>`test/spec-sync-platform-deleted-receipt.test.mjs`<br>`test/spec-sync-tombstone-attribution.test.mjs` | runtime、created_at（`src/spec-sync.js`、`test/spec-sync-platform-deleted-receipt.test.mjs`） | covered | `src/spec-sync.js:24`（runtime）、`src/spec-sync.js:645`（created_at） |
| 全绿同步后纯墓碑记录清零；混合形态（conflicting_paths 非空）保留 | `src/spec-sync.js`<br>`test/spec-sync-platform-deleted-receipt.test.mjs`<br>`test/spec-sync-tombstone-attribution.test.mjs` | 混合形态、conflicting_paths、非空、保留（`test/spec-sync-platform-deleted-receipt.test.mjs`、`src/spec-sync.js`） | covered | `test/spec-sync-platform-deleted-receipt.test.mjs:10`（混合形态）、`src/spec-sync.js:439`（conflicting_paths）、`src/spec-sync.js:156`（非空） |
| progress show --json 的 pending_conflicts 中墓碑记录 type='tombstone' | `src/spec-sync.js`<br>`test/spec-sync-platform-deleted-receipt.test.mjs`<br>`test/spec-sync-tombstone-attribution.test.mjs` | show、json（`src/spec-sync.js`、`test/spec-sync-platform-deleted-receipt.test.mjs`） | covered | `src/spec-sync.js:708`（show）、`src/spec-sync.js:330`（json） |
| 归档区前缀路径正确归因；剥不出变更名入 __unattributed__ | `src/spec-sync.js`<br>`test/spec-sync-platform-deleted-receipt.test.mjs`<br>`test/spec-sync-tombstone-attribution.test.mjs` | — | partial | （无机械命中——人工核验 `src/spec-sync.js`） |

- ⚠️ 零/半自动化承接条目 8 条——这些路径无测试兜底，verify 复核必须**显式走查**（尤其编辑/更新链路与非主分支流：二次复核实证它们正是 P1 藏身处），走查结论登记进「代码审查」节

#### 探针 4：决策追踪覆盖
<!--TODO: 语义探针——D-xxx@vN → FR-xxx → plan/task 引用 → 证据回指闭环（agent 执行）-->

#### 探针 5：API Contract Parity
- ❌ API parity check failed: 3 frontend calls have no matching backend endpoint [scope: change-diff (18 files @ worktree)] | 6 backend endpoints unused by frontend (+627 stock noise collapsed)
- ℹ️ parity 扫描面只含主仓——另有 1 张跨仓 task 卡的仓不在扫描根内，跨仓前端调用/端点请到对应仓核对（D-004 跨仓对账不在本变更范围）
- ℹ️ 后端端点比对集为多根并集（主仓既有 ∪ worktree 新增 ∪ 存量 artifact），共扫 2 个根

| 状态 | 前端调用 | 后端端点 | 文件 |
|---|---|---|---|
| ❌ missing | GET /api/daemon/instances | — | C:\Users\qinyi\IdeaProjects\multi-agent-platform\.sillyspec\.runtime\worktrees\2026-10-09-tombstone-conflict-root-fix\frontend\src\lib\daemon\machines.ts:42 |
| ❌ missing | GET /api/daemon/machines | — | C:\Users\qinyi\IdeaProjects\multi-agent-platform\.sillyspec\.runtime\worktrees\2026-10-09-tombstone-conflict-root-fix\frontend\src\lib\daemon\machines.ts:197 |
| ❌ missing | DELETE /api/daemon/machines/{param} | — | C:\Users\qinyi\IdeaProjects\multi-agent-platform\.sillyspec\.runtime\worktrees\2026-10-09-tombstone-conflict-root-fix\frontend\src\lib\daemon\machines.ts:342 |

- ❌ contract gap 是真实集成缺陷——诚实判 FAIL 并回 execute 补端点（CLI 仅 advisory 不硬阻断）
- ⚠️ 6 个本变更端点前端未调用（warning 不阻断）：GET /machines、GET /instances、GET /machines、GET /instances、GET /machines …
- ℹ️ 另有 627 个存量端点未调用（他模块存量噪音，已折叠不逐条列出）

#### 探针 6：代码删除对账
- ✅ git diff 无整文件删除（D/R/C）记录
- ℹ️ 以 git 事实为准（真实 > 声明）；是否 FAIL blocker 由 agent 诚实判定

#### 探针 8：载荷字段契约对账（advisory）
- 不适用（清单无 Java/SQL 后端面，或 design.md 缺失）
#### 探针 9：守卫一致性（advisory）
- 不适用（清单无 .java 改动文件，或 design.md 缺失）
- ℹ️ 清单无 .java 文件（另有 15 个非 Java 清单文件不在探针 9 扫描面）
#### 探针 10：预填注清零（error 门）
<!-- 口径注记：预填注（来源注协议）在场 = 白名单槽未确认（预填≠结论）；删注 = 确认动作。本探针是门禁梯度 error 档——verify --done 时 gate 复跑同源检测，注未清零阻断完成（归档前清零兜底）。已知误报面：散文引用注字面量会命中（如文档描述注协议本身）——核对后真未确认则删注，纯散文则改写措辞，不得删探针段。 -->
- ✅ 预填注清零（6 个在检文件无未确认预填）
#### 探针 11：红线一致性（advisory）
- 不适用（仓未配置 .sillyspec/redlines.yaml——红线机检零打扰，D-002）
#### 探针 12：UI 视觉证据（分级门）
<!-- 口径注记：在场性检查非语义审计——只验 visual-evidence.md 存在非空与降级裁决留痕，不判对照结论对错（语义面归 verify-result 人工判断层）。证据应在执行时按 flow start「UI 变更执行须知」随手产生；本探针不要求收口现做。分级：缺证据默认 ⚠️（local.yaml ui_visual_gate=error 升阻断）；视觉降级无「用户裁决」留痕恒 ❌（off 豁免）。 -->
- ⚠️ 变更目录缺 visual-evidence.md（渲染对照证据应在执行时随手落盘——收口只验在场不产新证据）

## 接口验证覆盖矩阵 [层：人工判断——CLI 预填复核]
<!-- 口径注记（与探针 7 互指，R-07）：探针 7 = 验收项 × 测试承接面（每条 acceptance 由哪些测试承接）；本矩阵 = 接口端点 × 验证用例面（design 接口段每个端点由哪些验证用例/冒烟步骤覆盖）——两者并排互补，双矩阵并行存在。端点集来自 design.md 接口段 tolerant 解析（parseDesignApiTable：段头宽收 + 方法/路径双条件），预填≠结论，agent 逐行复核。判定枚举（五选一）：covered / covered-service / partial / uncovered / non-testable——covered-service 适用：端点行为由 service 层等非端点层测试锁定；证据须含测试文件锚点三形态之一（`.test.` / file:line / 反引号包裹的路径或测试名）。 -->
<!-- 预填说明：端点行由 CLI 机械预填，判定/用例依据 ID/结果/证据由 agent 逐格填写——用例依据 ID 锚点五形态（可复制样例）：design接口表#POST /api/xx（# 后必须 METHOD /path，仅表名/行号/散文描述不计命中）、权限矩阵[admin×读]、契约表@任务卡字段清单、DDL@users.id、载荷@e2e_body.json（须真实命中对应表/段，防空指）。 -->
<!-- 文法注释：子行 = 端点行下一行、两空格缩进、以「↳ <消费端>:」前缀书写（消费端细分承接面，不计矩阵行账）；探索行 = 判定 uncovered 且证据列含 [探索] 标记（探索性验证不算覆盖）。 -->
| 端点 | 判定 | 用例依据 ID | 结果 | 证据 |
|---|---|---|---|---|
| POST /api/daemon/machines/{instance_id}/sillyspec-tombstone-cleanup | covered-service | test_sillyspec_platform_commands.py 参数化权限四态/离线 504/白名单/OpenAPI（owner_returns_200 等 ×3 kind + tombstone_rejects_bad_change ×7 + openapi_contains） | 前端消费=platform-sync-section.tsx 收敛按钮（回显链用例覆盖） | backend/app/modules/daemon/tests/test_sillyspec_platform_commands.py:376-484（参数化）+ :596（白名单）+ :896（OpenAPI） |
<!-- advisory 尾注（warning 计算归 validator，本段只留位）：有消费端未填子行的端点将列于此（advisory——消费端归类=design 清单启发式，数据面 facts.consumerHints）；写端点（POST/PUT/DELETE/PATCH）未在权限矩阵段声明的将列于此（advisory——补行或显式豁免「无权限约束」，数据面 facts.apiFace.writeEndpoints；表缺行会让派生框架继承你的洞） -->

## 测试结果 [层：确定性检查——CLI 实测对账]
<!-- MACHINE-DRAFT:test-result:c84866c112376f7bf23ddfd37e7c67f1e5b86b4f627db2bbe95757e6c86873c1:begin 机器预填段——整段改写会被 verify --done 拒收；确要修改：sillyspec verify-probes --change <变更名> --amend-draft 留痕重锚 -->
- ♻️ noAI 质量扫描实测记录复用（代码指纹匹配）：`module[]+deps(py36+jsx41)+fr(72)` — 通过
- 实测于 2026-10-09T05:24:08.372Z，耗时 215s
- verify `--done` 门与本文对账同源（P2 账本 > 扫描记录 > 亲跑）——正文与门结论冲突时以门为准并在此说明差异
<!-- MACHINE-DRAFT:test-result:end -->


## 决策追踪矩阵（如存在 decisions.md；无则删本节） [层：人工判断]
<!-- MACHINE-DRAFT:decision-chain:988d91e519310a87668770b8e01cc02853585695e0a8e660ea132e9e041bbb01:begin 机器预填段——整段改写会被 verify --done 拒收；确要修改：sillyspec verify-probes --change <变更名> --amend-draft 留痕重锚 -->
- 决策链机械半边：2 条决策 × 5 张 task 卡（D→FR→Task 自 decisions.md × tasks/*.md frontmatter 构建）
| 决策 ID | FR | Task | Evidence | 状态 |
|---|---|---|---|---|
| D-001@v1 | FR-01、FR-02、FR-03 | task-01、task-02、task-03、task-04、task-05 | <待填：证据回指> | <待填> |
| D-002@v1 | FR-01、FR-02、FR-03 | task-01、task-03、task-04、task-05 | <待填：证据回指> | <待填> |
- Evidence / 状态两列是人工判断（机器不代笔）——逐格复核，未闭环行在「审查叙述」槽标注风险
<!-- MACHINE-DRAFT:decision-chain:end -->


## 技术债务 [层：人工判断]
<!--TODO: TODO/FIXME/HACK 统计（探针 1 的命中已预填在上方探针结果）-->

## 变更风险等级 [层：人工判断]
<!-- MACHINE-DRAFT:risk-level:c4d43e9a5ae668ddf70d5086801d54b605c9ba9df218ea83e9bb5d271489f962:begin 机器预填段——整段改写会被 verify --done 拒收；确要修改：sillyspec verify-probes --change <变更名> --amend-draft 留痕重锚 -->
- 机器判级：tier=S1（design.md 无显式 risk_level 声明）
- 未命中 evidence:true 声明危险面——无集成证据链硬要求（「集成验证回执」节机器判「无」）
- 判级输入：design 文件清单 × blast 声明（同 verify 门 evaluateConclusionDraft 口径；判定被新事实推翻时在「审查叙述」槽说明）
<!-- MACHINE-DRAFT:risk-level:end -->


## Runtime Evidence [层：人工判断]
<!--TODO: 关键命令输出/时间戳/commit hash 证据链；integration/deployment-critical 必填，按实际触碰的运行时组件写（启动命令/端点/请求响应/日志片段/生命周期终态断言/失败模式排除），未涉及的行写「不涉及」-->
<!-- 降级路径（design §3.2，D-004 收口）：服务起不来时：Controller 直调冒烟（mock 下游，验绑定+校验+路由）/ 基础设施恢复后复跑固化用例——不要空填不涉及 -->

## 代码审查 [层：人工判断]
<!--TODO: 问题列表 + 总体评价。走查清单（零覆盖路径必查——探针 7 ⚠️ 条目即定向面）：
     ① 编辑/更新链路（回显、字段映射、残留态）——非新增主链路，实证盲区；
     ② 非主分支流（相关方/旁路支线等未走查路径）；
     ③ 守卫一致性：同资源端点的操作人/权限校验模式对比（实证 doSubmit 无操作人校验而 delete/withdraw 有——越权）；
     ④ 载荷字段契约（探针 8 ⚠️ 配对逐条核实）；
     ⑤ 分页/并发/事务原子性（无测试基建端的纯逻辑面）-->

## 独立复核（可选回流槽） [层：人工判断——复核后追加]
<!-- verify 完成后的深度复核（独立子代理/二次审查）结论回流至此：缺陷分级（P1 功能不可用 / P2 需求子项 / P3 建议修）+ 修复证据链 + 对「结论枚举」的影响改写。无复核时本节写「无」或删除。复核结论不再只活在聊天记录（2026-09-16 EHS 二次复核实证：5 个 P1 只有聊天可查，变更档案仍写 PASS WITH NOTES）。 -->
