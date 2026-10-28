---
author: qinyi
created_at: 2026-08-30 22:23:33
---

# frontend_components 模块变更索引

- 2026-10-14-session-turn-preview-cards | 会话页消息流未加载轮预览卡 + 跳转附近预取（长会话中间轮次隐身痛点）——①preview-merge.ts 归并层单一数据源（turn-outline 大纲 seq 定序 + 已加载轮透传 + 空壳配置行被预览条目替代 + 空大纲降级）；②turn-timeline.tsx TurnPreviewCard（虚线边框+brand-50 浅底+content-visibility+data-turn-preview 标记）+ expandPreview 可选 prop 缺省零回归；③session-panel-page displayTurns 串联归并 + handleExpandPreview 原地展开（不 scrollIntoView+2.2s ring）+ prefetchNearbyTurns 三重判重附近预取 + hit() 内容门排除预览卡（D-005）。测试：preview-merge 11 + turn-preview-card 7 + 整页集成 4 + 既有面 110 例全绿、tsc 0。

- ql-20260922-001-5ae6 | 思考级别控件 antd Dropdown 化（session-config-bar）——用户反馈配置条上思考级别原生 select（带边框 bg-card 小方框）与旁边供应商胶囊按钮风格不统一；改 antd Dropdown + 胶囊按钮触发器（类名逐字同 ctrlButton：无边框 rounded-md px-2 py-1 text-xs + Brain 图标 brand 色 + 值截断 + ChevronDown，hover bg-muted、开态 bg-muted text-primary），菜单 placement=topLeft 向上弹对齐 ConfigDropdown bottom-full 方向、selectable+selectedKeys 高亮当前档、off 档 P2-11 跨引擎语义 tooltip 保留（label span title），两态（预会话七档镜像/会话态动态档）与禁用态 title/级联重置/乐观缓存契约零变化，data-testid=config-thinking-select 与 aria-label 保留。测试：config-bar 53 用例（第 7/8 节由 select.options/fireEvent.change 改 menuitem 点击+触发器文本直显断言，照 page.m-change-detail antd Dropdown 先例）全绿、tsc 0 错、eslint 8 warning 预存（测试 mock 区未触碰）；dev server（:3100 指向 Docker 后端）实机截图确认胶囊形态与供应商按钮一致（ended 会话禁用态，菜单开态交互由单测覆盖）
- ql-20260921-001-8a4d | ⚡ dispatch_now 引导消息实时渲染兜底（session-panel-page/dialog 双挂载）——⚡「转为引导」链路发送点不建 steering 段（use-message-queue 不消费 dispatch 响应；inject 端点忙轮恒排队致 appendSteeredSegment 生产不可达），mid-turn 注入的 user_input 留痕 SSE 行到达时 markSteeredSegmentDelivered 无段可收敛、消息正文实时视图静默丢弃（刷新后 logsToTurns 才可见）。修复：SSE user_input 处理器新增 appendDeliveredUserMsgIfAbsent 兜底（page:265 起导出、dialog 复用）——口径与回放组2+ 一致：轮存在且 prompt 非空、主体（steerMatchKey，剥前导/附件标记行）与 prompt 互异、轮内无同主体 user_msg 段才追加 delivered 段；prompt 回显/daemon 双提交/纯前导不双画，steering 段刚收敛的 delivered 同键幂等。测试：sessions page 41（+1 ⚡ 场景：兜底 delivered 段+prompt 不覆盖+同主体重复幂等）绿、tsc 0
- ql-20260920-007-c04d | 「客户端路径」行改按账号显示本人 binding 路径（workspace-path-fields，2026-09-20-workspace-member-visibility D-004 另开 quick）——旧口径两处渲染位（列表卡片 + 详情页信息区）均显示 workspaces.root_path 全局列（创建者本机路径），任何能看到该工作区的账号都看到别人的路径；新增 myRootPath prop 三态渲染（string=本人 member binding root_path；null=未绑定，显示「未绑定——进入工作区后在『我的接入』绑定后显示你的本地路径」引导文案；undefined=调用方未接线兼容回退全局路径，daemon/兜底两渲染分支统一抽 ClientPathRow）。数据接线：列表页 bindingsByWs 由 {daemon_id} 扩展为 {daemon_id, root_path}（fetchMyBindings 既有响应零后端改动）+ cardPropsOf 透传；详情页传 myBinding?.root_path ?? null；workspace-card 加透传 prop（WorkspaceCardSlotProps 经 ComponentProps Omit 自动含新 prop）。测试：workspaces 页面 182 + workspace-card 19 用例绿、tsc 0
- ql-20260916-004-8b06 | 轮次刻度 active 选中双修（session-panel-page）——用户反馈短轮次一页多轮时点末刻度选不中末轮。根因两处同源：① handleJumpToTurn 虽先 setActiveTurnKey(entry.key) 即时置位，但 scrollIntoView({smooth}) 途中 scroll 事件经 syncActiveTurnKey（视口顶+120px 判定线规则）重算覆盖，一页多短轮时终点压线的是中间轮；② 贴底/短末轮场景判定线本就压不中末轮。修复：syncActiveTurnKey 加贴底钳制（距底 ≤120px → active=末个 data-turn-key 行，「读到末尾」语义，加载滚底即时正确）+ 跳转定位期 active 联动抑制窗口（performance.now 时间戳 ref，700ms 内 scroll 重算跳过让点击置位存活，过期恢复有机联动）。测试：page.test 新增 2 用例（贴底钳制取末行/离底回落判定线 + 抑制窗口内存活过期恢复）全绿；顺手修存量 mock 债（llm-providers 工厂 importActual 展开补 detectUsageProvider，7b80bf54 起缺导出致 whoLine 2 用例崩，修后余 1 例「发送者+时间」为并行会话已知在途债非本改动）。实机验证：点末刻度选中保持、点首刻度选中保持、有机滚底联动恢复全通
- ql-20260914-007-8f1d | CI 修复批（frontend 面）——①turn-catalog 补 ql-20260913-007-1351 丢失实现：该 quick 仅测试文件随 d114568f3 入库、组件实现未落 git（frontend-ci 5 用例连续红），按 quicklog sidecar 方案恢复——button 本体 h-[18px] × 轨全宽透明命中区（2px 杠上下各 8px 缓冲），视觉细杠内移子 span（data-testid="tick-line"）居中渲染，状态色/hover 放宽/空心描边全挂子 span 经 group-* 触发，nav 去 gap 相邻热区紧贴连续（刻度周期 9px→18px），飞出卡垂直锚点热区中心；②turn-timeline-auto-recover 固件改本地时区固化构造（旧 +08:00 死串在 UTC CI 渲染成 02:03，4 连败）；③session-panel-platform-shared 补 listScheduledMessages mock——全局 apiFetch 返回的共享智能体数组被真定时消息列表吞掉致 summarizeScheduledPrompt 读 undefined.length 异步崩（known_failures I 组时序 flaky 根因）。测试：turn-catalog 17 + sessions 页/variant 44 + auto-recover 7（TZ=UTC 亦绿）+ platform-shared 4 全绿；tsc 0 错；eslint 1 存量 warning（onJump entry 参数名）不变
- ql-20260911-030-dbf0 | 群聊样式对齐常规会话——group-chat-panel 面板根玻璃化（rounded-lg border-border/60 bg-card/80 backdrop-blur-xl，抄 PANEL_ROOT_CLS_DESKTOP）+ 头部玻璃（bg-card/60 backdrop-blur-md + z-20）+ 时间线/typing 条 bg-background + 输入区 bg-card px-5 pb-4 pt-1；输入胶囊换会话同款（rounded-2xl bg-muted/40 + focus-within brand 3px 柔环，原 rounded-xl bg-card + primary 边框弃）；输入框高度拖拽手柄移植（单聊 ql-20260826-010 同款：拖动实时生效 + localStorage sillyhub.sessions.inputBarHeight 落盘 + 双击恢复清键，**同一键全局共享**，textarea 原 max-h-[120px] 钳制移除）；member-panel 根玻璃化（bg-card/70 对齐会话列表面板旁栏口径）。验证：group-chat 113 + sessions-portal/m-sessions 64 用例绿、tsc 0 错；dev server 实测拖拽 44→144px 持久化 + 双击恢复，群聊/会话两面板渲染类名 1:1 对齐
- ql-20260911-001-c07c | turn-catalog 刻度命中区带状化——用户反馈轮次刻度轨必须精确压中 2px 细杠才有反应（原型 .tick 忠实还原连命中难点一起继承）；button 本体从 14×2px 视觉杠改整格刻度带（9px 高=原 2px 杠+7px gap 视觉 pitch × 轨道全宽 30px，轨 gap 归零刻度带无缝铺满整列，对齐 ZCode 带状命中手感），视觉细杠改 ::before 伪元素绘制（全部状态色类加 before: 前缀，14×2px 默认/20px hover+active 观感与 twMerge 冲突语义不变）+ 补 cursor-pointer；飞出卡垂直锚点改刻度带中心（offsetTop+offsetHeight/2，带中心=杠中心）。浏览器实机验证：命中带 30×9 无缝、杠外 3px 悬停出正确轮次飞出卡+杠放宽、杠外点击跳转高亮全通。测试 turn-catalog 15 + sessions 页 44 + variant 全绿，tsc 0 错，eslint 1 warning 预存（onJump 类型签名 entry 参数名，HEAD 同款）
- ql-20260910-008-415c | run-error-item 系统错误码映射补齐——新增 SYSTEM_ERROR_CODE_META（daemon_restarted=服务重启中断/daemon_stopped=服务停止中断/daemon_interrupted=任务中断，中性 slate 族+PowerOff+友好 defaultHint）+ errorMetaFor 统一入口（code 命中优先于 type 查表）；type 徽标键同步修（系统码命中显示 code，原固定拼 item.type 会露「… · unknown」——正是用户实测「运行失败 · unknown」吓人兜底的根因）；hint 链序不变（item.hint > fallbackHint（auto-resume 注入）> defaultHint），系统码与自动续跑提示共存时父级注入仍优先；模型错误 8 类映射与非系统 code（如 1310）零变化。测试 42 用例（新增 5：三码映射/code 优先/共存优先级/非系统码回归）

- 2026-09-10-auto-resume-interrupted-turn | 中断自动续跑前端三件——①session-config-bar 增 autoResume 可选控件（antd Switch 小号「中断自动续跑」，title 两态说明，不传零渲染）；②run-error-item 增 fallbackHint（item.hint > fallbackHint > defaultHint 链，daemon_restarted 不在 8 类映射由父级注入两态文案），turn-timeline daemonRestartedHint 透传（仅 code=daemon_restarted 命中）；③续跑轮徽标：SessionTurnView.autoResumeOf + page-helpers enrichDisplayTurns 回填 run.metadata.auto_resume_of + 轮次行「自动续跑」brand 徽标；session-panel-page 接线（开关 PATCH+detailQuery refetch 同源、hint 按开关态）。测试：error-item+徽标 39+config-bar 30+panel 回归 19 全绿

- ql-20260910-002-dd6d | 24h 审查风险修复第三批（三件）——①群聊聚合 pending 卡误关根治：group-chat-panel memberDialogsQ 的成员级 fetchPendingDialogs catch 原把「拉取失败」与「无卡」混同返回 []，收口判定把缺席一律标已答且 resolvedDialogs 只增不减——一次网络抖动/401 即永久关闭卡（agent 侧提问无超时跟着挂死）；改 queryFn 返回 {items, failedShadowSessionIds}，失败成员的已见卡不收口、用 knownDialogsRef 最后快照维持开放态渲染（下一轮恢复自愈，期间提交命中已答得 409 幂等）。②sessions-portal/floating-session-host 补 useDaemonMachines includeSessions:true——ql-20260909-013 轮询拆分漏了这两个消费方（sessions 恒空：空门户「继续最近会话」入口消失 + D-005 默认机器第二级回退失效）。③「继续最近会话」onClick 补 setSelectedWorkspaceId(recentSession.workspace_id)——D-006 第七个选中入口漏快照，跨工作区续接后 📁 文件树串档/初始误置灰。测试：群聊聚合 11（新增失败不关卡用例）、sessions-portal 53（新增 includeSessions+续接快照用例）全绿
- 2026-09-08-session-turn-nav | /sessions 会话轮次刻度轨导航——新增 components/sessions/turn-catalog.tsx（TickRail：左缘 30px 刻度轨、每轮 2px 刻度垂直居中、四态、hover/focus 深色飞出卡钳制 ±8px、hover:none 触屏直跳、aria-label/aria-current）；turn-timeline.tsx TurnRow 双分支根挂 data-turn-key=realRunId??runId + TurnTimelineProps.highlightTurnKey（per-row 布尔派生防 memo 击穿）；session-panel-page.tsx 接线（runsMeta→catalogEntries 定序合并/孤儿追加/空降级、handleJumpToTurn 直跳+循环加载≤8 页+suppress 触顶抑制+两档 toast、activeTurnKey 滚动联动、desktop flex 行挂载、mobile ⋯ 菜单+Drawer 行式列表）；variant 测试 desktop 父链断言有意更新。零后端（D-004），设计四轮 Grill pass，verify PASS
- ql-20260909-020-99c2 | run 级 SSE 中继两处补齐 sessions 标准写法——daemon-chat/[runId]/stream 与 agent/runs/[runId]/stream 的上游 fetch 原裸 headers：补 signal: request.signal（客户端关面板/切 run 后上游流不再悬挂到自然结束，前端 server 不再累积悬挂连接）+ Accept-Encoding: identity + undici compress:false（禁自动解压缓冲，防 SSE 帧攒 buffer「200 OK 但事件迟到成块」）；tsc/lint 0 错（无路由专属测试，sessions 同型模式已生产验证）
- ql-20260909-019-4534 | Agent Run 日志流管线两刀——①client（agent-stream.ts）connect/_doReconnect 预取回放改 _emitMessages 整批（簿记语义同单条版：timestamp 守卫/seenLogIds 去重/lastLogId 推进，空批不触发）+ 新增 onMessagesBatch 回调；②hook（use-agent-run-stream.ts）批量路径一次 setLogs 追加 + log_id 去重改 seenLogIdsRef O(1)（原 prev.some 每事件 O(n) 扫，长 run 流式累计 O(n²)；两路径共享索引，effect 重跑/clear 重置）；打开数千行 run 历史的 O(n²) 元素拷贝降为一次 O(n)；测试 28 既有 + 新增 TC-21/22（批内去重/跨路径共享索引/runId 切换重置）全绿，agent-run-panel 14 passed，tsc/lint 0 错；流式 delta 定时器微批与 viewer 行级 memo 评估后留后续（act 同步断言面大，需专项改造）
- ql-20260909-013-5c88 | 前端性能二件套——①pdf-previewer pdfjs-dist 改动态 import（原静态 import 经聊天文件卡片 file-message-card → file-preview-modal → PREVIEWER_MAP 链路进最高频会话页首屏 chunk，约 130KB+ gzip，PDF 预览低频；对齐 xlsx/docx await import 先例，workerSrc 随首次加载幂等赋值）；②useDaemonMachines 轮询瘦身——sessions（100 行级重列表）改 opts.includeSessions opt-in（默认不拉，唯一消费方机器页传 true，工作区概览/移动聊天页/悬浮抽屉等 6 挂载方 15s 白拉清零），includeSessions 进 queryKey 防两路缓存互相覆写 sessions 字段（导出 daemonMachinesQueryKey helper，runtimes 页 5 处 setQueryData 同 key 改用）；tsc 0 错误，runtimes 双测试文件 35 + workspaces/sessions 页面测试 46 passed（sessions 页 7 个轮次导航用例预存失败 stash 验证与本改动无关），lint 2 warning 预存
- ql-20260908-004-2b59 | session-panel 3 个测试文件补接 listSessionTasks mock（CI unhandled rejection 修复）——variant / pre-session / prompt 在 sessionApi hoisted 对象里定义了 listSessionTasks mock（task-10 补的）却没接进 vi.mock("@/lib/daemon") 工厂，真实 fetch 在 jsdom 失败 → useNotify().error → 无 AntApp 上下文 message.error 非函数 → 迟到异步抛错成 unhandled rejection（Vitest 按非零退出判 Test 步骤失败，3451 断言全过也拦）；与组件卸载竞态故 CI 慢机必现、本地快机常静默。对齐其余 8 个文件既有模式在 listSessionRuns 行后补 `listSessionTasks: sessionApi.listSessionTasks`（connection / dialog-offline 为整对象展开已天然接上无需改）。3 文件 47 用例绿、无 unhandled error
- ql-20260903-012-7c69 | 删除 admin-organization-tree 组件及其测试——组织管理页全 antd 重构（见 frontend_app 侧同 ql 条目）后组织树由 DataTable treeData 行内承载，该组件零引用成死代码；admin-org-tree（users 页组织筛选树）不受影响
- ql-20260903-011-66a4 | 侧边栏菜单高亮最长匹配独占修复——isActive 原对每菜单独立前缀判断（absolute 走 startsWith(matchPattern)、相对走 includes），兄弟路径互相连累：/settings/providers 页「设置」(/settings) 与「我的供应商」同时选中，/settings/api-keys、/settings/skills、/settings/mcp 同理，「拓扑图」页「项目组组件」连亮；改 matchLength（命中规则不变、结果换算成匹配段长度）+ sidebarSections（渲染菜单集合提前算与 JSX 共用，空组不渲染标题行为保留）取最大值独占高亮；新增 __tests__/app-shell.test.tsx 8 用例（next/link mock 须透传 className，丢了断言不到 active 类）；Docker 前端镜像重建部署实测三页高亮正确

- ql-20260830-013-14b3 | session-usage-bar 摘要行小型化——六项指标名文本标签改 lucide 图标+原生 title 悬浮提示（ArrowDownToLine/ArrowUpFromLine/HardDriveDownload/HardDriveUpload/Repeat/Gauge），值 13px 粗体→11px medium 去抢眼，「按模型明细」按钮改 ChevronDown 图标按钮（title+aria-label 保语义），容器内边距 py-2.5→py-1.5；测试标签断言 getByText→getByTitle 同步（5 用例绿+tsc 0）
- ql-20260830-014-74f5 | session-usage-bar 悬浮提示升级 antd Tooltip——六项与明细切换按钮原生 title 改 antd Tooltip（先例 message-queue-bar，即时弹出+主题 token），触发元素补 aria-label（无障碍名+测试锚点）、移除 title 防浏览器双提示；测试断言 getByTitle→getByLabelText（5 用例绿+tsc 0）
- ql-20260831-010 | turn-timeline 轮次徽标输入侧 null 运行中显示「↑执行中…」——旧实现硬编码假「↑0」误导（GLM 流式期间 message_start 不携带输入、daemon 只从该事件取输入，轮内 inputTokens 常 null 而输出已实时累加）；对齐输出侧 isLive 分支（终态 null 仍「↑0」旧口径），补回归用例（22 用例绿+tsc 0）

- 2026-09-20-agent-reply-no-bubble | 会话时间线 agent 回复去气泡（用户气泡保留）——方案 B 容器语义重构：TextSegmentView 容器（turn-segment-views.tsx）与旧数据回退答复容器（turn-timeline.tsx）统一换无框类 .seg-text-body（无边框/底色/阴影/内边距，max-w min(100%,48rem) 阅读限宽；旧路径不取 w-full 保行尾时间戳尾随语义）；删 SEGMENT_ANIMATION_CSS 子代理透明化补丁（去气泡后天然无框）；globals.css mobile 规则迁新类名（仅字号 14px/行高 24px，不带 max-width 防压 48rem 限宽），.turn-bubble 自此仅用户气泡持有。全流程 verify PASS WITH NOTES：vitest 174（turn-segment-views 72 含新增无框形态用例+session-panel-dialog+sessions page 40）、tsc 0 错、全仓 grep seg-text-bubble 零残留；移交 3 项视觉终验（旧数据回退分支目验/mobile 观感/限宽与段间距）
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
| 2026-10-15 | 2026-10-14-decision-anchor-change-qualified | 动机：变更详情沉淀资产卡的决策蒸馏弹窗定位不准——decisions/unmapped.md 等聚合文件里多个变更各有同 |
| 2026-10-15 | 2026-10-15-ci-recurrence-guard | CI 红灯防复发：把 2026-10-15-fix-ci-red 灭火中发现的三类漏拦（daemon api-types |
| 2026-10-15 | 2026-10-15-graph-type-cluster | 动机：知识图谱查询切片（neighbors/impact 等）的力场布局只有斥力/弹簧/向心，不同类型节点混成一坨视觉杂 |
| 2026-10-15 | 2026-10-15-change-assets-graph | 变更详情页信息动线不佳（用户原话四条）：①知识图谱（画布+右侧节点详情描述）没有出现在变更详情页，要… |
| 2026-10-15 | 2026-10-15-assets-graph-narrow-typecheck | 动机一行：2026-10-15-change-assets-graph 归档交付的 change-a… |
| 2026-10-15 | 2026-10-15-session-status-dot-semantics | 会话列表行内现有两套点：行首状态点（红=失败/绿=已结束/青+光环=active/灰=排队）与行尾活… |
| 2026-10-15 | 2026-10-15-pseudo-domain-migration | 用户指令：把平台仓存量伪域迁真域。背景：sillyspec 仓 2026-10-15-module-… |
| 2026-10-15 | 2026-10-15-workspace-session-agent-only | 工作区中新建会话不再选机器：机器已由工作区绑定决定，浮层只让用户选智能体类型 |
| 2026-10-15 | 2026-10-15-assets-graph-depth | 变更详情页沉淀资产卡的内嵌知识图谱分区（2026-10-15-change-assets-graph… |
| 2026-10-16 | 2026-10-16-session-decision-pill | 2026-10-16-session-decision-pill |
| 2026-10-16 | 2026-10-16-decision-pill-no-workspace | 无 workspace 的会话（如 445e12d9，10-09 创建 workspace_id 为… |
| 2026-10-16 | 2026-10-16-archived-files-tab | 归档变更也要显示「文件与对账」tab：归档留档区不展示 spec 文档全貌，用户需要文件树与范围对账… |
| 2026-10-16 | 2026-10-15-session-turn-completion-semantics | 上一变更把绿点/完成通知锚定在会话终态 ended 上，但平台里一轮任务跑完后会话仍为 active… |
| 2026-10-16 | 2026-10-16-session-run-status-realtime | 会话列表行首状态目前只靠 daemon 10 秒日志推导活性链（基线），用户触发会话后转圈/完成提示… |
| 2026-10-16 | 2026-10-16-session-pill-dock-drag | 会话页右下角两个悬浮 pill（待决策/变更文件）合并为竖排可拖拽停靠组，点击展开替代 hover |
| 2026-10-16 | 2026-10-16-change-files-sync-result | change 文件树「刷新」同步链路三层静默失败——后端 RPC 预算 3s 短于实测 6~13.5… |
| 2026-10-16 | 2026-10-17-audit-risk-followup | 24h 审计六连修收口：dsh/zcode 会话恢复白名单漏登记（daemon 重启静默丢记录）、r… |
| 2026-10-18 | 2026-10-18-change-type-git-conventional | 变更类型改用git惯用前缀彩色标签 |
| 2026-10-18 | 2026-10-18-change-list-type-filter | 变更列表加类型标签与类型筛选 |
| 2026-10-19 | 2026-10-19-assets-audit-expand-toggle | 归档留档改动文件清单漏展开按钮，超5条只能看前5条 |
| 2026-10-19 | 2026-10-19-shared-agent-onboarding-hint | 无自有 daemon 且无工作区共享机器的新用户(如 180072)在会话创建处不知道要选「平台共享… |
| 2026-10-19 | 2026-10-19-hide-shared-profile-in-session | 用户担心普通会话中途误选「平台向导」类平台共享智能体档案(切换后仅换人格提示词,但用户预期是整套环境… |
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
| 2026-10-20 | 2026-10-20-session-error-visibility | 会话页失败轮错误信息不可见修复 |
| 2026-10-20 | 2026-10-20-codex-requires-openai-auth | 腾讯云平台 codex 会话选直连（anthropic 形态）供应商时稳定断流（stream dis… |
| 2026-10-20 | 2026-10-20-preset-engine-endpoint | 新建供应商点「OpenCode Go」预设自动填 https://opencode.ai/zen/g… |
| 2026-10-20 | 2026-10-20-session-status-live-sync | 左侧会话状态标签与右侧实时同步 |
| 2026-10-21 | 2026-10-21-gitlog-quotepath-fix | 修复git日志非ASCII路径展示与空diff |
| 2026-10-21 | 2026-10-21-overview-card-mainflow-scan | 总览卡主管线去scan并隐藏thin零步骤 |
| 2026-10-21 | 2026-10-21-mobile-scan-birth-cleanup | 移动端与变更中心scan起步口径清零 |
| 2026-10-21 | 2026-10-21-task-wakeup-restore | 恢复后台任务终态唤醒链并折叠系统行呈现 |
| 2026-10-21 | 2026-10-21-daemon-zombie-turn | 修复 daemon 会话僵尸轮与打断无效 |
| 2026-10-21 | 2026-10-21-session-git-branch | 会话组件底部动态显示当前所在 git 分支 |
| 2026-10-21 | 2026-10-22-session-trajectory-view | 会话页接入轨迹第三视图 |
| 2026-10-22 | 2026-10-22-file-card-hide-empty | 文件变更卡无数据时整轮不再出卡 |
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
| 2026-10-23 | 2026-10-22-session-composer-slim | 会话页面底部输入区信息过载：排队消息与纯文本展示露出附件引用 uuid 长串，中断自动续跑是常驻开关… |
| 2026-10-23 | 2026-10-23-semantic-color-scale-fix | 修复语义色阶未定义导致的隐形状态标记 |
| 2026-10-23 | 2026-10-23-review-risk-fixes-2 | 审查遗留四处风险修复 |
| 2026-10-23 | 2026-10-23-turn-file-diff-dialog | 轮次文件变更卡行点击弹窗显示变更内容（18字） |
| 2026-10-23 | 2026-10-22-askuser-dock-inputbar | AskUser 问答卡迁至底部输入框位置 |
| 2026-10-23 | 2026-10-23-marquee-item-detail | 跑马灯条目细化：转圈、内部滚动与耗时 |
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
| 2026-10-27 | 2026-10-28-change-detail-sessions-source-fix | 变更详情会话区数据源错挂与附件标题修复：概览「会话」区实际取工作区全量最近会话而非该变更关联会话，用… |
| 2026-10-28 | 2026-10-28-bg-scan-tailread-eviction | 后台任务扫描环区间读与快照淘汰修复 |
| 2026-10-28 | 2026-10-28-model-retry-visible | 模型限流重试过程实时可见——复用COMPACT_STATUS协议行通道透传api_retry |
| 2026-10-28 | 2026-10-28-session-config-default-provider-fix | 会话配置条默认供应商显示与模型联动缺陷：pi 等引擎会话显示了不匹配引擎的默认供应商名（兜底查找未按… |
| 2026-10-28 | 2026-10-28-session-list-refresh-and-paging | 会话列表两个缺陷：①会话内暂存切换供应商/模型/档案随消息生效后，左侧列表条目 chips 仍显示新… |
| 2026-10-28 | 2026-10-28-session-list-loadmore-fetch | 上一变更（2026-10-28-session-list-refresh-and-paging）的「… |
