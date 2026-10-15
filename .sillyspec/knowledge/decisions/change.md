# 决策知识 — change

> decision-distill 从变更 decisions.md 幂等提炼（「最近确认」= 归档时 HEAD）。条目字段行为 docs-check 机械解析契约，勿手改。

## D-002@v1
状态：implemented
变更：2026-08-25-session-spec-binding
锚点：backend/migrations/versions/20260825223000_add_quicklog_session_links.py（播种）
最近确认：a9b06c98
理由：links 为唯一关联真相：读侧全部改走 links；alembic 一次性把存量 change_id 播种成 link 行（ON CONFLICT DO NOTHING）；change_id 列保留并继续写入（创建时锚定主变更的冗余提示，双写），后续变更再评估删列。

## D-003@v1 : 三条线打包 = 单变更三波交付（+revision 1 并入波 4）
状态：implemented
变更：2026-08-29-change-delete-closure-and-spec-pull
锚点：未记录
最近确认：0ec935c9
理由：删除收敛+防复活基建（波 1）/删除入口（波 2）/拉取口子（波 3）一个变更三波，波与波共享防复活基建（波 1 建）；进行中可见性经 revision 1 重开 brainstorm 并入为波 4——与波 1-3 同文件（platform_sync/change/changes 页面），并入避免并行变更冲突（规则 19）。跨仓配套（X1-X4）以 repo: sillyspec 任务卡入列，不另开变更。

## D-001@v1 本地用量归属 = 水位差分片段（方案 2）
状态：implemented
变更：2026-10-03-local-usage-segment-attribution
锚点：未记录
最近确认：ba6e699c8
理由：方案 ②（用户 AskUserQuestion 拍板「方案 2」）。协议：每次 agent-logs 上报插一行「水位」记录（上报时刻的 ctx + 当行已落库累计五值：invocations/四维 token）；某变更的本地用量 = 该 ctx 水位与下一水位（或 entry 当前快照）的差分之和。否决 ①（把偏差换个方向：后干的工作量记到先变更）、③（跨变更连续工作是常态，持续失真不可接受——本会话实证 caliber-fix 的量被 backfill 抢走）。
故障面：水位插入与摄取异步竞态（水位取的是「当时已落库值」，摄取稍后刷新——差分仍正确，见 D-002 时序推演）；水位表无界增长（见 D-003 修剪）
退役判据：若未来 CLI 协议升级为逐调用上报（含实时 ctx），水位差分可整体下线换直记

## D-002@v2 水位语义补精度边界（Grill X1 修正，supersedes D-002@v1 的一条断言）
状态：implemented
变更：2026-10-03-local-usage-segment-attribution
锚点：未记录
最近确认：ba6e699c8
理由：恒成立的是**总量守恒**（mark 单调序列 telescoping 可证）；「A 尾巴归 A」仅在尾巴摄取先于 B 上报落库时成立——滞后窗口内跨界 token 归后继变更（错归方向声明：后继多计/前驱少计），窗口=一次摄取延迟。invocations 同步值无此问题。D-002@v1 其余语义不变。
supersedes：D-002@v1

## D-004@v1 首水位锚定 = 差分序列隐式起点 0（Grill X2 P0 修正）
状态：implemented
变更：2026-10-03-local-usage-segment-attribution
锚点：未记录
最近确认：ba6e699c8
理由：每 entry 差分序列隐式起点 0：首水位 ctx 认领 [0, mark_first)。存量迁移语义=与改造前整行归属同值同主（重推 ctx 即当时 ctx）；新文件 mark_first=0 无影响。实现为聚合侧规则（无需插锚定行）。
故障面：首水位 ctx 认领基线——若存量真实归属与重推 ctx 不同（历史换主场景），基线记给重推 ctx（与改造前整行路径行为一致，不劣化）；修剪若未豁免首水位则基线转移（已由 D-003@v2 堵死）
退役判据：若 CLI 协议升级为逐调用实时上报（带 ctx），差分协议与锚定整体下线

## D-001@v1 风险与死路（design 槽4 收割）
状态：implemented
变更：2026-10-09-timeline-tick-stage-filter
锚点：未记录
最近确认：ece14180dc23240f0a83d34f61bc9aab0d9d2f16
理由：最大风险：tasks 域内仍无法区分 tasks.md 与 tasks/task-NN.md 卡片的勾选计数（卡片段落勾选会以「tasks · checked N→M」进入推断）——这是 CLI 同款已知诚实面限制（事件只记计数不记任务 id），本次对齐 CLI 语义不扩大不收窄。试过放弃：①events 表加 stage 列 + watcher 推送带 stage——需 schema 迁移与历史回填，跨仓协同成本远超收益；②按 detail 前缀白名单枚举具体 stage 名（design/proposal…）——黑名单式枚举漏新 stage 域，白名单「仅 tasks 参与」与 CLI 语义一致更稳。

## D-001@v1 风险与死路（design 槽4 收割）
状态：implemented
变更：2026-10-12-backfill-run-change-context
锚点：未记录
最近确认：f48221530edcc4242cce6f30c827420f5a5ffdbb
理由：最大风险：同一 submit 批次（timestamp 全同）内多条不同绑定命令时，批内消息序在 DB 无可靠序号（无 seq/created_at 列，id 为 uuid4）——「最后一条生效」在该面内取边近似随机，其后 NULL run 可错锚且被幂等固化。缓解：解析出不同绑定目标的并列组计入 ambiguous_parallel_groups 显式暴露（dry-run 报告可见、人工可查该 run 日志），真实数据面极窄（同一轮内既 done X 又 start Y 的形态罕见）；次风险：content_redacted 密钥脱敏破坏命令 JSON 可解析性（脱敏在字符串值内替换，结构破坏概率极低），解析失败静默计数（logs_parse_failed）不中断。首命令轮保持 NULL（与运行时一致）的 ≤1 轮切换误差已在上一变更裁决可接受。 试过但放弃： - 用 change_session_links 的链接建立时间做归属——链接只有会话粒度无轮粒度，退化回旧口径；弃。 - 从 platform_agent_logs 水位差分重算——那是本地 CLI 通道，会话有 run 即被防双计谓词排除，不适用平台会话；弃。 - 回填时创建缺失 Change 的 placeholder 行——回填应无副作用超集，缺行意味着变更已删，静默跳过计数更诚实；弃。

## D-001@v1 风险与死路（design 槽4 收割）
状态：implemented
变更：2026-10-12-run-level-change-attribution
锚点：未记录
最近确认：74fbd1ec26e5d14e6cd93fbe686c32b339010057
理由：最大风险：口径双轨期混乱——存量会话（如用户 10-10~10-12 那条 665 轮会话）轮上无锚，仍按会话链接全量摊派，与新会话的拆分口径并存。缓解：FR-03 显式冻结存量行为（防回归用例钉死）；仓库规则 11 允许重置开发数据，用户可选择重跑。 试过但放弃： - 复用 `AgentSession.change_id` 作可变上下文——该列语义是「会话创建时绑定的变更」（派发链写入、会话列表展示消费），拿它当游标会混淆两个含义，且派发会话 change_id 不应被后续命令覆盖；弃。 - submit 时回溯打锚（把 run.change_id 按当轮出现的命令改写）——会把整轮摊给轮中才出现的命令，归属误差方向更差；弃。 - 平台会话水位表（照抄本地机制）——需消息序回放与水位修剪，复杂度高；轮级打锚同效且复用既有原子单位；弃。 已知口径缝隙（评审 P3 披露，范围外不违约）：@ 联想绑定通道（`daemon/session/service/helpers.py` 落 change_session_links）只落 link 不回写 `current_change_id`——经 @ 绑定的变更收不到带锚轮，其统计按旧口径走链接认领（偏小非双计，不会错归别的变更）。本变更上下文回写仅覆盖 run_sync 命令解析通道（run/flow 两命令族）；@ 通道跟进留待后续变更。

## D-001@v1 风险与死路（design 槽4 收割）
状态：implemented
变更：2026-10-13-anchor-mismatch-fix
锚点：未记录
最近确认：2434a7500615f639e0283ced746a8586e8954de9
理由：最大风险：一致指向 X 的轮内实际可能混有上一变更的收尾工作（命令只测到 sillyspec 调用面）——重锚会把这点收尾量记给 X。裁决为可接受：这是既有数据下最优归属，且比现状（整轮错挂上一变更、X 空卡）显著更接近真实；已在报告中呈现命令数供人工复核。 试过但放弃： - 自动修主导型（80% 阈值）——阈值武断且巨轮类形态（126/150 含已删变更命令）语义复杂，降级为仅报告人工裁决；弃。 - token 按消息数比例分摊——无逐轮 token，编造精度；弃。 - 扩展到非交互轮——派发锚是 task 权威链，会话命令不应改写；弃。

## D-006@v1 落选方案 B（fire-and-forget + 前端二次刷新）— rejected
状态：rejected
变更：2026-10-13-change-files-refresh-sync
锚点：未记录
最近确认：76ea8a958
理由：GET 立即返回现有数据 + sync_triggered 标记，daemon 异步跑 CLI，前端延时自动二次拉取。
否决理由：接口零延迟但需改前端刷新逻辑（何时再拉、拉几次的启发式），改动面三端且体验不确定——用户可能要点两次刷新才看到新数据，与「刷新即最新」诉求相悖。
复潮条件：若未来 15s 阻塞预算实测不可接受（大变更同步常态化超 15s），可重新评估异步标记 + 前端二次拉取形态。

## D-007@v1 落选方案 C（新增显式 POST 同步端点 + 前端按钮联动）— rejected
状态：rejected
变更：2026-10-13-change-files-refresh-sync
锚点：未记录
最近确认：76ea8a958
理由：新增 POST 同步端点，前端刷新按钮先 POST 等同步完成再 GET 文件树。
否决理由：GET 保持纯读语义最干净，但三端改动最大；页面自动刷新（非按钮触发）场景覆盖不到；用户诉求是「这个刷新没意义」——期望刷新动作本身带同步，而非新增独立动作。
复潮条件：若同步副作用被证明污染 GET 缓存语义（CDN/网关层缓存 GET），可重新评估显式端点。

## D-001@v1 风险与死路（design 槽4 收割）
状态：implemented
变更：2026-10-13-change-reparse-autobind-remove
锚点：未记录
最近确认：851526254fa79a33b2bbd2fcac960b6b370cb1e6
理由：最大风险：纯本地开发（未走平台会话）产生的新变更不再有任何自动会话关联线索。判定为可接受损失——该场景下平台侧本就没有干活会话，绑「最近活跃」只是错误猜测（本变更的起因即其误伤实例）；真需要回溯时仍有命令通道与人工 @ 绑定可用。 试过但放弃的方案： - 收紧筛选条件（只绑「跑过任意 sillyspec 命令的最近会话」）——仍是猜测式归因，无法区分跑的是别的变更的命令，语义依旧错误。 - reparse 建行时按日志检索「含 `--change <本变更名>` 命令的会话」再绑——该能力命令解析通道已有（extract_spec_bindings 逐段精确解析且天然幂等），重复实现无增益，故整体删除。

## D-001@v1 风险与死路（design 槽4 收割）
状态：implemented
变更：change-list-description
锚点：未记录
最近确认：581ee6412672d6db110f6f0ec6e3114278bef231
理由：最大风险：提取规则对动机段书写形态的覆盖面——动机段可能只有列表、可能含「成功标准」字样在散文中、可能空段。对策：规则保守（无动机段/剥后为空 → None，前端零占位），500 字符截断防长文破版，纯函数加一组形态回归测试（thin 机器稿/完整流程散文/列表首段/无动机段/空前缀）。 放弃的方案：① CLI 侧给 thin proposal 起语义 H1——只惠及未来 thin，存量与完整流程不受益，且机器自动起标题质量不可控；② 前端行内直接拉 proposal 文档渲染——列表页多一轮文档请求、且 search 仍搜不到，不解决「找」的本痛点。
