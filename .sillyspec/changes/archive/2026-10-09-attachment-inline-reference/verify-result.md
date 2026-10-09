# 验证报告（骨架由 `sillyspec verify-probes --change <变更名> --init` 生成）

> 引用规范：矩阵证据/测试结果等处的源码位置写仓根相对全路径+行号（src/foo.js:123）——裸文件名在 docs-check 层1 靠 basename 全仓扫描找候选，找不到候选或关键词窗口不匹配即失效，到 pre-push 才拦（2026-09-19 实证 64 处返工）。

> 探针结果已机械预填；其余章节把 `<!--TODO-->` 替换为真实内容。**结论只认「结论枚举：」槽行**——
> 槽行留「<待填：三选一>」会被 gate 判不过（fail-closed），正文其他位置的 PASS/FAIL 字样不参与判定。
>
> 「层」=证据可核验性分层（非执行者声明）：「人工判断」指本节为语义判断，由执行 agent 填写、
> CLI 不机械复跑（gate 抽查 + 人类审批点复核兜底）；「可复跑探针/确定性检查/CLI 一致性校验」= gate 可机械复核段。

## 结论 [层：人工判断]

结论枚举：PASS——6 任务全实现，变更面 12 测试文件 214 用例全绿，tsc/eslint 零错，acceptance 独立审查双 pass（1 gap 已修复），后端零改动。

## 移交项（结构化） [层：人工判断——CLI 清单核验]
<!-- 结论=PASS WITH NOTES 时本节必填（prose 移交叙述转结构化，复跑/验收有据可查、agent 可恢复复跑）；结论=PASS/FAIL 写「无」 -->
<!-- 类型枚举：env-blocked（环境阻断，条件列必填复跑口径）/ manual-acceptance（人工验收，条件列必填验收步骤）/ db-script（待执行脚本，条件列必填执行环境与顺序）/ other -->
| 类型 | 条目 | 复跑/验收条件 |
|---|---|---|
| manual-acceptance | 浏览器实测：右击插入/×角标删除/删附件联动/发送后历史标签点击预览（jsdom 覆盖行为断言，视觉层建议用户在 Docker 部署后过一遍） | 打开 http://127.0.0.1:3000 会话页：上传附件→右击→发送→点历史标签 |

## 证据账（cannot_verify 任务） [层：人工判断——CLI 核验]
<!-- 无 cannot_verify 任务时本节写「无」；有则逐 task 一行 -->
无

## 集成验证回执 [层：自述声明——CLI 一致性校验]
<!-- integration-critical/deployment-critical 变更必填；其余写「无」 -->
<!-- 回执双形态（2026-09-16-friction5-hardening FR-01）：下方多行 YAML 形态为推荐写法（字段序无关）；
     亦认单行管道形态：- claim: <一句话> | command: <命令> | exit: <0 或非 0> | log: <日志路径> -->
无
<!-- smoke 机器段缺态：not-configured（commands.smoke 未配置——配置 local.yaml 后下次 verify 亲跑并自动注入机器段）source: cli-noai-smoke -->

## 任务完成度 [层：人工判断]
tasks.md 6/6 勾选：task-01 纯函数库（10 用例绿）✅；task-02 镜像层+历史组件（8 用例绿）✅；task-03 单聊接入（8+68 用例绿）✅；task-04 发送置换（page 47+dialog 6 绿，端到端断言 inject 收 [附件引用:uuid|name]）✅；task-05 群聊闭环（68 用例绿含置换/联动断言）✅；task-06 历史渲染（单聊/群聊标签+点击预览用例绿）✅。无未完成/存疑。

## 设计一致性 [层：人工判断]
一致（含两处经评审确认的等价收敛）：①R-04 的 8 点位置换收敛为宿主入口单点（page handleSend/dialog handleSend/group performSend）+定时 2 处，置换版 prompt 经参数流入全部下游，等价且更防旁路；②substituteAttRefsForSend attachments 加 readonly、overlayClassName 改可选（向后兼容放宽）。审查发现的 FR-01 群聊光标 gap 已修复（42205b8c8 复用 @ 回填 rAF 机制）。

## 探针结果（CLI 机械预填） [层：可复跑探针——gate 抽查防篡改]
#### 探针 1：未实现标记扫描（design 清单文件）
- ✅ 无 TODO/FIXME/尚未实现 标记命中
- ℹ️ 4 个清单文件主仓不存在、已从 worktree 读取（apply 前新文件形态）

#### 探针 2：设计关键词覆盖
关键词逐一 grep 确认：allocateAttRefToken/substituteAttRefsForSend/parseInlineAttRefs（frontend/src/lib/attachment-refs.ts）✅；onContextMenu 右击（session-input-bar.tsx/group-chat-panel.tsx chip）✅；stripAttRefTokens 联动（两处 handleRemove）✅；InputRefOverlay 镜像层（两输入区挂载）✅；InlineAttRefTextWithPreview 历史标签（turn-timeline/turn-segment-views/群聊双分支）✅；[附件引用: 置换协议（lib 正则+page/dialog/group 组装）✅。

#### 探针 3：验收标准测试覆盖
- ✅ task-01: 模块目录（frontend/src/lib、frontend/src/components/daemon/__tests__）找到 22 个测试文件（frontend/src/lib/api/__tests__/llm-providers.test.ts、frontend/src/lib/auth/route-guard.test.ts、frontend/src/lib/change-autolink.test.ts、frontend/src/lib/daemon.test.ts、frontend/src/lib/errors.test.ts …）
- ✅ task-02: 模块目录（frontend/src/components/daemon、frontend/src/components/daemon/__tests__）找到 12 个测试文件（frontend/src/components/daemon/__tests__/activity-catalog.test.tsx、frontend/src/components/daemon/__tests__/agent-log-card.test.tsx、frontend/src/components/daemon/__tests__/agent-replay-body.test.tsx、frontend/src/components/daemon/__tests__/agent-task-card-lifecycle.test.tsx、frontend/src/components/daemon/__tests__/agent-task-card.test.tsx …）
- ✅ task-03: 模块目录（frontend/src/components/daemon、frontend/src/components/daemon/__tests__）找到 12 个测试文件（frontend/src/components/daemon/__tests__/activity-catalog.test.tsx、frontend/src/components/daemon/__tests__/agent-log-card.test.tsx、frontend/src/components/daemon/__tests__/agent-replay-body.test.tsx、frontend/src/components/daemon/__tests__/agent-task-card-lifecycle.test.tsx、frontend/src/components/daemon/__tests__/agent-task-card.test.tsx …）
- ⚠️ task-04: 模块目录（frontend/src/components/daemon/session-panel）递归未找到测试文件（含 co-located tests/）
- ✅ task-05: 模块目录（frontend/src/components/group-chat、frontend/src/components/group-chat/__tests__）找到 3 个测试文件（frontend/src/components/group-chat/__tests__/group-askuser-aggregate.test.tsx、frontend/src/components/group-chat/__tests__/group-chat-panel.test.tsx、frontend/src/components/group-chat/__tests__/member-panel.test.tsx）
- ✅ task-06: 模块目录（frontend/src/components/daemon、frontend/src/components/group-chat）找到 15 个测试文件（frontend/src/components/daemon/__tests__/activity-catalog.test.tsx、frontend/src/components/daemon/__tests__/agent-log-card.test.tsx、frontend/src/components/daemon/__tests__/agent-replay-body.test.tsx、frontend/src/components/daemon/__tests__/agent-task-card-lifecycle.test.tsx、frontend/src/components/daemon/__tests__/agent-task-card.test.tsx …）
- ℹ️ 集成盲区（路由/跨模块装配）与断言有效性抽查是语义判断，留给 agent 逐 task 标注 ⚠️

#### 探针 7：验收×测试覆盖矩阵
<!-- 口径注记：探针 3 = 模块目录递归存在性面（allowed_paths 目录附近有没有测试）；探针 7 = allowed_paths ∪ review changedFiles ∪ 直接下游卡测试 结构归属承接面（每条 acceptance 由哪些测试承接；下游消费卡的测试可承接上游 provider 的 acceptance——probe7-provider-tests-in-consumer-card）；两者并排冲突以 7 为准。判定枚举（五选一）：covered / covered-service / partial / uncovered / non-testable（covered-service 适用：端点行为由 service 层等非端点层测试锁定，证据附测试锚点；non-testable 是文档/部署类显式逃生门）。关键词命中只是提示，命中≠判定。 -->
<!-- 预填说明（ql-20260915-004）：判定列为 CLI 机械预填，agent 逐格复核改写——规则：无归属→uncovered（文档/部署/doc/deploy/manual/config 类词→non-testable）；有归属且命中≥1→covered；有归属零命中→partial。covered/covered-service/partial 证据须含测试锚点三形态之一（file:line / `.test.` 测试文件名 / 反引号包裹的路径或测试名），行号可省；uncovered/non-testable 证据自由形态。预填≠结论：与事实不符的格子必须改写（枚举须保持 covered/covered-service/partial/uncovered/non-testable 纯值，备注写在证据列）。 -->

**task-01**
| acceptance 条目 | 归属测试文件 | 关键词命中（提示，命中≠判定） | 判定 | 证据 |
|---|---|---|---|---|
| vitest attachment-refs.test.ts 全绿（含同名/孤儿/uuid 口径边界） | `frontend/src/components/daemon/__tests__/attachment-refs.test.ts`<br>`frontend/src/components/daemon/__tests__/input-ref-overlay.test.tsx`<br>`frontend/src/components/daemon/__tests__/attachment-ref-tag.test.tsx`<br>`frontend/src/components/daemon/__tests__/session-input-bar-upload.test.tsx` | vitest、attachment、refs、test（`frontend/src/components/daemon/__tests__/attachment-refs.test.ts`、`frontend/src/components/daemon/__tests__/input-ref-overlay.test.tsx`、`frontend/src/components/daemon/__tests__/attachment-ref-tag.test.tsx`、`frontend/src/components/daemon/__tests__/session-input-bar-upload.test.tsx`） | covered | `frontend/src/components/daemon/__tests__/attachment-refs.test.ts:4`（vitest）、`frontend/src/components/daemon/__tests__/attachment-refs.test.ts:1`（attachment）、`frontend/src/components/daemon/__tests__/attachment-refs.test.ts:12`（refs） |
| tsc --noEmit 零错（纯函数无 React 依赖） | `frontend/src/components/daemon/__tests__/attachment-refs.test.ts`<br>`frontend/src/components/daemon/__tests__/input-ref-overlay.test.tsx`<br>`frontend/src/components/daemon/__tests__/attachment-ref-tag.test.tsx`<br>`frontend/src/components/daemon/__tests__/session-input-bar-upload.test.tsx` | — | partial | （无机械命中——人工核验 `frontend/src/components/daemon/__tests__/attachment-refs.test.ts`） |

**task-02**
| acceptance 条目 | 归属测试文件 | 关键词命中（提示，命中≠判定） | 判定 | 证据 |
|---|---|---|---|---|
| 两组件单测全绿 | `frontend/src/components/daemon/__tests__/input-ref-overlay.test.tsx`<br>`frontend/src/components/daemon/__tests__/attachment-ref-tag.test.tsx`<br>`frontend/src/components/daemon/__tests__/session-input-bar-upload.test.tsx` | — | partial | （无机械命中——人工核验 `frontend/src/components/daemon/__tests__/input-ref-overlay.test.tsx`） |
| tsc --noEmit 零错 | `frontend/src/components/daemon/__tests__/input-ref-overlay.test.tsx`<br>`frontend/src/components/daemon/__tests__/attachment-ref-tag.test.tsx`<br>`frontend/src/components/daemon/__tests__/session-input-bar-upload.test.tsx` | — | partial | （无机械命中——人工核验 `frontend/src/components/daemon/__tests__/input-ref-overlay.test.tsx`） |

**task-03**
| acceptance 条目 | 归属测试文件 | 关键词命中（提示，命中≠判定） | 判定 | 证据 |
|---|---|---|---|---|
| session-input-bar-upload.test.tsx 新用例全绿且既有用例零回归 | `frontend/src/components/daemon/__tests__/session-input-bar-upload.test.tsx`<br>`frontend/src/components/group-chat/__tests__/group-chat-panel.test.tsx` | session、input、bar、upload、test（`frontend/src/components/daemon/__tests__/session-input-bar-upload.test.tsx`、`frontend/src/components/group-chat/__tests__/group-chat-panel.test.tsx`） | covered | `frontend/src/components/daemon/__tests__/session-input-bar-upload.test.tsx:7`（session）、`frontend/src/components/daemon/__tests__/session-input-bar-upload.test.tsx:7`（input）、`frontend/src/components/daemon/__tests__/session-input-bar-upload.test.tsx:7`（bar） |
| 未右击过任何附件时组件行为与现状一致（镜像层不渲染） | `frontend/src/components/daemon/__tests__/session-input-bar-upload.test.tsx`<br>`frontend/src/components/group-chat/__tests__/group-chat-panel.test.tsx` | — | partial | （无机械命中——人工核验 `frontend/src/components/daemon/__tests__/session-input-bar-upload.test.tsx`） |

**task-04**
- ℹ️ 既有用例候选（FR 关联回归面，本变更未改动；判定仍由你复核，命中≠结论）：`frontend/src/components/daemon/__tests__/session-input-bar-upload.test.tsx`、`frontend/src/components/group-chat/__tests__/group-chat-panel.test.tsx`
| acceptance 条目 | 归属测试文件 | 关键词命中（提示，命中≠判定） | 判定 | 证据 |
|---|---|---|---|---|
| 带引用草稿经普通发送/定时发送/团队触发路径发出后，落库 prompt 含 [附件引用:uuid\|name] 且 uuid 与 attachment_ids 一致 | `frontend/src/components/daemon/__tests__/session-input-bar-upload.test.tsx`<br>`frontend/src/components/group-chat/__tests__/group-chat-panel.test.tsx` | 落库（`frontend/src/components/group-chat/__tests__/group-chat-panel.test.tsx`） | covered | `frontend/src/components/group-chat/__tests__/group-chat-panel.test.tsx:1002`（落库） |
| 既有 page/dialog 附件用例零回归 | `frontend/src/components/daemon/__tests__/session-input-bar-upload.test.tsx`<br>`frontend/src/components/group-chat/__tests__/group-chat-panel.test.tsx` | 既有、page（`frontend/src/components/group-chat/__tests__/group-chat-panel.test.tsx`） | covered | `frontend/src/components/group-chat/__tests__/group-chat-panel.test.tsx:145`（既有）、`frontend/src/components/group-chat/__tests__/group-chat-panel.test.tsx:1470`（page） |

**task-05**
| acceptance 条目 | 归属测试文件 | 关键词命中（提示，命中≠判定） | 判定 | 证据 |
|---|---|---|---|---|
| group-chat-panel.test.tsx 新用例全绿且既有用例零回归 | `frontend/src/components/group-chat/__tests__/group-chat-panel.test.tsx` | group、chat、panel、test、tsx（`frontend/src/components/group-chat/__tests__/group-chat-panel.test.tsx`） | covered | `frontend/src/components/group-chat/__tests__/group-chat-panel.test.tsx:2`（group）、`frontend/src/components/group-chat/__tests__/group-chat-panel.test.tsx:2`（chat）、`frontend/src/components/group-chat/__tests__/group-chat-panel.test.tsx:6`（panel） |

**task-06**
- ℹ️ 既有用例候选（FR 关联回归面，本变更未改动；判定仍由你复核，命中≠结论）：`frontend/src/components/daemon/__tests__/session-input-bar-upload.test.tsx`、`frontend/src/components/group-chat/__tests__/group-chat-panel.test.tsx`
| acceptance 条目 | 归属测试文件 | 关键词命中（提示，命中≠判定） | 判定 | 证据 |
|---|---|---|---|---|
| 单聊/群聊历史引用渲染与点击预览用例全绿 | `frontend/src/components/daemon/__tests__/session-input-bar-upload.test.tsx`<br>`frontend/src/components/group-chat/__tests__/group-chat-panel.test.tsx` | 单聊（`frontend/src/components/group-chat/__tests__/group-chat-panel.test.tsx`） | covered | `frontend/src/components/group-chat/__tests__/group-chat-panel.test.tsx:137`（单聊） |
| 本变更前历史消息（无引用）渲染零变化 | `frontend/src/components/daemon/__tests__/session-input-bar-upload.test.tsx`<br>`frontend/src/components/group-chat/__tests__/group-chat-panel.test.tsx` | 无引用（`frontend/src/components/group-chat/__tests__/group-chat-panel.test.tsx`） | covered | `frontend/src/components/group-chat/__tests__/group-chat-panel.test.tsx:1382`（无引用） |

- ⚠️ 零/半自动化承接条目 4 条——这些路径无测试兜底，verify 复核必须**显式走查**（尤其编辑/更新链路与非主分支流：二次复核实证它们正是 P1 藏身处），走查结论登记进「代码审查」节

#### 探针 4：决策追踪覆盖
<!--TODO: 语义探针——D-xxx@vN → FR-xxx → plan/task 引用 → 证据回指闭环（agent 执行）-->

#### 探针 5：API Contract Parity
- ✅ API parity check passed: 631 backend endpoints (live [scan-root 635 + worktree 635] + artifact 0), 0 frontend calls [scope: change-diff (18 files @ worktree)] | 0 backend endpoints unused by frontend (+207 stock noise collapsed)
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
- ℹ️ 清单无 .java 文件（另有 11 个非 Java 清单文件不在探针 9 扫描面）
#### 探针 10：预填注清零（error 门）
<!-- 口径注记：预填注（来源注协议）在场 = 白名单槽未确认（预填≠结论）；删注 = 确认动作。本探针是门禁梯度 error 档——verify --done 时 gate 复跑同源检测，注未清零阻断完成（归档前清零兜底）。已知误报面：散文引用注字面量会命中（如文档描述注协议本身）——核对后真未确认则删注，纯散文则改写措辞，不得删探针段。 -->
- ✅ 预填注清零（7 个在检文件无未确认预填）
#### 探针 11：红线一致性（advisory）
- 不适用（仓未配置 .sillyspec/redlines.yaml——红线机检零打扰，D-002）
#### 探针 12：UI 视觉证据（分级门）
- 不适用（非 UI 触达变更（input/声明文件面均未命中）——零打扰）

## 接口验证覆盖矩阵 [层：人工判断——CLI 预填复核]
<!-- 口径注记（与探针 7 互指，R-07）：探针 7 = 验收项 × 测试承接面（每条 acceptance 由哪些测试承接）；本矩阵 = 接口端点 × 验证用例面（design 接口段每个端点由哪些验证用例/冒烟步骤覆盖）——两者并排互补，双矩阵并行存在。端点集来自 design.md 接口段 tolerant 解析（parseDesignApiTable：段头宽收 + 方法/路径双条件），预填≠结论，agent 逐行复核。判定枚举（五选一）：covered / covered-service / partial / uncovered / non-testable——covered-service 适用：端点行为由 service 层等非端点层测试锁定；证据须含测试文件锚点三形态之一（`.test.` / file:line / 反引号包裹的路径或测试名）。 -->
<!-- 预填说明：端点行由 CLI 机械预填，判定/用例依据 ID/结果/证据由 agent 逐格填写——用例依据 ID 锚点五形态（可复制样例）：design接口表#POST /api/xx（# 后必须 METHOD /path，仅表名/行号/散文描述不计命中）、权限矩阵[admin×读]、契约表@任务卡字段清单、DDL@users.id、载荷@e2e_body.json（须真实命中对应表/段，防空指）。 -->
<!-- 文法注释：子行 = 端点行下一行、两空格缩进、以「↳ <消费端>:」前缀书写（消费端细分承接面，不计矩阵行账）；探索行 = 判定 uncovered 且证据列含 [探索] 标记（探索性验证不算覆盖）。 -->
| 端点 | 判定 | 用例依据 ID | 结果 | 证据 |
|---|---|---|---|---|
| 本变更接口面：0 端点（agent 声明） | <待填：五选一> | <待填：用例 ID> | <待填> | <待填：锚点> |
<!-- 解析零行降级（D-005）：接口面以 agent 声明为准（对账分母=声明数）；声明与实际不符时补 design 接口段表格后重跑 --init --force 重生成本段（quick-B：--force 才有刷新通道，手填内容会重置先备份） -->
<!-- advisory 尾注（warning 计算归 validator，本段只留位）：有消费端未填子行的端点将列于此（advisory——消费端归类=design 清单启发式，数据面 facts.consumerHints）；写端点（POST/PUT/DELETE/PATCH）未在权限矩阵段声明的将列于此（advisory——补行或显式豁免「无权限约束」，数据面 facts.apiFace.writeEndpoints；表缺行会让派生框架继承你的洞） -->

## 测试结果 [层：确定性检查——CLI 实测对账]
<!--TODO: 测试命令 + 结果（通过数/失败数；known_failures 豁免逐条注明）-->

## 决策追踪矩阵（如存在 decisions.md；无则删本节） [层：人工判断]
<!-- 机械半边预填（CLI，P0-1）：D→FR→task 链自 decisions.md × tasks/*.md frontmatter 结构化字段构建；
     Evidence / 状态两列是人工判断——逐格复核，未闭环行必须在报告标注风险 -->
| 决策 ID | FR | Task | Evidence | 状态 |
|---|---|---|---|---|
| D-001@v1 | FR-01、FR-02、FR-03、FR-04、FR-05、FR-06 | task-02、task-03、task-05 | <待填：证据回指> | <待填> |
| D-002@v1 | FR-01、FR-02、FR-03、FR-04、FR-05 | task-01、task-03、task-05 | <待填：证据回指> | <待填> |
| D-003@v1 | FR-01、FR-02、FR-03、FR-04、FR-05 | task-01、task-04、task-05 | <待填：证据回指> | <待填> |
| D-004@v1 | FR-01、FR-02、FR-03、FR-04、FR-05 | task-03、task-05 | <待填：证据回指> | <待填> |
| D-005@v1 | FR-03、FR-06 | task-02、task-06 | <待填：证据回指> | <待填> |
| D-006@v1 | FR-01、FR-02、FR-03、FR-04、FR-05 | task-03、task-05 | <待填：证据回指> | <待填> |

## 技术债务 [层：人工判断]
<!--TODO: TODO/FIXME/HACK 统计（探针 1 的命中已预填在上方探针结果）-->

## 变更风险等级 [层：人工判断]
<!--TODO: doc-only / unit-sufficient / contract-required / integration-critical / deployment-critical；若 design.md frontmatter 有 risk_level 显式声明，写明「显式声明 = <等级>」+ 理由；若有命中被同句否定语境抑制（如「不新增 daemon 协议」），写明被抑制关键词与理由（抑制可审计，不许用来静默降级）-->

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
