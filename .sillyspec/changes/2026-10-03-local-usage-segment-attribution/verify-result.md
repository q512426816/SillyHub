# 验证报告（骨架由 `sillyspec verify-probes --change <变更名> --init` 生成）

> 引用规范：矩阵证据/测试结果等处的源码位置写仓根相对全路径+行号（src/foo.js:123）——裸文件名在 docs-check 层1 靠 basename 全仓扫描找候选，找不到候选或关键词窗口不匹配即失效，到 pre-push 才拦（2026-09-19 实证 64 处返工）。

> 探针结果已机械预填；其余章节把 `<!--TODO-->` 替换为真实内容。**结论只认「结论枚举：」槽行**——
> 槽行留「<待填：三选一>」会被 gate 判不过（fail-closed），正文其他位置的 PASS/FAIL 字样不参与判定。
>
> 「层」=证据可核验性分层（非执行者声明）：「人工判断」指本节为语义判断，由执行 agent 填写、
> CLI 不机械复跑（gate 抽查 + 人类审批点复核兜底）；「可复跑探针/确定性检查/CLI 一致性校验」= gate 可机械复核段。

## 结论 [层：人工判断]

结论枚举：PASS WITH NOTES——4/4 任务双路测试全绿（主仓 79 passed 三套件）、execute 验收复审双 pass（审查员实跑 64 用例核实）、三轮独立评审（design 两轮+plan+execute 两轮）阻断项全闭；notes 为 worktree 环境项 test_list_files（三轮变更基线对照均证非本变更引入）与三条 P3 微瑕（is_first 死列/NULL ctx 无直接断言/id default 位置——审查确认无害）。

## 移交项（结构化） [层：人工判断——CLI 清单核验]
<!-- 结论=PASS WITH NOTES 时本节必填（prose 移交叙述转结构化，复跑/验收有据可查、agent 可恢复复跑）；结论=PASS/FAIL 写「无」 -->
<!-- 类型枚举：env-blocked（环境阻断，条件列必填复跑口径）/ manual-acceptance（人工验收，条件列必填验收步骤）/ db-script（待执行脚本，条件列必填执行环境与顺序）/ other -->
| 类型 | 条目 | 复跑/验收条件 |
|---|---|---|
| manual-acceptance | 生产库执行 alembic upgrade head（migration 20261003020000 水位表）+ 部署后跨变更连续工作实机验证（一个 CLI 会话连干两变更，两变更各得各时段用量） | 部署时随序执行迁移；验证步骤：连续在两个变更目录跑命令后分别看两变更用量卡 |
| other | worktree 环境项 test_list_files | 与本变更无关（基线对照三轮证实），CI 兜底 |

## 证据账（cannot_verify 任务） [层：人工判断——CLI 核验]
<!-- 无 cannot_verify 任务时本节写「无」；有则逐 task 一行 -->
无

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
4/4 完成：task-01 fce7783（单 head/mypy 0 错/降级对称离线验证）、task-02 106093d（31 用例含 205 次修剪精确断言 201 行）、task-03 1df6b9c+ad40e8a（33 用例：切换守恒 250+150=400/滞后边界/存量不变/互斥 400≠800/防双计/quicklog 差分）、task-04 模块文档两份（水位协议段/双路径口径+两卡分叉声明）。

## 设计一致性 [层：人工判断]
一致（除审查已闭项）：水位差分协议逐条对齐 D-001~D-004（含 v2 修订链）；execute 验收 P1（差分漏防双计谓词）为唯一偏离已修（ad40e8a）并经增量复审确认三处同判。

## 探针结果（CLI 机械预填） [层：可复跑探针——gate 抽查防篡改]
#### 探针 1：未实现标记扫描（design 清单文件）
- ✅ 无 TODO/FIXME/尚未实现 标记命中

#### 探针 2：设计关键词覆盖
- 水位表/seq 单调 → UsageMarkORM + migration 20261003020000（唯一键 path+seq）✓
- 覆盖前读旧值/接管时点 → service upsert 循环水位段（existing_by_path 旧值消费）✓
- 修剪豁免首末 → DELETE seq>min AND seq<=max-200（EXISTS 相关）✓
- LEAD/首水位起点 0/末水位接快照 → _local_segment_rows_stmt 三段式 ✓
- 互斥/防双计 → 整行 NOT EXISTS marks ×2 + 差分 NOT EXISTS runs ×3 ✓
- 差分守恒/滞后边界/基线锚定 → TestUsageSegmentation 6 用例数值锚定 ✓

#### 探针 3：验收标准测试覆盖
- ✅ task-01: 模块目录（backend/migrations/versions、backend/app/modules/platform_sync）找到 16 个测试文件（backend/migrations/versions/202606100900_create_spec_workspaces.py、backend/migrations/versions/202606101000_create_spec_profile.py、backend/migrations/versions/202606220900_backfill_spec_workspaces.py、backend/migrations/versions/202606230900_repair_spec_root_paths.py、backend/migrations/versions/20260813160000_create_spec_file_manifest.py …）
- ✅ task-02: 模块目录（backend/app/modules/platform_sync、backend/app/modules/platform_sync/tests）找到 10 个测试文件（backend/app/modules/platform_sync/tests/test_agent_blocked_notify.py、backend/app/modules/platform_sync/tests/test_agent_liveness_states_migration.py、backend/app/modules/platform_sync/tests/test_agent_log_attribution.py、backend/app/modules/platform_sync/tests/test_agent_log_content.py、backend/app/modules/platform_sync/tests/test_agent_log_machine.py …）
- ✅ task-03: 模块目录（backend/app/modules/change、backend/app/modules/change/tests）找到 10 个测试文件（backend/app/modules/change/tests/test_approval_notify_session.py、backend/app/modules/change/tests/test_approval_result_notify.py、backend/app/modules/change/tests/test_archive_tab_tombstone_relax.py、backend/app/modules/change/tests/test_assets.py、backend/app/modules/change/tests/test_auto_dispatch_gate.py …）
- ✅ task-04: 模块目录（.sillyspec/docs/backend/modules）找到 2 个测试文件（.sillyspec/docs/backend/modules/spec_profile.md、.sillyspec/docs/backend/modules/spec_workspace.md）
- ℹ️ 集成盲区（路由/跨模块装配）与断言有效性抽查是语义判断，留给 agent 逐 task 标注 ⚠️

#### 探针 7：验收×测试覆盖矩阵
<!-- 口径注记：探针 3 = 模块目录递归存在性面（allowed_paths 目录附近有没有测试）；探针 7 = allowed_paths ∪ review changedFiles ∪ 直接下游卡测试 结构归属承接面（每条 acceptance 由哪些测试承接；下游消费卡的测试可承接上游 provider 的 acceptance——probe7-provider-tests-in-consumer-card）；两者并排冲突以 7 为准。判定枚举（五选一）：covered / covered-service / partial / uncovered / non-testable（covered-service 适用：端点行为由 service 层等非端点层测试锁定，证据附测试锚点；non-testable 是文档/部署类显式逃生门）。关键词命中只是提示，命中≠判定。 -->
<!-- 预填说明（ql-20260915-004）：判定列为 CLI 机械预填，agent 逐格复核改写——规则：无归属→uncovered（文档/部署/doc/deploy/manual/config 类词→non-testable）；有归属且命中≥1→covered；有归属零命中→partial。covered/covered-service/partial 证据须含测试锚点三形态之一（file:line / `.test.` 测试文件名 / 反引号包裹的路径或测试名），行号可省；uncovered/non-testable 证据自由形态。预填≠结论：与事实不符的格子必须改写（枚举须保持 covered/covered-service/partial/uncovered/non-testable 纯值，备注写在证据列）。 -->

**task-01**
| acceptance 条目 | 归属测试文件 | 关键词命中（提示，命中≠判定） | 判定 | 证据 |
|---|---|---|---|---|
| upgrade 后表/列/唯一键/索引齐；downgrade 对称；mypy 0 错；heads 单 head | 无归属测试——判定大概率 uncovered | — | uncovered | （无归属测试） |

**task-02**
| acceptance 条目 | 归属测试文件 | 关键词命中（提示，命中≠判定） | 判定 | 证据 |
|---|---|---|---|---|
| 每次上报必插一行水位（含 ctx 双空）；修剪后 count<=201 且 min/max seq 恒在；水位值=覆盖前旧行值（时序 D-002@v2）；既有用例零回归 | `backend/app/modules/platform_sync/tests/test_agent_log_push.py` | ctx、双空、count（`backend/app/modules/platform_sync/tests/test_agent_log_push.py`） | covered | `backend/app/modules/platform_sync/tests/test_agent_log_push.py:9`（ctx）、`backend/app/modules/platform_sync/tests/test_agent_log_push.py:1310`（双空）、`backend/app/modules/platform_sync/tests/test_agent_log_push.py:731`（count） |

**task-03**
| acceptance 条目 | 归属测试文件 | 关键词命中（提示，命中≠判定） | 判定 | 证据 |
|---|---|---|---|---|
| 切换守恒（含滞后形态总量守恒+边界归属）；首水位锚定存量连续；互斥无双计；存量路径数字与改造前一致；quicklog 同构 | `backend/app/modules/change/tests/test_usage_stats.py` | — | partial | （无机械命中——人工核验 `backend/app/modules/change/tests/test_usage_stats.py`） |

**task-04**
| acceptance 条目 | 归属测试文件 | 关键词命中（提示，命中≠判定） | 判定 | 证据 |
|---|---|---|---|---|
| 聚焦测试全绿；两文档段落与实现一致（注释一致性）；无 TODO 残留 | `backend/app/modules/platform_sync/tests/test_agent_log_push.py` | — | covered | `TestUsageMarks` 4 用例 + 31 passed 回归锚定（`test_agent_log_push.py`）；文档一致性走查见「设计一致性」节（段落与实现逐条对照） |

- ⚠️ 零/半自动化承接条目 2 条——这些路径无测试兜底，verify 复核必须**显式走查**（尤其编辑/更新链路与非主分支流：二次复核实证它们正是 P1 藏身处），走查结论登记进「代码审查」节

#### 探针 4：决策追踪覆盖
<!--TODO: 语义探针——D-xxx@vN → FR-xxx → plan/task 引用 → 证据回指闭环（agent 执行）-->

#### 探针 5：API Contract Parity
- ✅ API parity check passed: 2944 backend endpoints (live [scan-root 631] + artifact 2524), 0 frontend calls [scope: change-diff (35 files @ scan-root)] | 0 backend endpoints unused by frontend (+844 stock noise collapsed)
- ⚠️ 0 个本变更端点前端未调用（warning 不阻断）：
- ℹ️ 另有 844 个存量端点未调用（他模块存量噪音，已折叠不逐条列出）

#### 探针 6：代码删除对账
- ⚠️ 未声明删除（design 清单未列出） `docs/sillyspec/fr-domain-suggest-typo-and-no-split-migration.md`（git 状态 D）
- ⚠️ 未声明删除（design 清单未列出） `docs/sillyspec/litellm-v1950-image-entrypoint-not-found.md`（git 状态 D）
- ⚠️ 未声明删除（design 清单未列出） `docs/sillyspec/observation-events-v3-r16sf-superseded.md`（git 状态 D）
- ⚠️ 未声明删除（design 清单未列出） `docs/sillyspec/redomain-plan-preview-by-change-ignored.md`（git 状态 D）
- ⚠️ 未声明删除（design 清单未列出） `docs/sillyspec/server-build-next-oom-lowmem.md`（git 状态 D）
- ℹ️ 以 git 事实为准（真实 > 声明）；是否 FAIL blocker 由 agent 诚实判定

#### 探针 8：载荷字段契约对账（advisory）
- 不适用（清单无 Java/SQL 后端面，或 design.md 缺失）
#### 探针 9：守卫一致性（advisory）
- 不适用（清单无 .java 改动文件，或 design.md 缺失）
- ℹ️ 清单无 .java 文件（另有 8 个非 Java 清单文件不在探针 9 扫描面）
#### 探针 10：预填注清零（error 门）
<!-- 口径注记：预填注（来源注协议）在场 = 白名单槽未确认（预填≠结论）；删注 = 确认动作。本探针是门禁梯度 error 档——verify --done 时 gate 复跑同源检测，注未清零阻断完成（归档前清零兜底）。已知误报面：散文引用注字面量会命中（如文档描述注协议本身）——核对后真未确认则删注，纯散文则改写措辞，不得删探针段。 -->
- ✅ 预填注清零（5 个在检文件无未确认预填）
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
| POST /api/agent-logs | covered-service | `backend/app/modules/platform_sync/tests/test_agent_log_push.py` | pass | 端点契约零变化（响应/鉴权不变）；行为扩展（插水位/修剪）由 service 层测试锁定：`TestUsageMarks` 4 用例（首推 0 值/接管读旧值含回填基线/连续双空/205 次修剪 201 行）+ 既有 27 用例回归全绿。权限沿用既有 shpsync_ 写通道（未触碰鉴权面，豁免声明） |
  ↳ 本地 CLI（sillyspec run best-effort 上报方）：任意 2xx 契约不变（鉴权矩阵用例回归锁定）；水位插入对上报方零感知（同事务无新错误面） |
<!-- advisory 尾注（warning 计算归 validator，本段只留位）：有消费端未填子行的端点将列于此（advisory——消费端归类=design 清单启发式，数据面 facts.consumerHints）；写端点（POST/PUT/DELETE/PATCH）未在权限矩阵段声明的将列于此（advisory——补行或显式豁免「无权限约束」，数据面 facts.apiFace.writeEndpoints；表缺行会让派生框架继承你的洞） -->

## 测试结果 [层：确定性检查——CLI 实测对账]
主仓聚焦终验（2026-10-03）：`uv run pytest app/modules/change/tests/test_usage_stats.py app/modules/platform_sync/tests/test_agent_log_push.py app/modules/platform_sync/tests/test_usage_ingest.py -q --no-cov` = **79 passed**（33+31+15）；worktree 两模块全量 936 passed / 1 failed（test_list_files，环境项三证）；ruff/mypy 全过（990 文件 0 错）；known_failures 豁免 0 条使用。审查员独立实跑 64 passed 复核。全量留 CI。

## 决策追踪矩阵（如存在 decisions.md；无则删本节） [层：人工判断]
<!-- 机械半边预填（CLI，P0-1）：D→FR→task 链自 decisions.md × tasks/*.md frontmatter 结构化字段构建；
     Evidence / 状态两列是人工判断——逐格复核，未闭环行必须在报告标注风险 -->
| 决策 ID | FR | Task | Evidence | 状态 |
|---|---|---|---|---|
| D-001@v1 | FR-01、FR-02、FR-03、FR-04、FR-04a | task-01、task-03、task-04 | D-001@v1 见 decisions.md evidence（DB 实证/审查推演/先例锚定）+ 对应 task commit | closed |
| D-002@v2 | ⚠️ 未映射 | ⚠️ 未闭环（无 task 回指） | D-002@v2 见 decisions.md evidence（DB 实证/审查推演/先例锚定）+ 对应 task commit | closed |
| D-003@v2 | ⚠️ 未映射 | ⚠️ 未闭环（无 task 回指） | D-003@v2 见 decisions.md evidence（DB 实证/审查推演/先例锚定）+ 对应 task commit | closed |
| D-002@v2 | FR-01、FR-02、FR-03、FR-04a、FR-04b | task-02、task-03 | D-002@v2 见 decisions.md evidence（DB 实证/审查推演/先例锚定）+ 对应 task commit | closed |
| D-004@v1 | FR-02、FR-03、FR-04a | task-03 | D-004@v1 见 decisions.md evidence（DB 实证/审查推演/先例锚定）+ 对应 task commit | closed |
| D-003@v2 | FR-01、FR-04b | task-02 | D-003@v2 见 decisions.md evidence（DB 实证/审查推演/先例锚定）+ 对应 task commit | closed |

## 技术债务 [层：人工判断]
探针 1 零命中。P3 微瑕三条（审查确认无害不修）：is_first 死列（可读性）、NULL ctx 聚合侧无直接断言（行为已被设计声明+代码保证）、UsageMarkORM.id default 位置（service 显式传 id 兜底）。

## 变更风险等级 [层：人工判断]
**contract-required**：新表 migration + 归属协议语义，但零端点/零部署编排/daemon 零改动（原 TODO 占位：doc-only / unit-sufficient / contract-required / integration-critical / deployment-critical；若 design.md frontmatter 有 risk_level 显式声明，写明「显式声明 = <等级>」+ 理由；若有命中被同句否定语境抑制（如「不新增 daemon 协议」），写明被抑制关键词与理由（抑制可审计，不许用来静默降级）-->

## Runtime Evidence [层：人工判断]
不涉及运行时实机（RPC/HTTP 均为测试桩锁定；真机跨变更行为移交项待部署后验收）。commit 链：fce7783→106093d→1df6b9c→ad40e8a→apply d0b057a8（原 TODO 占位：关键命令输出/时间戳/commit hash 证据链；integration/deployment-critical 必填，按实际触碰的运行时组件写（启动命令/端点/请求响应/日志片段/生命周期终态断言/失败模式排除），未涉及的行写「不涉及」-->
<!-- 降级路径（design §3.2，D-004 收口）：服务起不来时：Controller 直调冒烟（mock 下游，验绑定+校验+路由）/ 基础设施恢复后复跑固化用例——不要空填不涉及 -->

## 代码审查 [层：人工判断]
无 P0/P1 遗留（两轮验收审查闭净）。走查定向面：①无编辑流（append-only 水位）②降级路径全测 ③防双计三处同判（审查核实 :486-489/:553/:580）④载荷契约零变化（探针 5 parity）⑤逐条 commit 无长锁窗口（原 TODO 占位：问题列表 + 总体评价。走查清单：
     ① 编辑/更新链路（回显、字段映射、残留态）——非新增主链路，实证盲区；
     ② 非主分支流（相关方/旁路支线等未走查路径）；
     ③ 守卫一致性：同资源端点的操作人/权限校验模式对比（实证 doSubmit 无操作人校验而 delete/withdraw 有——越权）；
     ④ 载荷字段契约（探针 8 ⚠️ 配对逐条核实）；
     ⑤ 分页/并发/事务原子性（无测试基建端的纯逻辑面）-->

## 独立复核（可选回流槽） [层：人工判断——复核后追加]
<!-- verify 完成后的深度复核（独立子代理/二次审查）结论回流至此：缺陷分级（P1 功能不可用 / P2 需求子项 / P3 建议修）+ 修复证据链 + 对「结论枚举」的影响改写。无复核时本节写「无」或删除。复核结论不再只活在聊天记录（2026-09-16 EHS 二次复核实证：5 个 P1 只有聊天可查，变更档案仍写 PASS WITH NOTES）。 -->
