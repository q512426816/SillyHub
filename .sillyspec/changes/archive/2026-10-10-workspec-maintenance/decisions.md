---
author: qinyi
created_at: 2026-10-10 17:09:03
generated_by: sillyspec-fourpiece-init
change: 2026-10-10-workspec-maintenance
---

# 决策记录（Decisions）

<!-- 增量落盘：每解决一个有实现影响的问题当场追加一条（格式见 brainstorm Step 3 模板）；幂等按 D-xxx@vN 判重 -->
<!-- 引用规范：evidence 等处的源码位置写仓根相对全路径+行号（src/foo.js:123）——裸文件名在 docs-check 层1 靠 basename 全仓扫描找候选，找不到候选或关键词窗口不匹配即失效，到 pre-push 才拦（2026-09-19 实证 64 处返工） -->

## D-001@v1: workspec 术语澄清——指跨仓关联配置，非四件套编辑
- type: term
- priority: P0
- status: accepted
- source: user
- question: 「sillyspec workspec 维护的能力」指的是什么？是四件套文档编辑、新建变更入口、还是别的？
- answer: 用户原话：「我的意思是配置跨仓信息 比如我有个单独的 spec 文档仓 但是他要跟实际的代码仓关联 或者是 我这个是后端仓 要跟前端仓关联」——即平台缺少对「spec 文档仓↔代码仓」「后端仓↔前端仓」这类跨仓关联信息的配置维护能力。AI 最初猜测的四件套编辑/新建变更入口两个方向均被否定。
- normalized_requirement: 本变更交付的是「跨仓关联配置」能力（登记/编辑/展示仓与仓之间的关联），不是变更文档编辑器，也不是新建变更表单回归。
- impacts: [FR-全部, proposal 定位段]
- evidence: 用户回答轮次 2（AskUserQuestion 自由输入）；现状依据 backend/app/modules/workspace/model.py:46-52（root_path 部分唯一约束=严格单仓模型）
- 故障面: 若用户实际还隐含期待四件套编辑升级，本变更不覆盖（范围外，另立变更）

## D-002@v1: 关联配置的下游行为——按「配置+展示+agent 上下文注入」推进，深度自动化留开放决策
- type: boundary
- priority: P0
- status: accepted
- source: user
- question: 跨仓关联配好之后驱动什么行为？（spec 仓规范自动覆盖代码仓会话 / 跨仓影响对账主动化 / 多仓聚合管理 / 仅登记展示）——二次澄清时用户未作答。
- answer: 用户离席未答。按用户已给出的两个例子的最小公倍数推进：v1 交付「关联登记 + 工作区详情展示 + agent 会话上下文注入关联仓信息」（对齐活跃变更 2026-10-10-borrow-sandbox-workspace-context 的 AGENTS.md 注入先例）；跨仓影响标记/对账主动化、多仓聚合管理列为 v2 候选不进本期。此取舍待用户在方案复核时确认或否决。
- normalized_requirement: v1 范围=关联数据模型 + 管理 API + 工作区设置/详情 UI + 会话上下文注入；v2 候选（本期不做）：变更级跨仓影响标记、scope-audit 主动化、多仓变更/文档聚合视图。
- impacts: [FR 列表分层, design 分期]
- evidence: 用户回答轮次 3（AskUserQuestion 未作答）；先例 .sillyspec/changes/2026-10-10-borrow-sandbox-workspace-context/proposal.md（AGENTS.md 注入沙箱根）
- 故障面: 用户若期待的是多仓聚合管理（C 选项），v1 的登记+注入不满足，需二期扩展（数据模型预留多仓聚合可能：关联仓条目含 root_path，不与单仓约束互斥）

## D-002@v2: v1 范围修订——登记+双落盘为核心，会话注入移出本期
- type: boundary
- priority: P0
- status: accepted
- source: user
- question: D-002@v1 定义的 v1 范围（登记+展示+会话上下文注入）在 D-008 定调后是否维持？
- answer: 修订。用户确认双落盘架构时明确「会话上下文注入降为可选加分项不再作为核心」。v1 范围=关联仓登记（共享字段+成员级路径）+daemon 双落盘+落盘状态回环；会话上下文注入移入非目标（留 v2 候选——落盘后 CLI 自身的模块上下文/跨仓对账机制已覆盖大部分场景）。
- normalized_requirement: design 非目标节显式列「agent 会话上下文注入（AGENTS.md/前导渲染）」；v2 候选清单含会话注入、变更级跨仓影响标记、scope-audit 主动化、多仓聚合。
- supersedes: D-002@v1
- impacts: [design 非目标节, FR 列表]
- evidence: 设计确认轮 7（用户确认「确认，写文档」，含注入降级条款）

## D-003@v1: 实现路线选方案 A——平台侧「关联仓」登记 + 会话上下文注入
- type: architecture
- priority: P0
- status: accepted
- source: user
- question: 跨仓关联配置的权威源与实现路线选 A（平台登记+注入）/ B（仓库侧 projects yaml relations 为源）/ C（local.yaml repos 注册表平台化）？
- answer: 选 A。注意：方案选择轮用户未达（AskUserQuestion 两次未作答），此为 AI 按推荐路线推进、待用户方案复核时确认或否决——非用户亲选。理由：唯一直接覆盖两个用户场景的最小闭环（B 的 projects/*.yaml 子项目路径必须相对工作区根且存在，独立 spec 仓 clone 与代码仓分处不同目录树写不进去）；人工 curated 小数据与 2026-07-06 砍掉的机器自动生成 relations 垃圾（446 条全 depends_on 全自动生成）性质不同，防复潮风险低；不依赖 sillyspec 工具发版节奏。
- normalized_requirement: 权威源=平台 DB（workspace 级 linked_repos 登记：名称/repo_url/本地 root_path 提示/角色/关系描述/备注）；交付 CRUD API + 工作区 UI 卡片 + agent 会话上下文注入（lease metadata + AGENTS.md 渲染，对齐 borrow-sandbox 先例）。
- impacts: [FR-01..FR-06, design 全部章节]
- evidence: 方案对比轮 4；工具路径约束证据 sillyspec workspace add 实现（src/workspace.js:38-70，路径须存在且相对根）；先例 .sillyspec/changes/2026-10-10-borrow-sandbox-workspace-context/proposal.md；防复潮查证 .sillyspec/changes/archive/2026-07-06-component-readonly-split/proposal.md:19（relations 垃圾根因）
- 故障面: 平台侧配置不回写仓库——本地直跑 sillyspec CLI 的会话看不到关联信息（仅平台派发会话有上下文）；与工具侧 projects/*.yaml、local.yaml repos: 并存为第三处跨仓信息表达点，需文档说明口径分工
- 退役判据: 若工具侧未来支持跨目录树的 spec↔code 关联原生表达（workspace add 放开相对根限制或 relations 进 CLI 管理），平台登记可降级为镜像/中转

## D-004@v1: 落选方案 B——仓库侧 projects/*.yaml relations 为权威源
- type: architecture
- priority: P0
- status: rejected
- source: code
- question: 同 D-003 取舍问句
- answer: 否决。否决理由：①表达不了用户主场景——projects/*.yaml 子项目路径必须相对工作区根且真实存在（src/workspace.js:38-70），独立 spec 仓 clone 与代码仓 clone 分处不同目录树写不进 relations；②daemon 上传显式排除 projects/ 目录（sillyhub-daemon/src/spec-sync.ts:615-622，本地绝对路径隐私），解除需脱敏改造；③sillyspec workspace add 不写 relations（工具侧全无 relations 消费者，本仓 yaml 里 relations 段是手工写的），平台回写要自己拼 yaml，违反「yaml 读写一律交给 CLI」工具规则；④平台消费 relations 的链路 2026-07-06 刚拆除，重建成本高。
- 复潮条件: sillyspec 工具原生支持跨目录树子项目登记且 relations 进 CLI 管理时，可重新评估仓库侧为权威源。
- impacts: []
- evidence: 方案对比轮 4；workspace/parser.py:112-363（解析 relations 后唯一消费方丢弃）；backend/app/modules/workspace/service.py:1153（generate_projects 明确不再生成 relations 段）

## D-005@v1: 落选方案 C——local.yaml repos: 注册表平台化下发
- type: architecture
- priority: P0
- status: rejected
- source: code
- question: 同 D-003 取舍问句
- answer: 否决（本期）。否决理由：①local.yaml 为 gitignored 每设备独立文件，平台生成/写入需处理多机差异、并发写、损坏恢复，链路重；②repos: 注册表是 CLI 较新机制（plan-postcheck/cross-repo-reconcile 消费），依赖工具与 daemon 版本，旧环境空转；③对「agent 会话知道关联仓在哪」这个最直接诉求绕远路（需经 CLI 对账才显形）；④改动横跨三端，v1 过重。保留为 v2 演进路线：方案 A 的平台登记数据是 C 的前置（登记数据可后续生成 repos: 段下发）。
- 复潮条件: v1 落地后用户需要工具侧跨仓对账自动化（scope-audit 主动化）时，以 A 的数据模型为基础扩展下发链路。
- impacts: []
- evidence: 方案对比轮 4；工具侧消费证据 sillyspec src/stages/plan-postcheck.js:263-283（parseRepoRegistry）；平台被动收数现状 backend/app/modules/change/scope_audit.py:411-438

## D-006@v1: 砍掉关联类型枚举（spec_source/peer）——用户否决
- type: boundary
- priority: P1
- status: accepted
- source: user
- question: 关联仓要不要 relation_kind 枚举（规范源仓/对等关联仓两档）？
- answer: 用户原话：「我认为没必要类型啊」——v1 两类行为完全一样（都只是注入上下文），枚举只有展示意义，配置时多一步选择。砍掉，保留 name/repo_url/本地路径/描述。v2 若需按类型分化行为（规范聚合/跨仓影响标记），届时再补列迁移（本项目未上线无历史兼容负担，CLAUDE.md 规则 11）。
- normalized_requirement: workspace_linked_repos 无 relation_kind 字段；原型/表单/列表同步去掉类型徽标与单选。
- impacts: [design 数据模型节, FR 卡片, 原型]
- evidence: 设计确认轮 5（AskUserQuestion 自由输入）
- 复潮条件: v2 出现按关联性质分化的实际行为需求时重新评估

## D-007@v1: 关联仓本地路径改为成员级（每用户每机器各自配置）
- type: architecture
- priority: P0
- status: accepted
- source: user
- question: 关联仓的本地路径（root_path_hint）存工作区级单一值还是成员级？
- answer: 用户原话：「你要关注的应该是 不同用户电脑上 这些关联的仓库位置都不一样」——原设计工作区级单值无法适配多成员多机器（A 的 clone 在 C:/Users/A/...，B 的在 /home/b/...）。改为两层：仓的共享登记（name/repo_url/description）为工作区级；本地路径为成员级（每用户各自保存自己的路径），对齐 WorkspaceMemberRuntime 成员绑定 root_path 的既有模式。会话注入时按 lease 认领成员解析其配置的本地路径，未配置则该条只注入 repo_url 并标注路径未配置。
- normalized_requirement: 新增成员级路径表（linked_repo_id + user_id 唯一）；API 提供「我的本地路径」读写端点（普通成员可写自己的，不越权）；claim payload 注入按成员解析。
- impacts: [design 数据模型/API/注入节, FR-01..FR-04, 原型]
- evidence: 设计确认轮 5（AskUserQuestion 自由输入）；成员绑定先例 backend/app/modules/member_runtimes/model.py:21-89（workspace+user+daemon+root_path）

## D-008@v1: 平台配置必须落盘到工具消费点（local.yaml repos: + projects/）——用户定调
- type: architecture
- priority: P0
- status: accepted
- source: user
- question: 平台配置的跨仓关联，除了进平台 DB 和会话上下文，要不要落盘到 sillyspec 工具真正消费的位置？
- answer: 用户原话：「local.yaml 中 和 project 目录 要考虑清楚怎么配置，这个是必须的！ 不涉及 sillyspec 工具能力，做这个功能没意义，并且 sillyspec 现有的能力应该满足的！」——即：平台配置必须驱动工具行为（跨仓对账/子项目登记），纯平台侧登记+会话注入不构成这个功能的意义；且用工具现有机制落盘（不改 sillyspec 本身）。查证证实工具能力满足：① `sillyspec workspace add` 路径校验仅 existsSync(resolve(cwd,path)) 无「根目录内」限制，`../xxx` 跨目录树相对路径可登记（sillyspec/src/workspace.js:38-70）；② `sillyspec local register-repo <key> <path>` 外科写 local.yaml repos: 段，跨仓 task 卡 repo: key 校验/plan-postcheck/MultiRepoContext/scope-audit 消费（sillyspec/src/index.js:4972-5008、src/stages/plan-postcheck.js:247-283）。
- normalized_requirement: 方案修订为「平台登记 + daemon 双落盘」：平台 DB 存登记（工作区共享字段+成员级路径）做 UI/CRUD/审计；daemon 经 spawn CLI 落盘两个工具消费点——`sillyspec workspace add <name> <相对路径> --repo --role`（写 .sillyspec/projects/<name>.yaml，git 内团队共享）与 `sillyspec local register-repo <key> <成员本机绝对路径>`（写 local.yaml repos:，gitignored 每机器）；落盘状态回报平台展示。会话上下文注入降级为可选加分项。（注：`--role` 后经 Design Grill X-004 去除——数据模型无对应字段，见 design 分层要点 2）
- impacts: [design 全部章节, FR-01..FR-06, plan 波次]
- evidence: 设计确认轮 6（AskUserQuestion 自由输入）；工具源码查证同 answer
- 故障面: daemon 落盘经 spawn CLI 有版本依赖（老 sillyspec 无 register-repo 命令则该层降级，需能力探测+状态可见）；成员机器目录布局不满足约定相对路径时 workspace add 落盘失败（需失败回报与 UI 提示）；平台 DB 与落盘产物间存在最终一致窗口
- 退役判据: sillyspec 工具若原生提供「平台侧配置拉取」命令（pull 式），daemon push 式落盘可退役

## D-003@v2: 实现路线修订——「平台登记 + daemon 双落盘」取代纯「登记+会话注入」
- type: architecture
- priority: P0
- status: accepted
- source: user
- question: D-003@v1 选定的方案 A（平台侧登记+会话上下文注入）在用户 D-008 定调后是否维持？
- answer: 不维持纯 A。修订为：A 的平台登记层（CRUD/成员级路径/审计）保留为 UI 与权威源，但价值核心转向 daemon 落盘层（D-008）：projects/*.yaml（workspace add）+ local.yaml repos:（register-repo）。会话注入从必做降为可选。
- normalized_requirement: 同 D-008。
- supersedes: D-003@v1
- impacts: [design, FR, plan]
- evidence: D-008 用户定调轮 6

## D-004@v2: 推翻 D-004@v1 对「仓库侧 projects yaml」的否决——路径约束查证不成立
- type: architecture
- priority: P1
- status: superseded
- source: code
- question: D-004@v1 否决 B（仓库侧 projects yaml 为源）的核心理由「路径必须相对工作区根、独立 spec 仓跨目录树写不进」是否成立？
- answer: 不成立。查证 workspaceAdd 源码：路径仅校验存在性（existsSync(resolve(cwd, projPath))），无根目录内限制；`../platform-specs` 形式相对路径合法（sillyspec/src/workspace.js:38-70）。projects/*.yaml 恢复为落盘层之一（经 CLI 写，不手拼 yaml），但权威源仍在平台 DB（下发向），非「仓库侧为源」。
- 复潮条件: 已复活（作为 D-008 双落盘之一）
- supersedes: D-004@v1
- impacts: []
- evidence: 工具源码查证轮 6

## D-005@v2: 推翻 D-005@v1 对「local.yaml repos 平台化」的本期否决——用户定调为必须
- type: architecture
- priority: P1
- status: superseded
- source: user
- question: D-005@v1 否决 C（repos 注册表平台化下发）「本期不做」是否维持？
- answer: 不维持。用户 D-008 明确 repos: 落盘「必须」。原否决理由①（gitignored 每设备下发链路重）被 D-007 成员级路径设计消解——每成员 daemon 写自己机器的 local.yaml 正是正确模型；register-repo 命令化后写入面从「平台拼文件」缩为「spawn CLI 外科写入」。
- 复潮条件: 已复活（作为 D-008 双落盘之一）
- supersedes: D-005@v1
- impacts: []
- evidence: D-008 用户定调轮 6

## D-009@v1: execute 验收审查返工——越权修复/PATCH 清除语义/best-effort 补全/owner 视角/四处偏差登记
- type: architecture
- priority: P0
- status: accepted
- source: code
- question: execute Stage Review 独立验收（初审 spec/quality 双 fail）提出的安全与功能缺陷、design 偏差如何处置？
- answer: 全部修复+登记。①跨工作区 repo_id 越权（IDOR）：service 层 get/update/delete/upsert_my_path 加 workspace 归属过滤（跨工作区统一 404）+回归用例；②PATCH 清除失效：改 exclude_unset 语义（JSON null=显式清除，缺省=不动）+用例；③best-effort 推送半通道：payload 补逐成员 abs_path（按 binding.user_id 查 paths）、推送挂 PATCH/my-path 端点（原仅 create）、任务引用模块级集合持有（fire-and-forget 不阻塞 CRUD）+用例；④owner 视角走样：summary 提权视角扩为 owner（workspace 建者，_ensure_creator_as_owner 先例）||platform admin；⑤daemon 失败重试一次（R-07 承诺补齐，unsupported 不重试）+3 用例；⑥死代码 clear_all_sync_states 删除。
- normalized_requirement: 实现即约束；四处登记偏差——(a) daemon root_path 本地回退收缩（design 分层要点 5 修订：backend 恒下发为唯一来源，缺失时 daemon 报参数错误，不本地兜底）；(b) GET 列表返回裸数组非 {items}（前后端与生成类型自洽）；(c) sync 端点 200 非 202（无异步任务语义）；(d) 前端删除无二次确认 Modal（visual-evidence 已登记，低频管理操作）。
- impacts: [design 分层要点 5, FR-01..FR-05, verify]
- evidence: execute Stage Review（agent_0b6bed90，2026-10-10）初审报告；修复 diff（service/router/linked_repos_sync/linked-repos-sync.ts/测试）
- 故障面: 无（收敛性修复）
- 退役判据: 无
