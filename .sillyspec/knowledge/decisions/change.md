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
文件：.sillyspec/changes/change-list-description/tasks.md, backend/app/modules/change/model.py, backend/app/modules/change/parser.py, backend/app/modules/change/schema.py, backend/app/modules/change/service.py, backend/app/modules/change/tests/test_reparse_guard.py, backend/app/modules/change/tests/test_title_normalization.py, backend/app/modules/change/title_norm.py, backend/app/modules/platform_sync/service.py, backend/migrations/versions/20260928140000_add_change_description.py, backend/openapi.json, frontend/src/app/(dashboard)/workspaces/[id]/changes/__tests__/page.test.tsx, frontend/src/app/(dashboard)/workspaces/[id]/changes/page.tsx, frontend/src/app/m/workspaces/[id]/changes/page.tsx, frontend/src/components/daemon/__tests__/session-fork-lineage.test.tsx, frontend/src/components/mobile/mobile-change-card.tsx, frontend/src/lib/api-types.ts, sillyhub-daemon/tests/task-runner-lease-cancel-idempotent.test.ts, .sillyspec/changes/change-list-description/design.md, .sillyspec/changes/change-list-description/proposal.md
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

## D-change-001@v1 2026-09-26-assets-test-binding-raw-text——只读展示增强，三件：①后端 ChangeTestRow 加 raw_binding: str | None（schema.py），assets.py 新增 _r
状态：implemented
变更：2026-09-26-assets-test-binding-raw-text
原编号：D-000@v1
锚点：.sillyspec/changes/archive/2026-09-26-assets-test-binding-raw-text/design.md
文件：backend/app/modules/change/assets.py, backend/app/modules/change/schema.py, backend/app/modules/change/tests/test_assets.py, backend/openapi.json, frontend/src/components/changes/detail/__tests__/change-assets-card.test.tsx, frontend/src/components/changes/detail/change-assets-card.tsx, frontend/src/lib/api-types.ts
最近确认：未记录
理由：只读展示增强，三件：①后端 ChangeTestRow 加 raw_binding: str | None（schema.py），assets.py 新增 _read_binding_raw_text(change_dir)——读归档 requirements.md，按正则匹配「AGENT:测试绑定(FR-XX)」槽注释行，取其后连续非空内容行拼为原文，返回 {锚点: 原文} 映射；_read_test_rows 增第二参数接收映射填充 raw_binding（锚点缺席 → None）。②规则 21：pnpm gen:types 重生成 api-types.ts + openapi.json 随提交。③前端资产卡测试绑定行下渲染原文小字（raw_binding 与 tests 列表等价时不渲染，避免纯文件级绑定的重复行）。选「读 requirements 原文」而非改摘录器：摘录在 sillyspec CLI（外部工具，已留坑待修），requirements.md 归档件只读解析零审计影响，且对全部存量归档立即生效。

## D-change-002@v1 2026-09-26-change-asset-transparency——只读展示增强，沿用沉淀资产聚合与卡片：①后端 assets.py 两组聚合——知识触达复用既有 fr/decisions 条目解析（_parse_entries
状态：implemented
变更：2026-09-26-change-asset-transparency
原编号：D-000@v1
锚点：.sillyspec/changes/archive/2026-09-26-change-asset-transparency/design.md
文件：backend/app/modules/change/assets.py, backend/app/modules/change/schema.py, backend/app/modules/change/tests/test_assets.py, backend/openapi.json, frontend/src/components/changes/detail/__tests__/change-assets-card.test.tsx, frontend/src/components/changes/detail/change-assets-card.tsx, frontend/src/lib/api-types.ts
最近确认：未记录
理由：只读展示增强，沿用沉淀资产聚合与卡片：①后端 assets.py 两组聚合——知识触达复用既有 fr/decisions 条目解析（_parse_entries_owned_by 的「变更：」归属改为「待复核：」归属变体参数化，双域全扫）；模块触达读归档 change-patch 的 file_list（既有数据）× 镜像 docs/*/modules/_module-map.yaml（yaml 安全解析，paths 去 ** 后前缀匹配，多项目并扫），模块中文名读 doc 文件首行 h1 提取（失败回退模块 id）；DTO 两组挂 ChangeAssetsRead。②前端资产卡两组渲染：知识触达行 Link 跳知识库 ?file=&anchor=（FR 行同款）；模块触达 chip 点击开独立文件预览弹窗（explorer FilePreview 直挂，路径确定不走测试文件的搜索解析）。③规则 21 gen:types。数据可得性依据：待复核标记由 flow done 对触达域 active FR 打标（knowledge/fr/auto-backend.md 实证 2026-09-26-assets-test-binding-raw-text 六处）；模块图 schema_version 2 含 doc/paths。

## D-change-003@v1 2026-09-27-thin-affected-modules-from-patch-manifest——改 `backend/app/modules/change/parser.py` 的 `_infer_affected_components`：在既有两来源（m
状态：implemented
变更：2026-09-27-thin-affected-modules-from-patch-manifest
原编号：D-000@v1
锚点：.sillyspec/changes/archive/2026-09-27-thin-affected-modules-from-patch-manifest/design.md
文件：backend/app/modules/change/parser.py, backend/app/modules/change/tests/test_parser.py, backend/app/modules/daemon/router/session_insights.py
最近确认：未记录
理由：改 `backend/app/modules/change/parser.py` 的 `_infer_affected_components`：在既有两来源（module-impact.md 矩阵、tasks.md/tasks/*.md 代码路径）之外，新增第三来源——读同目录 `change-patch.json` 的 `files` 数组（flow done 冻结的真实改动文件清单，CLI 新旧格式均携带），滤除 `.sillyspec/changes/` 治理面前缀后并入文件路径集合，统一走既有 `_match_paths_to_modules` 前缀匹配。选这个方案而非直接信 CLI 新三键 `modules[].id`，是因为该 id 是 flow 运行仓自己项目图的模块名，对本仓 module-map 无意义；`files` 是与仓无关的通用真相，且存量 38 个 thin 归档件全部携带，可一次性回填。实现期实测发现单图口径在 Windows 上恒空（PurePath 排序大小写不敏感，SillyHub 排 backend 之后，且 backend 图 paths 以 app/ 开头与交付路径永不匹配），方案升级为 `_load_module_map` 多图全收合并（跨全部项目目录收集、同名模块前缀并集、缓存键升级为路径元组+mtime 元组复合指纹）——粗粒度图（multi-agent-platform 的 backend/frontend 顶层模块）会与细粒度模块并存命中，属可接受的展示冗余。

## D-change-004@v1 2026-10-02-title-norm-thin-h1-family——只改后端 `backend/app/modules/change/title_norm.py` 的 `_TEMPLATE_TYPE_WORDS` 词表：补收 t
状态：implemented
变更：2026-10-02-title-norm-thin-h1-family
原编号：D-000@v1
锚点：.sillyspec/changes/archive/2026-10-02-title-norm-thin-h1-family/design.md
文件：backend/app/modules/change/tests/test_title_normalization.py, backend/app/modules/change/title_norm.py
最近确认：未记录
理由：只改后端 `backend/app/modules/change/title_norm.py` 的 `_TEMPLATE_TYPE_WORDS` 词表：补收 thin（flow-draft）模板 H1 家族四个类型词——`设计记录`（插在 `设计` 前）、`任务注册表`（插在 `任务注册` 前）、`决策记录`、`验证回执`。根因：CLI 轻量变更的四件套文档 H1 是「类型词（英文）— <变更名>」形态，documents 推送按最深阶段文档（tasks.md）重派生 title 时靠该词表识别模板并回退 change_key 去日期前缀；词表只有 `任务注册`（尾字「表」挡住后缀匹配），模板 H1 被误判为自定义语义标题，反把 CLI 收养的好标题覆盖。纯词表补收即闭环（归一化/兜底判定/回翻守卫三写路径同源消费同一正则），不动任何写路径逻辑。

## D-change-005@v1 2026-10-09-knowledge-touch-marker-sunset——CLI 自 2026-09-29-rot-retire-inject-cap 起不再落盘「待复核」标记（371 条零消费实证，持久化已拆），平台侧 change
状态：implemented
变更：2026-10-09-knowledge-touch-marker-sunset
原编号：D-000@v1
锚点：.sillyspec/changes/archive/2026-10-09-knowledge-touch-marker-sunset/design.md
文件：backend/app/modules/change/assets.py, backend/app/modules/change/schema.py, backend/app/modules/change/tests/test_assets.py, backend/openapi.json, docs/sillyspec/fourpiece-created-at-utc-born-anchor-offset.md, frontend/src/components/changes/detail/__tests__/change-assets-card.test.tsx, frontend/src/components/changes/detail/change-assets-card.tsx, frontend/src/lib/api-types.ts
最近确认：未记录
理由：CLI 自 2026-09-29-rot-retire-inject-cap 起不再落盘「待复核」标记（371 条零消费实证，持久化已拆），平台侧 change assets 聚合的标记反查面恒空成为死面——归档前后触达列表恒等（实测 48→48），归档态文案「以标记为准」失真。本变更：backend 摘除 `_REVIEW_MARK_RE` 标记反查与 `owner_line_re` 死参数，knowledge_touch 单一来源 = `_live_touch_rows`（knowledge_hits inject 遥测）；frontend 统一文案为「注入命中留痕」口径并修渲染（同 slug 的 id/title 只显示一个、整文件路由收拢 chip 行、锚点条目按文件分组）。 不选「恢复 CLI 标记落盘」（被零消费实证否决的旧路）也不选「新建权威收窄面」（无真实消费者，重蹈覆辙风险高）；展示层修复低风险且直接解决噪声投诉。若未来要「受影响 FR」窄视图，应消费既有 fr-rot-suspect 遥测（自带条目级 frIds），不属本变更。

## D-change-006@v1 2026-10-09-timeline-tick-stage-filter——`timeline.py` 的 `_TASK_DONE_RE` 从「checked N→M」子串匹配改为带可选 stage 前缀捕获的锚定匹配（`^(?:(\S
状态：implemented
变更：2026-10-09-timeline-tick-stage-filter
原编号：D-000@v1
锚点：.sillyspec/changes/archive/2026-10-09-timeline-tick-stage-filter/design.md
文件：backend/app/modules/change/tests/test_timeline.py, backend/app/modules/change/timeline.py, backend/app/modules/daemon/lease/tests/test_init_claim_tokens.py, docs/sillyspec/fourpiece-created-at-utc-born-anchor-offset.md
最近确认：未记录
理由：`timeline.py` 的 `_TASK_DONE_RE` 从「checked N→M」子串匹配改为带可选 stage 前缀捕获的锚定匹配（`^(?:(\S+) · )?checked (\d+)→(\d+)`），`_infer_task_times` 循环内对捕获到的非 None 且非 `tasks` 的 stage 前缀 continue 跳过——语义与 CLI `inferFlipTimes`（sillyspec 仓 timeline.js:39 `e.stage && e.stage !== 'tasks'`）逐字对齐。根因背景：watcher 对任何文件的 `- [x]` 计数增加都发 task-done（detail 带「stage ·」前缀，DB 无独立 stage 列），design.md 自审清单 6 勾产生「design · checked 0→6」；Python 移植只做了计数子串匹配、丢了 CLI 的域白名单，误吃该事件把 10:00:48 赋给全部任务且游标跳到 6 致后续真实事件断裂。选前缀解析而非给 events 表加 stage 列：零 schema 变更、零回填，与推送端既有「stage 并入 detail」契约一致。

## D-change-007@v1 2026-10-12-backfill-run-change-context——问题：2026-10-12-run-level-change-attribution 上线后，存量会话的 run 无 change_id 锚，变更列表执行用量仍
状态：implemented
变更：2026-10-12-backfill-run-change-context
原编号：D-000@v1
锚点：.sillyspec/changes/archive/2026-10-12-backfill-run-change-context/design.md
文件：backend/app/modules/change/backfill_service.py, backend/app/modules/change/tests/test_backfill_run_context.py, backend/scripts/backfill_run_change_context.py
最近确认：未记录
理由：问题：2026-10-12-run-level-change-attribution 上线后，存量会话的 run 无 change_id 锚，变更列表执行用量仍按「无锚 run 经会话链接摊派」旧口径显示会话总和；用户要求把指定工作区（4e9eb05b…）的存量数据按新口径刷新。 方案：一次性运维回填（脚本 + 可测服务层）。服务层 `ChangeContextBackfillService`（change 模块）按会话重放绑定命令游标——run 时间序逐个「先打锚（仅 NULL 且游标非空）再推进游标（本 run sillyspec 命令，最后一条生效）」，与线上 run_sync 通道「命令在本轮 submit 时写上下文、下一轮 inject 才继承」的时序语义逐点对齐；结束时把游标终值写会话 current_change_id。脚本 scripts/backfill_run_change_context.py 默认 dry-run（单事务回滚），--apply 才提交，--workspace 收窄范围；会话选取限定 change_session_links 有链接者。为什么不用清库重置：该工作区是真实 dogfooding 数据，回填保数据且幂等可审。

## D-change-008@v1 2026-10-13-anchor-mismatch-fix——问题：「轮归开始时上下文」的运行时语义在「整个变更生命周期（flow start→done）发生在单轮内」时把整轮锚到上一个变更——实测两例（10-10 fir
状态：implemented
变更：2026-10-13-anchor-mismatch-fix
原编号：D-000@v1
锚点：.sillyspec/changes/archive/2026-10-13-anchor-mismatch-fix/design.md
文件：backend/app/modules/change/backfill_service.py, backend/app/modules/change/tests/test_backfill_run_context.py, backend/scripts/backfill_run_change_context.py
最近确认：未记录
理由：问题：「轮归开始时上下文」的运行时语义在「整个变更生命周期（flow start→done）发生在单轮内」时把整轮锚到上一个变更——实测两例（10-10 fire-equipment 厚流程巨轮 126 命令、10-13 form-strict 9 命令），都是人工按命令证据链逐例修正的，无系统化检出。 方案：给既有回填服务/脚本加错配扫描与修复模式。判定规则：交互轮（spec_strategy=interactive）的**全部已解析**绑定命令一致指向 X 且轮锚 != X → 错配；混合指向（切换轮）不触发——保住既有「切换轮归旧上下文 ≤1 轮误差」裁决；主导型（top ≥80% 且 ≥5 条）仅报告。批量两条查询（工作区交互轮 + 命令日志 JOIN），零 N+1。为什么不做 token 按时间比例分摊：轮内无逐轮 token，编造精度，弃。

## D-change-009@v1 2026-10-13-change-owner-backfill——问题根因（排查实证）：变更负责人仅在 change_writer 代理写路径落库（2026-08-16-change-owner-from-token），主力路
状态：implemented
变更：2026-10-13-change-owner-backfill
原编号：D-000@v1
锚点：.sillyspec/changes/archive/2026-10-13-change-owner-backfill/design.md
文件：backend/app/modules/change/binding.py, backend/app/modules/change/model.py, backend/app/modules/change/service.py, backend/app/modules/change/tests/test_change_session_binding.py, backend/app/modules/change/tests/test_reparse_owner_backfill.py, backend/app/modules/change/tests/test_spec_binding.py, frontend/src/app/(dashboard)/workspaces/[id]/changes/__tests__/page.test.tsx, frontend/src/app/(dashboard)/workspaces/[id]/changes/page.tsx, frontend/src/app/m/workspaces/[id]/changes/page.tsx, frontend/src/components/mobile/mobile-change-card.test.tsx, frontend/src/components/mobile/mobile-change-card.tsx, sillyhub-daemon/tests/daemon-heartbeat-sillyspec.test.ts
最近确认：未记录
理由：问题根因（排查实证）：变更负责人仅在 change_writer 代理写路径落库（2026-08-16-change-owner-from-token），主力路径「agent 本地 CLI 写变更目录 + 平台 reparse 扫描登记」建行恒 `owner_id=None`（service.py `_build_change`），库里 342 条变更 300 条无负责人，变更中心大面积显示「—」。 方案两条腿： 1. **后端数据侧（治本，管新行）**：`_build_change` 加 `owner_id` 关键字参数（默认 None 保持既有调用兼容），reparse 主循环建新行处传 `owner_id=workspace.created_by`（工作区所有者）。`_apply_parsed` 维持现状不触碰 owner_id（2026-08-16 设计 R-05 既有守卫）——已有 owner 不覆盖、存量空行不回填（把「未知」改写成「猜测」会污染数据；存量行的可见性交给第 2 条）。 2. **前端展示侧（治标，管存量行+可读性）**：列表负责人位从「首字小圆」改为「首字头像 + 名字文本」；双空行兜底显示 `workspace.owner.display_name`（列表页已并发拉取 workspace，零新增请求），title 标注兜底语义；全链无值才显示「—」。 选这个组合而非「reparse 回填全部存量空行」：回填会把 300 条历史行的负责人批量改写为工作区所有者（多数是 agent 干的活，所有者只是「最可能的责任人」），数据断言变弱且不可逆；展示层兜底达到同样的可见效果，数据保持诚实。

## D-change-010@v1 2026-10-13-change-reparse-autobind-remove——移除 `ChangeService.reparse` created 分支对 `_bind_change_to_session` 的调用，并整体删除该方法（20
状态：implemented
变更：2026-10-13-change-reparse-autobind-remove
原编号：D-000@v1
锚点：.sillyspec/changes/archive/2026-10-13-change-reparse-autobind-remove/design.md
文件：backend/app/modules/change/binding.py, backend/app/modules/change/model.py, backend/app/modules/change/service.py, backend/app/modules/change/tests/test_change_session_binding.py, backend/app/modules/change/tests/test_reparse_owner_backfill.py, backend/app/modules/change/tests/test_spec_binding.py, frontend/src/app/(dashboard)/workspaces/[id]/changes/__tests__/page.test.tsx, frontend/src/app/(dashboard)/workspaces/[id]/changes/page.tsx, frontend/src/app/m/workspaces/[id]/changes/page.tsx, frontend/src/components/mobile/mobile-change-card.test.tsx, frontend/src/components/mobile/mobile-change-card.tsx
最近确认：未记录
理由：移除 `ChangeService.reparse` created 分支对 `_bind_change_to_session` 的调用，并整体删除该方法（2026-08-14-change-center-conversation-driven task-02 / design §8 D-007 引入的启发式绑定）。绑定语义收敛为「命令解析通道唯一」：只有会话内实际执行 `sillyspec run/flow --change <名>` 命令（run_sync 命令解析与 daemon agent-logs 上报两分支，`change/binding.py`）才写 change_session_links。 选这个方案的理由：D-007 假设「新变更出现时，最近活跃会话即干活会话」，实测误伤面大——2026-10-13 阿里云实例：归档目录随镜像同步首次到达触发 reparse 建行（变更 2026-10-13-slim-subagent-false-running），自动绑上 43 分钟前活跃的「你好」闲聊会话（link 与变更行创建同事务、仅差 13ms，已查实）。而真正干活的会话本就会经命令解析通道精确绑定，D-007 只是补充猜测，删除后无损覆盖。

## D-change-011@v1 2026-10-16-change-files-sync-result——现场两案例实证三层静默失败：fire-ledger 变更（centos8 daemon）刷新 4 次全失败——1 次 3s 超时降级 + 3 次 daemon
状态：implemented
变更：2026-10-16-change-files-sync-result
原编号：D-000@v1
锚点：.sillyspec/changes/archive/2026-10-16-change-files-sync-result/design.md
文件：.zcode/skills/deploy-to-server/SKILL.md, backend/app/modules/change/router.py, backend/app/modules/change/schema.py, backend/app/modules/change/tests/test_files_refresh_sync.py, backend/openapi.json, docs/sillyspec/finished/verify-probe7-matrix-prefill-four-defects.md, frontend/src/components/__tests__/change-file-tree-sync-feedback.test.tsx, frontend/src/components/change-file-tree.tsx, frontend/src/lib/__tests__/change-file-sync.test.ts, frontend/src/lib/api-types.ts, frontend/src/lib/change-file-sync.ts, frontend/src/lib/change-files.ts, sillyhub-daemon/src/api-types.ts
最近确认：未记录
理由：现场两案例实证三层静默失败：fire-ledger 变更（centos8 daemon）刷新 4 次全失败——1 次 3s 超时降级 + 3 次 daemon 快败回执被后端丢弃；auth-random-logout（本机 daemon）刷新从未触发、用户零感知（其文件没上平台另有服务端根因：2026-10-16 迁移后 `/data/spec-workspaces` 属主由容器用户 999 变 ubuntu 755，后端写落盘 `PermissionError` 致 `POST /api/changes/-/spec-sync` 恒 500——已 ops 侧 `chown -R 999:999` 修复并写进 deploy skill 验证探针，不在本变更代码面重复兜底）。 代码面修三处：① `backend/app/modules/change/router.py` 同步预算 3s→15s（实测同步 5.5~13.5s，3s 下真同步恒超时）；`_sync_change_via_daemon` 从「None + 静默」改为返回结构化回执 dict，daemon ok:false / skipped / 四路异常全部映射，失败记 warning。② `schema.py` 的 `ChangeFileList` 新增可选 `sync_result`，openapi 与双端 api-types 重生成。③ 前端新增零依赖纯函数 `lib/change-file-sync.ts` 把回执翻成中文提示，`change-file-tree.tsx` 刷新点击后接线展示非阻塞琥珀色提示条。 选此方案：延续 2026-10-14「GET 显式 sync」既定路线，历史否决案 D-006@v1（fire-and-forget + 二次刷新）与 D-007@v1（新增 POST 端点）不触碰——GET 纯读语义、单一触发面、无新端点都不动，只补齐「预算按实测校准 + 回执不丢 + 失败用户可见」三件事。

## D-change-012@v1 2026-10-16-change-title-condense-backfill——变更中心两类烂标题（完整变更=变更名兜底、轻量变更=50 字截断长句）的病根在 CLI 侧（另变更处理），但存量已入库的坏 title 只能平台侧修：平台 `c
状态：implemented
变更：2026-10-16-change-title-condense-backfill
原编号：D-000@v1
锚点：.sillyspec/changes/archive/2026-10-16-change-title-condense-backfill/design.md
文件：backend/app/modules/change/router.py, backend/app/modules/change/schema.py, backend/app/modules/change/service.py, backend/app/modules/change/tests/test_rename_title.py, backend/app/modules/change/tests/test_title_normalization.py, backend/app/modules/change/title_backfill.py, backend/app/modules/change/title_norm.py, backend/app/modules/platform_sync/service.py, backend/app/modules/platform_sync/tests/test_change_deleted_guard.py, backend/openapi.json, backend/scripts/backfill_change_titles.py, docs/sillyspec/active-pitfalls.md, docs/sillyspec/change-title-not-readable.md, frontend/src/app/(dashboard)/workspaces/[id]/changes/[cid]/__tests__/page-rename-title.test.tsx, frontend/src/app/(dashboard)/workspaces/[id]/changes/[cid]/page.tsx, frontend/src/lib/api-types.ts, frontend/src/lib/changes.ts, sillyhub-daemon/src/api-types.ts
最近确认：未记录
理由：变更中心两类烂标题（完整变更=变更名兜底、轻量变更=50 字截断长句）的病根在 CLI 侧（另变更处理），但存量已入库的坏 title 只能平台侧修：平台 `changes.description` 列已存有动机段提取文本（2026-09-28-change-list-description），是现成的语义来源。本变更三件事： 1. `title_norm.py` 新增 `condense_title` 纯函数——自然标点截断（强边界 优先，弱边界兜底，区间 `[8,30]`，无边界硬截加 `…`），与将来 CLI 侧同规则实现行为对齐（两边各留一份、用同一组实证样本锚定，防漂移靠测试样本一致）。 2. 收养口防御：`_ensure_change_row` 采纳 CLI 上行标题前，超 30 字先提炼再入库——防旧版 CLI 继续推长标题进来（存量修完再进新的就没意义了）。 3. 存量回填：新服务 `title_backfill.py` + 薄脚本 `scripts/backfill_change_titles.py`（dry-run 缺省 / `--apply` 落库 / `--yes` 门，照抄 `backfill_run_change_context.py` 先例骨架）。选中规则 = `location IN ('active','archive')` 且（title 兜底形态 或 title >30 字）且 description 非空；新 title = `condense_title(description)`。 回填只救「有 description 的行」；无 description 的老行跳过计数（不猜、不去盘上读 proposal——保持脚本纯 DB 面，读盘归 reparse 职责）。

## D-change-013@v1 2026-10-19-cross-repo-patch-slicing——跨仓冻结元数据已上资产卡，但看跨仓某文件 diff 只能进全屏预览读数 MB JSON。
状态：implemented
变更：2026-10-19-cross-repo-patch-slicing
原编号：D-000@v1
锚点：.sillyspec/changes/archive/2026-10-19-cross-repo-patch-slicing/design.md
文件：backend/app/modules/change/assets.py, backend/app/modules/change/router.py, backend/app/modules/change/schema.py, backend/app/modules/change/tests/test_assets.py, backend/openapi.json, frontend/src/components/changes/detail/__tests__/change-assets-card.test.tsx, frontend/src/components/changes/detail/change-assets-card.tsx, frontend/src/lib/api-types.ts, frontend/src/lib/changes.ts, sillyhub-daemon/src/api-types.ts
最近确认：未记录
理由：跨仓冻结元数据已上资产卡，但看跨仓某文件 diff 只能进全屏预览读数 MB JSON。本次补齐对等切片能力：端点加可选 `repo` 参数（正文取 `change-patch.json scopeAudit.repos[repo].patch` 内联串，复用 `slice_patch_for_file` 与 200k 上限）；仓内文件清单不需要新增冻结字段——后端从 patch 块头解析新侧路径投影进 `ChangePatchRepo.file_list`（去重保序、超 `_PATCH_FILES_MAX` 截断标注），资产卡仓段渲染清单、点开走 `patch-file?repo=…` 弹窗（弹窗头标注跨仓键与 repos[] 数据源）。未命中仓键按 note 降级（与主仓切片「读不到留档是展示面降级」同语义，不做 422 白名单——`path` 的白名单是防穿越，repo 键无安全面）。
