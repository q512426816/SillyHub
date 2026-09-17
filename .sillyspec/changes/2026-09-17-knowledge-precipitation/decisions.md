---
author: qinyi
created_at: 2026-09-17 09:37:28
---

# 决策记录（Decisions）

## D-001@v1: 知识来源范围——会话记录 + 手工录入 + 变更归档
- type: boundary
- priority: P0
- status: accepted
- source: user
- question: 知识沉淀 v1 从哪些记录生成知识？
- answer: 用户多选确认：会话记录、手工录入、变更归档三项；事件复盘（incident postmortem）不在 v1 范围。
- normalized_requirement: 平台知识沉淀入口必须支持（a）选择已有 agent 会话提炼、（b）表单手工录入、（c）选择已归档变更提炼；不实现事件复盘转知识。
- impacts: [FR-01, FR-02, FR-03]
- evidence: 用户 AskUserQuestion 回答轮次 1（2026-09-17）；incident 现状=Postmortem 仅存 DB（backend/app/modules/knowledge/../incident/service.py），lessons_learned 未落知识文件。

## D-002@v1: 蒸馏引擎=派发 agent 会话（非后端直调 LLM）
- type: architecture
- priority: P0
- status: accepted
- source: user
- question: 候选知识如何生成——后端直调 LLM、派发 agent 会话、还是不调 AI？
- answer: 用户单选确认：派发 agent 会话。理由（用户选项描述）：能力最强，agent 能读文件、能跑 sillyspec knowledge propose 等命令，产物直接落在 .sillyspec 树内，与 CLI 口径天然一致。
- normalized_requirement: 会话/变更来源的知识提炼必须通过平台现有 agent 会话基建（AgentRun + daemon lease）派发后台任务执行；后端不做直调 LLM 的蒸馏实现。
- impacts: [FR-01, FR-03, design-任务派发节]
- evidence: 用户 AskUserQuestion 回答轮次 1（2026-09-17）；平台派发先例=spec_workspace 的 SpecBootstrapService.bootstrap（建 AgentRun 后台跑）。
- 故障面: 派发依赖 daemon 在线与 lease 可用；daemon 离线时蒸馏任务排队/失败需有反馈路径。
- 退役判据: 若 agent 会话蒸馏成本/时延不可接受且后端 LiteLLM 直调已能覆盖同等质量，可复议 D-002@v2。

## D-003@v1: 入库位置=.sillyspec/knowledge 树（与 sillyspec CLI 同源）
- type: architecture
- priority: P0
- status: accepted
- source: user
- question: 沉淀的知识存哪里——写入 .sillyspec/knowledge 还是平台独立存储？
- answer: 用户单选确认：写入 .sillyspec/knowledge。候选先进待审区（proposed/），人工审核后合并进正式知识文件并更新 INDEX，经现有 spec 同步（spec_version bump → daemon lease claim 按 latest_spec_version 拉取）回流各端；CLI 与网页看到同一份。
- normalized_requirement: 所有平台侧知识写入必须落在 spec_root 的 knowledge/ 子树内并维护 SpecFileManifest（apply_ops 单写者语义，D-011）；不新建独立知识存储表。
- impacts: [FR-04, FR-05, design-写路径节]
- evidence: 用户 AskUserQuestion 回答轮次 1（2026-09-17）；spec_workspace 模块卡片（manifest 乐观锁/apply_ops 单写者）；decisions/sillyhub-daemon.md D-004@v1（lease claim 按 latest_spec_version 下行传播）。
- 故障面: 平台侧写入与 daemon 上行同步可能撞 manifest 乐观锁（冲突走既有 conflict 路径人工拍板）。
- 退役判据: 若知识规模/并发写入增长到文件树形态不可维护（数千条目/多人同时写常态），复议为文件真相源之上加 DB 读索引，而非放弃与 CLI 同源。

## D-004@v1: 知识库显示范围修复——递归 zone 展示对齐 CLI 口径
- type: term
- priority: P0
- status: accepted
- source: user
- question: 用户抱怨"workspace 下其他目录文件不显示"——知识库页到底显示什么？
- answer: 知识库页按设计只显示 spec 树 knowledge/ 目录的知识文档（不是 workspace 文件浏览器，那是 explorer 页职责）；但现实现 parser.py 非递归 glob 顶层 *.md，把 decisions/（13 文件）与 generated/（39 文件）整个吞掉，与 sillyspec CLI zone 口径不一致，属缺陷。本变更一并修复为递归 zone 分组展示。
- normalized_requirement: 知识库列表必须递归展示 knowledge/ 下全部子目录的 .md 条目并按 zone（顶层手册/decisions/generated/proposed）分组；workspace 其他业务目录（frontend/、backend/ 等）不进知识库页。
- impacts: [FR-06]
- evidence: backend/app/modules/knowledge/parser.py:40-46（glob("*.md") 非递归）；本地实证 ~/.sillyhub/daemon/specs/b97f8231-9404-43bd-89de-38c281c4d875/knowledge/（junction→主仓 .sillyspec）含 decisions/ generated/ 子目录；sillyspec CLI inspect 按 generated/、proposed/ 前缀分区。

## D-005@v1: 平台侧写路径=方案A 平台直写（服务端权威写 + 蒸馏上行复用现有同步）
- type: architecture
- priority: P0
- status: accepted
- source: user
- question: 平台侧知识写入架构——平台直写 / daemon 代写排队 / 分期交付？
- answer: 用户单选确认：方案A 平台直写。手工录入与审核合并由 backend 直接写服务器 spec_root（维护 SpecFileManifest 单写者语义：行版本 +1、spec_version bump、软删备份），网页即时生效不依赖 daemon 在线；agent 蒸馏任务在会话内写本地 .sillyspec 后照现有上行同步回流（pull/push 维持主动快照语义，daemon 决策库 D-004@v1）。与上行同步撞同文件冲突走既有 manifest conflict 人工拍板路径（知识文件写入低频，冲突面可控）。否决方案B（全走 daemon 代写 outbox：daemon 离线即阻塞、异步排队体验差）；否决方案C（分期：人为拖慢用户明确要的蒸馏能力）。
- normalized_requirement: 手工录入/审核合并的写入必须由 backend 服务端直接落盘 spec_root 并维护 manifest/spec_version；不得引入 DaemonChangeWrite 代写队列作为知识写路径；蒸馏产物仍走会话内 CLI 写入+现有上行同步。
- impacts: [FR-02, FR-05, design-写路径节]
- evidence: 用户 AskUserQuestion 方案选择轮次（2026-09-17）；对比方案：B=daemon 代写排队（daemon 离线阻塞）、C=分期交付（蒸馏延后）。
- 故障面: 平台直写与 daemon 上行同步并发改同一知识文件时触发 manifest 冲突（走既有 conflict 人工拍板）；repo-native junction 场景下行应用会改用户 git 工作树，需 git 感知提示。
- 退役判据: 若知识写入频率升高导致冲突常态化，复议 D-005@v2 转代写队列或合并写协调器。

## D-006@v1: 编辑范围=手册层+自动生成层+候选全可编辑；决策库 v1 只读
- type: term
- priority: P0
- status: accepted
- source: user
- question: 设计确认轮用户反馈"已生成的知识应该也能修改"——网页编辑能力覆盖哪些分区？
- answer: 手册层（顶层 *.md）与自动生成层（generated/*.md）全部开放网页编辑（Markdown 编辑器，保存走平台直写：版本+1、旧内容入 30 天备份区、frontmatter 保持不动）；候选（proposed/）本就可编辑。决策库 decisions/ v1 只读——该目录由变更归档时的 decision-distill 幂等维护，语义属主是工具流程，网页手改存在被后续归档蒸馏冲突/覆盖的语义风险，暂不开放（后续有真实需求再复议 v2）。
- normalized_requirement: 知识库页手册层与 generated 层条目必须提供编辑入口（写权限门控 KNOWLEDGE_WRITE，保存维护 manifest 版本与备份）；decisions/ 条目网页端不提供编辑入口并标注"由归档流程维护"。
- impacts: [FR-07]
- evidence: 用户设计确认轮反馈（2026-09-17）；decision-distill 幂等语义见 sillyspec CLI knowledge-match.js/decisions 条目格式（## D-xxx@vN 状态/变更/锚点/最近确认）。


## D-007@v1: merge 两段式 apply + 三类映射目标 + 路由关键词人工输入（Design Grill B-1/B-3 修正）
- type: architecture
- priority: P0
- status: accepted
- source: design-grill
- question: apply_ops 逐 op 冲突跳过语义下单批 update+delete 会产生"候选已删但 INDEX 缺行"半态；CLI classify 四类外目标文件无 INDEX 分类段落点——merge 如何安全落地？
- answer: 两段式：第一段 apply_ops([update(目标文件), update(INDEX.md)])，确认返回无 conflict 后第二段 apply_ops([delete(proposed)])；第二段失败=候选残留幂等可重试。合并目标 v1 限定三类 INDEX 映射文件（known-issues.md/patterns.md/conventions.md）；路由关键词由审核人人工填写（KnowledgeMergeIn.keywords），不做自动派生。另定 path 字段规范：entry.path 保留 .sillyspec/knowledge/ 前缀（顶层条目值不变，兑现兼容承诺），filename 扩展为含子目录段的相对路径，zone 由 filename 首段派生（Grill B-2 定论）。
- normalized_requirement: merge 必须两段式提交且第二段以第一段无 conflict 为前置；merge 目标文件白名单=三类映射文件；KnowledgeMergeIn 必含 keywords；entry.path 永远带 .sillyspec/knowledge/ 前缀。
- impacts: [FR-05, FR-06, task-3.1, task-3.2]
- evidence: spec_workspace/service.py:2072-2080（conflict 逐 op continue）/:2115-2131（delete 独立执行）/:2263-2314（单 commit）；knowledge-classify.js:32-33（categoryForTarget 四类外 fail）；parser.py:62（现 path 带前缀）。
- 故障面: 两段间窗口内另一端同步改动 proposed 文件 → 第二段 conflict，候选残留（可重试，无知识丢失）。
- 退役判据: apply_ops 若未来提供事务性整批中止（all-or-nothing）语义，可合并回单段。

## D-008@v1: 蒸馏源记录交付断链 R-08 修复方向=补取数通道（后端导出会话记录为文件）
- type: architecture
- priority: P0
- status: accepted
- source: user
- question: execute 后探索发现会话源蒸馏断链（对话在 DB 不在文件树、agent 无取数通道），如何修复？
- answer: 首选方向 1「补取数通道」：后端把会话记录分页导出为临时文件落 workspace（如 .sillyspec/.runtime/distill-sources/<session_id>.md），prompt 从「读会话 session_id」改为「读这个文件路径」，agent 用 grep/分片增量读取。变更源回流（平台直写候选下行预置到 daemon 本地）与超阈值分段 map-reduce 列为后续增强。平台侧传指针（不搬运对话内容）的设计本身正确保留。
- normalized_requirement: 会话源蒸馏的 prompt 必须指向一个 agent 可读的文件路径（而非裸 session_id）；导出文件必须分页生成（防 100MB 全量重放撑爆）；变更源蒸馏在 platform-managed 策略下的候选回流必须经既有 spec 同步下行可达。
- impacts: [R-08, design-蒸馏源记录交付断链节, task-09 部署期 M2]
- evidence: 探索会话结论（2026-09-17 16:03）+ 主代理核实：agent_run_logs=DB 表（agent/model.py:485）、prompt 只内嵌 session_id（distill.py:81）、mcp-server.ts 无查会话工具、distill.py:84 变更源指文件树但平台知识库在服务器 spec_root。
- 故障面: 导出文件落 workspace 增加磁盘占用（需清理策略）；超大导出文件需分页与体量护栏（洞三）。
- 退役判据: 若未来 daemon 侧提供查会话记录的 MCP 工具，可弃文件导出通道直接走接口（减少落盘）。

## D-009@v1: 会话源蒸馏默认走原会话续接（reopen+inject），新 agent 为可选项
- type: architecture
- priority: P0
- status: accepted
- source: user
- question: 会话源蒸馏派谁去干？用户提出并确认：最好让原 agent 会话续接去沉淀（有完整上下文——快+省 token+高质量），同时保留换其他 agent 的选项。
- answer: 会话源默认=原会话续接——平台既有 reopen_session（session_lifecycle.py:41，续接已结束 claude/codex 会话，SDK resume 保留完整对话历史+prompt cache）+ inject_session(prompt=...)（service.py:764）把提炼指令发进原会话。一举兑现三好处（快/省 token/高质量）并化解 R-08 洞一（原会话读自己，无需取数通道）。新 agent（现状 bootstrap 新建 AgentRun）保留为可选项，用于：会话已删/引擎不支持 resume/用户想换视角。变更源天然走新 agent（文件树无"原会话"概念）。引擎限制：续接仅 claude/codex（provider caps 门控）+ 仅已结束会话可 reopen（进行中用 inject）+ 归档区禁写。原型未体现"谁去干"——前端补选择 UI（会话源默认勾选"原会话续接（推荐）"，旁保留"新建 agent"）。
- normalized_requirement: 会话源蒸馏必须默认走原会话续接路径（reopen+inject），新建 agent 为显式可选降级；前端必须暴露"谁去干"的选择且默认推荐续接；引擎不支持 resume/会话已删时自动或引导降级到新 agent 路径。
- impacts: [R-08 洞一化解, FR-01, task-08 UI 增选项, design-蒸馏派发节]
- evidence: 用户提出并确认（2026-09-17 16:34）；源码核实：reopen_session session_lifecycle.py:41（claude/codex resume+prompt cache 保留）、inject_session service.py:764（带 prompt 下发）、AgentRun.agent_session_id 关联（model.py:267）；D-008 取数通道降级为新 agent 路径专用。
- 故障面: 续接会话可能比新 agent 更"固执"于原上下文视角（用户已有认知，故保留换 agent 选项）；reopen 对进行中会话报错需引导用 inject 而非 reopen。
- 退役判据: 若后续所有引擎均支持 resume 且用户实测续接质量稳定，可收窄新 agent 选项为高级设置。

## D-010@v1: 沉淀闭环增强——已沉淀标签+知识点反链 / quicklog 第三来源 / 新建 agent 复用 create_session / 蒸馏会话隔离
- type: architecture
- priority: P0
- status: accepted
- source: user
- question: ①已沉淀的会话/变更要有标签提示并可指向知识点；②快速修复日志也应作为来源；③新建 agent 应像会话新建一样先选机器再选 agent 类型、有据可循；④这类会话不要在常规会话页展示、只在知识库侧有提炼记录跳转。
- answer: 四项全做，源码可行性已核实：①已沉淀标签=查该源有无 distill run（AgentRun.agent_session_id 关联+metadata_.kind 落档，无需新表），proposed frontmatter 的 source 字段为反链载体（writer.py:350 现写 manual，蒸馏写 session:<id>/change:<key>/quick:<id>）；合并时把目标小节锚点记入反链（因合并后 proposed 文件删除入备份区，反链须指到合并后目标小节 known-issues.md#某节而非已删 proposed 文件）；②quicklog 与 knowledge 同构（GET /quicklog 现成 router.py:197），数据在文件树 .sillyspec/quicklog/，新 agent 直接读、连 R-08 洞一取数问题都没有——来源类型扩 quick，单条 ql 小故来源多选；③新建 agent 复用 create_session（session/service/create.py:42 原生支持 runtime_id 钉机器+provider/agent_profile_id/llm_provider_id/model 完整形态），后端代触发而非用户手点，title 带「提炼」前缀；④AgentSession.metadata_（model.py:457 JSON 列）写 origin=knowledge-distill，常规会话页列表过滤排除，知识库侧 DistillTaskRead 保留 agent_session_id 可跳转——会话有据可循+不污染常规列表双兑现。
- normalized_requirement: 来源选择须含会话/变更归档/快速修复三类且 quicklog 支持多选；已沉淀标签须基于真实 distill run 判定（非前端假标）；合并动作须把目标小节锚点写入反链供来源侧跳转；新建 agent 蒸馏会话须经 create_session 完整链路（可追机器+agent 类型）且 AgentSession.metadata_.origin=knowledge-distill 使其在常规会话页不可见、仅知识库提炼记录可跳转。
- impacts: [FR-01/FR-03 扩, task-07 扩 source_type, task-08 UI 扩来源+标记+跳转, design-蒸馏派谁去干节扩]
- evidence: 用户提出并确认（2026-09-17 16:46）；源码核实：create_session create.py:42（runtime_id 优先于 provider 双入口）、AgentSession.metadata_ model.py:457、quicklog 同构 router.py:197、AgentRun.agent_session_id 关联 model.py:267。
- 故障面: 反链映射在合并时若目标小节重命名会失效（锚点漂移，需以 file+section_title 双键而非裸锚点）；蒸馏会话过滤若靠 metadata 判空，老会话（无 origin 字段）默认可见需零回归兜底。
- 退役判据: 若常规会话页引入通用「会话用途」过滤维度，蒸馏隔离可并入该维度不再单列 origin 键。

## D-008@v2: R-08 三洞修复落定——附件通道取数 + --spec-dir 指路回流 + 三重护栏（supersedes D-008@v1）
- type: architecture
- priority: P0
- status: accepted
- supersedes: D-008@v1
- source: design-grill
- question: D-008@v1 的修复方向在实现期经源码调查发现洞二前提不成立，修复方案如何修正落定？
- answer: 实现期调查（2026-09-17，commit 2c7873e5e）修正前提：**spec 树三策略统一下发 daemon 本地 `~/.sillyhub/daemon/specs/{ws_id}`（交互会话启动 pull + 会话结束 postSpecSync 增量回传，`knowledge/` 在同步集内）**——v1 判断"platform-managed 下 daemon 本地无树"不成立，洞二实为"树在缺指路"。修正落定：①洞一取数走**附件通道**（导出会话日志为 Markdown→SessionAttachmentService 上传→create_session attachment_ids→daemon 落盘 {cwd}/attachments/ 供 agent 读，不污染知识库树；替代 v1 的 .runtime 导出方案——.runtime 在同步排除集内送不到 daemon，v1 方案不可行）；②洞二回流=prompt 统一带 `--spec-dir ~/.sillyhub/daemon/specs/{ws_id}` 指路（CLI 实测 propose 只认 --spec-dir 不认 --spec-root，scan 参数不可照搬）；③洞三护栏=turn>2000 422/单条 8KB 截断/总量 19MB 422 引导 resume；④非多模态引擎（附件通道依赖 provider_caps.multimodal，仅 claude/pi）fresh 会话源 422 守卫。
- normalized_requirement: fresh 会话源蒸馏必须经附件通道携带导出记录（agent 可读路径）；所有 propose 命令必须带 --spec-dir 指向 daemon 本地 spec 目录；体量护栏三重（turn/单条/总量）；附件引擎门控必须前置校验。
- impacts: [R-08 闭环, FR-01, task-09 部署期 M2 验证范围]
- evidence: commit 2c7873e5e（81 测试绿）；源码锚点：daemon.ts _startInteractiveSession（pull 落点三策略统一）、spec-sync.ts UPLOAD_EXCLUDE_TOP_BASE（knowledge/ 在同步集）、turn-control.ts（附件落盘 {cwd}/attachments）、CLI `sillyspec knowledge propose --help` 实测（只认 --spec-dir）；config.py:271 spec_transport=tar。
- 故障面: 附件下载 daemon 侧 60s 超时（既有链路）；postSpecSync 乐观锁冲突靠 pending_push 自愈（既有）；超大对话 resume 模式上下文超限由引擎 compact 兜底。
- 退役判据: 若 daemon 侧未来提供会话记录查询 MCP 工具，可弃附件导出通道。
