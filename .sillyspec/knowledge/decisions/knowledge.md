# 决策知识 — knowledge

> decision-distill 从变更 decisions.md 幂等提炼（「最近确认」= 归档时 HEAD）。条目字段行为 docs-check 机械解析契约，勿手改。

## D-001@v1 知识来源范围——会话记录 + 手工录入 + 变更归档
状态：implemented
变更：2026-09-17-knowledge-precipitation
锚点：未记录
最近确认：e83c21744
理由：用户多选确认：会话记录、手工录入、变更归档三项；事件复盘（incident postmortem）不在 v1 范围。

## D-002@v1 蒸馏引擎=派发 agent 会话（非后端直调 LLM）
状态：implemented
变更：2026-09-17-knowledge-precipitation
锚点：未记录
最近确认：e83c21744
理由：用户单选确认：派发 agent 会话。理由（用户选项描述）：能力最强，agent 能读文件、能跑 sillyspec knowledge propose 等命令，产物直接落在 .sillyspec 树内，与 CLI 口径天然一致。
故障面：派发依赖 daemon 在线与 lease 可用；daemon 离线时蒸馏任务排队/失败需有反馈路径。
退役判据：若 agent 会话蒸馏成本/时延不可接受且后端 LiteLLM 直调已能覆盖同等质量，可复议 D-002@v2。

## D-003@v1 入库位置=.sillyspec/knowledge 树（与 sillyspec CLI 同源）
状态：implemented
变更：2026-09-17-knowledge-precipitation
锚点：未记录
最近确认：e83c21744
理由：用户单选确认：写入 .sillyspec/knowledge。候选先进待审区（proposed/），人工审核后合并进正式知识文件并更新 INDEX，经现有 spec 同步（spec_version bump → daemon lease claim 按 latest_spec_version 拉取）回流各端；CLI 与网页看到同一份。
故障面：平台侧写入与 daemon 上行同步可能撞 manifest 乐观锁（冲突走既有 conflict 路径人工拍板）。
退役判据：若知识规模/并发写入增长到文件树形态不可维护（数千条目/多人同时写常态），复议为文件真相源之上加 DB 读索引，而非放弃与 CLI 同源。

## D-005@v1 平台侧写路径=方案A 平台直写（服务端权威写 + 蒸馏上行复用现有同步）
状态：implemented
变更：2026-09-17-knowledge-precipitation
锚点：未记录
最近确认：e83c21744
理由：用户单选确认：方案A 平台直写。手工录入与审核合并由 backend 直接写服务器 spec_root（维护 SpecFileManifest 单写者语义：行版本 +1、spec_version bump、软删备份），网页即时生效不依赖 daemon 在线；agent 蒸馏任务在会话内写本地 .sillyspec 后照现有上行同步回流（pull/push 维持主动快照语义，daemon 决策库 D-004@v1）。与上行同步撞同文件冲突走既有 manifest conflict 人工拍板路径（知识文件写入低频，冲突面可控）。否决方案B（全走 daemon 代写 outbox：daemon 离线即阻塞、异步排队体验差）；否决方案C（分期：人为拖慢用户明确要的蒸馏能力）。
故障面：平台直写与 daemon 上行同步并发改同一知识文件时触发 manifest 冲突（走既有 conflict 人工拍板）；repo-native junction 场景下行应用会改用户 git 工作树，需 git 感知提示。
退役判据：若知识写入频率升高导致冲突常态化，复议 D-005@v2 转代写队列或合并写协调器。

## D-007@v1 merge 两段式 apply + 三类映射目标 + 路由关键词人工输入（Design Grill B-1/B-3 修正）
状态：implemented
变更：2026-09-17-knowledge-precipitation
锚点：未记录
最近确认：e83c21744
理由：两段式：第一段 apply_ops([update(目标文件), update(INDEX.md)])，确认返回无 conflict 后第二段 apply_ops([delete(proposed)])；第二段失败=候选残留幂等可重试。合并目标 v1 限定三类 INDEX 映射文件（known-issues.md/patterns.md/conventions.md）；路由关键词由审核人人工填写（KnowledgeMergeIn.keywords），不做自动派生。另定 path 字段规范：entry.path 保留 .sillyspec/knowledge/ 前缀（顶层条目值不变，兑现兼容承诺），filename 扩展为含子目录段的相对路径，zone 由 filename 首段派生（Grill B-2 定论）。
故障面：两段间窗口内另一端同步改动 proposed 文件 → 第二段 conflict，候选残留（可重试，无知识丢失）。
退役判据：apply_ops 若未来提供事务性整批中止（all-or-nothing）语义，可合并回单段。

## D-008@v2 R-08 三洞修复落定——附件通道取数 + --spec-dir 指路回流 + 三重护栏（supersedes D-008@v1）
状态：implemented
变更：2026-09-17-knowledge-precipitation
锚点：未记录
最近确认：e83c21744
理由：实现期调查（2026-09-17，commit 2c7873e5e）修正前提：**spec 树三策略统一下发 daemon 本地 `~/.sillyhub/daemon/specs/{ws_id}`（交互会话启动 pull + 会话结束 postSpecSync 增量回传，`knowledge/` 在同步集内）**——v1 判断"platform-managed 下 daemon 本地无树"不成立，洞二实为"树在缺指路"。修正落定：①洞一取数走**附件通道**（导出会话日志为 Markdown→SessionAttachmentService 上传→create_session attachment_ids→daemon 落盘 {cwd}/attachments/ 供 agent 读，不污染知识库树；替代 v1 的 .runtime 导出方案——.runtime 在同步排除集内送不到 daemon，v1 方案不可行）；②洞二回流=prompt 统一带 `--spec-dir ~/.sillyhub/daemon/specs/{ws_id}` 指路（CLI 实测 propose 只认 --spec-dir 不认 --spec-root，scan 参数不可照搬）；③洞三护栏=turn>2000 422/单条 8KB 截断/总量 19MB 422 引导 resume；④非多模态引擎（附件通道依赖 provider_caps.multimodal，仅 claude/pi）fresh 会话源 422 守卫。
supersedes：D-008@v1
故障面：附件下载 daemon 侧 60s 超时（既有链路）；postSpecSync 乐观锁冲突靠 pending_push 自愈（既有）；超大对话 resume 模式上下文超限由引擎 compact 兜底。
退役判据：若 daemon 侧未来提供会话记录查询 MCP 工具，可弃附件导出通道。

## D-009@v1 会话源蒸馏默认走原会话续接（reopen+inject），新 agent 为可选项
状态：implemented
变更：2026-09-17-knowledge-precipitation
锚点：未记录
最近确认：e83c21744
理由：会话源默认=原会话续接——平台既有 reopen_session（（续接入口 reopen_session，见 backend/app/modules/daemon/session/service/session_lifecycle.py），续接已结束 claude/codex 会话，SDK resume 保留完整对话历史+prompt cache）+ inject_session(prompt=...)（（inject_session，见 backend/app/modules/daemon/service.py））把提炼指令发进原会话。一举兑现三好处（快/省 token/高质量）并化解 R-08 洞一（原会话读自己，无需取数通道）。新 agent（现状 bootstrap 新建 AgentRun）保留为可选项，用于：会话已删/引擎不支持 resume/用户想换视角。变更源天然走新 agent（文件树无"原会话"概念）。引擎限制：续接仅 claude/codex（provider caps 门控）+ 仅已结束会话可 reopen（进行中用 inject）+ 归档区禁写。原型未体现"谁去干"——前端补选择 UI（会话源默认勾选"原会话续接（推荐）"，旁保留"新建 agent"）。
故障面：续接会话可能比新 agent 更"固执"于原上下文视角（用户已有认知，故保留换 agent 选项）；reopen 对进行中会话报错需引导用 inject 而非 reopen。
退役判据：若后续所有引擎均支持 resume 且用户实测续接质量稳定，可收窄新 agent 选项为高级设置。

## D-010@v1 沉淀闭环增强——已沉淀标签+知识点反链 / quicklog 第三来源 / 新建 agent 复用 create_session / 蒸馏会话隔离
状态：implemented
变更：2026-09-17-knowledge-precipitation
锚点：未记录
最近确认：e83c21744
理由：四项全做，源码可行性已核实：①已沉淀标签=查该源有无 distill run（AgentRun.agent_session_id 关联+metadata_.kind 落档，无需新表），proposed frontmatter 的 source 字段为反链载体（backend/app/modules/knowledge/writer.py 的 frontmatter source 行 现写 manual，蒸馏写 session:<id>/change:<key>/quick:<id>）；合并时把目标小节锚点记入反链（因合并后 proposed 文件删除入备份区，反链须指到合并后目标小节 known-issues.md#某节而非已删 proposed 文件）；②quicklog 与 knowledge 同构（GET /quicklog 现成 backend/app/modules/knowledge/router.py:197），数据在文件树 .sillyspec/quicklog/，新 agent 直接读、连 R-08 洞一取数问题都没有——来源类型扩 quick，单条 ql 小故来源多选；③新建 agent 复用 create_session（backend/app/modules/daemon/session/service/（create_session 入口，见 backend/app/modules/daemon/session/service/create.py） 原生支持 runtime_id 钉机器+provider/agent_profile_id/llm_provider_id/model 完整形态），后端代触发而非用户手点，title 带「提炼」前缀；④AgentSession.metadata_（backend/app/modules/daemon/model.py:457 JSON 列）写 origin=knowledge-distill，常规会话页列表过滤排除，知识库侧 DistillTaskRead 保留 agent_session_id 可跳转——会话有据可循+不污染常规列表双兑现。
故障面：反链映射在合并时若目标小节重命名会失效（锚点漂移，需以 file+section_title 双键而非裸锚点）；蒸馏会话过滤若靠 metadata 判空，老会话（无 origin 字段）默认可见需零回归兜底。
退役判据：若常规会话页引入通用「会话用途」过滤维度，蒸馏隔离可并入该维度不再单列 origin 键。

## D-001@v1 变更范围=知识库效果面板三件套
状态：implemented
变更：2026-09-20-knowledge-effect-panel
锚点：未记录
最近确认：095869924
理由：用户对话逐条点单：①使用统计+热力图（知识库被用起来的节奏）②决策库展示效果化（裸文件→卡片，体现防复潮价值）③fr/ 目录（FR 索引，fr-index 新产物）展示效果化（状态/取代链/场景全埋正文里看不见）。统一主题=知识库从「能看到」升级到「看效果」。
故障面：hits 上行链路新增 daemon 改动面（此前 knowledge 变更零 daemon 改动）。
退役判据：若 hits 遥测被 CLI 侧改为直接上报平台 HTTP 端点，daemon 豁免上行可撤。

## D-003@v1 上行链路=daemon 同步豁免 hits 文件增量上报（非 CLI 直报）
状态：implemented
变更：2026-09-20-knowledge-effect-panel
锚点：未记录
最近确认：095869924
理由：复用既有 spec 同步通道而非改 CLI：daemon 在 spec 同步流程单独摘出 spec 目录下 .runtime/knowledge-hits.jsonl（豁免 UPLOAD_EXCLUDE 的这一个文件），按「已上行字节数/行数」断点增量 POST 到平台新端点批量落库。离线容忍（下次补传）、CLI 零改动、多端各报各的天然合并。
故障面：行截断（上行时本地正 append）——按完整行断点，尾行不完整留下次。
退役判据：CLI 未来原生支持遥测上报时可退役 daemon 豁免通道。

## D-006@v2 总体方案 A 确认（用户亲答）
状态：implemented
变更：2026-09-20-knowledge-effect-panel
锚点：未记录
最近确认：095869924
理由：用户亲答（2026-09-20）：认可方案 A（daemon 豁免增量上行+落库聚合+卡片渲染器+日历热力图），附加要求：上行链路必须解决多用户单工作区问题（见 D-007）。
supersedes：D-006@v1

## D-007@v1 多用户单工作区=各端独立上报+行 hash 幂等去重+行带 daemon 归属
状态：implemented
变更：2026-09-20-knowledge-effect-panel
锚点：未记录
最近确认：095869924
理由：用户亲答提出此问题，方案：①汇聚——各 daemon 只报本机 hits 增量（.runtime 不同步各端文件独立），服务器按行内容 sha256 做幂等去重（唯一约束 workspace_id+line_hash，INSERT ON CONFLICT DO NOTHING），多端天然合并零重复，重装/offset 丢失全量重报亦兜底；②断点——每 daemon 在自身家目录状态文件记已上报 offset（不落 spec 树防同步污染）；③归属——上报经 daemon 鉴权，行落库带 daemon_id（可关联注册用户），展示默认聚合总量（热力图=工作区整体节奏），数据层留归属供后续按人视图。
故障面：两端同一毫秒并发 INSERT 同 hash——唯一约束+ON CONFLICT 兜底，无竞态。

## D-004@v2 统一条目渲染器覆盖全部 zone（supersedes D-004@v1）
状态：implemented
变更：2026-09-20-knowledge-effect-panel
锚点：未记录
最近确认：095869924
理由：用户亲答（2026-09-20 原型反馈）：整个知识库下各目录结构应统一，都搞成人类阅读更友好的形式，参考本仓与 sillyspec 仓的知识结构。统一条目模型（两仓实证同构）：手册文件=## 小节多条目、decisions/fr=## ID+字段行、generated=单条目、INDEX=路由目录页。统一渲染器三形态：①正文小节卡（手册：小节标题+markdown 正文+条目级 🔥 徽标——手册命中本就是 条目#锚点 粒度）②结构化字段卡（决策/FR：状态/字段/理由/取代链/互跳）③目录导航卡（INDEX：分类段+路由行→点击跳对应条目）。每文件保留「原文」tab 切回 md 视图。
supersedes：D-004@v1

## D-009@v1 热力图删除，换运营指标仪表盘（用户亲答 a）
状态：implemented
变更：2026-09-20-knowledge-effect-panel
锚点：未记录
最近确认：095869924
理由：用户亲答选 a：删除日历热力图。顶部换运营指标仪表盘四卡：①知识覆盖率（被命中条目/全部条目+趋势）②死条目（90 天零命中，可点开清单引导清理）③每任务命中密度（均值趋势，过低=检索没跟上/过高=注入过肥）④新知识生效速度（近 30 天新增条目已被使用比例）。使用榜改日均使用率排序（命中次数÷条目存在天数，消除老条目累计偏差；绝对次数作副信息）。

## D-unmapped-012@v1 设计期风险与放弃方案（底稿）
状态：implemented
变更：2026-10-15-platform-vector-search
原编号：D-001@v1
锚点：未记录
文件：.sillyspec/docs/SillyHub/modules/frontend_app.changelog.md, .sillyspec/docs/SillyHub/modules/frontend_components.changelog.md, .sillyspec/docs/multi-agent-platform/modules/frontend.changelog.md, backend/app/core/config.py, backend/app/main.py, backend/app/modules/knowledge/schema.py, backend/app/modules/knowledge/tests/test_vector_search.py, backend/app/modules/knowledge/vector_router.py, backend/app/modules/knowledge/vector_search.py, backend/pyproject.toml, backend/uv.lock
最近确认：e5720127412ce70fe982a121ed96dd6bbadebe4f
理由：最大风险：真模型首查秒级 embed 延迟（700-2400 条）+ 首次模型下载 90MB——已卸线程池不卡事件循环；生产建议镜像预烤模型（文档在 FastembedEmbedder docstring）；workspace 语料超万条时首查可感——当前量级（本体系最大 2400）无虞，超限再引增量索引。次风险：fastembed/ONNX 依赖体积（镜像 +~200MB）——用户已拍板接受；embedding 质量对极短条目（纯标题无理由）弱——语料契约本就含理由文本，模板保证在场。死路（放弃）：①API embedding（litellm/openai）——用户指出 litellm 平台侧已去，且要 key 要钱要外网；②统计向量（TF-IDF/n-gram）——与 CLI 本地层同构重复建设，语义增益零；③pgvector——2400 条暴力余弦毫秒级，数据库往返反而更慢且加迁移负担；④daemon sync 挂点灌索引——免 daemon 改动的懒构建已覆盖，挂点属过早优化。

## D-knowledge-001@v1 2026-09-25-knowledge-anchor-match-tolerance——在 `parser.py` 新增纯函数 `anchor_match_key`（小写 + 只保留 `0-9a-z_` 与中文，丢 emoji/点号/短横/斜杠等全
状态：implemented
变更：2026-09-25-knowledge-anchor-match-tolerance
原编号：D-000@v1
锚点：.sillyspec/changes/archive/2026-09-25-knowledge-anchor-match-tolerance/design.md
文件：backend/app/modules/knowledge/hits.py, backend/app/modules/knowledge/parser.py, backend/app/modules/knowledge/tests/test_hits.py, backend/app/modules/knowledge/tests/test_parser.py
最近确认：未记录
理由：在 `parser.py` 新增纯函数 `anchor_match_key`（小写 + 只保留 `0-9a-z_` 与中文，丢 emoji/点号/短横/斜杠等全部符号）；`HitsService.stats` 聚合前用它建「归一键 → 条目锚点集合」解析表，命中锚点先精确比对（既有行为恒优先），未中且归一键唯一候选才回退到条目锚点，歧义/未中保持原锚点原样。 改两处：`backend/app/modules/knowledge/parser.py`（新常量 + 新函数）、`backend/app/modules/knowledge/hits.py`（stats 内解析闭包 + 聚合循环一行）。**展示层零变化**——条目 anchor 字符串、DTO 字段、前端都不动，只是聚合键从「命中侧原样字符串」换成「解析后的条目锚点」。 选这个落点的理由：条目锚点是本仓按当前文件标题现算的 slug，命中锚点是 CLI 写 INDEX 路由行时的原样字符串，两侧由不同规则/不同人/不同版本维护，实测三类系统性漂移（emoji 前缀、点号、短横折叠）导致逐字比较必然漏计；改 CLI 写侧属跨仓且存量 INDEX 会被 CLI 重写覆盖，改本仓 INDEX.md 会被 CLI 下一次生成覆盖，只有平台侧归一容错是自洽且可本地验证的修法。

## D-knowledge-002@v1 2026-09-27-governance-rpc-actions——①单源收敛：daemon 新增 KnowledgeGovernanceHandler（runtime-handler.ts 同文件，runSillyspecCm
状态：implemented
变更：2026-09-27-governance-rpc-actions
原编号：D-000@v1
锚点：.sillyspec/changes/archive/2026-09-27-governance-rpc-actions/design.md
文件：backend/app/modules/knowledge/router.py, backend/app/modules/knowledge/service.py, backend/app/modules/knowledge/tests/test_governance.py, frontend/src/components/knowledge/__tests__/governance-cards.test.tsx, frontend/src/components/knowledge/governance-cards.tsx, frontend/src/lib/knowledge.ts, sillyhub-daemon/src/daemon.ts, sillyhub-daemon/src/runtime-handler.ts, sillyhub-daemon/tests/knowledge-governance-handler.test.ts
最近确认：未记录
理由：①单源收敛：daemon 新增 KnowledgeGovernanceHandler（runtime-handler.ts 同文件，runSillyspecCmd 扩 cwd 可选参）——knowledge.digest RPC（root_path 元字符黑名单→cwd=仓库根 spawn sillyspec knowledge digest --json，CLI JSON 信封透传；旧版 CLI→method_not_found、超时→timeout、非 JSON→internal）与 knowledge.action RPC（kind 白名单 repair-paths/redomain 硬编码；域名 [a-z0-9-]+ 元字符防线——spawn shell:true 命令串拼接注入面）；daemon.ts 注册两 handler。backend governance_signals RPC 优先（RuntimeLiveService._resolve_binding 解绑定→ws_hub.send_rpc 60s），任何失败（离线/超时/未绑定/未注册）回退本地 _compute（degrade 不 502）；响应加 source（daemon-rpc|local）与 actions_available。②动作回传：POST /knowledge/governance/actions（KNOWLEDGE_WRITE；kind/域名 422 校验）→RPC 执行→输出尾部透传。frontend：GovernanceOut +source/actions_available；actions_available 时坏绑定卡[执行 repair]按钮、伪域卡[迁移到…]输入目标域按钮（[a-z0-9-]+ 前端预校验），useMutation+invalidateQueries；local 模式按钮隐藏。

## D-knowledge-003@v1 2026-10-10-dump-gzip-thread-offload——24h 审查发现 `GET /knowledge/graph/dump` 在 async 端点内同步执行 `json.dumps` + `gzip.compre
状态：implemented
变更：2026-10-10-dump-gzip-thread-offload
原编号：D-000@v1
锚点：.sillyspec/changes/archive/2026-10-10-dump-gzip-thread-offload/design.md
文件：backend/app/modules/knowledge/router.py, backend/app/modules/knowledge/tests/test_graph.py
最近确认：未记录
理由：24h 审查发现 `GET /knowledge/graph/dump` 在 async 端点内同步执行 `json.dumps` + `gzip.compress`（默认 level 9）——大图（2026-10-09-knowledge-graph-fullmap 真图实测 5855 节点/MB 级 payload）该 CPU 段达百 ms~秒级，期间事件循环上全部并发请求（含 SSE 心跳/日志流推送）被阻塞。方案：把序列化+压缩收进单个同步闭包 `_serialize_compress`，经 `asyncio.to_thread` 卸载到工作线程执行。选 to_thread 而非降 compresslevel：降档只缩短阻塞时长不消除阻塞，卸载根治且响应字节零变化（同函数同参数）；选单闭包而非两段分别卸载：json.dumps 的 str 中间产物（MB 级）不必跨线程往返，一次切换开销最小。

## D-knowledge-004@v1 2026-10-15-platform-vector-search——效果评估清偿批 B1 平台面（用户拍板本地小模型方案）：CLI 向量召回层 2026-09-29 发布即对接本端点，平台从未实现（404 半个月实证；CLI 侧
状态：implemented
变更：2026-10-15-platform-vector-search
原编号：D-000@v1
锚点：.sillyspec/changes/archive/2026-10-15-platform-vector-search/design.md
文件：backend/app/core/config.py, backend/app/main.py, backend/app/modules/knowledge/schema.py, backend/app/modules/knowledge/tests/test_vector_search.py, backend/app/modules/knowledge/vector_router.py, backend/app/modules/knowledge/vector_search.py, backend/pyproject.toml, backend/uv.lock
最近确认：未记录
理由：效果评估清偿批 B1 平台面（用户拍板本地小模型方案）：CLI 向量召回层 2026-09-29 发布即对接本端点，平台从未实现（404 半个月实证；CLI 侧已收紧为显式开启+404 短路，见 sillyspec 仓 2026-10-15-vector-gate-tighten）。本变更补齐平台端四件： ① **端点** `POST /api/spec/knowledge/vector-search`（vector_router.py，独立 router 不入 /workspaces/{id}/knowledge/* 族——路径在 /spec/* 命名空间、shpsync token 鉴权单通道，对齐 platform_sync router 形态）。鉴权复用 require_platform_sync 三通道分流，但**只接受 shpsync_ workspace token**（scope.workspace_id 非 None；shk_live_/JWT 凭据有效也 403——并集 scope 表达不了「检索单一 workspace 语料」，且 CLI 固化 Bearer shpsync_）。 ② **embedding = fastembed 本地 ONNX 小模型**（`BAAI/bge-small-zh-v1.5`，512 维，镜像内 ~90MB 首用自动下载，零 key 零 API 零持续成本；`Settings.knowledge_embedding_model` 可配）。lazy import 不阻塞启动；初始化任何异常缓存为不可用态（进程级一次），端点 fail-soft 返回 `{ok, results:[], model_ready:false, reason}`——CLI 按空 results 静默降级本地词面层（与 404 时代降级契约同语义）。 ③ **索引** = 进程内 per-workspace 按文件集指纹 `(name, mtime_ns, size)` 懒构建缓存。**设计偏差（相对提案）**：daemon sync 挂点灌索引 → 查询时懒构建（语料 700-2400 条秒级，免 daemon 改动，文件增删改自动失效自愈）。 ④ **语料与相似度**：workspace spec 树 `knowledge/decisions/*.md` 条目（CLI `buildResultFromPlatform` 只认该前缀），embedding 文本 = `id+标题+理由`（rejected 条目照常入索引——策略面 CLI 本地解析，「平台只做语义召回」原则）；归一化点积纯 Python（不引 numpy 耦合）。检索主体经 run_in_threadpool 卸载（首查秒级不卡事件循环）。 依赖：pyproject 增 `fastembed>=0.4`（uv lock 已同步）；测试不依赖 fastembed（embedder 全 fake 注入）。

## D-knowledge-005@v1 2026-11-03-distill-prompt-fix——答：纯 prompt 文样工程，只改 `backend/app/modules/knowledge/distill.py` 的 `build_distill_p
状态：implemented
变更：2026-11-03-distill-prompt-fix
原编号：D-000@v1
锚点：.sillyspec/changes/archive/2026-11-03-distill-prompt-fix/design.md
文件：backend/app/modules/knowledge/distill.py, backend/app/modules/knowledge/tests/test_distill.py
最近确认：未记录
理由：答：纯 prompt 文样工程，只改 `backend/app/modules/knowledge/distill.py` 的 `build_distill_prompt` 拼装面（resume 式 source_line 一句、propose_cmd 命令模板、spec_note 落盘指引、新增公共「传参规则 + 回流确认」段、提炼要求补查重/幂等/数量条目），不动 dispatch、取数、导出渲染逻辑。方案依据：用户转写的两轮提示词评审反馈 + 本机 sillyspec 3.34.0 实证（--from 受支持；--spec-dir 悬空时 propose 静默 mkdir 孤儿树；platform sync 静默忽略 --spec-dir、根解析走 cwd/.sillyspec-platform.json 指针；knowledge search 必须 --query 传参；propose 同题幂等 update）。命令模板换单引号 body 从源头规避 shell 展开损坏；spec_note 改核验回落规则替代失实的「自动上行」承诺；回流确认段把验证动作显式化进提示词。

## D-knowledge-006@v1 2026-11-03-knowledge-search-hardening——答：落地用户拍板的 B+D+C 三项止血（A 治本另立 brainstorm，不在本变更内）。
状态：implemented
变更：2026-11-03-knowledge-search-hardening
原编号：D-000@v1
锚点：.sillyspec/changes/archive/2026-11-03-knowledge-search-hardening/design.md
文件：backend/app/modules/knowledge/search.py, backend/app/modules/knowledge/tests/test_knowledge_search.py, deploy/docker-compose.yml, frontend/src/app/(dashboard)/workspaces/[id]/knowledge/page.tsx
最近确认：未记录
理由：答：落地用户拍板的 B+D+C 三项止血（A 治本另立 brainstorm，不在本变更内）。B：backend `mem_limit` 2500m→3500m——2026-11-03 生产诊断实证（宿主 dmesg：10 月 40 次、11-02 2 次 cgroup OOM kill，被杀者 oom_score_adj=0 的模型 worker 子进程，anon-rss ~2.4G；2500m 对「服务本体 ~460M + 嵌入/翻译双 worker 并存」峰值偏紧），宿主 7.5G 下全栈限额总和升至 ~4.25G 仍充裕。D：`KnowledgeSearchState.updated_at` 补 `onupdate`（对齐 mcp_registry/model.py 先例）——该列原只有 `default_factory`，同步成功不刷新，DB 恒显示建行时间，本次排障先被误导；onupdate 是 SQLAlchemy 客户端侧行为，不改列 DDL，无需迁移。C：前端等待文案与降级徽标对齐真实机制——等待文案改「增量同步」口径；徽标按 `reason` 区分 `index_not_built`（索引未预建）与其余（模型不可用）。搜索同步的架构性改造（内联差量嵌入移出请求路径）留给 A 立项头脑风暴，本变更不触碰 search_sync 编排。
