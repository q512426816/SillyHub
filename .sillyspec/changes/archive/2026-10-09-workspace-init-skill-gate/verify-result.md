# 验证报告（骨架由 `sillyspec verify-probes --change <变更名> --init` 生成）

> 引用规范：矩阵证据/测试结果等处的源码位置写仓根相对全路径+行号（src/foo.js:123）——裸文件名在 docs-check 层1 靠 basename 全仓扫描找候选，找不到候选或关键词窗口不匹配即失效，到 pre-push 才拦（2026-09-19 实证 64 处返工）。

> 探针结果已机械预填；其余章节把 `<!--TODO-->` 替换为真实内容。**结论只认「结论枚举：」槽行**——
> 槽行留「<待填：三选一>」会被 gate 判不过（fail-closed），正文其他位置的 PASS/FAIL 字样不参与判定。
>
> 「层」=证据可核验性分层（非执行者声明）：「人工判断」指本节为语义判断，由执行 agent 填写、
> CLI 不机械复跑（gate 抽查 + 人类审批点复核兜底）；「可复跑探针/确定性检查/CLI 一致性校验」= gate 可机械复核段。

## 结论 [层：人工判断]

结论枚举：PASS WITH NOTES（机械事实全绿；探针 7 有 5 条机械判定 partial 系关键词未命中所致，已人工复核为实际覆盖并改写判定列——按 gate 协议以移交项承载该复核说明；execute 阶段独立 QA acceptance review 双 pass）

## 移交项（结构化） [层：人工判断——CLI 清单核验]
<!-- 结论=PASS WITH NOTES 时本节必填（prose 移交叙述转结构化，复跑/验收有据可查、agent 可恢复复跑）；结论=PASS/FAIL 写「无」 -->
<!-- 类型枚举：env-blocked（环境阻断，条件列必填复跑口径）/ manual-acceptance（人工验收，条件列必填验收步骤）/ db-script（待执行脚本，条件列必填执行环境与顺序）/ other -->
| 类型 | 条目 | 复跑/验收条件 |
|---|---|---|
| manual-acceptance | 探针 7 机械判定 partial 的 5 条 acceptance（task-03×2 / task-04×2 / task-05×1）经人工逐条复核均为实际覆盖，判定列已改写 covered×4 + non-testable×1 | 复跑口径：`sillyhub-daemon` 跑 `pnpm vitest run tests/run-sillyspec-init.test.ts tests/sillyspec-tool-mapping.test.ts`；`backend` 跑 `uv run pytest app/modules/daemon/lease/tests/test_init_claim_tokens.py -q --no-cov`；`frontend` 跑 `pnpm vitest run src/components/__tests__/workspace-scan-dialog.test.tsx src/components/workspace-config-card.test.tsx`（三端全绿即复核成立） |

## 证据账（cannot_verify 任务） [层：人工判断——CLI 核验]
<!-- 无 cannot_verify 任务时本节写「无」；有则逐 task 一行 -->
无（execute 无 cannot_verify 任务——verify-required-evidence.json 不存在，Task Review 2026-09-26 退役停写）

## 集成验证回执 [层：自述声明——CLI 一致性校验]
<!-- integration-critical/deployment-critical 变更必填；其余写「无」 -->
<!-- 回执双形态（2026-09-16-friction5-hardening FR-01）：下方多行 YAML 形态为推荐写法（字段序无关）；
     亦认单行管道形态：- claim: <一句话> | command: <命令> | exit: <0 或非 0> | log: <日志路径> -->
无（风险等级 unit-sufficient，非 integration/deployment-critical）
<!-- smoke 机器段缺态：not-configured（commands.smoke 未配置——配置 local.yaml 后下次 verify 亲跑并自动注入机器段）source: cli-noai-smoke -->

## 任务完成度 [层：人工判断]
- task-01 ✅ 已完成：spec-sync.ts argv 无 --no-skills + 门控 3.32.2（c405bb6d）；11 测试绿
- task-02 ✅ 已完成：SILLYSPEC_VALID_TOOLS 7 值含 zcode（cb23d7b9）；5 映射测试绿
- task-03 ✅ 已完成：complete_lease init 回写成败门（5797a5d4）；对照用例绿（daemon 域 2450 绿）
- task-04 ✅ 已完成：创建弹窗两步状态机（275de770 + e3a77a5c 修补）；9 测试绿
- task-05 ✅ 已完成：未初始化引导 Alert（05968956）；35 测试绿零回归
- 完成率 5/5 = 100%（勾选=实现+测试绿+wt-commit 三证齐）

## 设计一致性 [层：人工判断]
与 design.md 一致（execute 独立 QA 逐 FR 核验双 pass，review-2026-10-09-110149）。记录 4 项轻微偏差：
1. scan-dialog daemonId 注释自称「防御性再判」但代码无再判（入口守卫已保证，行为等价）→ 已修（e3a77a5c）
2. 测试正则含 typo 冗余分支 → 已修（e3a77a5c）
3. notify.success 合并进初始化完成时机（原为创建即通知）→ 合理保留：两步流程下成功语义以初始化完成为准
4. 引导 Alert 拆 message/description 两段 → 合理保留：antd Alert 层级更清晰，两个关键短语齐全（测试断言锚定）

## 探针结果（CLI 机械预填） [层：可复跑探针——gate 抽查防篡改]
#### 探针 1：未实现标记扫描（design 清单文件）
- ✅ 无 TODO/FIXME/尚未实现 标记命中
- ℹ️ 1 个清单文件主仓不存在、已从 worktree 读取（apply 前新文件形态）

#### 探针 2：设计关键词覆盖
设计关键词逐项核验（agent 执行）：
- --no-skills 移除：spec-sync.ts spawn argv 已无该 flag ✅
- 3.32.2：MIN_SILLYSPEC_VERSION_FOR_INIT = 3.32.2（spec-sync.ts 常量）✅
- zcode：SILLYSPEC_VALID_TOOLS 7 值含 zcode（runner-types.ts）✅
- 成败门：lease/service.py init 回写段 result.get("status") == "failed" 分支 ✅
- 2s 轮询/5min 超时：INIT_POLL_INTERVAL_MS=2000 / INIT_POLL_TIMEOUT_MS=300000（workspace-scan-dialog.tsx）✅
- 每台机器需要单独初始化：config-card Alert description ✅
- 五端工具目录（.claude/.codex/.openclaw/.opencode/.zcode 的 skills/）：由 sillyspec CLI init 复制段承接（daemon 只传 --tool）ℹ️ 依赖 CLI v3.32.2（门控已锁）

#### 探针 3：验收标准测试覆盖
- ✅ task-01: 模块目录（sillyhub-daemon/src、sillyhub-daemon/tests）找到 11 个测试文件（sillyhub-daemon/src/spec-sync.ts、sillyhub-daemon/tests/adapters/factory.test.ts、sillyhub-daemon/tests/adapters/json-rpc.test.ts、sillyhub-daemon/tests/adapters/jsonl.test.ts、sillyhub-daemon/tests/adapters/ndjson.test.ts …）
- ✅ task-02: 模块目录（sillyhub-daemon/src/task-runner、sillyhub-daemon/tests）找到 10 个测试文件（sillyhub-daemon/tests/adapters/factory.test.ts、sillyhub-daemon/tests/adapters/json-rpc.test.ts、sillyhub-daemon/tests/adapters/jsonl.test.ts、sillyhub-daemon/tests/adapters/ndjson.test.ts、sillyhub-daemon/tests/adapters/pi-json.test.ts …）
- ✅ task-03: 模块目录（backend/app/modules/daemon/lease、backend/app/modules/daemon/lease/tests）找到 1 个测试文件（backend/app/modules/daemon/lease/tests/test_init_claim_tokens.py）
- ✅ task-04: 模块目录（frontend/src/components、frontend/src/components/__tests__）找到 20 个测试文件（frontend/src/components/agent/borrowed-solution-files-panel.test.tsx、frontend/src/components/agent/borrowed-solution-files.test.tsx、frontend/src/components/agent/__tests__/borrow-trigger-contract.test.ts、frontend/src/components/agent-log/__tests__/normalize-dual-path.test.ts、frontend/src/components/agent-log/__tests__/normalize.test.ts …）
- ✅ task-05: 模块目录（frontend/src/components）找到 10 个测试文件（frontend/src/components/agent/borrowed-solution-files-panel.test.tsx、frontend/src/components/agent/borrowed-solution-files.test.tsx、frontend/src/components/agent/__tests__/borrow-trigger-contract.test.ts、frontend/src/components/agent-log/__tests__/normalize-dual-path.test.ts、frontend/src/components/agent-log/__tests__/normalize.test.ts …）
- ℹ️ 集成盲区（路由/跨模块装配）与断言有效性抽查是语义判断，留给 agent 逐 task 标注 ⚠️

#### 探针 7：验收×测试覆盖矩阵
<!-- 口径注记：探针 3 = 模块目录递归存在性面（allowed_paths 目录附近有没有测试）；探针 7 = allowed_paths ∪ review changedFiles ∪ 直接下游卡测试 结构归属承接面（每条 acceptance 由哪些测试承接；下游消费卡的测试可承接上游 provider 的 acceptance——probe7-provider-tests-in-consumer-card）；两者并排冲突以 7 为准。判定枚举（五选一）：covered / covered-service / partial / uncovered / non-testable（covered-service 适用：端点行为由 service 层等非端点层测试锁定，证据附测试锚点；non-testable 是文档/部署类显式逃生门）。关键词命中只是提示，命中≠判定。 -->
<!-- 预填说明（ql-20260915-004）：判定列为 CLI 机械预填，agent 逐格复核改写——规则：无归属→uncovered（文档/部署/doc/deploy/manual/config 类词→non-testable）；有归属且命中≥1→covered；有归属零命中→partial。covered/covered-service/partial 证据须含测试锚点三形态之一（file:line / `.test.` 测试文件名 / 反引号包裹的路径或测试名），行号可省；uncovered/non-testable 证据自由形态。预填≠结论：与事实不符的格子必须改写（枚举须保持 covered/covered-service/partial/uncovered/non-testable 纯值，备注写在证据列）。 -->

**task-01**
| acceptance 条目 | 归属测试文件 | 关键词命中（提示，命中≠判定） | 判定 | 证据 |
|---|---|---|---|---|
| spawn argv 不再含 --no-skills（run-sillyspec-init.test.ts 断言反转通过） | `sillyhub-daemon/src/spec-sync.ts`<br>`sillyhub-daemon/tests/run-sillyspec-init.test.ts` | spawn、skills、run（`sillyhub-daemon/src/spec-sync.ts`、`sillyhub-daemon/tests/run-sillyspec-init.test.ts`） | covered | `sillyhub-daemon/src/spec-sync.ts:22`（spawn）、`sillyhub-daemon/src/spec-sync.ts:1657`（skills）、`sillyhub-daemon/src/spec-sync.ts:4`（run） |
| MIN_SILLYSPEC_VERSION_FOR_INIT === '3.32.2' 且 3.26.8 被 compareSemver 判旧拒绝 | `sillyhub-daemon/src/spec-sync.ts`<br>`sillyhub-daemon/tests/run-sillyspec-init.test.ts` | MIN_SILLYSPEC_VERSION_FOR_INIT、compareSemver（`sillyhub-daemon/src/spec-sync.ts`、`sillyhub-daemon/tests/run-sillyspec-init.test.ts`） | covered | `sillyhub-daemon/src/spec-sync.ts:1656`（MIN_SILLYSPEC_VERSION_FOR_INIT）、`sillyhub-daemon/src/spec-sync.ts:1724`（compareSemver） |

**task-02**
| acceptance 条目 | 归属测试文件 | 关键词命中（提示，命中≠判定） | 判定 | 证据 |
|---|---|---|---|---|
| SILLYSPEC_VALID_TOOLS.size === 7 且含 'zcode' | `sillyhub-daemon/tests/sillyspec-tool-mapping.test.ts` | SILLYSPEC_VALID_TOOLS、size、且含、zcode（`sillyhub-daemon/tests/sillyspec-tool-mapping.test.ts`） | covered | `sillyhub-daemon/tests/sillyspec-tool-mapping.test.ts:3`（SILLYSPEC_VALID_TOOLS）、`sillyhub-daemon/tests/sillyspec-tool-mapping.test.ts:20`（size）、`sillyhub-daemon/tests/sillyspec-tool-mapping.test.ts:19`（且含） |
| 新测试三组断言全过；mapDetectedToSillyspecTools 保持纯函数无兜底 | `sillyhub-daemon/tests/sillyspec-tool-mapping.test.ts` | mapDetectedToSillyspecTools（`sillyhub-daemon/tests/sillyspec-tool-mapping.test.ts`） | covered | `sillyhub-daemon/tests/sillyspec-tool-mapping.test.ts:4`（mapDetectedToSillyspecTools） |

**task-03**
| acceptance 条目 | 归属测试文件 | 关键词命中（提示，命中≠判定） | 判定 | 证据 |
|---|---|---|---|---|
| failed complete 后 init_synced_at/init_synced_spec_version 均为 NULL 且有 warn 日志 | `backend/app/modules/daemon/lease/tests/test_init_claim_tokens.py` | — | covered | `backend/app/modules/daemon/lease/tests/test_init_claim_tokens.py:404`（test_failed_complete_does_not_sync_init：status=failed → init_synced_at 断言 None + completed.status 断言 completed） |
| completed complete 后回写行为与现状一致（对照组零回归） | `backend/app/modules/daemon/lease/tests/test_init_claim_tokens.py` | — | covered | `backend/app/modules/daemon/lease/tests/test_init_claim_tokens.py:431`（test_completed_complete_syncs_init_as_before：init_synced_at 非空 + spec_version==7） |
| lease 本身仍正常完成（成败门只影响回写，不阻塞 complete 流程） | `backend/app/modules/daemon/lease/tests/test_init_claim_tokens.py` | lease（`backend/app/modules/daemon/lease/tests/test_init_claim_tokens.py`） | covered | `backend/app/modules/daemon/lease/tests/test_init_claim_tokens.py:3`（lease） |

**task-04**
| acceptance 条目 | 归属测试文件 | 关键词命中（提示，命中≠判定） | 判定 | 证据 |
|---|---|---|---|---|
| 创建+初始化全链路：弹窗依次经历 creating→initializing→done，完成态有「打开工作区」 | `frontend/src/components/__tests__/workspace-scan-dialog.test.tsx` | 创建（`frontend/src/components/__tests__/workspace-scan-dialog.test.tsx`） | covered | `frontend/src/components/__tests__/workspace-scan-dialog.test.tsx:110`（创建） |
| 初始化失败/超时：弹窗 init_failed 态文案明示"工作区已创建成功"，onCreated 可达（不回滚） | `frontend/src/components/__tests__/workspace-scan-dialog.test.tsx` | — | covered | `frontend/src/components/__tests__/workspace-scan-dialog.test.tsx`（initDispatch 拒绝 → init_failed 文案 + 双出口 onCreated 断言；5min 超时 → init_failed 用例） |
| 卸载后无轮询泄漏 | `frontend/src/components/__tests__/workspace-scan-dialog.test.tsx` | — | covered | `frontend/src/components/__tests__/workspace-scan-dialog.test.tsx`（卸载清理用例：unmount 后 advance 10s fetchMyBinding 调用数不增） |

**task-05**
| acceptance 条目 | 归属测试文件 | 关键词命中（提示，命中≠判定） | 判定 | 证据 |
|---|---|---|---|---|
| 未初始化：徽标 + Alert 同显，文案含两个关键短语 | `frontend/src/components/workspace-config-card.test.tsx` | 未初始化、徽标（`frontend/src/components/workspace-config-card.test.tsx`） | covered | `frontend/src/components/workspace-config-card.test.tsx:336`（未初始化）、`frontend/src/components/workspace-config-card.test.tsx:336`（徽标） |
| 已初始化：无 Alert（现状零回归） | `frontend/src/components/workspace-config-card.test.tsx` | 已初始化（`frontend/src/components/workspace-config-card.test.tsx`） | covered | `frontend/src/components/workspace-config-card.test.tsx:339`（已初始化） |
| 后端零依赖（纯展示组件改动） | `frontend/src/components/workspace-config-card.test.tsx` | — | non-testable | 变更面声明非可测行为（config-card.tsx 仅渲染层插 Alert 无 API 改动，QA 审查确认 Props/数据流零改动） |

- 复核后原 5 行未命中条目全部改写（4 行 covered + 1 行 non-testable）——均系机械关键词未命中，测试实锚已在证据列；无零覆盖路径残留

#### 探针 4：决策追踪覆盖
决策追踪覆盖（agent 执行）：D-001~D-006 全部闭环——每条决策的证据回指见下方「决策追踪矩阵」Evidence 列（file:line 锚点 + 测试断言）；无 unresolved/superseded 被引用（verify step2 锚定结论）

#### 探针 5：API Contract Parity
- ✅ API parity check passed: 631 backend endpoints (live [scan-root 635 + worktree 635] + artifact 0), 0 frontend calls [scope: change-diff (10 files @ worktree)] | 0 backend endpoints unused by frontend (+207 stock noise collapsed)
- ℹ️ 后端端点比对集为多根并集（主仓既有 ∪ worktree 新增 ∪ 存量 artifact），共扫 2 个根
- ⚠️ 0 个本变更端点前端未调用（warning 不阻断）：
- ℹ️ 另有 207 个存量端点未调用（他模块存量噪音，已折叠不逐条列出）

#### 探针 6：代码删除对账
- ✅ git diff 无整文件删除（D/R/C）记录
- ℹ️ 以 git 事实为准（真实 > 声明）；是否 FAIL blocker 由 agent 诚实判定

#### 探针 8：载荷字段契约对账（advisory）
- 不适用（清单无 Java/SQL 后端面，或 design.md 缺失）
#### 探针 9：守卫一致性（advisory）
- 不适用（清单无 .java 改动文件，或 design.md 缺失）
- ℹ️ 清单无 .java 文件（另有 10 个非 Java 清单文件不在探针 9 扫描面）
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
<!-- 声明与解析并存（声明 0 端点 / 解析 1 端点）——以解析为准，差异需复核（design 接口段与声明行不同步的漂移信号） -->
| 端点 | 判定 | 用例依据 ID | 结果 | 证据 |
|---|---|---|---|---|
| POST /api/workspaces | covered-service | design 接口段（前端复用现有端点声明，本变更 0 端点改动） | 行为不变 | 端点后端行为未改动（存量 service 测试锁定）；前端消费形态由 `frontend/src/components/__tests__/workspace-scan-dialog.test.tsx`（createWorkspace 调用契约含 slug 三分支断言）锁定 |
<!-- advisory 尾注（warning 计算归 validator，本段只留位）：有消费端未填子行的端点将列于此（advisory——消费端归类=design 清单启发式，数据面 facts.consumerHints）；写端点（POST/PUT/DELETE/PATCH）未在权限矩阵段声明的将列于此（advisory——补行或显式豁免「无权限约束」，数据面 facts.apiFace.writeEndpoints；表缺行会让派生框架继承你的洞） -->

## 测试结果 [层：确定性检查——CLI 实测对账]
聚焦测试（全量留 CI；按 local.yaml 口径分端）：
- daemon：vitest 3 文件（run-sillyspec-init / sillyspec-tool-mapping / test_init_lease）45/45 绿；pnpm typecheck 零错
- backend：pytest app/modules/daemon/ 2450/2450 绿；ruff check lease/ All checks passed；mypy service.py no issues
- frontend：vitest 3 文件（scan-dialog 9 + config-card 35 + page 接线）59/59 绿；tsc 零错；lint exit 0（warning 均存量基线）
- 无 known_failures 豁免项

## 决策追踪矩阵（如存在 decisions.md；无则删本节） [层：人工判断]
<!-- 机械半边预填（CLI，P0-1）：D→FR→task 链自 decisions.md × tasks/*.md frontmatter 结构化字段构建；
     Evidence / 状态两列是人工判断——逐格复核，未闭环行必须在报告标注风险 -->
| 决策 ID | FR | Task | Evidence | 状态 |
|---|---|---|---|---|
| D-001@v1 | FR-01、FR-02 | task-01 | `sillyhub-daemon/src/spec-sync.ts`（argv 无 --no-skills）+ `tests/run-sillyspec-init.test.ts` not.toContain 断言 | 已闭环 |
| D-002@v1 | FR-03 | task-05 | `frontend/src/components/workspace-config-card.tsx`（未初始化 Alert 成员维度文案）+ 测试断言 | 已闭环 |
| D-003@v1 | FR-04 | task-04 | `frontend/src/components/workspace-scan-dialog.tsx`（initDispatch 串行 + 2s/5min 轮询）+ 四用例 | 已闭环 |
| D-006@v1 | FR-04、FR-05 | task-03 | `backend/app/modules/daemon/lease/service.py`（成败门 elif + warn 日志）+ 对照用例 | 已闭环 |
| D-005@v1 | FR-01、FR-02、FR-03、FR-04 | task-01、task-02、task-04、task-05 | 方案A 范围约束逐卡核验（skill-manager 未动/后端仅一处门/无硬门禁），QA 确认无越界 | 已闭环 |
| D-004@v1 | FR-01、FR-02 | task-01、task-02 | `runner-types.ts` 7 值含 zcode + `spec-sync.ts` 门控 3.32.2 + 3.30.0 拒绝用例 | 已闭环 |

## 技术债务 [层：人工判断]
无新增 TODO/FIXME/HACK（diff grep 0 命中，探针 1 ✅）；本变更文件不在 CONCERNS 🔴 区域清单

## 变更风险等级 [层：人工判断]
unit-sufficient：无接口/schema 变更（0 端点）、无部署面；三端行为由单测锁定（daemon spawn 参数 / 后端回写门 / 前端状态机），外部依赖仅 sillyspec CLI（门控锁 ≥3.32.2）。design frontmatter 无显式 risk_level。关键词注：涉及 daemon/lease 字样但被「生命周期契约：无（编排零变更）」语境抑制——不改 daemon↔backend 协议与 lease 生命周期，仅消费侧条件收紧

## Runtime Evidence [层：人工判断]
unit-sufficient 非 integration/deployment-critical，运行时组件不涉及（未起服务/未发真实请求）；证据链为 commit 锚点 + 测试实测：
- commits：c405bb6d → cb23d7b9 → 5797a5d4 → 05968956 → 275de770 → e3a77a5c（base 21763d356）
- 失败模式排除：init 失败 → init_synced_at 恒 NULL（lease/service.py 成败门）；轮询超时 → init_failed 双出口；卸载 → 零孤儿轮询（均有测试锚定）

## 代码审查 [层：人工判断]
execute 独立 QA acceptance review（review-2026-10-09-110149）+ 主代理轻量复审，问题列表：
- [P3 已修] scan-dialog daemonId 注释与实现不符 → e3a77a5c 修正
- [P3 已修] 测试正则 typo 冗余分支 → e3a77a5c 清理
- 无 P1/P2 问题。
走查清单复核：① 编辑链路——本变更未触碰（config-card 编辑入口/AccessGuide 零改动）；② 非主分支流——init_failed 双出口/轮询 catch 容忍/document.hidden 暂停均已走查（QA 三必查 + 反例四类）；③ 守卫一致性——新增守卫仅 lease 成败门（failed 拒/completed 放行/status 缺省放行，与既有缺省语义一致）；④ 载荷契约——探针 8 不适用（无 Java/SQL 面）；⑤ 并发/事务——回写与 commit 同事务（现有路径未动），轮询只读无并发写。
总体评价：实现与设计一致，三端测试覆盖充分，可收口。

## 独立复核（可选回流槽） [层：人工判断——复核后追加]
execute 阶段独立 QA 子代理 acceptance review（review-2026-10-09-110149）回流：
- verdict：specVerdict=pass / qualityVerdict=pass
- 缺陷分级：P1=0、P2=0、P3=2（daemonId 注释不符实 + 测试正则冗余）→ 均已修（e3a77a5c，修复后 scan-dialog 9/9 复跑绿）
- 三必查过：成败门×前端轮询契约两端闭合；init→sillyspec init→五端 skill 目录路径成立；测试断言与验收点一一对应
- 反例四类齐备（failed 不回写 + completed 对照 / 已初始化无 Alert / 3.30.0 门控拒 / copilot 过滤）
- 对结论枚举影响：无（PASS 维持）
