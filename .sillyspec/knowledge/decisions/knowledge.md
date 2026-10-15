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
最近确认：e5720127412ce70fe982a121ed96dd6bbadebe4f
理由：最大风险：真模型首查秒级 embed 延迟（700-2400 条）+ 首次模型下载 90MB——已卸线程池不卡事件循环；生产建议镜像预烤模型（文档在 FastembedEmbedder docstring）；workspace 语料超万条时首查可感——当前量级（本体系最大 2400）无虞，超限再引增量索引。次风险：fastembed/ONNX 依赖体积（镜像 +~200MB）——用户已拍板接受；embedding 质量对极短条目（纯标题无理由）弱——语料契约本就含理由文本，模板保证在场。死路（放弃）：①API embedding（litellm/openai）——用户指出 litellm 平台侧已去，且要 key 要钱要外网；②统计向量（TF-IDF/n-gram）——与 CLI 本地层同构重复建设，语义增益零；③pgvector——2400 条暴力余弦毫秒级，数据库往返反而更慢且加迁移负担；④daemon sync 挂点灌索引——免 daemon 改动的懒构建已覆盖，挂点属过早优化。
