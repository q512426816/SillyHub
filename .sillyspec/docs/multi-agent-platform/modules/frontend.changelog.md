# frontend 变更索引
- change 2026-10-13-session-change-files-hover | 会话页悬浮变更文件：ChangeFileTree 可选 autoRefreshMs prop（默认零定时器行为不变，弹窗传 15000 周期刷树+pending）；lib/changes.ts 增 listSessionChanges/useSessionChanges（GET /changes/-/by-session/{sid}，active 时 15s 轮询）+ queryKeys.sessionChanges 工厂；NEW session-change-files-hover.tsx（胶囊入口+hover/click 下拉分组：进行中置顶轻量/全量徽标+阶段中文+时间、已归档默认折叠展开；大弹窗 shadcn Dialog 85vh max-w-6xl + antd Select 切换 key 重挂载）挂 session-panel-page 真会话输入区上方 h-0 锚。前端 29 用例绿（autorefresh 3/悬浮 7/既有回归 19）；tsc 0；eslint 0 新增。
> 自动生成。正文历史已迁出，详见 frontend.md。
> author: qinyi
> created_at: 2026-08-26 10:20:00
- change 2026-10-15-server-logs-panel | 服务器信息页去业务统计卡+服务器日志卡：NEW components/server-log-panel.tsx（卡内独立 5s 轮询 getServerLogs/行数 Segmented {100,200,500,1000}/级别语义色阶行/点行展开原始 JSON/文件下拉+下载/安全提示/失败 Alert 保留数据）；lib/health.ts 增 getServerLogs（类型 api-types 生成物引用）与 downloadLogFile（fetch Blob+401 单飞刷新+objectURL，JWT 裸 URL 401 先例）；page.tsx 删 StatCell 与业务统计卡（D-007@v1）+ServerLogPanel 满宽置底（lg:col-span-2）+副标题更新；page.test.tsx 全用例扫描改写断言。测试：server-log-panel 7 + admin 域 24 用例全绿；tsc/eslint 零错。

- change 2026-09-25-change-center-thin-flow | 变更中心 thin 视觉全家桶：STAGE_KIND.thin 品牌紫阶（本地 brand kind）/STAGE_LABELS/STATUS_BADGE/WORKFLOW_STAGE_LABELS/双份 STAGE_OPTIONS 筛选项/BYPASS_BADGES+两处旁路判断；thin 两段式说明卡（桌面+移动）+ quick 卡退役文案；quick 存量标注五处（tab 徽标「存量 · N」/副标题/统计卡/quicklog 空态与表头）。tsc 0 错 + quicklog-table 16 + change-step-badge 13 + change-stage-actions/mobile-change-detail 30 用例绿。
- ql-20260918-012-ac1b | 工作区 Git 地址展示（列表卡 + 详情基本信息，自动识别不手填）：lib/workspaces.ts 新增 probeWorkspaces client（Schemas["WorkspaceProbeItem"] 生成类型，gen:types 同步）；列表页加载后补一发批量 probe（对齐关联项目异步补数模式，403/失败 catch 静默）→ 卡片 repoUrl prop（probe 实时值优先、DB repo_url 兜底）；详情页 mount 单工作区 probe 同款 + GET DB 值兜底；WorkspacePathFields 增「Git 地址」行（http(s) 渲染可点外链且 click 不冒泡整卡点击，scp/ssh 形态纯文本；空值不渲染行）——列表卡与详情基本信息共用。移动端 m/workspaces 未接入（简化选择器无路径信息区）。测试：workspace-card/workspace-drag-grid/team-trigger-popover 67 passed；tsc 0；eslint 0 error（8 warning 全存量，stash 对照确认非本次引入）。
- ql-20260915-008-c086 | 会话页额度胶囊刷新策略二调（用户二次反馈：不要固定 30 秒）——默认轮询 5 分钟 + 胶囊悬浮满 2 秒立即刷新：QUOTA_REFRESH_INTERVAL_MS 30_000→5*60_000；新增 QUOTA_HOVER_REFRESH_DELAY_MS=2_000，胶囊 onMouseEnter 起 setTimeout 延时器、满 2 秒仍在胶囊上立刻 refresh 一次（refresh 自带 in-flight 防重入，悬浮再久不重复触发），onMouseLeave 即取消、卸载兜底清理；浮层说明文案同步「每 5 分钟自动刷新；胶囊上悬浮 2 秒立即刷新」。测试：ctx-usage-bar 44/44（新增常量锚定 5min/2s 用例 + 悬浮三段用例：不足 2s 离开取消不刷新/满 2s 立即刷新不等轮询/持续悬浮 60s 仍只多一次）；tsc --noEmit 干净；eslint 0 error（2 warning 存量类型参数位未动）。
- ql-20260915-006-54b4 | 会话页额度胶囊 30 秒定时刷新 + 全部可查用量供应商聚合展示（用户要求）：原 QuotaPill 只查当前会话供应商的 quota 端点，后端仅智谱返回窗口数据、其余一律 quota=null（只显示 GLM 的根因），且不刷新。修法：①QuotaPill 重写为自治聚合——useQuery 拉全量供应商列表（5min 慢刷新）→ detectUsageProvider 过滤可查供应商（Kimi/智谱/MiniMax=token_plan 百分比，DeepSeek/硅基/OpenRouter=balance 金额）→ 智谱走 quota 端点（5小时窗/周限额，弱依赖永不 5xx）、其余走 usage 端点（两态错误模型），新增纯函数 mapUsageTiersToViews 归一 tier 视图 + balance 金额 ¥/$ 格式化；②30s setInterval 轮询（QUOTA_REFRESH_INTERVAL_MS 导出，替换 design §5 Wave3 低频单次口径）+ keep-last-good（瞬时失败/quota=null 保留上次数据，is_valid=false 鉴权失效清除条目不留陈旧假数据，供应商被删丢陈旧条目），in-flight 防轮询重叠、cancelledRef 防卸载回写；③胶囊面=会话供应商优先（providerId 语义从门控渲染弱化为排序提示，本机默认会话照常聚合展示）+等N家，浮层按供应商分节（名称+模型+各窗口剩余/金额+重置时间）+「每 30 秒自动刷新」文案（废弃「一期仅 GLM」表述）。测试：ctx-usage-bar 42/42（新增 fake timers 30s 到点重查/keep-last-good/鉴权清除/多端点分流/不可查不请求/providerId=null 照常聚合/余额金额浮层用例，renderPill 重写 rerender 自动补 QueryClientProvider——RTL rerender 替换整棵树会丢 Provider）；tsc --noEmit 干净；eslint 0 error（2 warning 为存量类型参数位 unused）。顺手修 session-history-scroll.test.tsx 存量 noUncheckedIndexedAccess 类型债（beforeCursors length===3 已断言，索引访问加非空断言），该文件 3/3 绿。
- ql-20260913-007-1351 | 轮次刻度轨命中区修复（用户反馈「鼠标指向要精确到一点点小范围才能显示和点击，太难操作」）：turn-catalog.tsx 刻度按钮本体原即 2px 视觉线（h-[2px] w-[14px]），hover 摘要卡/点击跳转都要求鼠标精确压线、刻度间 gap-[7px] 还是无响应缝隙。修法：按钮本体改为透明命中区（h-[18px] × 轨全宽 30px，上下各 8px 缓冲），视觉横杠移入内部 span 居中渲染（状态色/hover 放宽/空心描边平移至子元素 group-hover:*/group-focus-visible:* 触发，视觉基本不变——刻度垂直周期 9px→18px 密度略降换可用性）；nav 去 gap-[7px] 相邻命中区紧贴，鼠标垂直扫过轨道连续命中不闪断；飞出卡垂直定位改用刻度中心（computeFlyoutTop 首参 offsetTop→tickCenter，调用方传 offsetTop+offsetHeight/2，否则按钮变高后飞出卡偏上 8px）。测试：turn-catalog 17/17（状态类断言迁移至内部视觉线 span + 新增 2 命中区用例）、sessions page 37/37（轮次导航集成 8 用例全绿）、session-panel-variant 绿；eslint 0 error（onJump 类型参数名 1 warning 为 2026-09-08 存量非本次引入）。
- ql-20260910-006-4d12 | 会话面板头部「后台 ▾」下拉弹层被消息流背景盖住修复（用户反馈）：2026-09-09-sessions-visual-refresh task-07 给面板头部加 backdrop-blur-md 玻璃头后，backdrop-filter 使头部自成层叠上下文——头部内 absolute z-30 弹层（后台/子代理目录、搜索、mobile ⋯ 菜单）的 z 值被困在头部之内，被树序在后的消息流 relative 外包层（turn-timeline 滚动区 bg-background 不透明背景）整体覆盖。修法：page-helpers.tsx 的 PANEL_HEADER_CLS_DESKTOP/MOBILE 补 relative z-20，头部整体抬到消息流之上（流内最高 z-10 悬浮件不受影响；流内更高 z 的定位件仍按各自 z 值参与根上下文比较，无回归面）；dialog 模式头部无 backdrop-blur 不受影响未动。session-panel-variant.test.tsx 字面量回归锚同步更新。测试：session-panel-variant 7 + activity-catalog 5 + session-panel-ctx-tokens 4 + session-panel-team 18 共 34 用例全绿。
- ql-20260910-004-db16 | AskUser 提交撞 409 即时收口：ask-user-dialog-card 增 onAlreadyResolved 回调——409 HTTP_409_DAEMON_DIALOG_ALREADY_RESOLVED 不再直出英文报错，本地翻已答关闭态 + details.answered_by 回传父层；group-chat-panel 接线经成员表映射人名（「林一 已回答」），他答人名缺口与 10s 轮询等待双收口。测试：dialog-card 31（+2 409 双态）+ group-askuser 聚合 12（+1 他答 409 带名）。
- change 2026-09-09-askuser-pi-cursor | AskUser 前端全链：①NEW lib/askuser-marker.ts 标记解析器（尾部 8KB 窗口/仅认```askuser/4KB 限/非法 null，31 用例）——cursor 轮界提问协议「标记即数据不剥离」。②NEW ask-user-marker-card（选项/自定义输入/推荐 @条/已答 best-effort 关闭态）+turn-timeline 双路径接入（旧 output 气泡+v2 text 段，标记原文隐藏）。③ask-user-dialog-card 增 answered? 关闭态 prop（人名降级）+recommendResponders 推荐条。④group-chat-panel 聚合：成员影子会话 pending 原生卡（10s 轮询/来源标注/先到先得 409 关闭态）+群消息 marker 卡（engineLabel=成员名，sendGroupMessage 即答案）；session-sse/sessions 透传 answered_by_actual_user。⑤provider-caps dialog 镜像。已知限制：非群主读侧不可见卡（list_pending_dialogs 仍 owner-only，另卡）；他答人名降级。测试：前端 9 文件 245 用例全绿。
- ql-20260909-024-02ba | sessions/page.test.tsx 12 用例失败修复——非慢机超时，是三重根因（ql-20260909-022 时误判为存量环境债，实为可复现断言回归）：①视觉焕新（618bdaec2）漏跑本文件——轮尾换 RoundDivider 胶囊后「第 N 轮/状态/·」拆成兄弟文本节点，4 用例的 getByText(/第 N 轮 ·/) 跨节点正则失效，改按节点断言 getByText("第 N 轮")+既有状态断言；whoLine 头像换 ChatMessageAvatar 不再有 aria-label「发送者 X」，1 用例改 getByTitle（我（名字）/他人名字）；②ql-20260909-005 刻度轨 <3 轮整条隐藏但轮次导航夹具仅 1-2 个 run——5 个桌面跳转用例点不到刻度，夹具补第三轮（公共夹具 2→3 轮：最旧 r-ancient completed 孤儿补建为已加载第1轮，UNLOADED_TICK_LABEL 第1轮→第2轮；直跳用例单轮补两个更新 failed run 保持 r-1 第1轮）；③前两类失败连锁污染——vi.clearAllMocks 不清 mockResolvedValueOnce 队列，断言中途失败用例把未消费 once 泄漏给后继用例致其首屏拉错页（当前窗口提问/首问「凭空消失」），beforeEach 对 getAgentSessionLogs 改 mockReset（实现均在 it 内设置，reset 后回填默认值安全）。验证：page.test 36/36 两轮全绿（60s→9.7s，5s 重试等待消失）；tsc 0；eslint 0 error（4 warning 全预存）。教训：quick/变更收尾「相关文件」清单要含被改组件的**页面级集成测试**（视觉焕新 40 套件未含 page.test.tsx 才漏到现在）。
- ql-20260909-022-a42b | 会话用量条零用量判据修正（用户反馈 pi/cursor 会话顶部 token 用量条消失）：ql-20260909-005 引入的「api_requests=0 整条不渲染」误伤不上报请求计数的引擎——daemon onTurnResult 仅 driver 报 modelUsage（现仅 Claude SDK 驱动）才上报 model_usage/api_requests，pi（pi-rpc-driver）/cursor（cursor-driver）只报四维 token，后端聚合「未记录」桶请求次数恒按 0 计（read_model 兜底段 R-01），有真实 token 的会话条被整条误杀（DB 实证：pi 5 会话 11 轮 / cursor 2 会话 5 轮全零明细行）。修法：判据改五项原始指标（input/output/cache_read/cache_creation/api_requests）全 0 才隐藏，命中率为派生值不计；组件头注与内联注释同步改写。测试：session-usage-bar 6/6 绿（新增「有 token 无请求计数照常渲染、请求次数如实 0、命中率 85.5%」用例，全 0 隐藏用例保留）；sessions-portal 随跑绿；tsc 0；eslint 0 error（1 warning 预存）。sessions/page.test 12 例 5s 超时失败为存量环境债——其 mock 用量恒全 0，新旧判据下组件均渲染 null、DOM 恒同，与本次无关（复跑两次同样 12 挂）。
- change 2026-09-09-sessions-visual-refresh | 会话页完整视觉焕新（简洁大气好用，原型 v4 用户四轮确认）：①消息角色化——新建 components/chat/ 共享构件族（ChatMessageAvatar：agent 品牌渐变光环+Bot/user 首字，avatar 图片入参优先与 kind 无关→群聊自定义头像能力保留 D-006@v2；RoundDivider 轮次分隔胶囊六态 D-010@v1；useAvatarSrc 自 group-member-avatar 平移单份）；单聊 v2 段路径（对话视图挂头像+过程行不动）+旧回退路径+群聊消息行三处同源消费。②氛围层——globals.css 新增 --aurora-1/2/4/--glass(-heavy)/--border-soft/--row-active(-ring)/--shadow-glow 氛围 token 三主题分值写满（ai-native 紫/blue 蓝/dark 青，blue 零紫成分 D-002@v2）；应用壳（app-shell）挂极光背景 fixed、侧栏/顶栏/列表列/会话面板玻璃化 backdrop-blur（D-008@v1 极光铺壳玻璃才可读；无任何流光条）。③轮次胶囊替换对话视图轮尾小字（六态着色对齐 TurnUiStatus，"全部"视图状态条不动）；④列表行降噪——选中态硬竖条→--row-active 渐变底+ring 内描边，引擎 chip 收敛色点+短名（色点派生 PROVIDER_META 单一源），时间等宽数字；⑤dark 主题 bg zinc-900→zinc-950 拉大层级（themes.ts+globals.css 同步，card 保持 zinc-800）；⑥面板头面包屑降噪（id chip·状态·机器·工作区粗体一行）；⑦composer 聚焦环 4px ring-brand-100→3px brand-500/10 柔环（dark 霓虹圈消除 D-009@v1）；shadow-primary 三主题双层弥散降重。测试：chat 17 新用例+群聊 100（自定义头像断言随构件 testid 适配）+全相关 40 套件 759 用例全绿；tsc 0；eslint 0 error（15 warning 存量）；variant 测试 <3 轮刻度轨隐藏断言随 ql-20260909-005 行为翻转（HEAD 存量债顺手修复）。
- ql-20260909-009-fea8 | 会话页视觉 P0：气泡层级 + 深色代码块 + composer 阴影（用户反馈会话页"不够高级、视觉效果太差"，诊断后 P0 三件套）：①用户气泡 max-w-82%→80% + shadow-sm→shadow-primary 品牌投影浮出（turn-timeline.tsx，三主题 primary-foreground 均白、零对比度风险——brand 阶渐变在 dark 翻转会撞亮青底白字故不采用）；②agent 文本气泡 max-w-86%→80% + border-border/60（turn-segment-views.tsx，不再顶满成"文档块"）；③代码块深色化——markdown-text.tsx COMPACT/READING 双组去 !bg-muted/60（!important 原本压死库底色）+ pre 圆角 md→lg/内边距加大/pre code 升 12px + 行内 code 衬 bg-muted/70 小胶囊；globals.css 新增 --codeblock-bg/border/fg 三主题共享 token（slate-900/700/200 主题不变量，跨主题深底是设计决策）+ .markdown-text .wmde-markdown pre 元素级规则（特异度 (0,2,1) 压库 .wmde-markdown pre、与加载顺序无关，同 ql-20260824-015 表格修法）统一深底 + GitHub dark 语法色板 pre 局部重定义——根治库 prefers-color-scheme 跟 OS 不跟 data-theme 的「浅色系统+dark 主题语法色低对比」残留。④composer 常态 shadow-sm/聚焦升 shadow-md（session-input-bar.tsx，"灰底凹槽"→"悬浮输入条"）。验证：vitest 8 个相关文件 120 用例全绿；tsc --noEmit 0 错；eslint 0 error（8 warning 全预存）。
- ql-20260909-007-836e | 三分屏右列拖宽方向镜像修复（用户实测反馈：右侧拖拽方向反了）：根因——PanelResizer 原仅有左栏形态（把手在栏右缘、右移恒增宽），三分屏右列（文件预览）把手在列左缘直接复用未镜像。修法——PanelResizer 增 side?: "left"|"right" 可选属性（默认 left 零回归，explorer/scan-docs/会话左栏语义不变）：right 时拖拽增量取反（拖左增宽/拖右收窄）+ 键盘 ←/→ 对调（sideRef 即时读值不重挂监听）；sessions-portal 预览列把手传 side="right"；portal 测试新增方向用例（createEvent 补坐标：480→拖左+120=600、拖右-150=450、←+16/→-16）。sessions-portal 52/52 绿 + explorer 页拖拽回归绿；eslint 0/0；tsc 0。随 d10d8fc3d 重新构建部署阿里云（新 chunk 7512-6e63c524）。
- ql-20260909-006-1662 | ctx 上下文用量圆环收进配置条行尾（用户反馈「独占一行很突兀」）：SessionConfigBar 加可选 trailing?: ReactNode 行尾插槽（running 解锁提示之右，缺省零占位）；session-panel-page 真会话/预会话两处 CtxUsageBar（圆环+额度胶囊）自输入框上方独占行删除、改经 trailing 传入；CtxUsageBar 容器去 mb-1.5/min-h-7 独占行样式；输入区容器补 pt-3 保顶部间距。圆环与配置条语义同属会话状态信息行，输入区由「圆环行+输入框+配置条」收敛为「输入框+配置条」两层。测试：session-config-bar 加 trailing 用例（传入渲染行尾/不传零占位）；ctx-usage-bar/session-config-bar/sessions-portal 104 绿 + session-panel-ctx-tokens/pre-session 40 绿；eslint 0 error（9 warning 全预存）；tsc 0 新增；浏览器 DOM 断言 ringInBar/sameRow + 截图确认独占行消失。
- ql-20260909-005-684d | 会话页整洁度二轮六项（用户评估清单一档+二档）：①SessionUsageBar 零用量（api_requests=0）整条不渲染——与 TaskExecutionPanel ql-20260909-003 空态同口径，右栏顶部双条收敛闭环（分母0用例翻转为不渲染断言）；②空门户态两手写胶囊按钮换 antd Button 主/次级（Clock/Plus 导入随删），与全站方角设计语言统一；③SessionConfigBar 供应商/档案/模型三控件禁用态 title 按原因说明（ended→「会话已结束或机器离线，不可切换…」/running→「会话运行中，本轮结束后可切换…」/idle 原说明）——根治已结束会话「点了没反应」零解释；④TurnCatalog 轮次 <3 整条刻度轨 early return null（JSX.Element|null 签名修正），短会话回收左侧 30px 占位；⑤群聊未读徽章 h-[18px] bg-brand-600 实心大圆标 → h-4 bg-brand-100 text-brand-700 小号浅色阶（@我强提示由行首红点承担）；⑥筛选区两行对称——搜索框独占首行整宽，状态下拉 w-24 挪至机器行（机器 flex-1 + 智能体 w-24 条件 + 状态 w-24），锚点 id 全保留。测试：五文件 198/198 绿（新增 3 用例：零用量不渲染/禁用 title 三态/短会话隐藏跨阈值自动出现；3 处旧断言随行为翻转适配）；eslint 0 error（8 warning 全预存，git stash 干净基线对照实证）；tsc 我方 0 错误；主仓 dev 3102 实拍六项视觉全部生效。**环境发现**：localhost:3001 是 Docker 构建产物（非 dev watch 主仓），此前部分 3001 截图验收看到的是旧构建——热码验收须用主仓 dev server。
- ql-20260909-003-8a54 | 会话右栏收纳（用户反馈三条信息条叠聊天区上方挤）：TaskExecutionPanel 全零空数据不再常驻「运行中 0·任务 0…轮次 0」折叠条——hasAnyData（运行中/任务快照/轮次历史/团队任务含终态/计划总纲任一非空；取数失败 fail-closed 保守显示）全零且未展开返回 null，对齐 AgentLogCard 空态先例；task-07 FR-01「常驻 0 计数」决策演进（文件头注记）。常见空会话右栏顶部由「用量条+日志卡+任务条」收敛为「用量条」一条。测试①组三用例随行为翻转（空态/预会话断 null、展开用例改注入任务数据驱动）；task-execution-panel 12/12 + agent-task-card 两文件 22 绿；eslint 0/0（顺手清 HEAD 遗留 useRef 未用导入）；tsc 0 新增。
- change 2026-09-09-sessions-file-browser-three-pane | 会话页三分屏：会话 ⇄ 工作区文件浏览器（纯前端组合复用 explorer 全链路，零后端改动）：①新组件 portal-file-panels.tsx——PortalFileTreePanel（← 返回会话头部 + FileExplorer 直通）+ PortalFilePreviewPanel（✕ 关闭头部 + FilePreview 直通）+ 8 个宽度常量（左栏 320/240–560、右列 480/320–860，LS key sillyhub.sessions.leftPanelWidth/filePreviewWidth）；②SessionListPanel 加可选 headerExtra 插槽（头部「共 N 个」右侧，其它消费点零变化）；③SessionsPortal 三分屏接线——leftMode/filesModeWorkspaceId（进模式快照 D-004）/filePreview {workspaceId,path}（防跨工作区串档）/selectedWorkspaceId（D-006 六写入点显式快照：onSelect 行对象直取/选群/建群/深链 getAgentSession 返回体/enterPreSession/清选中六处置 null，Grill 审查修正原派生链两处永不到达缺口）、fileWorkspaceId=scope 恒 scope.workspaceId 否则快照（null 置灰+title 提示）、grid→flex 三栏 + 双 PanelResizer（拖宽/双击复位/localStorage 记忆）、中栏 grid 单元格保四分支高度链（R-01）、files 模式卸载 SessionListPanel（D-003，react-query 缓存+localStorage 态重挂无损）。测试：sessions-portal 12 新用例（切换/返回、置灰+title、六写入点快照、深链翻转载入、开列/关列、切回保留不串档）+ portal-file-panels 7 用例（mock lib/explorer 分层 R-04）= 相关面 226 绿（含 explorer 页/消费方 gap 补）；tsc 0 新增、eslint 1 先例同款 warning；浏览器实测置灰翻转/文件模式/返回/502 降级/拖宽记忆双击复位（daemon 离线致点文件开列走 pass-by-test，见变更 browser-acceptance.md）。
- ql-20260908-016-54dd | 会话页左栏排版统一（用户反馈「乱、不整洁不统一」，浏览器实拍定位四类根因）：①0 会话空分组沉底——新增 orderedGroups（visibleByGroup 可见数>0 稳定在前、空组沉底，仅树渲染序换用，分组构造/过滤/选中逻辑不动），空组头 muted 降调且不再渲染「（暂无会话）」空正文（原 8 个空组按工作区列表序霸占首屏、有会话组被挤出折叠线）；②群聊分区头对齐工作区组头一套样式（px-2 py-1.5 gap-2 text-[13px] font-semibold + 箭头列 w-3.5 定宽 + ＋按钮 h-6，原 px-1.5 text-[11px] ＋h-5 两套并存）；③行缘对齐——群行外包 px-1.5 容器（原比会话行左移 8px）、树容器 p-2→p-1.5、小节 px-2→px-1.5、行卡 px-3→px-2.5、meta 行 pl-[22px] 对齐标题列；④会话行第二行 meta 去三图标（User/BookUser/Cloud）改「创建人 · 档案 · 供应商 · N 轮」点分隔纯文本（title 悬浮全量保留）；⑤sessions-portal 主栅格 gap-3.5→gap-3 与 PageContainer 统一。测试：分组顺序断言随新排序更新（SillyHub→非工作区→空工作区），session-list-panel 100 + sessions-portal 39 = 139 用例全绿 + tsc 我方 0 错误（workspace/__tests__ 2 个为并行会话在途预存）+ eslint 3 文件 0 告警。
- ql-20260904-013-6fd8 | 会话页失败卡两缺口修复（会话 2f08b5da 实证，用户确认两做）：①session-log-assembler classifySessionLog 增 [ASSISTANT] 模型网关/CLI 鉴权错误特征行丢弃（isAssistantApiErrorText 同口径、仅 [ASSISTANT] 前缀门控防裸文本流误吞）——CLI 把远端 401 误报的 "Not logged in · Please run /login" 不再被 kind=reply 渲染成带复制按钮的回复气泡（09-03 的 normalize 修复只盖了日志查看器管线，会话页装配器漏网）；②runtime-session-helpers logsToTurns 前导条不再整条跳过——剥前导后剩余正文进 prompt 归并（影子直聊只落一条带前导 user_input 无干净条兜底，原 prompt 收空致无用户气泡+失败卡无重发按钮；常规双写路径同主体归并不双显；纯系统注入仍跳过），剩余正文 trim 后入组。测试：assembler 新增 5 用例（丢弃/null/output 零贡献/裸文本不误吞/正常答复不受影响）+ helpers 新增 3 用例（影子形态 prompt=群聊上下文+preamble 段、双写归并、纯注入仍空）；assembler 72+perf+sanitize 42+helpers 25 = 146 绿 + normalize 59 绿 + tsc 0（page.test 2 个触顶分页用例为预存失败，与本改动无关）。
- ql-20260904-012-9a2b | token 词元消耗单位统一 K/M（废除中文「万」+小写 k 归一大写）：四处万级私有副本 formatTokensZh（session-usage-bar / change-usage-card / changes 页 / quicklog-table）重写为 formatTokensCompact（>=1M→X.XM；>=1K→X.XK；K 以下原值直显，废除 10K 阈值与千分位形态），runtime-card-helpers formatTokens 与 lib/format-token formatTokenCount 小写 k→K 归一；请求次数/轮次保持千分位直显（计数语义不缩写），耗时格式不变。测试断言全量同步（万→K/M 换算值 + 小写 k→K）：11 文件 137 用例绿 + tsc 0（sessions/page.test 2 个触顶分页用例为预存失败，原始版本复现实证，与本改动无关）。
- ql-20260904-010-ec7d | 会话运行失败卡片重试按钮全覆盖 +「切换供应商」定位修正（用户反馈）：①run-error-item.tsx showResend 不再按 item.retryable 门控（废除 D-006 的 quota/auth 隐藏重发逻辑）——传入 onResend 即渲染，所有失败卡都有「重新发送」（无 prompt 孤儿 turn 父级不传仍不显示；重试约束由 session-panel 提交守卫承担：turn 串行/active/在线）；②session-panel page 模式 timelineOnSwitchProvider 不再 window.location.assign("/settings")——会话页底部本就有「只影响本会话」的 SessionConfigBar，改为 signal 递增触发其新 prop providerOpenSignal 打开供应商下拉 + scrollIntoView 兜底；会话结束/机器离线/Codex 锁定时 notify.warning 事实提示（替代点击无响应）；信号经 lastProviderSignalRef 消费（锁定时吞掉，解锁后不凭旧信号重放）。dialog 浮窗无配置条仍跳 /settings。测试：run-error-item 门控用例翻转 +3 新增（retryable=false 也显示且 primary）；session-config-bar 新增 providerOpenSignal describe 5 用例（递增打开/挂载即开/不重复/running 吞信号/Codex 锁定）；三套件 82 用例绿 + session-panel 4 文件 63 绿 + tsc 0。
- ql-20260903-011-1b58 | CLI 合成鉴权错误前端识别与中文错误卡片（配合后端自动重投）：normalize.ts isAssistantApiErrorText 增识 CLI 鉴权签名（Not logged in / Please run /login）——[ASSISTANT] 合成错误行归 error 类不再当 agent 回复文本渲染（2026-09-03 会话 cb56fabf 事故形态：误导文案以正常回复泡出现在时间线）；buildErrorLogItem 对 raw 命中该特征的 error_detail 升级 type=auth_failed + retryable=true + 中文文案「模型服务鉴权瞬时失败（远端返回 401）/平台已自动重试一次」（RunErrorItem auth_failed 红卡与「重新发送」操作复用既有），raw 原样保留供查看详情；非鉴权错误原映射零回归。normalize 套件 +4 用例 67 绿 tsc 0 eslint 0 error（1 预存 warning）。
- ql-20260826-007-8666 | 创建工作区对话框加 slug 输入框：默认值从工作区名称实时派生（lib/workspaces 新增 `slugifyWorkspaceName`，逐行为对齐后端 schema.slugify：非字母数字折叠连字符/去首尾/小写/兜底 workspace/截断 100），手动编辑过即脱离跟随；提交体非空才带 slug（空=省略走后端派生）；label 标注「创建后不可修改」。移动端创建不加新 UI（沿 D-006 非移动端功能改造惯例，后端派生兜底）。新单测 workspace-scan-dialog.test.tsx 5 用例（派生/纯中文兜底/脱离跟随/省略/手输优先）。
- ql-20260826-008-55ce | 团队任务块展开内容被裁剪且无滚动条修复：TeamTaskBlock 根节点补 shrink-0——父层（session-panel 两渲染点会话团队任务列表 flex-col + max-h-220px + overflow-y-auto）内 flex 子项默认 shrink:1 被压扁，配合块自身 overflow-hidden 裁掉底部分身行、父层永不溢出（滚动条不出现）；shrink-0 保持自然高度让限高滚动真正生效。补回归用例 1 个（jsdom 无真实布局，断言根节点 shrink-0 class），team-block 27 + session-panel-team 12 测试全绿，tsc 0。
- ql-20260827-005-8bca | 登录页删除登录名输入框常显前缀提示（Form.Item extra，连注释一并删；登录失败错误卡内同语义指路提示保留——仅失败场景出现）+ 变更文件弹窗 MD 宽内容横向滚动条补链：ql-20260818-008 只给 FilePreview 三分支加了 min-w-0，宽度约束链在上层 grid item（默认 min-width:auto）与内层 flex 容器处仍断——MD 宽表格把 grid 1fr 轨道撑大、被上层 overflow-hidden 裁掉且无滚动条；change-file-tree.tsx 右列两层包装补 min-w-0 后列宽锁住，overflow-auto 正常出左右滚动条。验证：change-files-card 2 用例过 + 两改动文件 eslint 0 error（1 既有 warning 在未触及代码处）。
- change 2026-08-25-unified-floating-session | 统一智能悬浮会话 v1：新增 stores/floating-session.ts 壳层 store + FloatingSessionHost（球/抽屉/胶囊/互斥挂载门控）+ use-page-session-context（URL 派生页面上下文）；POST /api/daemon/sessions 请求体新增可选 page_context（PageContextCreateBlock）+ build_page_context_preamble 前导；ppm/projects 发起团队按钮改唤起悬浮。后继 2026-08-25-runtimes-entry-unified-floating 在此基础上扩展 runtime 锁定 scope。
- change 2026-08-28-session-ppm-task-binding | 会话关联 PPM 任务/问题前端 + 发起团队预选修复：**lib 层**——daemon.ts createSession（ppm_item_kind/ppm_item_id）+ injectSession（bind_ppm_item_kind/bind_ppm_item_id）四字段绑定透传 + listSessions ppm 筛选参数，新增 `listItemSessions`（GET /api/ppm/item-sessions，卡片数据源）；api-types.ts/openapi.json gen:types 重生成；session-mention(-sources).ts PPM 分组源（任务/问题双分组，默认进行中 + 切全部开关，D-002@v1）、query-keys.ts 缓存键、ppm/task.ts+problem.ts 参数。**组件**——新增 `components/ppm/ppm-item-sessions-card.tsx`（PPM 条目关联会话卡片）；session-panel.tsx ppmItem/mentionBindOptions/autoTeamOpen 最小接线、session-mention-popover.tsx @联想分组渲染（atEnabled 门控）、session-list-panel.tsx 列表 ppm 三段编码筛选、team-trigger-popover.tsx `defaultProjectId` 预选（项目上下文入口直接落到项目 scope）。**三入口**——task-plans 个人视图 / workbench-task-table / problem-drawer 均可对 PPM 任务/问题发起关联会话。**发起团队预选修复（task-07）**——stores/floating-session + floating-session-host 加 `pendingPpmItem` 挂起位（含可选 title，零额外请求）+ `autoTeamIntent`：入口带 PPM 条目时挂起待预会话构造，宿主送达 autoTeamOpen 自动弹 TeamTriggerPopover + defaultProjectId 预选项目 + 分析项目 objective 预填（两步浮层 P2-3 一并修复）。前端相关 11 文件 347 用例全绿 + tsc 0。
- ql-20260828-009-08d0 | 运行时页平台共享智能体管理卡默认折叠 + 补启用/删除（用户反馈「默认折叠起来」「只能停用不能启用或删除」）：后端 grants/router.py 本就有 PATCH enabled 真假双向 + DELETE 204，前端只接了停用。①platform-shared-agents-card.tsx 头部常驻计数摘要（N 个生效 / 共 M 个，data-testid=platform-shared-agents-summary）+ 展开按钮（expanded 默认 false，条件渲染表单/列表/说明文案，折叠时不再占半屏）；②lib/daemon.ts disableSharedAgent 泛化为 setSharedAgentEnabled(grantId, enabled) + 新增 deleteSharedAgent；③操作列按行状态给「停用/启用」切换 + 「删除」（App.useApp modal.confirm 二次确认，对齐 runtimes 页移除运行时先例）。测试：组件 8 用例重写（默认折叠/计数/展开收起/停用(g-1,false)/启用(g-2,true)/删除确认/取消不调；坑：antd v6 confirm 标题双渲染——.ant-modal-title 供 aria-labelledby + .ant-modal-confirm-title 正文，getByText 多命中须按结构选择器断言）+ runtimes 页 admin 用例适配折叠断言。组件+页面 20 用例绿 + page-usage 10 绿 + tsc 0 + lint 仅预存 warning。
- ql-20260828-012-2a3e | 工作区详情「守护进程共享」卡禁用借用绑定（防「共享的共享」，用户反馈）：quick-18951370 放宽后 page.tsx 只要 myBinding 存在就渲染 SharedDaemonToggle，借用绑定（boundDaemon 兜底取 machineCandidates 共享机器，标签形如「xx 共享」）也显示开关。修复：effect 里记 boundDaemonOwned（listDaemonInstances 命中=自有）；绑定 daemon 且 owned=false 时改渲染提示「当前绑定的是他人共享的守护进程（借用），仅自有守护进程可开启共享。」，未绑 daemon 维持原开关行为（后端同步加归属校验双保险，见 backend 侧条目）。顺手修预存债：quick-18951370 给 page 接 useDaemonMachines 时漏处理本测试文件的 QueryClientProvider 依赖（HEAD 基线 10/10 全挂）——mock @/lib/use-daemon-machines 修复；新增自有/借用两用例（不走 renderWithStrategy——其 mockDefaultBinding 会覆盖 daemon_id，照 default_agent 用例手动 mock）。page.test 12/12 + toggle 组件 4/4 绿 + tsc 0。
- ql-20260828-013-1a7d | frontend-ci 红灯清偿（HEAD 9 失败文件全修，CI 全链路对齐）：**machineCandidates mock 债（quick-18951370/0fd09699 接线漏更 6 文件）**——组件侧已改读 useDaemonMachines 融合候选（task-10），mobile-session-list/session-list-panel/sessions-portal/page.m-sessions/page.m-session-chat 的 hook mock 只回 items 漏 machineCandidates（机器分组恒走 config_snapshot 回退判离线 / 机器层 tab 空 / machines 透传空数组），逐文件补 machineCandidates 与 items 同源注入（session-list-panel 收敛进 setMachines 辅助函数派生）；workspace-access-guide.test 则整个漏 hook mock + QueryClientProvider（render 即抛 No QueryClient set），照 page.test 先例 mock 空集走组件 `?? []` 兜底。**SessionPanel 三件预存债（604c32fa ＋功能菜单收敛未适配旧断言，local.yaml B 段）**——dialog-attachments 两用例先点「更多功能」开菜单再断言菜单项 title/disabled（＋ 不随输入框 disabled）；ux-fixes 派团队用例改点 ＋ 菜单「派团队」menuitem（独立按钮已随 TeamTriggerRow 删除）；variant 的 streamSession 断言补第三参（ql-20260827-018 cursor/initialSync 建流选项，对齐 pre-session 已适配形态，两调用点实参 {cursor,initialSync}/{}）。9 文件 130 用例绿 + tsc 0 + lint 仅预存 warning。
- ql-20260829-004-a7ef | dialog attach 挂起会话轮询节流到 15s：session-panel attach 轮询 effect 增加 suspendedNow/lastPollAt 闭包节流——挂起期间实际拉取降频到 SUSPENDED_SESSION_REFETCH_MS（对齐 page 模式 refetchInterval 低频档），离开挂起（daemon 回归转其它状态）恢复 1.5s 档；修复挂起窗口（以小时计）内 1.5s 无限高频轮询请求风暴（每客户端每分钟约 40 次 getAgentSession）。新增节流用例 + 存量恢复断言适配 15s 节流窗（回归检测最多延迟一个窗，与 page 模式语义一致）。suspended-display 12 + connection 11 用例绿，tsc 0。
- ql-20260829-005-86e9 | 审批面板 SSE 永久性错误停重连：session-permission-panel onerror 此前忽略 fetch-sse 透传的 status 码，会话已删（404）/凭证失效（401）/无权限（403）也按 [1..30]s 退避无限重试必败请求；新增 PERMANENT_SSE_ERROR_STATUSES={401,403,404}，命中即置 closed 停本会话重连循环+摘除 sourcesRef 死连接。无 status（网络中断/流结束）与 5xx 照旧退避（task-09 行为不变）；token 刷新/sessionIds 变化经 effect deps 重建订阅自然重开。新增 401/404 停连 + 503/无 status 照旧重连两用例，connection 13 用例绿 tsc 0。daemon.ts subscribeAgentSessionsEvents 同款形态未动（用户指定范围仅审批面板）。
## 2026-08-29-frontend-e2e-playwright
- 新增浏览器级 E2E 体系：frontend/e2e/ 六件套 + playwright.config + test:e2e script + e2e-ci.yml；移除 puppeteer 残留（lockfile -596 行）。8 用例（auth A1-A4/navigation N1-N4），本机 Docker 全栈 8/8 绿 + CI 绿（run 33257206610）+ vitest 2908 零回归。

## 2026-08-29 — 通知铃铛与数据层（变更 2026-08-29-approval-notify-push task-09~13）
- lib/notifications.ts：四 REST 函数 + useNotifications/useUnreadCount（无 refetchInterval，D-005@v1）+ useNotificationsStream（SSE 事件与重连成功双 invalidate，PERMANENT_SSE_ERROR_STATUSES={401,403,404} 停连+指数退避）；query-keys 增 notifications 族。
- components/notifications/notification-bell.tsx：铃铛+Badge 徽标（99+）+Popover 面板（类型语义色标签/相对时间/点击已读+跳转/全部已读/空态），挂载 top-bar（替换原静态 Bell 占位）；三主题 brand-* 语义阶。api-types.ts 经 gen:types 同步（5 端点+4 DTO）。
- change 2026-08-29-session-usage-stats | 会话内 Token 用量统计（frontend 侧）：新组件 session-usage-bar.tsx（摘要行 输入/输出/缓存读取/缓存写入/请求次数/缓存命中率 + 按模型折叠明细，「未记录（旧轮次）」灰阶 tag + 口径脚注；万级中文缩写）；lib/daemon.ts getSessionUsage+手写过渡类型（生成物已同步）；session-panel page 头部下方/dialog 输入框上方双模式挂载，两处 onTurnCompleted 轮次终态递增 refreshSignal 重取（dialog 零 react-query）。组件 5+挂载 4 用例+既有 25 回归绿 tsc 0。

## 2026-08-30 — daemon 徽标闪烁与切换器轮询（ql-20260830-008-fe1d）
- lib/workspace-daemon-status.ts：queryKey 从整个 machineCandidates（含 last_heartbeat_at 心跳时间戳，15s 机器轮询后键必变→切空缓存→statusMap 短暂 {}→全页徽标闪「未绑定」）瘦身为每台机器 [id,status] 二元组 + placeholderData keepPreviousData 双保险；聚合 queryFn 仍消费完整候选（quick-90a9bf32 共享 daemon 误报修复语义不变）。
- components/workspace-switcher.tsx：撤 30s refetchInterval 常驻轮询 GET /api/workspaces（治吵），改 DropdownMenu onOpenChange 打开时 refetch（保留 react-query 默认窗口聚焦刷新）；文件头与行内过时注释同步修正。

## 2026-08-30 — 通知面板条目重排（quick 样式优化）

- notification-bell 条目布局：类型小字标签移到标题上方独立行（右对齐相对时间），标题独占整行解决被标签挤截断；未读标识改左侧 brand 竖条；去掉时间行混排的「点击查看」（hover 背景+title tooltip 承担可点暗示）；「全部已读」加 CheckCheck 图标；间距收紧（px-3.5/py-2.5/gap-2.5，图标 28px）。

## 2026-08-31 — 会话上下文窗口用量：分母可编辑 + 1M 兜底（ql-20260831-002-f683）

- ctx-usage-bar.tsx：分母解析链升四级——第 0 级会话级覆盖 `windowOverride`（AgentSession.ctx_window_tokens，onWindowOverrideChange 存在即在浮层渲染 CtxWindowEditor：InputNumber+保存+恢复默认，覆盖态「已用 / 总量」带「（手动）」标记）＞ one_m 1M ＞ 模型常量表 200k ＞ **兜底 1M**（原 null「无分母」态废除——本地模型/本机默认（未绑平台供应商）拿不到 provider 记录、本地端点协议不暴露窗口大小，读不到不允许为空）；resolveCtxWindowTokens 签名加首参 windowOverride、返回类型改 number（非法覆盖 0/负/NaN 忽略落回自动链）；浮层口径文案同步。session-panel.tsx 真会话环接线（windowOverride + handleCtxWindowOverrideChange → PATCH ctx-window → detailQuery 缓存同步）；lib/daemon.ts 新增 updateSessionCtxWindow。gen:types 同步 AgentSessionRead.ctx_window_tokens。测试：ctx-usage-bar 25 用例（四级链/非法覆盖忽略/编辑器保存与恢复默认/只读态无编辑器）+ session-panel-ctx-tokens 4（1M 兜底下环显示占比，SSE/历史回填数据改可区分大值）+ page.test 1 断言适配，50 绿 + tsc 0。

## 2026-08-31 — 会话消息排队体验修复与增强：SSE 队列实时 + 立即发送/拖拽排序/重新编辑 + 消息复制（变更 2026-08-31-session-queue-ux）

- change 2026-08-31-session-queue-ux | 会话消息排队体验修复与增强（frontend 侧）：**SSE 实时（FR-03）**——lib/daemon.ts envelope 联合补 queue_changed case（会话级事件，不入 run_id 白名单）→ handlers.onQueueChanged?.()（可选 handler，旧调用方零改动）+ reorderSessionQueue/updateSessionQueueEntry/dispatchSessionQueueNow 三 client + SessionQueueEntry.position。**useMessageQueue**——reorderEntry/editEntry/dispatchNowEntry 三方法（逐字对齐 removeEntry 的「调 API→无论成败一律 load 以服务端为准」模式；reorder 422 MISMATCH catch 静默+load 收敛拖拽 vs 派发竞态，R-02）。**MessageQueueBar 重构**——⇅ 拖拽手柄 HTML5 原生 DnD（dragstart/dragover 高亮/drop/dragend，松手收集全量 id 序上传，零新增依赖）+ ⚡ 立即发送（pending/failed 两态，title=打断当前轮立即发送）+ ✎ inline 编辑浮层（textarea+取消/保存，failed 保存转等待中；[后台任务通知]（TASK_WAKEUP）条目不渲染 ✎，与后端 409 双保险）。**session-panel**——page/dialog 双模式 SSE onQueueChanged→refresh + 队列三回调接线（5s 轮询保留兜底）。**CopyButton（FR-07）**——新组件三处挂载：用户气泡（复制剥离附件标记后的正文，空文本不渲染按钮）/Text 段/Thinking 展开正文；「✓ 已复制」1.2s 复位，clipboard 不可用静默降级短暂「复制失败」（R-06）；gen:types 产物同步（三端点+四 schema+position）。测试 +27 用例（bar +7/hook +4/daemon.test +1/panel +1/copy-button 8/segment +3/timeline +3；套件总数 bar 18/hook 12/daemon 30/panel 6/copy 91）全绿 tsc 0。
- ql-20260903-008-3c76 | 群聊右列成员面板高度对齐聊天区（用户反馈「群成员样式高度要和群聊会话一样，超出显示滚动」）：member-panel.tsx MemberPanel 根 aside 缺高度约束——挂载包装层 div(hidden min-h-0 md:block) 是 block 容器，aside 高度 auto 被成员卡内容撑开、超出聊天区列高且根节点 overflow-y-auto 永不触发；根节点补 h-full（挂载列宽屏 grid 拉伸项/窄屏 Drawer body 均定高，session-list-panel 根 h-full 同惯例），成员多时面板与聊天列同高、超出内部滚动；group-chat-panel.tsx 右列加载/错误占位 aside 同步补 h-full 保持同列高。验证：群聊两组件 89 用例（member-panel 42 + group-chat-panel 47）全绿，tsc 0。
- ql-20260903-010-f11d | 群聊页面体验/性能优化（诊断后 P0+P1 方案）：① GroupTimelineRow memo 化——流式期间每个 token 原带动全部历史行重渲染，props 全稳定（entry 不可变归并引用、空 replying 用模块常量 NO_REPLYING 防 `?? []` 击穿、onPin 先解构 mutate 再 useCallback、onQuote 原有 useCallback）后仅变化行重渲染；② 回放分页——初始回放 limit 200 取代全量拉回，顶部「加载更早消息」按 before=最早一条 ts 游标向上翻页（落不满一页即无更早），归并走 applyGroupTimelineEvent（log_id 去重，与 SSE resync 重叠自愈），scrollTop 抬高增量保持视口原位；③ 回到底部悬浮按钮——上滚读历史出现（原只能手动划回），离开期间新消息计「N 条新消息」（leftBottomTs 锚定离开点），滚回底部/点击清零。测试 harness /logs 加动态 logsByUrl 响应器，新增 4 用例（不足一页无入口/翻页游标与插入位/失败重试/按钮全链路），group-chat 目录 93 用例全绿，tsc 0，模块文档 frontend_components.md 同步。
- change 2026-09-02-changes-overview-card | 工作台活跃变更总览卡片：changes-overview-card.tsx（健康条/变更行管线/ghost 折叠/冲突区/过滤/null 占位与过期态/超限降级）+ /workspaces/[id] SectionCard 网格挂载 + 变更中心引导；类型链走 gen:types（api-types 含 MachineSillySpecStatusRead）。卡片+页面 23 绿 tsc 0。
- change 2026-09-25-change-precipitated-assets | 变更详情「沉淀资产」折叠卡：NEW change-assets-card.tsx（ChangeEventsCard 同款范式——useQuery 自取数/retry:false/失败静默 null；四组逐组有数据才渲染：FR 索引/决策蒸馏行可点击跳知识库页（?file= 前向参数）、测试绑定行、patch+delta 归档留档；在途变更引导空态）+ lib/changes.ts getChangeAssets 客户端 + [cid]/page.tsx aside 尾挂载。组件 5 用例全绿 tsc 0。
- 2026-10-12-stale-run-askwait-fix | 动机：生产实证（阿里云会话 47e2ff1a）：交互轮 AskUserQuestion 等待用户回答期间日志静默，后端重
- 2026-10-13-agent-task-stuck-running | 动机:general-purpose 子代理已完成但 UI 永久显示「运行中」——完成通知在 daemon 失忆时被静默
- 2026-10-13-write-tool-diff | 会话面板 Write 工具展开区不显示 diff（Edit 有「变更对比」而 Write 只显示全文），前端补上 Wri
- 2026-10-13-subagent-stub-reconcile | 动机:历史会话时间线里子代理容器(分页窗口截断致派发行缺失时落成 stub 段)永久显示「运行中」且名字回落类型名 ge
- 2026-10-13-session-taskwakeup-hide | 会话面板中 [后台任务通知] 系统注入对用户是纯噪音：进度视图每条通知落一张「上下文注入（N 字，已随消息发送）」卡（文
- 2026-10-13-agentlog-write-diff | 变更运行日志视图（agent-log）的 Write 工具卡仍只显示全文预览，与会话面板已上线的 Write diff 
- 2026-10-13-task-wakeup-remove | 后台子代理任务终态后 daemon 自动注入「[后台任务通知]」开新轮让主代理汇报——用户裁定该自动汇报轮没必要（tok
- 2026-10-13-editpatch-fullchain | agent-log 视图 Edit 卡与会话化对话视图（agent-log-card）的 Write/Edit 卡仍无行
- 2026-10-13-editpatch-p3-cleanup | 收编 editpatch-fullchain 评审 P3：①daemon EDIT_PATCH_MAX_CHARS 按 
- 2026-10-13-turn-live-visibility | 会话运行中用户感知不到 agent 真实状态：TaskOutput 阻塞等待后台任务时时间线只显示原始 JSON 且静默
- 2026-10-13-turn-nav-rail-overflow-fix | 会话页轮次导航窄轨在轮次很多时溢出面板错乱:turn-nav-rail 容器 shrink-0 导致刻度轨不随面板高度收
- 2026-10-13-turn-nav-initial-scroll | 会话页轮次导航窄轨首挂载不滚向当前轮:P3 留债(归档件 2026-10-13-turn-nav-rail-overfl
- 2026-10-13-change-files-view-polish | 变更文件预览的人读优化：timeline.md 裸 markdown 不像时间线、change.patch 整片红绿摊开
- 2026-10-13-session-changefiles-select-fix | 会话页悬浮变更文件弹窗的变更切换下拉项选择不了（用户实测反馈）：radix Dialog modal 遮罩对 body 
- 2026-10-13-session-changefiles-archive-gate | 会话页悬浮变更面板的归档判定口径与变更中心不一致：面板只认 location==='archive' 单信号，而平台既有
- 2026-10-13-sessions-portal-header-remove | 智能体会话页面（/sessions 及 workspace/change/quicklog 三 scoped 入口）页头
- 2026-10-13-session-scroll-layout-storm | 会话页连续滚动（触顶自动加载 / 回到开头后快速滚到底）在系统 Chrome 上 100% 单页崩溃白屏（rendere
- 2026-10-13-slim-subagent-false-running | 动机：历史会话里已结束的子代理（Explore/general-purpose 等）永远显示「运行中」——2026-09
| 2026-10-13 | 2026-10-13-load-earlier-full-turn | 动机：智能体会话页触顶加载与「回到会话开头」按 (ts,id) 复合游标固定 400 行分页，页边界会把一轮（run）切 |
| 2026-10-13 | 2026-10-13-change-reparse-autobind-remove | 动机：reparse 首建变更行时自动绑定工作区最近活跃会话（D-007）误伤面大——闲聊/测试会话躺着中枪（2026- |
| 2026-10-13 | 2026-10-13-change-owner-backfill | 变更中心负责人数据大面积缺失（342 条变更 300 条 owner_id 为空，2026-09-08 后新建全为空）： |
| 2026-10-13 | 2026-10-14-ci-red-batch-fix | 动机：main 最新 push（4347239）后 backend-ci / daemon-ci / frontend- |
| 2026-10-13 | 2026-10-14-ci-flaky-probe-mock | 动机：frontend-ci 在 d850b45fe 仍红——session-history-scroll「连续 bef |
| 2026-10-13 | 2026-10-14-ci-flaky-render-anchor-sweep | 动机：CI 连续逐轮暴露「mock 调用等待后同步断言渲染」型时序脆弱用例（agent-replay-body、sess |
| 2026-10-14 | 2026-10-14-session-preview-defect-fixes | 用户实测 2026-10-14-session-turn-preview-cards 上线后发现两缺陷：①额度耗尽失败轮 |
| 2026-10-14 | 2026-10-14-session-bottom-follow-insert | 用户实测：打开会话加载后有时没滚到底——导航 active 显示最后一轮，但消息流视口停在倒数第几轮。根因：初始日志窗口 |
| 2026-10-14 | 2026-10-14-session-bottom-passive-grow | 上轮修复（bottom-follow-insert）实测 3 次冷加载 2 次仍停距底 9092px：大纲后到中段插入预 |
| 2026-10-14 | 2026-10-14-session-bottom-switch-remount | 用户实测仍偶发不落底——复现路径为「列表点击切换会话」（SPA 内切换，TurnTimeline 不重挂载）：滚动 re |
| 2026-10-14 | 2026-10-14-session-bottom-resize-observer | 第四层根因（真浏览器注入复现取证：重申窗过期后向滚动容器注入 2000px 占位 → delta=2000 永久停住，无 |
| 2026-10-15 | 2026-10-14-session-bottom-no-restore | 第五层根因（滚动写入审计+对照实验锁定）：刷新（reload）时 Chrome 恢复上次滚动位置，恢复晚到（内容装配后） |
| 2026-10-15 | 2026-10-14-session-bottom-grace-window | 用户实测刷新落位随机（19 轮复现 1 次，复现态特征锁定：scrollTop=602=布局早期瞬态假底、clientH |
| 2026-10-14 | 2026-10-14-files-refresh-explicit-sync | 动机：文件树刷新前置同步的触发面挂在了 GET files 接口本体上——会话悬浮面板 15s 自动轮询、初始加载等非主 |
| 2026-10-14 | 2026-10-14-logout-full-reload-clear-cache | 动机：登出换账号后页面仍显示上一用户的工作区/会话等数据——主动登出走 router.replace SPA 跳转，Re |
| 2026-10-14 | 2026-10-14-logout-localstorage-user-data-cleanup | 动机：登出换账号后 localStorage 里按 sessionId/groupId 索引的用户数据（会话草稿、群聊草 |
| 2026-10-14 | 2026-10-14-change-center-lineage-tag-and-filter | 变更中心列表只给轻量出身行显示「轻量」标签，完整流程变更没有任何标签，且筛选下拉里只有「轻量变更」（走 stage=th |
| 2026-10-14 | 2026-10-14-assets-knowledge-popup-preview | 动机：变更详情沉淀资产卡的需求规则（FR 索引）、决策蒸馏、知识触达三组条目当前点击整页跳转知识库，打断浏览；期望点击在 |
| 2026-10-15 | 2026-10-15-fix-ci-red | main 分支 CI 红灯灭火：daemon api-types 漂移 + 前端菜单测试数量锚过期，纯对齐修复无行为变更 |
| 2026-10-15 | 2026-10-14-decision-anchor-change-qualified | 动机：变更详情沉淀资产卡的决策蒸馏弹窗定位不准——decisions/unmapped.md 等聚合文件里多个变更各有同 |
| 2026-10-15 | 2026-10-15-ci-recurrence-guard | CI 红灯防复发：把 2026-10-15-fix-ci-red 灭火中发现的三类漏拦（daemon api-types |
| 2026-10-15 | 2026-10-15-graph-type-cluster | 动机：知识图谱查询切片（neighbors/impact 等）的力场布局只有斥力/弹簧/向心，不同类型节点混成一坨视觉杂 |
| 2026-10-15 | 2026-10-15-change-assets-graph | 变更详情页信息动线不佳（用户原话四条）：①知识图谱（画布+右侧节点详情描述）没有出现在变更详情页，要… |
| 2026-10-15 | 2026-10-15-assets-graph-narrow-typecheck | 动机一行：2026-10-15-change-assets-graph 归档交付的 change-a… |
| 2026-10-15 | 2026-10-15-session-status-dot-semantics | 会话列表行内现有两套点：行首状态点（红=失败/绿=已结束/青+光环=active/灰=排队）与行尾活… |
| 2026-10-15 | 2026-10-15-group-cross-mention-visibility | 群聊互@模式设置面：member-panel 群设置区+建群向导第三步新增互@模式控件（私聊协作/公开委派，三态联动禁用——互@总开关关/consensus 开互斥提示），服务端真值顶层列局部 PATCH 乐观回滚，双端 gen:types 同变更再生成；antd Radio.Button 的 cssinjs 组合选择器在 jsdom nwsapi 抛 SyntaxError 级联炸用例（二分定位）改 Button+aria-pressed 实现。 |
| 2026-10-15 | 2026-10-15-pseudo-domain-migration | 用户指令：把平台仓存量伪域迁真域。背景：sillyspec 仓 2026-10-15-module-… |
| 2026-10-15 | 2026-10-15-workspace-session-agent-only | 工作区中新建会话不再选机器：机器已由工作区绑定决定，浮层只让用户选智能体类型 |
| 2026-10-15 | 2026-10-15-assets-graph-depth | 变更详情页沉淀资产卡的内嵌知识图谱分区（2026-10-15-change-assets-graph… |
- 2026-10-15-change-detail-redesign | 变更详情页重设计：四 tab 容器 + 状态自适应 + 统一时间线 + 图谱独立分区 + 范围对账下沉 + 用量/会话入概览右信息栏（D-001~D-018）
| 2026-10-16 | 2026-10-16-session-decision-pill | 2026-10-16-session-decision-pill |
| 2026-10-16 | 2026-10-16-decision-pill-no-workspace | 无 workspace 的会话（如 445e12d9，10-09 创建 workspace_id 为… |
| 2026-10-16 | 2026-10-16-archived-files-tab | 归档变更也要显示「文件与对账」tab：归档留档区不展示 spec 文档全貌，用户需要文件树与范围对账… |
| 2026-10-16 | 2026-10-15-session-turn-completion-semantics | 上一变更把绿点/完成通知锚定在会话终态 ended 上，但平台里一轮任务跑完后会话仍为 active… |
| 2026-10-16 | 2026-10-16-session-run-status-realtime | 会话列表行首状态目前只靠 daemon 10 秒日志推导活性链（基线），用户触发会话后转圈/完成提示… |
| 2026-10-16 | 2026-10-16-session-pill-dock-drag | 会话页右下角两个悬浮 pill（待决策/变更文件）合并为竖排可拖拽停靠组，点击展开替代 hover |
| 2026-10-16 | 2026-10-16-change-files-sync-result | change 文件树「刷新」同步链路三层静默失败——后端 RPC 预算 3s 短于实测 6~13.5… |
| 2026-10-16 | 2026-10-16-change-center-back-keeps-list-state | 变更中心列表切「已归档」tab或翻页后点行进详情,点详情页「变更列表」返回入口回到列表会重置为进行中… |
| 2026-10-16 | 2026-10-16-change-title-condense-backfill | 变更中心标题提炼与存量回填 |
| 2026-10-16 | 2026-10-16-change-center-delete-back-keeps-state | 变更详情页删除成功后 router.push 无参列表,丢 tab/页码(删归档区变更后回进行中第一… |
- 2026-10-16-conflict-full-tree-compare | 原型视图 conflict-sync-states-view.tsx 与 prototype-build.mjs 重编译对账（原型产物 git diff 为空），改动面聚焦回归 44 用例绿
| 2026-10-16 | 2026-10-17-audit-risk-followup | 24h 审计六连修收口：dsh/zcode 会话恢复白名单漏登记（daemon 重启静默丢记录）、r… |
| 2026-10-17 | 2026-10-17-session-replay-pingpong-fix | 生产环境后端日志 HTTP_401_AUTH_TOKEN_EXPIRED 每秒约10条持续刷屏（单日… |
| 2026-10-17 | 2026-10-17-session-envelope-rev-stale-guard | 2026-10-17-session-replay-pingpong-fix 评审 P3-3——跨标… |
| 2026-10-18 | 2026-10-18-change-type-git-conventional | 变更类型改用git惯用前缀彩色标签 |
| 2026-10-18 | 2026-10-18-change-list-type-filter | 变更列表加类型标签与类型筛选 |
| 2026-10-19 | 2026-10-19-assets-audit-expand-toggle | 归档留档改动文件清单漏展开按钮，超5条只能看前5条 |
| 2026-10-19 | 2026-10-19-shared-agent-onboarding-hint | 无自有 daemon 且无工作区共享机器的新用户(如 180072)在会话创建处不知道要选「平台共享… |
| 2026-10-19 | 2026-10-19-hide-shared-profile-in-session | 用户担心普通会话中途误选「平台向导」类平台共享智能体档案(切换后仅换人格提示词,但用户预期是整套环境… |
| 2026-10-19 | 2026-10-19-change-list-created-sort | 变更中心列表默认按创建时间倒序 |
| 2026-10-19 | 2026-10-19-thinking-zh-translate | 思考内容离线翻译为中文展示 |
| 2026-10-19 | 2026-10-19-change-assets-cross-repo-repos | 变更资产卡展示跨仓冻结面 |
| 2026-10-19 | 2026-10-19-cross-repo-patch-slicing | 资产卡跨仓单文件 diff 切片 |
| 2026-10-19 | 2026-10-19-preview-card-empty-turn-fix | 切换档案产生的静默轮（started_at 空、无日志、无 error_code 的终态轮）刷新后进… |
| 2026-10-20 | 2026-10-20-pill-dock-left-align | 悬浮 pill 停靠组贴左吸附时内容改左对齐 |
| 2026-10-20 | 2026-10-20-pill-dock-drag-align-keep | 悬浮 pill 停靠组拖拽过程中保持拖拽前对齐方向 |
| 2026-10-20 | 2026-10-20-conflict-platform-archive | 冲突对比平台留档快照自足回退 |
| 2026-10-21 | 2026-10-21-provider-set-default-ui | 供应商页复活设为默认入口 |
| 2026-10-21 | 2026-10-21-agent-profile-slim-default | 档案瘦身重定位为人格加技能清单并支持用户默认档案 |
| 2026-10-21 | 2026-10-21-provider-default-ui-hint | 供应商未选态显示对齐用户默认供应商 |
| 2026-10-21 | 2026-10-21-profile-default-prehint | 预会话态档案显示对齐用户默认档案 |
| 2026-10-22 | 2026-10-22-agent-profile-modal-restyle | 智能体档案弹窗重构与技能全选 |
| 2026-10-22 | 2026-10-22-agent-profile-edit-refresh | 档案编辑后全局页列表自动刷新修复 |
| 2026-10-20 | 2026-10-20-session-error-visibility | 会话页失败轮错误信息不可见修复 |
| 2026-10-20 | 2026-10-20-codex-requires-openai-auth | 腾讯云平台 codex 会话选直连（anthropic 形态）供应商时稳定断流（stream dis… |
| 2026-10-20 | 2026-10-20-preset-engine-endpoint | 新建供应商点「OpenCode Go」预设自动填 https://opencode.ai/zen/g… |
| 2026-10-20 | 2026-10-20-session-status-live-sync | 左侧会话状态标签与右侧实时同步 |
| 2026-10-20 | 2026-10-21-proto-data-exposure-guard | 预览真实会话数据移出静态目录并补 gitignore |
| 2026-10-21 | 2026-10-21-gitlog-quotepath-fix | 修复git日志非ASCII路径展示与空diff |
| 2026-10-21 | 2026-10-21-overview-card-mainflow-scan | 总览卡主管线去scan并隐藏thin零步骤 |
| 2026-10-21 | 2026-10-21-mobile-scan-birth-cleanup | 移动端与变更中心scan起步口径清零 |
| 2026-10-21 | 2026-10-21-task-wakeup-restore | 恢复后台任务终态唤醒链并折叠系统行呈现 |
| 2026-10-21 | 2026-10-21-daemon-zombie-turn | 修复 daemon 会话僵尸轮与打断无效 |
| 2026-10-21 | 2026-10-21-session-git-branch | 会话组件底部动态显示当前所在 git 分支 |
| 2026-10-21 | 2026-10-22-review-risk-fixes | 审查修复：原型路由防线与监听泄漏 |
| 2026-10-21 | 2026-10-22-session-trajectory-view | 会话页接入轨迹第三视图 |
| 2026-10-22 | 2026-10-22-file-card-hide-empty | 文件变更卡无数据时整轮不再出卡 |
| 2026-10-22 | 2026-10-22-daemon-snapshot-report-log | daemon 快照上报补收口日志 |
| 2026-10-22 | 2026-10-22-fix-translate-pending | 生产 /api/translate/thinking 请求长时间 pending：容器未配置 TRA… |
| 2026-10-22 | 2026-10-21-task-wakeup-event-queue | 唤醒通知排队呈现改为事件形式 |
| 2026-10-22 | 2026-10-22-session-trajectory-third-view | 把会话轨迹从「进度」视图内的第二层呈现开关上移为与「对话 / 进度」并列的第三个顶层视图，同时修复轨… |
| 2026-10-22 | 2026-10-22-turn-trigger-generalize | 轮触发溯源泛化为统一事件呈现 |
| 2026-10-22 | 2026-10-22-askuser-card-inline | 会话页 AskUser 提问卡悬浮改内嵌滚动 |
| 2026-10-22 | 2026-10-22-turn-trigger-metadata-p2 | 轮触发溯源 Phase 2：定时消息接入与 metadata 戳驱动 |
| 2026-10-22 | 2026-10-22-trajectory-view-redesign | 2026-10-22-trajectory-view-redesign |
| 2026-10-22 | 2026-10-22-file-changes-card-fix | 文件变更卡采集与展示修复 |
| 2026-10-22 | 2026-10-22-sillyspec-probe-db-missing-evict | 已删工作区探针自动淘汰与诊断增强 |
| 2026-10-22 | 2026-10-20-session-awaiting-answer-status | 左侧会话状态补充等待回答问号 |
| 2026-10-22 | 2026-10-22-conversation-live-marquee | 会话页「对话」tab 运行中时只有一行状态条，用户感知不到 agent 正在真实执行；希望在该轮末尾… |
| 2026-10-22 | 2026-10-22-agent-profiles-page-restyle | 智能体档案列表页重设计 |
| 2026-10-22 | 2026-10-23-translate-budget-align | 修复翻译超时预算矛盾与缓存回填乱序 |
| 2026-10-23 | 2026-10-22-session-composer-slim | 会话页面底部输入区信息过载：排队消息与纯文本展示露出附件引用 uuid 长串，中断自动续跑是常驻开关… |
| 2026-10-23 | 2026-10-23-semantic-color-scale-fix | 修复语义色阶未定义导致的隐形状态标记 |
| 2026-10-23 | 2026-10-23-review-risk-fixes-2 | 审查遗留四处风险修复 |
| 2026-10-23 | 2026-10-23-turn-file-diff-dialog | 轮次文件变更卡行点击弹窗显示变更内容（18字） |
| 2026-10-23 | 2026-10-22-askuser-dock-inputbar | AskUser 问答卡迁至底部输入框位置 |
| 2026-10-23 | 2026-10-23-marquee-item-detail | 跑马灯条目细化：转圈、内部滚动与耗时 |
| 2026-10-23 | 2026-10-23-marquee-ticker-speed | 跑马灯条目内部滚动提速 |
| 2026-10-23 | 2026-10-23-live-turn-meta-time | 进行中轮次底部元信息时间显示修复 |
| 2026-10-23 | 2026-10-23-askuser-history-live-sync | AskUser 问答历史实时回显（用户实测 bug 修复） |
| 2026-10-23 | 2026-10-23-file-card-agent-grouping | 文件变更卡按AGENT编辑分组展示并修弹窗说明 |
| 2026-10-23 | 2026-10-23-session-input-clear-fix | 会话输入框发送即清与草稿隔离修复 |
| 2026-10-23 | 2026-10-23-marquee-motion-polish | 跑马灯动效与流光柔化 |
| 2026-10-23 | 2026-10-23-diff-dialog-copy-fallback | 变更弹窗超长diff补复制兜底 |
| 2026-10-23 | 2026-10-23-diff-copy-p3-cleanup | 变更弹窗复制兜底P3清偿 |
| 2026-10-23 | 2026-10-23-session-network-context | 2026-10-23-session-network-context |
| 2026-10-23 | 2026-10-23-session-dialog-input-align | 会话浮窗输入即清与草稿语义对齐修复 |
| 2026-10-23 | 2026-10-23-session-first-window-turn-align | 会话重新进入时首屏历史窗口按最近 400 条日志截断，单轮日志超过 400 条时窗口起点落在该轮中段… |
| 2026-10-23 | 2026-10-23-askuser-dialog-draft | AskUser 弹窗选项与输入互斥及作答草稿保留 |
| 2026-10-23 | 2026-10-23-marquee-blank-track-fix | 修复跑马灯长会话空白 |
| 2026-10-23 | 2026-10-23-marquee-queue-window | 跑马灯渲染队列收敛到最近12条 |
| 2026-10-23 | 2026-10-23-session-first-load-ux | 会话首屏加载提速：补拉链不阻塞渲染+加载骨架屏 |
| 2026-10-23 | 2026-10-23-marquee-thinking-fulltext | 跑马灯思考条目展示全文 |
| 2026-10-23 | 2026-10-23-diff-dialog-pairing-fix | 轮文件变更弹窗(turn-file-diff-dialog)在补丁行缺 tool_use_id 时走… |
| 2026-10-23 | 2026-10-23-knowledge-scope-maintenance | 知识注入作用域维护面板 |
| 2026-10-23 | 2026-10-24-pi-edit-patch-synth | pi 会话的文件变更卡弹窗永远显示无补丁(pi-events.ts 设计期把 edit_patch … |
| 2026-10-24 | 2026-10-22-trajectory-context-jump | 轨迹视图两处体验缺口（对照 dsh）：1) processItems 里的 system_event… |
| 2026-10-25 | 2026-10-24-trajectory-context-rows | 上一变更（2026-10-22-trajectory-context-jump）接错了数据源：pro… |
| 2026-10-25 | 2026-10-23-marquee-awaiting-indicator | 跑马灯等待模型响应指示 |
| 2026-10-25 | 2026-10-25-marquee-subagent-outer-only | 跑马灯外部只显示子代理容器条目 |
| 2026-10-25 | 2026-10-25-subagent-card-unify-panel | 子代理卡片统一为紧凑卡片+详情栏 |
| 2026-10-25 | 2026-10-25-trajectory-source-model | 2026-10-25-trajectory-source-model |
| 2026-10-25 | 2026-10-25-session-tab-visual-unify | 会话页对话与进度tab宽度组件统一改版 |
| 2026-10-25 | 2026-10-25-askuser-keyword-overkill-fix | 会话 96b55567 排查实证——前端 session-log-assembler.ts clas… |
| 2026-10-25 | 2026-10-25-marquee-inactive-awaiting-fix | 修复终态子代理卡片内嵌流动条仍显示等待转圈 |
| 2026-10-25 | 2026-10-25-session-config-deferred-switch | 会话配置点选改暂存随下条消息生效 |
| 2026-10-25 | 2026-10-23-pre-session-draft-persist | 新建会话未发送草稿跨刷新切换保留 |
| 2026-10-25 | 2026-10-25-marquee-awaiting-real-data | 跑马灯等待条目接入真实计时与token |
| 2026-10-25 | 2026-10-25-session-git-worktree-root | 会话 git 分支指示项感知 sillyspec 工作树 |
| 2026-10-25 | 2026-10-25-fe-build-unblock | 修复前端构建红态两处类型错误 |
| 2026-10-26 | 2026-10-26-worktree-group-collapse | 用户反馈（功能上线后实测）：Git 日志页「工作区更改」卡的三个分组标题（更改/未纳入版本管理/已忽… |
| 2026-10-26 | 2026-10-26-config-staged-all-states | 配置切换暂存全状态覆盖与模型下拉跟随修复 |
| 2026-10-26 | 2026-10-26-turn-phase-orphan-fallback | 阶段事件竞态丢弃修复:turn_phase 事件按 run_id 精确匹配未命中时改为回退归属到当前… |
| 2026-10-26 | 2026-10-26-subagent-card-width-unify | 子代理卡片与工具卡限宽统一补漏 |
| 2026-10-26 | 2026-10-26-subagent-task-meta-restore | 子代理任务元数据装配竞态修复 |
| 2026-10-26 | 2026-10-26-ci-red-to-green | 修复四条CI工作流失败转绿 |
| 2026-10-27 | 2026-10-27-mobile-chat-dense | 用户真机复验 seq44 部署后反馈：会话页 agent 回复内容希望手机端占满一行,字体和间隔收小… |
| 2026-10-27 | 2026-10-27-mobile-chat-visual-round2 | 用户真机第二轮反馈(截图)：agent 回复仍未占满一行(真凶=PC 阅读限宽 max-w-[cal… |
| 2026-10-27 | 2026-10-27-scheduled-send-attachments | 用户反馈定时消息发送后 agent 收不到附件。排查确认：后端定时消息全链路（schema/落库/到… |
| 2026-10-27 | 2026-10-27-task-wakeup-precision-fix | 修复任务唤醒判据与通知四处缺陷 |
| 2026-10-27 | 2026-10-27-ghost-spec-binding-fix | 失败命令不再生成幽灵变更占位并过滤存量 |
| 2026-10-27 | 2026-10-27-task-wakeup-inject-retry | 后台任务终态唤醒注入经后端中转单发无重试，撞后端短暂不可用窗（部署重建/502/504）即 inte… |
| 2026-10-27 | 2026-10-27-mobile-chat-visual-round3 | 用户真机三轮反馈：轮次信息折行难看要单行；会话页顶部加返回会话列表按钮；会话列表卡加 PC 端同款状… |
| 2026-10-27 | 2026-10-27-session-input-spacing-tighten | 会话页输入区与消息流底部留白过大——用户在浏览器开发者工具审查发现 pt-3/pt-1/pb-4/p… |
| 2026-10-27 | 2026-10-27-turn-phase-stall-honest-ui | 会话忙时用户消息在 backend 排队/派发链路滞留（生产实证 2026-10-27 会话 7ef… |
| 2026-10-27 | 2026-10-27-archive-reparse-oom-governance | 2026-10-27-archive-reparse-oom-governance |
| 2026-10-27 | 2026-10-27-mobile-chat-visual-round4 | 用户四轮反馈：子代理卡/进度视图过程块(运行命令等)仍不满宽(8 处 calc(100%-120px… |
| 2026-10-27 | 2026-10-27-netdata-prod-monitoring | 腾讯云生产机部署 Netdata 秒级监控 |
| 2026-10-27 | 2026-10-27-sessions-panes-gap-remove | 用户追点：会话页双栏容器 sessions-portal-panes 的 gap-3（栏间横向空隙，… |
| 2026-10-27 | 2026-10-27-turn-phase-observability-monotonic | 生产实证（2026-10-27 会话 7eff99e1，run 4f2e2cdd）：first_ev… |
| 2026-10-27 | 2026-10-27-sessions-total-and-status-filter | 会话列表数据统计修正：用户手机/PC 会话页总数被前端拉取上限截断在 500（实际 515），状态筛… |
| 2026-10-27 | 2026-10-27-knowledge-hits-flush-button | 知识遥测断流根因：sillyspec CLI 2026-10-18 把遥测文件迁至 .runtime… |
| 2026-10-27 | 2026-10-28-knowledge-hits-cli-direct | CLI 直报主通道的接收侧（用户拍板方案收尾）：CLI 侧只持有 shpsync_ 平台令牌（wor… |
| 2026-10-27 | 2026-10-28-change-detail-sessions-source-fix | 变更详情会话区数据源错挂与附件标题修复：概览「会话」区实际取工作区全量最近会话而非该变更关联会话，用… |
