# 会话门户功能清点基线（Feature Inventory）

> 2026-09-27 三子代理全量清点整合（左栏/中栏/右栏），作为 2026-09-27-session-portal-ia-restructure 的 FR-01 对照基线。
> 重组完成后逐项在「状态」列打勾；位置/触发允许变化，功能语义与数据口径不得变。
> 文件缩写：PORTAL=sessions-portal.tsx，SLP=session-list-panel.tsx，SPP=session-panel/session-panel-page.tsx，BAR=session-config-bar.tsx。

## 〇、重组对照结论（2026-09-27 实现后）

**总判定：功能零丢失。** 全部功能点可达性与语义保持；本次重组涉及的功能点位置映射如下（其余功能点原位零改动）：

| 清单条目 | 原位置 | 新位置 | 保留方式 |
|---|---|---|---|
| §2.1 会话 ID 短码复制 | 头部单行标题右侧 | 头部行2 meta 行（desktop）+ 右列详情「概览」组双入口；mobile ⋯ 菜单原位 | 按钮/文案/toast 逐字搬移 |
| §2.1 状态徽标 | 头部 meta span 内 | 头部行1 标题旁（升级可见性）+ 详情概览组 | 同一 statusBadge 派生 |
| §2.1 平台共享徽标 | 头部 meta span 内 | 头部行2（testid `session-platform-shared-badge` 不变）+ 详情概览组 | 逐字搬移 |
| §2.1 机器/工作区名 chips | 头部 meta span 内 | 头部行2 meta 行 | 逐字搬移（含图标与粗体） |
| §2.1 后台/子代理目录、视图tab、搜索、打断 | 头部右侧操作组 | 原位（新增「详情」开关于同组） | 零改动 |
| §2.3 SessionUsageBar | desktop 头部下方信息条 | desktop 右列「详情」用量组（开关展开，localStorage 记忆开合）；mobile ⋯ 菜单原位 | 组件与 props 零变化，仅挂载点 |
| §2.3 TaskExecutionPanel | 消息流上方（desktop+mobile） | desktop 右列「详情」任务组；mobile 原位 | ref/13 props 零变化，applyEvent 注入链路保持 |
| §三 子代理详情右栏 | 右列（openSubagentId 单槽位） | 原位——右列内容二选一（子代理命中优先），宽度键/resizer 共用 | 语义零变化，subagentPanelOpen 派生优先 |
| §三 右栏拖宽把手 | 子代理右列 | 双模式共用（ariaLabel 文案更新） | side=right 方向零变化 |
| §1.1 「关联」筛选（workspace scope） | 独占一行 | 并入筛选 flex-wrap 区（窄栏自然换行） | 控件 props/联动/服务端过滤零变化 |
| §1.1 机器/智能体/状态下拉 | 筛选行 | 同区 flex-wrap（min-w 约束） | 联动/记忆/重置行为零变化 |

**新增（非清点项，纯收纳入口）**：右列「详情」开关（头部操作组，aria-pressed，`sillyhub.sessions.detailPanel` 记忆开合）；详情概览组新增展示字段（引擎/供应商、模型、档案、轮次、创建时间——均来自既有 session 快照数据，只读展示）。

**移动端与群聊面板零波及**：/m/ 路由、group-chat-panel、PORTAL 层文件预览列均未触碰（git diff 佐证：仅 SPP 与 SLP 两文件 + 三份测试同步）。


## 一、左栏（SLP）

### 1.1 筛选与搜索
- [ ] 标题搜索（回车才应用、allowClear、纯视图过滤）
- [ ] 状态下拉 5 项（全部/活跃/已结束/已失败/已归档哨兵 __archived__ 切服务端数据源）
- [ ] 机器筛选下拉（可搜索、含全部机器清空项、自有+共享融合候选）
- [ ] 智能体筛选下拉（仅选机器后出现、SESSION_ENGINE_OPTIONS 单一源、选机器自动清空）
- [ ] 「关联」下拉（仅 workspace scope；change/quicklog/PPM 任务/PPM 问题分组、服务端过滤、value 编码）
- [ ] 筛选记忆 localStorage `sillyhub.sessions.tree.filter`（含恢复候选缺失自动重置）
- [ ] 筛选变化重置展开（filterEpoch 纪元、清显示全部、本地 Agent 小节回默认）

### 1.2 群聊分区（全局+workspace scope）
- [ ] 分区启用门控（onSelectGroup 传入且 scope 允许；change/quicklog 不挂）
- [ ] 分区头（Users 图标+计数+可折叠 localStorage 记忆）
- [ ] 分区头「＋」三步建群向导（群信息→邀请用户→Agent 成员；归档视图隐藏）
- [ ] 群行（facepile 3 头像+群名+群聊徽标+最后消息摘要/成员数）
- [ ] @我未读红点 + 「[有人@我]」前缀 + tooltip（group-unread lib）
- [ ] 未读数徽标（≥99 显示 99+）
- [ ] 已归档群（muted 徽标+整行降调）
- [ ] 群 hover 操作：归档/取消归档/删除（Modal.confirm+toast+选中清理）

### 1.3 树结构（工作区分组手风琴）
- [ ] workspace_id 分桶（limit=500 拉取；全局=列表序+未知工作区桶+非工作区组；scope=单组）
- [ ] 有会话组在前、0 会话组沉底降调
- [ ] 组头（展开箭头+Folder+工作区名（别名优先）+N 个会话+「＋」+多选钮；hover 浮现）
- [ ] 展开记忆（localStorage 展开例外 ∪ 选中所在组 ∪ defaultExpandedWorkspaceId；同一选中只触发一次）
- [ ] 组头「＋」新建（带筛选直达或两步浮层；归档工作区置灰）
- [ ] 组头多选钮（一次仅一组多选）
- [ ] 组内截断（50 条+显示全部按钮）
- [ ] 拉取上限提示（仅显示最近 N 条共 M 条）

### 1.4 组内小节与附属分组
- [ ] 机器小节（机器名+在线状态点+离线标注+回退 config_snapshot+首现序）
- [ ] 「本地 Agent」合并小节（origin=tool_report、默认折叠、计数、展开记忆）
- [ ] 「分身」附属组（parent_session_id 挂父行下、折叠头、孤儿兜底小节绝不丢行）
- [ ] 「分叉」附属组（origin=fork 挂源行下、与分身组互不联动、源不可见照常渲染+徽标）
- [ ] 归档视图横幅

### 1.5 会话行
- [ ] 状态点（active 光环/ended/failed/其他）
- [ ] 标题截断+空标题兜底（未命名会话/分身/分叉）
- [ ] 置顶徽标+置顶时间 title（服务端排序前端零重排）
- [ ] 已归档徽标、本地 Agent 徽标（引擎位显 harness 身份）、分叉徽标
- [ ] 相对时间（last_active_at 优先回退 created_at）
- [ ] 活性小灯+悬停卡（30s 轮询、Popover 四项、working/blocked→idle 红点未读、选中三路清除）
- [ ] 第二行 chips（引擎色点 chip+meta 行创建人·档案·供应商·N 轮）
- [ ] 行点击/Enter 选中（批量模式下=勾选切换）
- [ ] hover 操作：置顶/取消置顶（轻量不弹确认）→重命名→归档/取消归档→导出（两档 Dropdown）→删除
- [ ] 行内重命名（Enter/blur 提交、Esc 取消防重复提交、≤255 校验）
- [ ] 单条删除/归档（Modal.confirm+成功/部分失败 toast）
- [ ] 行级导出（chat Markdown/full JSON+附件、导出中 spinner）

### 1.6 批量操作条
- [ ] 全选本组/取消全选
- [ ] 删除选中（N）、归档选中/取消归档选中（按视图二选一）、导出选中（两档）
- [ ] 勾选框替代状态点（多选限单组 batchGroupId）

### 1.7 新建与入口
- [ ] 组头「＋」筛选直达（两层筛选具体+runtime 在线跳过浮层）
- [ ] 两步浮层（在线机器卡→在线受支持引擎 runtime、默认 Claude Code 高亮、遮罩取消、空态引导）
- [ ] 空门户「新建会话」按钮（scope 锁定默认组）
- [ ] 空门户「继续最近会话」（含 ?session= 落 URL）
- [ ] ?new=1 直达（D-005 三级回退解析默认机器、?session= 优先、消费后移除）

## 二、中栏（SPP）

### 2.1 头部
- [ ] 会话标题展示（空标题不渲染）
- [ ] 会话 ID 短码 #xxxxxxxx 点击复制（mobile ⋯ 菜单）
- [ ] 状态徽标（六态）
- [ ] 「平台共享」徽标
- [ ] 机器名/工作区名 chips
- [ ] 后台活动目录「后台 ▾」（Bash/Agent 任务/团队任务、脉冲点+计数、外点 Esc 收起）
- [ ] 子代理目录 SubagentCatalog（状态/时长/最新活动、点击开右栏或跳转定位）
- [ ] 「对话/进度」视图切换（localStorage 按会话持久化）
- [ ] 会话内搜索（icon 浮层、回车查 limit=100、命中列表+高亮、点击关闭）
- [ ] 打断本轮按钮
- [ ] mobile ⋯ 菜单（复制 ID/机器/工作区/轮次导航/后台/子代理/用量条）
- [ ] 预会话头部（新会话标题+chips+禁用打断+子代理目录占位）

### 2.2 状态横幅
- [ ] suspended 挂起横幅（继续对话按钮+24h GC 副行）
- [ ] 机器离线只读横幅
- [ ] SSE 断线重连横幅（第 N 次尝试）
- [ ] 连接已恢复横幅（2s 消失）
- [ ] 看门狗横幅（90s/300s 无信号对账、上限 12 轮停表）
- [ ] 已结束/失败/恢复超时横幅+重新开启（409 中文映射）
- [ ] 发送失败错误条（消息流顶部）

### 2.3 折叠信息面板（消息流上方）
- [ ] AgentLogCard 本地 Agent 日志折叠栏（N 个+最新时间、harness/originator/短码/大小/活跃/调用数/命令/log_path 复制、查看内容对话化渲染、加载更早、422/409/404 回落原文）
- [ ] TaskExecutionPanel 任务执行折叠面板（摘要行+三页签：任务清单/运行中/轮次历史+计划总纲条+实时事件注入）
- [ ] 后台任务仍在运行提示行
- [ ] SessionUsageBar 会话累计用量条（六项+缓存命中率+按模型明细表+口径脚注+轮终态刷新+零用量不渲染）

### 2.4 消息流
- [ ] 用户消息气泡（发送时间/头像/附件 chips/hover 复制、剥离标记复制）
- [ ] 静默配置切换轮紧凑行（⚙ 时间·档案·智能体·供应商）
- [ ] whoLine 上下文引用 chip（读轮快照）
- [ ] 系统事件中性行（居中虚线药丸）
- [ ] TurnStatusBar 运行轮状态条（三态+走秒+工具计数+子代理计数+当前活动摘要）
- [ ] 思考占位（三点气泡）
- [ ] 超长输出折叠（>3 万字符+展开全文）
- [ ] RoundDivider 轮尾分隔（第 N 轮+tokens 六态着色）
- [ ] TurnStatusBadge（进度视图）
- [ ] 自动续跑轮徽标
- [ ] 轮级「⑂ 从此分叉」入口（三重门控：caps/进行中/锚点）
- [ ] 失败轮 RunErrorItem 错误卡（8 类图标/文案/建议+重发/切供应商/详情折叠+自动恢复提示）
- [ ] 轮次三段时间（开始/结束/历时）
- [ ] 轮内引导消息段（三态气泡：引导中虚线脉冲/已投递/未投递）
- [ ] AskUser cursor marker 提问卡（原位渲染+提交作下一条+已答态）
- [ ] 段卡全家族：文本（流式光标+复制）/思考折叠（摘要+限高展开）/工具单行（图标+参数+状态徽章+耗时+展开 ToolExpandBody：Write 预览/Edit 行级 diff/Bash 纯文本/Grep 命中/Agent Prompt/通用 JSON）/子代理嵌套块（双模式）/分身段块/stderr 警示行/preamble 上下文注入卡/compact 压缩三态卡/文件段卡/旧回退路径卡
- [ ] pending 提问卡（sticky 顶部+选项+自定义输入+推荐提示+最小化右下角胶囊+已答态）
- [ ] ❓ 轻量提问记录（对话/进度双视图穿插）
- [ ] tool_report 已激活会话历史轮折叠条（不混对话流）
- [ ] tool_report 未激活会话 AgentReplayBody 回放（主日志正文+工作会话折叠+加载更早+三态提示）

### 2.5 轮次导航
- [ ] TurnCatalog 刻度轨（每轮一刻度+状态五档+hover 摘要卡+未加载空心）
- [ ] 刻度点击跳转（已加载直跳+ring 高亮；未加载循环翻页 50 页上限+toast）
- [ ] 滚动联动当前轮（120px 判定+贴底钳制+跳转抑制窗）
- [ ] mobile 轮次导航 Drawer

### 2.6 计划批准与团队
- [ ] PlanApprovalCard（目标/步骤/设计摘要+三态决策+必填反馈+提交 spinner+同 run 去重）
- [ ] ＋菜单「派团队」入口（caps.subagent 门控+终态/离线禁用 tooltip）
- [ ] /team 指令拦截（已有活跃 mission 放行直发）
- [ ] TeamTriggerPopover（目标/范围多选/预算/高级折叠：主控 agent+分身预设/预会话主 agent 选择）
- [ ] 活跃 chip「团队进行中·N 分身」（编辑回显/取消）
- [ ] TeamTaskBlock（概要折叠+主控/范围/分身行+取消两步确认）
- [ ] 分身行：日志展开（logsToTurns 富渲染）/产物展开（summary Markdown+patch）/主体点击开分身会话浮层
- [ ] mission 5s 条件轮询

### 2.7 输入区
- [ ] 多行 textarea（Enter 发送/Shift+Enter 换行）
- [ ] 输入框高度拖拽（44-480px+localStorage+双击复位）
- [ ] ＋菜单（附件/派团队/选择技能/关联变更·快速修复·PPM；独立禁用+tooltip）
- [ ] 附件（多选上限 10/Ctrl+V 粘贴图片/分类上传/chips 预览/失败行内错误/×删除/门控/多模态降级黄条/带附件空文本可发）
- [ ] @ / 联想浮层（指令+技能/变更/快速修复/PPM 任务问题+分组+键盘导航+IME 保护）
- [ ] 结构化选中回传（change/quick/ppmItem 三槽位+绑定上送）
- [ ] ⏰ 定时发送按钮（仅真会话）
- [ ] 发送按钮（creating spinner/空文本禁用/附件豁免）
- [ ] 8000 字上限 toast
- [ ] 草稿持久化（按会话 id+预会话隔离键+失败保留）
- [ ] 发送状态机（占位轮直发/忙轮排队或 steering 直注入/队满 5 拒收/终态禁发/占位轮抢先认领）
- [ ] 预会话首句 createSession（十余字段+失败内联保留输入）
- [ ] 预会话锁定上下文行（chips+🔒+@PPM chip）
- [ ] 占位文案 16 分支链+键盘提示
- [ ] 消息队列条（chips 摘要+三态+展开+拖拽排序+⚡立即发送+✎编辑+↻重试+✕删除+队满 Tag+降级标注+系统条目保护+SSE 即时刷新）
- [ ] 定时消息条（四态 tag+取消 Modal+清空已结束+30s 轮询+自动续跑徽标）
- [ ] 定时发送弹窗（草稿预览+分钟级 DatePicker+快捷项）

### 2.8 配置条与用量
- [ ] SessionConfigBar（供应商/模型级联/档案/思考档位七档/中断自动续跑开关/预会话暂存/外部信号开下拉/Esc 关闭）
- [ ] CtxUsageBar（上下文用量环+额度胶囊+窗口总量编辑+压缩上下文按钮三型回执）
- [ ] 切换成功刷新详情+列表+runsMeta
- [ ] 错误卡「切换供应商」定位联动

### 2.9 会话操作与滚动
- [ ] 打断本轮（含发送窗口期回退输入框+409 兜底）
- [ ] 重新开启
- [ ] 失败轮重发（剥离附件标记）
- [ ] 复制全家（气泡/文本段/思考/工具/会话 ID/log_path/短码）
- [ ] 触顶自动加载（400 条起步+复合游标+锚钉回+30s 硬上限）
- [ ] 视口不满自动续拉（10 次上限）
- [ ] 贴底跟随（80px 阈值+选中文字不打断+静默窗）
- [ ] 回到底部/N 条新消息悬浮按钮
- [ ] content-visibility 屏外跳过渲染

### 2.10 子代理右栏与分叉
- [ ] 子代理紧凑卡点击开右栏（openSubagentId 单槽位+✕/段失效自动关闭）
- [ ] SubagentDetailPanel（头部+任务指令全文块+children 时间线+嵌套切换+独立滚动）
- [ ] 右栏拖宽把手（与文件预览共用宽度键）
- [ ] fork 顶部 LineageBlock 溯源块+多跳谱系面包屑（环防御 5 跳）
- [ ] ForkConfirmModal（档位语义标注+继承快照+409/422 行内）
- [ ] WorkerSessionOverlay（分身/谱系/分叉进入三场景复用）

## 三、右栏（PORTAL + 面板内）

- [ ] 文件预览列（✕ 关闭+路径 truncate+可拖宽+跨工作区防串档）
- [ ] FilePreview 本体（pdf/html iframe+源码预览切换/图片 lightbox/Markdown/Prism 17 语言代码高亮/二进制元信息卡/10MB 截断/全屏预览/下载/空态错误态）
- [ ] 左栏「📁」文件模式切换（快照防闪跳+全局无选中置灰+「← 返回会话」保留预览边聊边看）
- [ ] filePreview 与 subagentView 单槽位互斥（双向清零+会话切换统一清）
- [ ] SubagentPanelContext null 哨兵渐进增强（dialog/悬浮回退内联展开）
- [ ] 三栏宽度（左 240-560/预览 320-860，localStorage 记忆，双击复位+方向键微调）

## 四、门户级（PORTAL）

- [ ] 四分支（群>真会话>预会话>空门户；key 重挂载清流）
- [ ] ?session= 双向同步（群分流、router.replace 不进历史、无效静默）
- [ ] 页头 scope 后缀+workspace 紧凑 GitStatusBar
- [ ] SSE 会话事件订阅（onConnected 补拉+400ms 去抖+断线退避）
- [ ] 列表条件轮询（10s 进行中/30s 静默+后台标签停轮）
- [ ] 机器 15s 轮询、群列表 staleTime、供应商/归档守卫
- [ ] 四入口 scope 差异（全局/工作区/变更/快速修复：过滤、preContext 双传、群分区、关联筛选、GitStatusBar、空态文案）

## 五、隐蔽功能（重构最易丢，重点对照）

- [ ] 五处 localStorage 记忆（tree.filter/tree.expansion/group-section-collapsed/leftPanelWidth/filePreviewWidth/new.machineId）
- [ ] 活性未读红点链路（转移检测+三路清除+全空闲停轮）
- [ ] 搜索回车才应用语义
- [ ] 选中自动展开组/小节（同一选中只触发一次防回弹）
- [ ] 分身/分叉孤儿兜底绝不丢行+计数不受 50 截断影响
- [ ] ?new=1 与 ?session= 优先级+消费后移除+urlRestoreDoneRef 防自写参数二次验证
- [ ] SSE onConnected 首次补拉+leading/trailing 去抖+卸载 cancel
- [ ] 群深链分流（session_kind）+建群成功落 URL
- [ ] 归档三态防御（显式 archived=false+queryKey 视图维度+归档视图隐藏＋+归档工作区置灰）
- [ ] 操作后选中态清理矩阵（会话与群两套）
- [ ] selectedWorkspaceId 六写入点快照（📁 防串档）
- [ ] 重命名 Esc 取消标记防 blur 二次提交
- [ ] 批量模式行点击语义反转+多选限单组
- [ ] 0 会话组沉底降调
- [ ] 键盘可达性（role=button+tabIndex+Enter；resizer role=separator+aria）
- [ ] 占位轮 SSE 抢先认领+mid-turn 注入留痕兜底+迟到日志补跑
- [ ] 拖选文字不触发折叠/不自动滚底守卫
- [ ] 发送窗口期打断回退（inflightSendRef）
- [ ] steering 三态段纯函数双模式共享
- [ ] 队列条系统条目保护+降级标注
- [ ] 草稿/视图模式/输入高度/右栏宽度四套 localStorage
- [ ] 触顶加载复合游标+锚钉回+会话纪元防串台
- [ ] 跳转三抑制窗协同（防跳转被弹回底部）
- [ ] whoLine/sender/replyAt 快照注入（历史不跟随当前）
- [ ] 门户小开关群（自动续跑/ctx 覆盖/压缩/思考档位/多模态降级/归档只读/队满/8000 字）
- [ ] mobile 收入口不砍功能原则
- [ ] panel 层零 react-query（自建 Provider/自取数）
- [ ] 性能守卫（memo+per-row 基元派生+content-visibility+解析缓存 FIFO 500）
- [ ] 预会话失败内联错误保留输入
- [ ] 右栏单槽位互斥双向清零
- [ ] fork 两档文案同源（FORK_TIER_META/LINEAGE_TIER_META）
