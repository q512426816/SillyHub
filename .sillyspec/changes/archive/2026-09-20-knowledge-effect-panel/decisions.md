---
author: qinyi
created_at: 2026-09-20 19:30:00
---

# 决策记录（Decisions）

## D-001@v1: 变更范围=知识库效果面板三件套
- type: boundary
- priority: P0
- status: accepted
- source: user
- question: 本变更做什么？
- answer: 用户对话逐条点单：①使用统计+热力图（知识库被用起来的节奏）②决策库展示效果化（裸文件→卡片，体现防复潮价值）③fr/ 目录（FR 索引，fr-index 新产物）展示效果化（状态/取代链/场景全埋正文里看不见）。统一主题=知识库从「能看到」升级到「看效果」。
- normalized_requirement: 必须交付三件：使用统计（hits 上行+落库+聚合端点+热力图+条目徽标）、决策库卡片流、fr 索引卡片流；不做的事见 design 非目标。
- impacts: [全部 FR]
- evidence: 用户消息（2026-09-20）：知识点使用次数能不能统计展示？做个热力图？+ 决策库展示效果不好 + fr 活规则展示效果不好（fr/knowledge 目录实证 2 文件 11 条）。
- 故障面: hits 上行链路新增 daemon 改动面（此前 knowledge 变更零 daemon 改动）。
- 退役判据: 若 hits 遥测被 CLI 侧改为直接上报平台 HTTP 端点，daemon 豁免上行可撤。

## D-002@v1: 使用统计口径=agent 注入命中（inject）为主
- type: term
- priority: P0
- status: superseded
- supersedes_by: D-002@v2
- source: design
- question: 什么算一次「使用」？
- answer: 【agent 默认，未经用户确认——用户拒绝选择题后自选，待用户亲答追认】只统计 sillyspec CLI 给 agent 注入知识的 inject 命中（现有 2597 条全是这类；知识主消费者是 agent 任务注入，数据真实零埋点）。人工网页浏览不计数（噪声大）。classify 落库存档不进使用计数。用户否决本默认则升 v2。
- normalized_requirement: 使用计数数据源=hits jsonl 的 type=inject 行；matchedFiles 逐锚点拆条落库；classify 仅存档。
- impacts: [FR-统计]
- evidence: hits jsonl 实证形态（inject/classify 两型）；AskUserQuestion 被拒后按推荐默认（用户未反对）。

## D-003@v1: 上行链路=daemon 同步豁免 hits 文件增量上报（非 CLI 直报）
- type: architecture
- priority: P0
- status: accepted
- source: design
- question: 本地 hits 数据如何到服务器？
- answer: 复用既有 spec 同步通道而非改 CLI：daemon 在 spec 同步流程单独摘出 spec 目录下 .runtime/knowledge-hits.jsonl（豁免 UPLOAD_EXCLUDE 的这一个文件），按「已上行字节数/行数」断点增量 POST 到平台新端点批量落库。离线容忍（下次补传）、CLI 零改动、多端各报各的天然合并。
- normalized_requirement: daemon 侧新增 hits 增量上报（豁免单文件不动 .runtime 整体排除语义）；backend 新端点批量接收落库；不得要求 sillyspec CLI 改动。
- impacts: [FR-上行]
- evidence: spec-sync.ts UPLOAD_EXCLUDE_TOP_BASE 既有排除集；hits 文件 append-only 特性（appendKnowledgeHit 恰好一行 JSON）适合 offset 增量。
- 故障面: 行截断（上行时本地正 append）——按完整行断点，尾行不完整留下次。
- 退役判据: CLI 未来原生支持遥测上报时可退役 daemon 豁免通道。

## D-004@v1: 决策库与 fr 索引共用统一条目卡片渲染器
- type: architecture
- priority: P0
- status: superseded
- supersedes_by: D-004@v2
- source: design
- question: decisions/ 与 fr/ 两种条目库怎么展示？
- answer: 两库条目格式同构（## ID : 标题 + 字段：值行），共用一个「结构化条目卡片」渲染器：每条目一张卡（ID+标题、状态徽标、关键字段行、摘要/理由、依据决策↔决策库互跳、全文链接→归档 requirements、最近确认 commit）；superseded/rejected 折叠置底并显式取代链；文件级命中热度徽标。差异字段按 zone 配置化渲染（决策：锚点/理由；FR：场景正文折叠/取代链）。
- normalized_requirement: 前端必须单组件承载两 zone 卡片流（配置差异化），不得两套重复实现；卡片点击进既有 md 阅读视图。
- impacts: [FR-决策卡, FR-FR卡]
- evidence: decisions/backend.md 与 fr/host-fs-handler.md 条目格式实证同构；样式遵循 AI-Native（brand 语义阶）。

## D-005@v1: fr/ 进独立 zone（需求规则组）
- type: term
- priority: P0
- status: accepted
- source: design
- question: fr/ 目录在知识库树的归属？
- answer: parser ZONE_SUBDIRS 增 "fr"，前端 ZONE_GROUPS 增「需求规则（fr/）」组（置于决策库组后）；不混入知识手册组。quicklog 不动。
- normalized_requirement: fr 条目 zone="fr" 透传到前端并独立分组展示。
- impacts: [FR-FR卡]
- evidence: parser.py:15 ZONE_SUBDIRS 现值 {decisions,generated,proposed}；fr-index 持续增长（随归档）需独立入口。

## D-006@v1: 总体方案=daemon 豁免上行+统一卡片渲染器+日历热力图（agent 推荐）
- type: architecture
- priority: P0
- status: superseded
- supersedes_by: D-006@v2
- source: design
- question: 实现方案选型？
- answer: 【agent 推荐，未经用户确认——「用户未反对」不构成确认，此前误标 source:user 已纠正】方案 A：①daemon spec-sync 豁免 hits 单文件断点增量 POST；②backend 新表 knowledge_hits + 批量接收端点 + 聚合查询端点（按条目/按日两视图）；③前端统一条目卡片渲染器（决策+fr 两 zone 配置化）+ GitHub 风格日历热力图（近半年）+ 条目使用徽标 + Top10。否决 B（CLI 改动+每机鉴权复杂）；否决 C（数据留在本机多端不可见，平台无价值）。
- normalized_requirement: 实现必须按方案 A 三段（上行/落库聚合/展示），B/C 路径不得引入。
- impacts: [全部 FR]
- evidence: 对话方案表展示（2026-09-20）+ 用户连续补充需求未提异议。

## D-002@v2: 使用口径=agent 注入命中（用户亲答确认）
- type: term
- priority: P0
- status: superseded
- supersedes: D-002@v1
- source: user
- question: 什么算一次「使用」？
- answer: 用户亲答（2026-09-20）：sillyspec 每次跑任务给 agent 注入知识时命中算一次（=v1 agent 默认口径获确认）；附加要求：必须解决多用户对应单个工作区问题（见 D-007）。
- normalized_requirement: 使用计数=hits jsonl type=inject 行，matchedFiles 逐锚点拆条；多用户汇聚按 D-007。
- impacts: [FR-统计]

## D-006@v2: 总体方案 A 确认（用户亲答）
- type: architecture
- priority: P0
- status: accepted
- supersedes: D-006@v1
- source: user
- question: 总体方案认不认？
- answer: 用户亲答（2026-09-20）：认可方案 A（daemon 豁免增量上行+落库聚合+卡片渲染器+日历热力图），附加要求：上行链路必须解决多用户单工作区问题（见 D-007）。
- normalized_requirement: 按方案 A 实现，多端汇聚语义按 D-007。
- impacts: [全部 FR]

## D-007@v1: 多用户单工作区=各端独立上报+行 hash 幂等去重+行带 daemon 归属
- type: architecture
- priority: P0
- status: accepted
- source: user
- question: 多用户对应单个工作区，统计怎么汇聚不乱？
- answer: 用户亲答提出此问题，方案：①汇聚——各 daemon 只报本机 hits 增量（.runtime 不同步各端文件独立），服务器按行内容 sha256 做幂等去重（唯一约束 workspace_id+line_hash，INSERT ON CONFLICT DO NOTHING），多端天然合并零重复，重装/offset 丢失全量重报亦兜底；②断点——每 daemon 在自身家目录状态文件记已上报 offset（不落 spec 树防同步污染）；③归属——上报经 daemon 鉴权，行落库带 daemon_id（可关联注册用户），展示默认聚合总量（热力图=工作区整体节奏），数据层留归属供后续按人视图。
- normalized_requirement: knowledge_hits 表必须含 (workspace_id, line_hash) 唯一约束与 daemon_id 列；去重必须数据库级幂等；offset 状态不得写入同步 spec 树；聚合端点默认不分人。
- impacts: [FR-上行, FR-统计]
- evidence: 用户亲答（2026-09-20）两问均要求解决多用户单工作区；spec-sync .runtime 双向排除实证各端文件独立。
- 故障面: 两端同一毫秒并发 INSERT 同 hash——唯一约束+ON CONFLICT 兜底，无竞态。

## D-004@v2: 统一条目渲染器覆盖全部 zone（supersedes D-004@v1）
- type: architecture
- priority: P0
- status: accepted
- supersedes: D-004@v1
- source: user
- question: 卡片化只做决策库/fr，还是整个知识库所有目录统一人类友好渲染？
- answer: 用户亲答（2026-09-20 原型反馈）：整个知识库下各目录结构应统一，都搞成人类阅读更友好的形式，参考本仓与 sillyspec 仓的知识结构。统一条目模型（两仓实证同构）：手册文件=## 小节多条目、decisions/fr=## ID+字段行、generated=单条目、INDEX=路由目录页。统一渲染器三形态：①正文小节卡（手册：小节标题+markdown 正文+条目级 🔥 徽标——手册命中本就是 条目#锚点 粒度）②结构化字段卡（决策/FR：状态/字段/理由/取代链/互跳）③目录导航卡（INDEX：分类段+路由行→点击跳对应条目）。每文件保留「原文」tab 切回 md 视图。
- normalized_requirement: 全 zone 文件点开默认进统一卡片流（三形态按文件类型分发）；条目级使用徽标至少覆盖手册与决策/fr；INDEX 渲染为可点击导航。
- impacts: [FR-决策卡, FR-FR卡, FR-统一渲染]
- evidence: 用户原型反馈亲答；两仓 knowledge 目录与文件小节形态实证（conventions/testing-gotchas ## 小节、decisions/fr ## ID、generated 单条目、INDEX 路由行）。

## D-008@v1: 使用榜全量展示不截断
- type: term
- priority: P0
- status: superseded
- supersedes_by: D-008@v2
- source: user
- question: Top 榜限制 10 条？
- answer: 用户亲答：不要限制 10 条，按触发次数顺序全量展示（滚动列表）。
- normalized_requirement: 使用榜=全量条目按命中次数降序，滚动浏览，无条数截断。
- impacts: [FR-统计]
- evidence: 用户原型反馈亲答（2026-09-20）。

## D-009@v1: 热力图删除，换运营指标仪表盘（用户亲答 a）
- type: architecture
- priority: P0
- status: accepted
- source: user
- question: 日历热力图（纯命中次数=开发活跃度混叠，意义不大）怎么处理？
- answer: 用户亲答选 a：删除日历热力图。顶部换运营指标仪表盘四卡：①知识覆盖率（被命中条目/全部条目+趋势）②死条目（90 天零命中，可点开清单引导清理）③每任务命中密度（均值趋势，过低=检索没跟上/过高=注入过肥）④新知识生效速度（近 30 天新增条目已被使用比例）。使用榜改日均使用率排序（命中次数÷条目存在天数，消除老条目累计偏差；绝对次数作副信息）。
- normalized_requirement: 不得呈现纯命中总量日历图；聚合端点必须输出覆盖率/死条目/密度/生效速度四指标与使用率排序（次/天）；条目存在天数取条目可得的创建时间（frontmatter created_at 优先，知识文件 mtime 兜底）。
- impacts: [FR-统计]
- evidence: 用户亲答（2026-09-20）：「我想要的不是整体命中次数……命中率使用率这类运营相关的信息」→ 方案 a/b 二选一 → 亲答「a」。

## D-008@v2: 使用率榜排序=次/任务（按变更+快速修复触发量归一）
- type: term
- priority: P0
- status: superseded
- supersedes: D-008@v1
- source: user
- question: 榜单排序的归一化基准？（v1 误用存在天数）
- answer: 用户亲答修正（2026-09-20）：按变更或者快速修复触发量，不是按天——条目排序指标=该条目命中次数÷其存在期间的任务总数（任务=inject 行 change_name 去重，含变更与 quick），单位**次/任务**（每任务对该知识的平均触发率=运营渗透率，剥离开发量）；绝对次数作副信息；全量不截断保留 v1。
- normalized_requirement: 使用率榜主排序键=条目命中次数/条目存在期间任务数（次/任务）；不得用时间维度归一；任务计数口径=inject 行 change_name 去重（变更+quick 合并）。
- impacts: [FR-03]
- evidence: 用户亲答：「按日均使用率排序（次/天）这个不对 应该按 变更或者快速修复 触发量，不是按天」。

## D-002@v3: 使用计数 type 扩至 {inject, fr-inject}（Grill 实数据修正）
- type: term
- priority: P1
- status: accepted
- supersedes: D-002@v2
- source: design-grill
- question: hits 实测五型（inject/fr-inject/fr-duplicate-warning/fr-supersede/fr-unreferenced，无 classify）——fr-inject 算使用吗？
- answer: 算。fr-inject 同为「给 agent 注入知识」语义（FR 索引注入），属用户口径「每次跑任务注入知识时命中」的自然延伸；实测其 matchedFiles 全空，对条目计数/覆盖率零影响，仅进每任务密度与任务分母口径。其余 fr-*（warning/supersede/unreferenced）为维护事件仅存档。ingest 五型白名单全收。
- normalized_requirement: 使用计数 type∈{inject, fr-inject}；ingest 白名单五型；classify 未在实数据出现但白名单保留容纳。
- impacts: [FR-02, FR-03]
- evidence: Grill rev1 实测 .runtime/knowledge-hits.jsonl 2597 行 type 分布（inject 2580/fr-inject 13/fr-duplicate-warning 1/fr-supersede 2/fr-unreferenced 1）。

## D-008@v3: 触发率百分比显示格式（<10% 两位小数，≥10% 一位小数）
- type: term
- priority: P1
- status: accepted
- supersedes: D-008@v2
- source: user
- question: 次/任务数值怎么展示？
- answer: 用户亲答（2026-09-20）：按 % 显示——小于 10% 显示两位小数（如 3.25%），大于等于 10% 显示一位小数（如 25.4%）。后端 stats 仍出原值 per_task（次/任务浮点），% 格式化为前端展示职责；排序不变（per_task 降序）。
- normalized_requirement: 前端使用率榜主数值=per_task×100 按阈值格式化（<10 → 两位小数%；≥10 → 一位小数%）；绝对次数副信息保留。
- impacts: [FR-03, task-04]
- evidence: 用户亲答：「按每任务触发率排序（次/任务）下面应该按 % 显示 小于 10% 则显示两位小数，大于则显示一位小数」。
