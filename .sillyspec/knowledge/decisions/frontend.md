# 决策知识 — frontend

> decision-distill 从变更 decisions.md 幂等提炼（「最近确认」= 归档时 HEAD）。条目字段行为 docs-check 机械解析契约，勿手改。

## D-001@v1 : plan 模式采用强确认交互
状态：implemented
锚点：`frontend/src/components/daemon/plan-approval-card.tsx`
最近确认：04bb45fe
理由：强确认，类似 askuser 弹窗。

## D-005@v1 : 预览弹窗用 antd Modal
状态：implemented
锚点：`frontend/src/components/files/file-preview-modal.tsx`
最近确认：3b1624fb
理由：FRONTEND_PAGE_STYLE 约定弹窗不用 Drawer；标题栏含元信息+下载，body 按注册表分发（D-004）。

## D-007@v1 : PDF 渲染用 pdf.js 画布（iframe+原生查看器不可依赖）
状态：implemented
锚点：`frontend/src/components/files/previewers/pdf-previewer.tsx`
最近确认：3b1624fb
理由：ql-20260827-001——Chrome 原生查看器对内嵌 blob PDF 报"未能加载"、嵌入式 Chromium 无 PDF 组件；pdf.js 逐页画布零插件依赖，worker 静态放 public/，>50 页截断提示下载。

## D-008@v1 : Excel 不做在线渲染（xls/xlsx → fallback 下载引导）
状态：implemented
锚点：`frontend/src/components/files/preview-registry.ts`
最近确认：3b1624fb
理由：ql-20260826-013 用户决策——SheetJS 表格还原度差、OnlyOffice/LibreOffice 管线先后退役（字体/网格排版/页数偏差），Excel 预览弹窗直接给下载引导。

## D-009@v1 : md 附件渲染器统一 useObjectUrl 托管 blob 生命周期
状态：implemented
锚点：`frontend/src/components/files/use-object-url.ts`
最近确认：3b1624fb
理由：鉴权拉 blob → createObjectURL → 卸载/切换自动 revoke 三件套统一 hook，消灭三入口手写拉取泄漏风险（R-04）。

## D-010@v1 : OnlyOffice 渲染器免 npm 包（动态 script + DocsAPI）
状态：implemented（休眠）
锚点：`frontend/src/components/files/previewers/onlyoffice-previewer.tsx`
最近确认：3b1624fb
理由：不引 @onlyoffice/documenteditor-react——DocsAPI 全局 + 自写最小类型；api.js 单飞加载；DS 9 替换式挂载（holder 被 iframe 替换）→ 兜底超时以父容器出现 iframe/holder 消失为成功信号（ql-20260826-002 误降级教训）。

## D-007@v1 : 进行中可见性三层方案（投影+徽标 / CLI 上报增强 / 心跳不做）
状态：implemented
变更：2026-08-29-change-delete-closure-and-spec-pull
锚点：`frontend/src/components/changes/change-activity-badge.tsx`
最近确认：0ec935c9
理由：Layer 1 ChangeSummary.last_pushed_at 投影（progress 行既有列，零 migration）+ 活动徽标三态（active≤30min「进行中」/active>30min「停滞」/waiting|null 空闲）；ACTIVITY_STALE_MS=30min 阈值与 ISO_LIKE_RE 正则白名单防御解析（畸形串回退原文不炸组件）均为前端展示层关注点不进后端 DTO，复用既有 30s 轮询零新增请求；Layer 2 CLI X3 步骤开始/X4 任务边界补推为跨仓渐进增强（后端零改动）；Layer 3 心跳 Non-Goal 协议预留。徽标文案只陈述事实（「最后信号 x 分钟前」）不断言挂死（R-12）；current_step_status 不区分 pending/in-progress 是 Layer 1 启发式固有边界（态 1/态 2 仅由阈值区分），强判定需心跳留将来。

## D-002@v1 : 覆盖范围不含 git-log
状态：implemented
变更：2026-08-26-file-fullscreen-preview
锚点：未记录
最近确认：5d86ddb1
理由：用户勾选「统一预览弹窗加全屏 + 工作区文件浏览器」，未勾选 git 提交记录文件列表。

## D-003@v1 : 方案 A 统一弹窗升级
状态：implemented
变更：2026-08-26-file-fullscreen-preview
锚点：frontend/src/components/files/file-preview-modal.tsx
最近确认：5d86ddb1
理由：用户选「方案A：统一弹窗升级」。

## D-004@v1 : CSS 伪全屏而非浏览器 Fullscreen API
状态：implemented
变更：2026-08-26-file-fullscreen-preview
锚点：未记录
最近确认：5d86ddb1
理由：antd Modal 尺寸切换（100vw/100vh）实现伪全屏，参考 agent-log-viewer.tsx L905 fixed inset-0 先例。不用 requestFullscreen()——iframe/弹窗嵌套下兼容坑多且不可控。

## D-005@v1 : 新增 HtmlPreviewer 渲染器
状态：implemented
变更：2026-08-26-file-fullscreen-preview
锚点：frontend/src/components/files/previewers/html-previewer.tsx（新增）
最近确认：5d86ddb1
理由：新增 html 渲染器：iframe sandbox="allow-scripts allow-popups" + srcDoc（与 change-file-tree 内联 HTML 预览同款安全策略）；registry 增 text/html mime + html/htm 扩展名。

## D-007@v1 : explorer/变更文件不接 OnlyOffice
状态：implemented
变更：2026-08-26-file-fullscreen-preview
锚点：未记录
最近确认：5d86ddb1
理由：不接。officeSource 仅支持 session_attachment|file 两类有平台 id 的来源；这两处无 id，不传该字段恒走本地渲染器（docx-preview/SheetJS）。

## D-008@v1 : Esc 保持 antd 默认关窗
状态：implemented
变更：2026-08-26-file-fullscreen-preview
锚点：未记录
最近确认：5d86ddb1
理由：保持 antd Modal 默认（Esc 直接关窗）。拦截改写需 hack antd 键盘处理链，脆弱且收益小；原型演示的「先退全屏」仅为示意，不作为实现要求。

## D-001@v1 @V1 渲染层策略：独立移动渲染层（方案 A）
状态：implemented
变更：2026-08-26-mobile-workspace-page
锚点：未记录
最近确认：e784c9fb
理由：新增 `/m/workspaces/[id]/**` 独立移动页面：变更列表/详情用移动卡片 + 全屏钻取重绘；会话直接复用 SessionPanel 内核（继门户页/悬浮窗之后的第四宿主）。数据层 100% 复用 `lib/changes.ts` + `lib/daemon.ts` + `lib/tasks.ts`，桌面代码零回归（仅解除 m/workspaces 门禁等 4 处最小改动）。middleware UA 分流（matcher 已含 `/workspaces/:path*`）与 route-guard（已放行 `/workspaces/:id/**`）无需结构改动

## D-003@v1 @V1 会话能力边界：完整内核复用
状态：implemented
变更：2026-08-26-mobile-workspace-page
锚点：未记录
最近确认：e784c9fb
理由：SessionPanel 内核 100% 复用，所有高级功能（消息队列/子代理目录/上下文用量/会话配置）保留，仅重排样式适配手机竖屏。对齐 2026-08-25-unified-floating-session 验证过的"一内核·N 宿主"模式

## D-002@v1 : 数据链路走方案 A——git_log 模块扩展独立轻量 status 端点
状态：implemented
变更：2026-08-26-workspace-git-status
锚点：backend/app/modules/git_log/router.py
最近确认：86d6c405
理由：复用 git_log 模块与 host-fs 平名通道，daemon 加单方法 git_status、backend 加 GET /git-log/status、前端共享组件。

## D-001@v1 ctx_tokens 派生位置——归一化器源头上报处派生（方案 A），否决消费侧统一派生（方案 B/C）
状态：implemented
变更：2026-09-13-ctx-usage-all-providers
锚点：sillyhub-daemon/src/interactive/providers.ts:ProviderCaps（caps 键落点）+ sillyhub-daemon/src/interactive/usage-ctx.ts:ctxTokensFromNetInput（公式单源落点，execute 新建）
最近确认：未记录
理由：用户原话指定方向：「都要接入的，并且需要统一抽象出来（我记得最近刚刚做了个统一抽象的事情，就是怕后面再接新 agent 又遗漏一些功能）」。据此选方案 A（各归一化器在 usage 构造处用共享 helper 派生 + ProviderCaps 第 11 键声明走既有三端生成与守护链）。

## D-001@v1
状态：implemented
变更：2026-09-19-tool-report-session-replay
锚点：frontend/src/components/daemon/session-panel/session-panel-page.tsx:3474（isToolReportBody 分支）、frontend/src/components/daemon/turn-timeline.tsx:220（SessionTurnView）
最近确认：53c67e02a
理由：直接按普通会话样式展示会话时间线，数据源换成 agent 日志对话化消息——复用真组件（TurnTimeline）而非自造相似渲染器

## D-002@v1
状态：implemented
变更：2026-09-19-tool-report-session-replay
锚点：frontend/src/components/daemon/agent-log-card.tsx:877（AgentLogCard 折叠栏——子代理入口可沿用该形态）
最近确认：53c67e02a
理由：主日志 = 回放正文；子代理日志降级为次级「工作会话」入口（不并入正文，避免同一叙事重复两遍）；主日志多条（同 ctx 多次本地会话）时最新为主、更早折叠

## D-004@v1
状态：implemented
变更：2026-09-19-tool-report-session-replay
锚点：sillyhub-daemon/src/agent-log/parse-zcode-model-io.ts:66（NormalizedLogMessage）、backend/app/modules/platform_sync/router.py:849（messages 端点）
最近确认：53c67e02a
理由：四层打通——daemon 解析器透传 usage/turn/model/耗时 + 全会话累计 → RPC 返回结构 → 平台 GET /agent-logs/{id}/messages schema → gen:types → 前端映射到 SessionTurnView token 字段与会话用量环；老 daemon 字段可选、缺省显示「未知」；cursor-agent 回放 token 恒「未知」（数据不落盘，非解析器可解）

## D-008@v1
状态：implemented
变更：2026-09-19-tool-report-session-replay
锚点：decisions.md D-001/D-004/D-007
最近确认：53c67e02a
理由：方案A——前端适配器把 NormalizedLogMessage[] 映射为 SessionTurnView 喂 TurnTimeline 真组件；daemon zcode 解析器补 usage/turnId/model/累计 + 新增 claude-code、cursor-agent 解析器与 cursor-agent 扫描上报；平台 messages schema 加可选字段 + gen:types；平台库零表结构改动，按需现读

## D-001@v1 agent 回复去气泡、用户消息保留气泡
状态：implemented
变更：2026-09-20-agent-reply-no-bubble
锚点：未记录
最近确认：fbbf02f4b
理由：用户确认（2026-09-20 explore 会话 + AskUserQuestion 选择直接立项）：agent 回复文本去掉气泡（边框/底色/阴影/内边距，内容铺在时间线背景上）；用户消息（含轮内引导消息三态气泡）保留品牌色右对齐气泡不动。依据：主流 AI 会话同款形态（Claude/ChatGPT/Gemini/DeepSeek），且项目已半途演进——子代理文本段已透明化去气泡、agent 气泡曾因"顶满成文档块"收窄 86%→80%、mobile 限宽放宽至 94%。

## D-002@v1 双渲染路径同步改，不做新旧形态分叉
状态：implemented
变更：2026-09-20-agent-reply-no-bubble
锚点：未记录
最近确认：fbbf02f4b
理由：同步改。旧路径（segments undefined 的孤儿 turn/旧数据）与 v2 路径若形态不一致，同一会话里新旧消息长相分叉，违背"回退不崩不空且行为等价"的既有约定（turn-timeline.tsx:671 注释）。代价仅是多改一处类名。

## D-005@v1 实现方案选 B（容器语义重构）
状态：implemented
变更：2026-09-20-agent-reply-no-bubble
锚点：未记录
最近确认：fbbf02f4b
理由：方案 B。⚠️ 采纳方式如实记录：AskUserQuestion 会话内用户未作答（离席），按预置推荐默认继续，非用户亲选——用户可 `sillyspec run brainstorm --reopen --from-step 4` 改选，改选 C 时本决策 superseded。理由要点：新建无框正文类（seg-text-body 语义名）承载 agent 文本，bubble 类名只留用户侧，避免"名不副实"；顺带删子代理透明化补丁（.seg-subagent-body .seg-text-bubble 覆盖，去气泡后天然冗余）+ 迁移 mobile 规则；方案 A 的共享类 .turn-bubble 拆样式是埋坑（用户气泡与旧路径答复共用），方案 C 超出本次气泡诉求（YAGNI）。
故障面：类名替换遗漏（测试/样式选择器仍引用旧类）——靠全仓 grep .seg-text-bubble/.turn-bubble 清单化核对兜底
退役判据：若后续整体对齐主流形态（方案 C 复潮），正文容器类可沿用，仅结构层重排

## D-001@v1 定时发送的实现方案
状态：implemented
变更：2026-09-07-session-pin-rename-scheduled-send
锚点：未记录
最近确认：35f3d6528
理由：**方案 B：新建 `agent_session_scheduled_messages` 表 + 独立 sweeper 常驻协程**。到点扫描 due 条目，逐条复用 `inject_session_as_service`（忙轮自动入 `agent_session_queued_messages` 既有队列），单条状态 pending → dispatched / cancelled / failed，失败隔离。

## D-001@v2 liveness 联表取数与未读转移检测（客户端状态机）
状态：implemented
变更：2026-09-08-session-list-liveness-dot
锚点：未记录
最近确认：35f3d6528
理由：**客户端转移检测状态机**：hook 每轮（30s）对每个有 liveness 的会话，取 localStorage 存的该会话「上次已知 state」与当前 state 比较——`prevState ∈ {working, blocked}` 且 `current == idle` 时置未读标记（`sillyhub:liveness-unread:${sessionId}` = 转移发现时间戳）；随后更新 `sillyhub:liveness-state:${sessionId}` = current。红点显示 = 未读标记存在；`selected` 置真（覆盖点击/Enter/深链三路）时清除未读标记。首次见到该会话（无 prevState，含 unknown/无记录）不亮红点，避免初次打开刷屏。取数缓存槽固定 `"all"`（queryKey `["agent-liveness-overview", "all"]`）——API 本就不按 workspace 过滤（鉴权 scope 全量），固定槽让悬浮宿主/门户多挂载共享同一份缓存与轮询；与总览卡（wsId 槽）各自独立互不干扰（跨路由 gcTime 内仍可复用 react-query 缓存）。
supersedes：D-001@v1

## D-003@v1 未读转移语义继承（归档草案 D-006 落地）
状态：implemented
变更：2026-09-08-session-list-liveness-dot
锚点：未记录
最近确认：35f3d6528
理由：触发边 = `working/blocked → idle` 状态转移（用户原话）；清除 = 用户看过该会话（点开）；**不往状态枚举加「未读」**（用户硬约束）。

## D-002@v1 展示硬约束继承（D-004 两层 + 双主题 + 悬停卡定位）
状态：implemented
变更：2026-09-08-session-list-liveness-dot
锚点：未记录
最近确认：35f3d6528
理由：行尾**只加 ~18px 状态小灯**（复用 `liveness-badge.tsx` 的 LivenessDot 与 LIVENESS_META，不重写五态视觉）；**不新增列、不改列表布局**；完整信息只出现在悬停卡；无关联日志的会话不显示灯；色值只用语义阶。悬停卡用 **antd Popover（trigger=hover，默认 portal 渲染）**包住 18px 小灯实现——SessionRow 根节点 `overflow-hidden` 会裁剪 absolute 定位卡片（session-list-panel.tsx:2640，Grill BL-02），portal 渲染是唯一不破行布局的落法；悬停卡内容为**组合渲染**（LIVENESS_META 状态名 + 静默时长相对时间（last_event_at）+ 证据摘要（state_evidence 截断）+ 推导时间（state_derived_at）），不直接用 livenessTitle 单行字符串（其为原生 tooltip 拼接形态）；「关联」行删除（AgentLogListItem 无 change_key/quick_id 数据源，Grill CC-04）。

## D-001@v1 根治方案选 A——全链强制 workspace_id + daemon 映射查根
状态：implemented
变更：2026-09-09-conflict-root-workspace-scoping
锚点：未记录
最近确认：35f3d6528
理由：**方案 A**。对比 RPC `sillyspec_conflict_snapshot` 与裁决指令 `sillyspec_resolve` 全链（REST 请求体 → WS payload → daemon 消息处理 → 前端弹窗下传）强制携带 `workspace_id`；daemon 用 `_sillyspecStatusRoots.get(workspaceId)` 解析根，**映射未命中不得回退单槽位**，抛 RpcError `workspace_root_unknown`（提示该工作区尚未被本机会话认领）；无 workspace_id 的旧调用形态保留单槽位 legacy 语义。辅防：无 workspaceId 的 claim 不再覆盖单槽位。与根因文档 `docs/sillyspec/conflict-compare-wrong-status-root.md` 已定稿口径一致。

## D-002@v1 P0-2 独立配额池的作用域与实现层次
状态：implemented
变更：2026-09-10-review-dispatch-platform-fixes
锚点：未记录
最近确认：f1bdbef95
理由：用户原话「支持按 workspace 或按 agent_profile 独立配置（独立池或不同 provider）」。探查证实 profile 绑定链路已全通，真缺口=llm_provider schema 锁死 claude + daemon injector REGISTRY 无 pi；补齐后 per-(user, agent_kind=pi) 默认与 profile/workspace(default_agent_profile_id) 两条路都开放，不在本变更里强选一条。

## D-002@v1 供应商下拉按会话引擎过滤 agent_kind
状态：implemented
变更：2026-09-11-session-provider-switch-codex-pi
锚点：frontend/src/components/sessions/session-config-bar.tsx
最近确认：225dd771d
理由：用户裁决：按引擎过滤。codex 会话只列 codex kind 供应商，pi 只列 pi kind，claude 只列 claude kind。顺手修掉现状「全量展示 + 选错 kind 撞 backend 422（inject_gates.py:556 agent_kind 不匹配）」的坑。

## D-002@v1 触发时机=仅 turn 空闲可压（轮中禁用）
状态：implemented
变更：2026-09-14-session-ctx-compact
锚点：未记录
最近确认：1aacbb3d9
理由：用户选「仅空闲时可压」——turn running 时按钮禁用（提示「轮运行中」），turn 空闲后才可压缩；不打断用户正在跑的任务（各引擎原生 /compact 也都是空闲交互语义）。

## D-004@v1 反馈呈现=端点响应回执 + 前端通知三分型
状态：implemented
变更：2026-09-14-session-ctx-compact
锚点：未记录
最近确认：1aacbb3d9
理由：端点响应承载回执，前端按 provider 分型通知：pi「已压缩：X → 约 Y tokens」（数字来自 RPC response）/ codex「已触发上下文压缩」（受理无数字）/ claude「已发送 /compact（压缩轮运行中）」（流程可见性由会话流中的 /compact 轮本身承载）；失败通知带 error 原文（如 pi "Nothing to compact"）。

## D-002@v1 架构=compact 同款 RPC 模式（可选 driver 方法+daemon RPC handler+caps 键）
状态：implemented
变更：2026-09-14-session-thinking-level
锚点：未记录
最近确认：28915f71b
理由：方案 A：照 2026-09-14-session-ctx-compact 刚验证的 RPC 模式——driver.ts 加可选 `getThinkingLevels?(handle)`/`setThinkingLevel?(handle, level)` 两契约方法；daemon.ts 注册 `session_get_thinking_levels`/`session_set_thinking_level` 两 RPC handler；backend 两端点（GET 档位列表+POST 切换）；caps 第 13 键 `thinking_level`（claude/pi/codex=true、cursor=false）。B（进程重启式）否决：切档重启子进程丢流式状态体验差；C（inject 文本）否决：pi/codex 不认文本且档位查询无通道。

## D-002@v1 保留服务端分页（量级一两百）
状态：implemented
变更：2026-09-14-workspace-drag-sort
锚点：未记录
最近确认：e21bf19cc
理由：一两百个量级，服务端分页（12/页 limit/offset）保留，不做"加载全部"改造。

## D-010@v1 前端拖拽库——@dnd-kit/core + @dnd-kit/sortable
状态：implemented
变更：2026-09-14-workspace-drag-sort
锚点：未记录
最近确认：e21bf19cc
理由：引入 @dnd-kit/core + @dnd-kit/sortable（两者皆新依赖）。理由：1/2/3 列响应式网格的落点判定与位移动画，原生 HTML5 需手写碰撞检测且体验糙；dnd-kit 轻量、支持网格 sortable、键盘无障碍内置。

## D-011@v1 数据层实现——方案 A（排序表 + 浮点中点锚点）
状态：implemented
变更：2026-09-14-workspace-drag-sort
锚点：未记录
最近确认：e21bf19cc
理由：方案 A（用户 brainstorm Step 4 AskUserQuestion 亲选）。理由：唯一同时满足锚点跨页（客户端只需边界卡 id）+ 保住现有服务端 limit/offset 分页与四路筛选 SQL（LEFT JOIN 原生 ORDER BY）+ 每次拖拽 O(1) 单行写入；B 把排序挤到应用层与分页 SQL 冲突且全量写放大；C 跨设备不同步、分页下无法独立排序。淘汰记录：B 违反 D-002 精神（架空服务端分页）、C 违反 D-001（顺序非服务端持久）。

## D-005@v2 筛选态手柄形态——禁用态而非隐藏
状态：implemented
变更：2026-09-14-workspace-drag-sort
锚点：未记录
最近确认：e21bf19cc
理由：禁用态：手柄可见但灰显（cursor-not-allowed）+ 筛选条内提示。可发现性优于隐藏——用户在筛选态能看见"有排序功能但被保护"，而非以为功能不存在。
supersedes：D-005@v1

## D-009@v2 「移动到…」弹窗范围收敛——页首/页尾 + 方向锚点
状态：implemented
变更：2026-09-14-workspace-drag-sort
锚点：未记录
最近确认：e21bf19cc
理由：弹窗仅保留页首/页尾（用户 Step 5 确认的设计形态），"某卡前后"精确落位由页内拖拽覆盖不重复提供。锚点按移动方向区分：页首=向上 before_id 目标页第一张/向下 after_id 目标页第一张；页尾=向上 before_id 目标页最后一张/向下 after_id 目标页最后一张；目标页内容先经现有列表接口拉取；锚点为自身时前端跳过请求。
supersedes：D-009@v1

## D-012@v1 边缘投放带锚点由服务端页相对解析（to 枚举 + rank 响应）
状态：implemented
变更：2026-09-14-workspace-drag-sort
锚点：未记录
最近确认：e21bf19cc
理由：投放带请求改 `{to: "next_page_head"|"prev_page_tail"}`（可选 page_size 默认 12），服务端在默认视图有序序列（可见 ∧ active ∧ 未删，按显示序）上定位被移动卡 rank、按分页数学解析目标插入 rank，再走统一中点路径；响应携带移动后 rank，前端 floor(rank/page_size) 换算目标页自动翻页+高亮。否决客户端预取相邻页方案：每次拖拽多两请求且边界卡在并发移动下会过期，分页数学在客户端重复实现必再出 off-by-one。

## D-003@v2 边缘投放带锚点表达改 to 枚举（UX 不变）
状态：implemented
变更：2026-09-14-workspace-drag-sort
锚点：未记录
最近确认：e21bf19cc
理由：维持边缘投放带路线（用户 explore 亲选的 UX 不变），仅锚点表达从客户端 id 锚点改为 `{to: next_page_head|prev_page_tail}` 服务端解析（D-012）。v1 的锚点写法作废；翻页+高亮闭环承诺保留。
supersedes：D-003@v1

## D-014@v1 分页数量不变量——move 是纯重排
状态：implemented
变更：2026-09-14-workspace-drag-sort
锚点：未记录
最近确认：e21bf19cc
理由：不允许（用户 2026-09-14 明确约束）。move 只做单行 sort_position 更新，不增删任何行；任何移动后 total 不变、每页恒 PAGE_SIZE 张（末页允许不满），跨页移动=源页少一张/目标页多一张后重新切片。

## D-001@v1 thin 接入形态=THIN 新辅助阶段，列表页与常规变更同列（用户裁决）
状态：implemented
变更：2026-09-25-change-center-thin-flow
锚点：未记录
最近确认：9c908b6ae
理由：用户裁决选方案 A（THIN 新辅助阶段），并加 UX 约束原话：「列表页面上我想跟常规变更在一起，内部的逻辑展示可以不一样」——thin 变更是常规 Change 记录，进主变更列表（不像 quicklog 另开 tab），详情页内部按薄流程两段式（start→干活→done）差异化展示。依据：与上游 CLI「存量过渡」语义逐字对齐（quick 保留收尾、新工作走 thin）；新旧隔离清晰存量零风险；manual_dispatch 泛化路径零改动可用；quicklog 那种独立 tab 的形态在核对中被证伪（thin 变更的四件套/归档/事件/蒸馏全在 change 体系，独立入口割裂最重）。
故障面：过渡期 quick/thin 两套辅助阶段并存——前端徽章/筛选/说明卡两态都要活，漏一处即裸显英文 "thin" 或全灰管线（核对报告前端遗漏清单已列全触点）。
退役判据：quick 存量变更全部收尾归档后，可另立决策下线 QUICK 阶段派发面与 quicklog 读侧（读侧至少保留一个归档周期）。

## D-001@v1 数据流=服务端聚合端点（方案 a），thin+brainstorm 跑法（用户裁决）
状态：implemented
变更：2026-09-25-change-precipitated-assets
锚点：未记录
最近确认：a7eca07270b25dbe374717aaf8379f57254fe3df
理由：用户前轮方案对比后裁决「好，做」选定方案 a——后端新增聚合端点按变更名解析 spec 树镜像（knowledge/fr/*.md 与 knowledge/decisions/*.md 的「变更：」行过滤 + 归档目录 test-trace.json/change-patch.json/delta.md 容错读取），前端观测事件卡同构折叠卡；并裁决本变更走「轻量变更+头脑风暴预段」（原话：好，做，第二个变更走轻量变更附加头脑风暴）。b（CLI 命令：tests 无 --json/derive 无对应 facet/decisions list 只读 active）与 c（前端自行解析：全量拉 60+ 域文件 N+1 + CLI 机械解析契约前端化双端漂移）经两子代理核对证伪排除。
故障面：解析契约与 CLI 演进漂移——「变更：」行格式属 CLI 机械契约，上游改格式需同步本解析（加版本容错与未知行跳过）。
退役判据：若平台后续引入结构化资产表（CLI 直推 DB），本解析层可退役改读表。

## D-001@v1 需求范围 = 本地 CLI 会话的 token 用量纳入变更中心统计
状态：implemented
变更：2026-10-02-change-center-token-usage
锚点：未记录
最近确认：0dc1de6bd
理由：A——本地 CLI 会话（用户 AskUserQuestion 确认）。这类会话已建 agent_sessions 行（origin=tool_report，title=「本地 · 变更名」）并经 change_session_links 绑定变更，但其 token 用量不落库（platform_agent_logs 无 token 列），变更中心用量聚合对它们恒为空。需求 = 让这类用量也进变更中心展示，口径与平台执行展示一致。

## D-002@v1 落库触发方式 = 方案 A 上报链路顺带解析（backend 拉）
状态：implemented
变更：2026-10-02-change-center-token-usage
锚点：未记录
最近确认：0dc1de6bd
理由：方案 A（用户 AskUserQuestion 确认）。CLI 每次 POST /api/agent-logs 上报后，backend 异步经现有 WS RPC 通道让 daemon 解析本次涉及 entry 的日志用量并落库。理由：触发高频自然（CLI 每条命令都上报）、复用回放已有的解析器与 RPC 通道、改动集中 backend；daemon 离线仅暂缓（下次上报全量解析幂等补齐）。否决 B（两端改动 + 持续解析开销与观看需求无关）与 C（列表页批量 RPC 爆炸、离线空数据，不可行）。
故障面：后台摄取任务可能因 daemon 离线/超时长期空转记日志（无失败放大，快照滞后）；上报高峰期重复解析受节流钳制但仍有 RPC 开销
退役判据：若后续 daemon 原生周期推送用量（方案 B 复潮条件：多机环境下报频率不足、新鲜度成为实际痛点），本摄取链路可整体下线，落库快照消费端（聚合/展示）不变

## D-002@v1 日志采用拉取尾部+手动刷新（非实时流）
状态：implemented
变更：2026-10-13-daemon-log-config-view
锚点：未记录
最近确认：255a46d66
理由：用户选「拉取尾部+手动刷新」：点开查看最近 N 行（默认可调），带刷新按钮；不做 WebSocket 实时滚动
故障面：大日志文件全量读取导致 RPC 超时——须在 daemon 侧或 backend 侧限制返回尾部字节上限
退役判据：未来出现「盯日志实时排障」高频诉求时，再评估升级为 WS 实时流（可基于现有 daemon:ws 通道扩展）

## D-003@v1 功能范围=查看+下载（不做在线编辑）
状态：implemented
变更：2026-10-13-daemon-log-config-view
锚点：未记录
最近确认：255a46d66
理由：用户选「查看+下载」：日志和配置均支持查看与下载为文件；不做在线编辑（allowed_roots 编辑已有现有路径，其余配置改动仍在 daemon 本机做）
故障面：用户误以为平台可改配置——UI 上需明确标注「只读」

## D-004@v1 采用方案 B——daemon 专用诊断 RPC（log_tail + config_get）
状态：implemented
变更：2026-10-13-daemon-log-config-view
锚点：未记录
最近确认：255a46d66
理由：用户选方案 B：daemon 注册 daemon_log_tail 与 daemon_config_get 两个 RPC handler（路径由 daemon 侧 getLogFile()/loadConfig 权威解析，尾部截断与脱敏在源头做），backend 新增转发端点（复制 daemon_rpc.py 先例），前端 /runtimes 机器卡加入口。理由：路径权威（SILLYHUB_DAEMON_DIR 重定向不影响）、大文件不全量传、脱敏贴近数据源
故障面：老 daemon（未升级）无这两个 RPC → method_not_found；需在 backend 映射 422 + 前端升级提示
退役判据：若未来 host_fs RPC 支持按约定 key 寻址 + tail 参数，可考虑合并回通用文件读通道

## D-backend-006@v1 交互形态 = 知识库页内嵌搜索 + 结果面板 + 双落点跳转
状态：implemented
变更：2026-10-15-platform-knowledge-search
原编号：D-006@v1
锚点：未记录
最近确认：7af8e0e32
理由：知识库页（/workspaces/[id]/knowledge）顶部内嵌搜索框（用户原话场景：方便在知识库里检索数据和理解知识内容）；结果面板展示 来源徽章/文件路径/条目或标题/片段高亮/匹配度。点击落点分两类：knowledge/ 结果 → 既有深链 ?file=&anchor=（page.tsx deepLinkDoneRef 机制现成）；docs/ 结果 → scan-docs 页新增 ?path= 深链（该页现无 URL 参数定位，需补选中逻辑）。片段文本随结果直接展示，不点开也能看到匹配上下文。
故障面：scan-docs 深链若只按 path 精确匹配而 workspace 尚未同步该文件，会静默落空——落空时保持空白态静默（不报错、不提示、不重试请求）；消费时机对策：ref 只在命中并选中后置位，命中前每次列表刷新（含 reparse 静默刷新）重试匹配，目标出现即自动选中（design.md Phase 4，评审 X5 修订）。
退役判据：若日后引入全局 ⌘K 命令面板聚合搜索，页内搜索框可降级为入口之一。

## D-backend-008@v1 实现方案选定——方案 A（新用户侧端点 + 文件系统直读 + 词面/向量融合）
状态：implemented
变更：2026-10-15-platform-knowledge-search
原编号：D-008@v1
锚点：未记录
最近确认：7af8e0e32
理由：（autonomous 会话代拍板——用户未在线，AI 按仓库既有约束与 D-001~D-007 权衡代选方案 A，待用户复核）方案 A：新建独立搜索服务与用户侧端点，spec 根直读文件、结构切块、词面与向量双路融合、进程内懒索引。理由：①唯一不破坏 CLI 契约（B 的问题）又能复用平台 embedding 基建的路径；②文件直读与 vector_search.py 已验证的懒构建同构，故障面最小；③切块/权限/降级全可控。
故障面：前端需同时接两个后端查询面（知识搜索 + scan-docs 列表）做跳转；若 scan-docs 深链不同步做，docs 结果不可直达（风险已记 D-006）。
退役判据：若 B/C 的否决条件消失（见 D-009/D-010 复潮条件），可重议。

## D-frontend-001@v1 首屏信息动线 = 分阶段自适应（在途看进度+待办 / 归档看成果）
状态：implemented
变更：2026-10-15-change-detail-redesign
原编号：D-001@v1
锚点：未记录
最近确认：fe8a71ed4
理由：用户选「分阶段自适应」：在途变更首屏讲「进度 + 现在该做什么」，归档变更首屏讲「最终产出了什么」；同一页面按变更状态切换重点，避免两套空态互相打架。（落选：待办优先 / 进度优先 / 成果优先三个单一取向。）
故障面：状态判定用 isTerminalChange(status=archived 或 location=archive) 双条件，若后端新增第三态（如 failed）则分叉漏判退化为在途态展示。
退役判据：若详情页拆分为两个独立路由（在途页/归档页），本「同页自适应」决策退役为路由分叉。

## D-frontend-002@v1 页面骨架 = 顶部四 Tab 分区（概览 / 产出 / 过程 / 文件与对账）
状态：implemented
变更：2026-10-15-change-detail-redesign
原编号：D-002@v1
锚点：未记录
最近确认：fe8a71ed4
理由：用户选「顶部 Tab 分区」，并以第 2 轮追问确定为**四 tab**：概览 / 产出 / 过程 / 文件与对账；首屏只留概览，其余点进去看。tab 组件复用项目现成 primer `UnderlineNav`（变更列表页已同款使用）。
故障面：tab 隐藏内容后，用户可能找不到某些信息（发现性下降）——以概览页放「各 tab 摘要 + 计数入口」缓解（已计入 D-006/D-007）。
退役判据：若内容量回落到单屏可承载（如卡片数 ≤3），可退回单列布局。

## D-frontend-003@v1 知识图谱 = 脱离沉淀资产卡内嵌，作为「产出」tab 内独立分区
状态：implemented
变更：2026-10-15-change-detail-redesign
原编号：D-003@v1
锚点：未记录
最近确认：fe8a71ed4
理由：用户选「知识图谱独立」：图谱从资产卡内嵌分区改为「产出」tab 内的独立分区（自带画布 + 右侧节点详情），不再与资产清单抢同一张卡；卡内固定高度（280px）的挤压约束随之解除。
故障面：图谱查询失败/不可用时的隐藏策略改变——原为「整区静默隐藏」（资产卡内局部塌陷），独立成区后隐藏会造成 tab 内大片空白，需为空态提供显式说明或整 tab 空态（已列入 design 待办）。
退役判据：若知识图谱页（/knowledge/graph）能承接该视图，可改为深链跳转而非内嵌。

## D-frontend-004@v1 范围对账 = 从侧栏常驻下沉至「文件与对账」tab
状态：implemented
变更：2026-10-15-change-detail-redesign
原编号：D-004@v1
锚点：未记录
最近确认：fe8a71ed4
理由：用户选「范围对账下沉」：不再侧栏常驻，收进「文件与对账」tab（与变更文件同区）；卡内三态计数、明细弹窗、命令折叠等既有能力保留。
故障面：下沉后用户不再被「有差异」自动提示——若差异化提示缺失，对账价值降为「主动去看」，需在概览保留差异计数入口（已计入 D-006）。
退役判据：若对账能力并入「归档留档」数据面（同一批文件差异），本卡可整体退役。

## D-frontend-005@v1 两条时间线合并为一条统一时间线
状态：implemented
变更：2026-10-15-change-detail-redesign
原编号：D-005@v1
锚点：未记录
最近确认：fe8a71ed4
理由：用户选「合并两条时间线」：合并为一条统一的过程时间线（时间/任务/状态/提交记录合到一行看），消除同一时点、同一任务在两处重复出现的现象。
故障面：合并去重规则误判把两个真实不同的动作并成一行（如某步骤的 --done 与同名 task-done 事件）——需以「源+稳定键」复合键去重而非按名称/时间近似匹配，且保留可展开查看原始两源明细的兜底。
退役判据：若后端提供单一权威时间线端点（服务端合并），前端合并算法退役。

## D-frontend-006@v1 执行用量与会话入口 = 概览右侧信息栏（MetaPanel 式压缩展示）
状态：implemented
变更：2026-10-15-change-detail-redesign
原编号：D-006@v1
锚点：未记录
最近确认：fe8a71ed4
理由：用户选「概览右侧信息栏」：概览页右侧一条窄信息栏（类 GitHub PR 右栏 / primer MetaPanel），承载变更 key、类型、负责人、创建时间、任务进度、用量数字、会话入口、范围对账差异计数等元信息，压缩成数行；用量明细仍可按需展开。
故障面：信息栏窄（≤300px）时长文本（变更标题、会话名、模型名）溢出——需统一 truncate + title 悬浮全文的既有约定。
退役判据：无（信息栏为概览的结构组成）。

## D-frontend-007@v1 归档态 tab 集自适应收窄
状态：implemented
变更：2026-10-15-change-detail-redesign
原编号：D-007@v1
锚点：未记录
最近确认：fe8a71ed4
理由：用户选「tab 随状态自适应（收窄）」：归档后保留概览（转为「成果总结」语义）+ 产出 + 过程，隐藏「文件与对账」（归档时其内容与「沉淀资产 · 归档留档」重复）。在途变更则概览突出进度与待办。
故障面：归档态隐藏 tab 后，用户若仍需对账明细将无入口——降级路径为「产出」tab 的归档留档区（patch/delta + 单文件 diff）。
退役判据：若对账与归档留档两数据面合并，本收窄规则随 D-004 一并复核。

## D-frontend-008@v1 实现路径 = 原型驱动全量重写（走项目既有 prototype-as-code 管线）
状态：implemented
变更：2026-10-15-change-detail-redesign
原编号：D-008@v1
锚点：未记录
最近确认：fe8a71ed4
理由：用户选方案 A：先在 `frontend/src/components/prototype/` 写完整新版详情页视图（import 生产组件 + fixture 假数据），`pnpm prototype:build` 编译为可双击打开的独立 HTML 供用户批准；批准后按 PROTOTYPE.md「接线」规程把视图挪到正式页面（fixture 换真实 hooks），同变更内一次性完整交付（D-010）。
故障面：fixture 假数据与真实数据形状偏差（尤其合并时间线 D-005 的去重输入）——以「原型只管版式、逻辑走纯函数+单测」分工隔离，接线阶段逐 tab 换真实 hooks。
退役判据：若原型管线被废弃（改为 dev 预览路由），本路径退化为「dev 预览确认」。

## D-frontend-009@v1 与本次冲突的活需求 = 显式取代并落盘
状态：implemented
变更：2026-10-15-change-detail-redesign
原编号：D-009@v1
锚点：未记录
最近确认：fe8a71ed4
理由：用户选「显式取代并落盘」：在本变更 decisions.md + requirements.md 逐条写入取代记录（旧 FR 标 superseded + 指向新 FR），并同步知识库索引；不采用「只在新文档注明」的轻处理。
故障面：取代记录不全 → 旧需求保持 active 会在后续变更的知识注入中被当作真约束，造成改回旧版式的复潮。
退役判据：无。

## D-frontend-010@v1 交付节奏 = 一次性完整交付
状态：implemented
变更：2026-10-15-change-detail-redesign
原编号：D-010@v1
锚点：未记录
最近确认：fe8a71ed4
理由：用户选「一次性完整交付」：概览 + 产出 + 过程 + 文件与对账四 tab、合并时间线、图谱独立分区、口径自适应全部完成后统一验收，不留四不像的中间态。
故障面：单次交付面大（page.tsx 重写 + 新组件族 + 合并算法 + 原型），风险集中——以 Wave 分批执行 + 每波测试绿门控缓解。
退役判据：无。

## D-frontend-011@v1 改造边界 = 桌面变更详情页；移动端不动但组件契约须兼容
状态：implemented
变更：2026-10-15-change-detail-redesign
原编号：D-011@v1
锚点：未记录
最近确认：fe8a71ed4
理由：用户选「允许改后端」（若设计需要可新增接口或字段，同变更内同步生成前端类型）；同时未选「桌面+移动端」，故移动端 /m/ 详情页本轮不改。经源码核实：移动端直接 import 了桌面的 4 个组件（change-agent-run-log / change-stage-header(WORKFLOW_STAGES) / change-step-timeline / change-usage-card）与 scope-audit-command-card，故重构不得静默破坏这些导出与行为。
故障面：合并时间线若决定在后端做（D-005 退役判据触发）会引入跨端改动，与「移动端不动」的边界冲突——已在 design 阶段以「前端合并、零后端改动」为默认路径规避（待 Design Grill 复核）。
退役判据：移动端详情页改版立项时，本条边界失效。

## D-frontend-012@v1 变更文件查看 = 「文件与对账」tab 内直接内嵌文件树
状态：implemented
变更：2026-10-15-change-detail-redesign
原编号：D-012@v1
锚点：未记录
最近确认：fe8a71ed4
理由：用户选「标签页内直接内嵌」：文件树常驻于「文件与对账」tab，左侧点文件、右侧出内容/diff，不再只给一个「打开」按钮再套一层弹窗。
故障面：文件树常驻后首屏多一次取数（原为 open 才请求）——以 tab 懒挂载（切到该 tab 才挂载）抑制。
退役判据：若文件树取数成本不可接受，退回弹窗按需加载。

## D-frontend-013@v1 tab 状态写入 URL query（?tab=）
状态：implemented
变更：2026-10-15-change-detail-redesign
原编号：D-013@v1
锚点：未记录
最近确认：fe8a71ed4
理由：用户选「写进网址」：切换 tab 更新 `?tab=`，刷新、分享链接、从别处跳回都停在同一个 tab。
故障面：URL 与内部 state 双源不同步（前进/后退与手改地址）——以 URL 为唯一源、state 从 URL 派生。
退役判据：无。

## D-frontend-014@v1 合并时间线的确定性口径（源内去重 + task-done 折叠 + 步骤行与任务行不合并）
状态：implemented
变更：2026-10-15-change-detail-redesign
原编号：D-014@v1
锚点：未记录
最近确认：fe8a71ed4
理由：我的判断——读完后端合成时间线实现后确定三层口径：①**源内严格去重**：步骤用「阶段 + 序位」为键（StepTimelineEntry 有 stage/ordering 稳定字段，无 id），事件用「时间 + 类型 + 文本」为键（TimelineEvent 无 id）；②**task-done 事件不单独成行**：任务行的勾选时刻本就是由 task-done 事件序列推断出来的（backend/app/modules/change/timeline.py:96-122 `_infer_task_times`「checked N→M」游标衔接）——此为**数据来源上的确定重合，非近似匹配**，故 tasks 域的 task-done 事件折叠进「任务进度」清单，非 tasks 域（如 design.md 自审清单「design · checked 0→6」）的 checked 事件保留为普通事件行；③**步骤行与任务行不做合并**：二者粒度不同（阶段步骤 vs 计划任务）且映射非确定（步骤名常为「Wave 2 执行」而不含 task id），合并需名称/时间近似匹配 → 明确不做，转而在行内标来源（步骤/事件）并以独立「任务进度」清单承载任务面。
故障面：步骤行与任务行并存时，用户可能仍觉得「task-06 完成」与清单里的「task-06」重复——以两者形态明显区分（时间轴 vs 勾选清单、清单带进度比与提交锚）缓解；若实测仍觉重复，复潮路径见复潮条件。
退役判据：若后端在 steps 与 tasks 之间建立显式外键（步骤记录引用 task id），跨源合并可由数据保证而重启。

## D-frontend-015@v1 tab 集只由「归档与否」两态决定；thin 不特判（修正展示轮表述）
状态：implemented
变更：2026-10-15-change-detail-redesign
原编号：D-015@v1
锚点：未记录
最近确认：fe8a71ed4
理由：我的判断——thin 不特判，在途态一律四 tab（概览/产出/过程/文件与对账），仅归档态收窄为三 tab（见 D-007）。依据：后端合成时间线文档明示 thin 的 steps 恒空、**主线叙事由观测事件流承担**（backend/app/modules/change/timeline.py:1-5 文档原文），若按展示轮所说把「过程」tab 从 thin 收窄掉，等于把 thin 唯一的叙事面藏起来；而 tab 级若再按「有无数据」动态收窄，会造成导航漂移（tab 随数据到达出现/消失）。
故障面：thin 在途的「产出」tab 可能近乎空（无 FR/决策，仅知识触达）——由组级空态承载，不出现整 tab 白屏（设计已要求面板内空态文案）。
退役判据：若 thin 的 steps 不再恒空（CLI 为轻量变更落 progress steps），thin 与完整流程的展示差异自然消失，本决策退化为无特殊处理。

## D-frontend-016@v1 Design Grill 首轮修订的契约补录（移动端页模块导出 / 合并边界输入类 / 错误分支与深链钳制）
状态：implemented
变更：2026-10-15-change-detail-redesign
原编号：D-016@v1
锚点：未记录
最近确认：fe8a71ed4
理由：我的判断——逐条补录为可测契约（修订明细见 design.md「审查修订记录」表）：①**B-1（阻断，修正 D-011 枚举不全）**：移动端 `frontend/src/components/mobile/mobile-change-detail.tsx:66-67` 还从本变更要重写的 `[cid]/page.tsx:64` 导出里 import `isTerminalChange`（移动端注释自称「从桌面详情页 import 复用」），原兼容清单只列 7 个组件符号（`:71-77`）漏了页模块导出——补「逐符号 import 面表 + 页模块导出契约」，并在页面级测试加导出在场断言；②**B-2（细化 D-014 口径）**：三个未闭合输入类的显式取舍——非 ISO `completed_at` 残留原串（schema.py:58）排序前先做可解析判定、不可解析与无时间戳同置末尾；事件键同键碰撞保留去重并声明取舍（不用序号后缀）；task-done 推断断裂后任务行显示「时刻不可推断（观测断链）」而非裸 `?`；③**B-3（细化 D-001/D-003）**：资产卡主查询 `isError` 由「整卡 return null」改为分区级错误说明，归档态资产查询失败时「归档留档」MUST 保底渲染；④**B-4（D-009 承接补笔）**：`ChangeAgentRunLog` 维持桌面不挂载、仅移动端承载，并对 FR-styles-011 的该分句在承接表落笔；⑤**B-5（细化 D-013）**：`?tab=files` 不在 `visibleTabs` 时（归档态或切换变更残留）以 `router.replace` 钳回 `overview`；⑥**B-6**：原型↔design 三处双向差异一律以批准稿为准，R-02 的时间线限高折叠为唯一「实现严于原型」项。
故障面：若「保底渲染归档留档」在资产主查询失败时仍依赖同一失败查询，则保底无效——实现 MUST 让归档留档走其自身的 patch 摘要取数路径。
退役判据：无。

## D-frontend-017@v1 执行期裁决——「归档留档保底渲染」的实现口径收窄 + 资产卡新增 archived prop
状态：implemented
变更：2026-10-15-change-detail-redesign
原编号：D-017@v1
锚点：未记录
最近确认：fe8a71ed4
理由：我的判断（执行期非破坏性裁决）——原文的口径在实现层不可直接成立：归档留档的 patch 摘要与文件清单与资产主查询**同源**（同一端点 `GET /changes/{cid}/assets`），失败时无法凭空呈现数据；且首帧失败时 `query.data` 缺失，连「是否归档」都无法从响应判定。故收窄为三条可验证承诺：①资产卡新增可选 `archived` prop（页面层传 `isTerminalChange(change)`），归档判定在首帧失败时同样可用（缺省回退读响应字段，兼容既有调用点）；②失败时渲染「卡头 + 分区级错误说明（含重试）」；③归档态额外渲染「归档留档」分区壳，明示「改动面数据暂不可用（与沉淀资产同一数据源）」并指路「变更文件」。语义由「呈现可用部分」收窄为「分区在场 + 明示不可用 + 可重试 + 有替代路径」，不新增端点、不静默留白。
故障面：页面层若忘记传 `archived`，归档态在**首帧失败**时会退化为在途形态（无归档留档壳）——task-07 接线时 MUST 显式传参（已列入其实现要点）；正常路径（取数成功）不受影响。
退役判据：若后端提供独立的 patch 摘要端点（不依赖 assets 主查询），可恢复「以自身取数呈现可用部分」的原文口径。

## D-frontend-018@v1 执行期裁决——归档概览的「归档留档」渲染为统计摘要 + 指路，不重复文件清单
状态：implemented
变更：2026-10-15-change-detail-redesign
原编号：D-018@v1
锚点：未记录
最近确认：fe8a71ed4
理由：我的判断（执行期非破坏性裁决）——归档概览的「归档留档」渲染为**统计摘要**（patch 的 文件数/增删行 + delta 的 Before/Delta 行）并附一行「改动文件清单与单文件 diff 见『产出 · 归档留档』」；**文件清单与「看 diff」入口只在「产出」tab 出现一次**（MUST NOT 重复渲染同一清单）。数据取同一 queryKey（`["changeAssets", …]`），零额外请求。
故障面：若后续在概览补回完整清单，会与产出 tab 双重维护并复现「两处看同一件事」的原始问题——恢复前需先复核本裁决。
退役判据：若「产出」tab 被取消（归档态只留概览），清单可回归概览。

## D-backend-029@v1 「裁决」本轮不修，跨变更记录的裁决留 CLI 侧后续 change
状态：implemented
变更：2026-10-16-conflict-full-tree-compare
原编号：D-002@v1
锚点：未记录
最近确认：d3c425bf6
理由：用户确认本轮只修对比+文案；裁决入口行为保持现状，平台对该类行的正确引导是「重新同步」或 CLI 侧 `sillyspec platform resolve full-tree`；CLI 口径改动另开 change。

## D-backend-030@v1 新增平台侧「标记已处理」关闭入口（复用已有 resolve 接口）
状态：implemented
变更：2026-10-16-conflict-full-tree-compare
原编号：D-003@v1
锚点：未记录
最近确认：d3c425bf6
理由：用户确认加——冲突行上加「标记已处理」，调用已有 `POST /api/workspaces/{workspace_id}/spec-conflicts/{conflict_id}/resolve`，仅可操作者（canOperate）可见/可点。

## D-backend-031@v2 兜底裁剪输入面与来源提示语义修订（supersedes D-006@v1）
状态：implemented
变更：2026-10-16-conflict-full-tree-compare
原编号：D-006@v2
锚点：未记录
最近确认：d3c425bf6
理由：修订为——归属校验与裁剪一律以 **`snapshot.files[].path`** 为输入（entry 保持完整，与 `_build_spec_tree_compare` 的消费面一致）；`path_total` 语义＝**兜底快照返回的路径总数**（受 daemon 300 路径帽截断，不声称记录真实总数）；来源提示为**固定说明行、无关闭控件**（告知性质；如需关闭控件另开）。
supersedes：D-006@v1

## D-frontend-019@v2 本变更生成真码原型（supersedes D-007@v1 的「跳过」判断）
状态：implemented
变更：2026-10-16-conflict-full-tree-compare
原编号：D-007@v2
锚点：frontend/src/components/prototype/conflict-sync-states-view.tsx
最近确认：d3c425bf6
理由：我的判断：改为生成真码原型——新增 `frontend/src/components/prototype/conflict-sync-states-view.tsx`（primer/Tailwind/token 方言，fixture 覆盖三个界面态：行级关闭入口、失败卡四臂分支、full-tree 兜底来源提示），`pnpm prototype:build` 编译产物拷入变更目录 `prototype-conflict-sync-states.html`；构建脚本 VIEWS 登记一行。
故障面：新增常驻原型视图会进入每次 prototype:build 的产物集，后续改动需保持产物对账（重编译后 git diff 为空）。
退役判据：该视图长期不再被引用（连续多个变更不再涉及冲突同步界面）时可从 VIEWS 与目录中移除。

## D-backend-034@v1 首轮独立审查其余修订项（分支键/失效键/关闭范围/保真损失）
状态：implemented
变更：2026-10-16-conflict-full-tree-compare
原编号：D-012@v1
锚点：未记录
最近确认：d3c425bf6
理由：全部按审查结论修订进 design/requirements/tasks——①失败卡分支键＝`details.daemon_code`（daemon 业务失败时外层 `ApiError.code` 恒为 `HTTP_502_DAEMON_RPC_REMOTE`，不可作键；离线/超时臂按外层 `HTTP_504_DAEMON_RUNTIME_OFFLINE` / `HTTP_504_DAEMON_RPC_TIMEOUT`）；②关闭成功后 invalidate 键＝`["platform-sync-section","spec-conflicts",workspaceId]`（`QUERY_KEY_ROOT=["platform-sync-section"]` 实际值）；③「标记已处理」关闭范围＝整条注册表记录（一条记录可含多个变更名，并列展示的兄弟行会一起消失），写进确认文案并记 R-07；④兜底命中时 `ql_id` 恒 null、archive 路径排序沉底、>300 路径时属该变更的路径可能被帽截掉（表现为缺路径）——均接受为已知边界，记 R-08/R-02。

## D-frontend-020@v1 轨迹上移为第三个顶层视图，覆盖 D-035 两态约束
状态：implemented
变更：2026-10-22-session-trajectory-third-view
原编号：D-001@v1
锚点：未记录
文件：.sillyspec/docs/SillyHub/modules/daemon.changelog.md, .sillyspec/docs/SillyHub/modules/frontend_components.changelog.md, .sillyspec/docs/SillyHub/modules/frontend_lib.changelog.md, .sillyspec/docs/multi-agent-platform/modules/backend.changelog.md, .sillyspec/docs/multi-agent-platform/modules/deploy.md, .sillyspec/docs/multi-agent-platform/modules/docs.changelog.md, .sillyspec/docs/multi-agent-platform/modules/frontend.changelog.md, .sillyspec/docs/multi-agent-platform/modules/sillyhub-daemon.changelog.md, backend/app/core/config.py, backend/app/modules/translate/README.md, backend/app/modules/translate/chunking.py, backend/app/modules/translate/engine.py, backend/app/modules/translate/service.py, backend/app/modules/translate/tests/test_chunking.py, backend/app/modules/translate/tests/test_engine.py, backend/app/modules/translate/tests/test_service.py, deploy/docker-compose.yml, frontend/src/components/daemon/__tests__/session-panel-variant.test.tsx, frontend/src/components/daemon/__tests__/turn-timeline-trajectory-view.test.tsx, frontend/src/components/daemon/session-panel/__tests__/session-view-tabs.test.tsx
最近确认：28c19e2677fae0639cda0a7ba96aec3ba484749e
理由：用户裁决为第三个顶层视图：会话面板显示对话 / 进度 / 轨迹三态并列；「进度」恢复纯时间线，不再保留「时间线 / 轨迹」第二层开关。覆盖 2026-10-22-session-trajectory-view 的 D-035。
supersedes：D-035

## D-frontend-021@v1 新功能采用 IDEA 颜色语义，现有文件变更卡不动
状态：implemented
变更：2026-10-25-explorer-git-status
原编号：D-002@v1
锚点：frontend/src/components/prototype/explorer-git-status-view.tsx:24
最近确认：19783ad99
理由：用户选「只新功能用 IDEA 语义」——现有文件变更卡颜色不在本变更范围
故障面：平台内两套状态色并存，用户可能困惑——文档与图例需标明
退役判据：后续全局统一颜色语义时另立变更收敛两套映射

## D-backend-035@v1 方案 A——平行状态接口 + 前端 join（选定）
状态：implemented
变更：2026-10-25-explorer-git-status
原编号：D-007@v1
锚点：sillyhub-daemon/src/daemon.ts:7803
最近确认：19783ad99
理由：用户选定方案 A——daemon 新增「改动文件清单」（porcelain v2 文件行 + ignored --directory 聚合 + numstat）与「工作区单文件 vs HEAD diff」两个平名 RPC，backend 暴露两个只读端点；前端一次拉清单建 path→status 映射，explorer 树着色与 Git 日志页修改集合同源消费
故障面：状态清单为拉取式快照，daemon 侧文件变动后页面不自动变色——需手动刷新或重新进页
退役判据：出现「多端同改工作区需秒级感知」的真实场景时重议推送（见 D-009）

## D-frontend-022@v1 展示形态=轻量单行状态文案（接受不留痕 trade-off）
状态：implemented
变更：2026-10-26-session-stage-progress
原编号：D-001@v1
锚点：`frontend/src/components/daemon/turn-status-bar.tsx`
最近确认：cf17c6a9f
理由：状态条文案增强（轻量）——不新增独立区域，把单行「思考中/执行中」替换为当前具体阶段文案，随阶段实时切换；接受「历史轮次不留痕、阶段一闪而过无法回看」的代价。
故障面：阶段文案与右侧活动摘要并存时单行信息密度上升，窄视口下截断优先级需定义（活动摘要 truncate 既有行为保留，阶段标签 shrink-0 不截断）。
退役判据：若用户反馈需要回看历史阶段轨迹，升级为阶段轨迹时间线形态（原型 ① 档）时本决策由 v2 取代。

## D-backend-036@v1 覆盖范围=盲区补齐 + 轮内统一阶段轴
状态：implemented
变更：2026-10-26-session-stage-progress
原编号：D-002@v1
锚点：`backend/app/modules/daemon/control_commands.py`、`sillyhub-daemon/src/daemon.ts`
最近确认：cf17c6a9f
理由：盲区+统一阶段轴——静默盲区（平台转发→执行器领取→启动准备→等待首响）补齐信号，并把 AI 干活期间已有信号（执行命令/工具调用/输出间隙）统一映射到同一阶段文案体系。
故障面：统一阶段轴依赖三端词表同步——任一端词表漂移（新增 phase 未同步前端映射）会显示原始英文 phase 值；已由兼容策略「未知 phase 显示原始字符串兜底」覆盖。
退役判据：若阶段体系演进为服务端驱动的通用任务阶段模型（跨会话/任务类型复用），本词表并入更大模型后本决策由 v2 收编。

## D-frontend-023@v1 异常处理=阶段超时变色提示（不弹窗）
状态：implemented
变更：2026-10-26-session-stage-progress
原编号：D-003@v1
锚点：`frontend/src/components/daemon/turn-status-bar.tsx`
最近确认：cf17c6a9f
理由：阶段超时提示——单阶段停留超过阈值（默认 30s，实现期可调）时该行变色并显示「已等待 X 秒」，区分「正常慢」和「卡死了」；不弹窗、不做独立告警系统。
故障面：前端本地计时与事件到达延迟叠加可能瞬时误报（如浏览器标签页休眠后恢复、计时跨度被拉长）——标签页不可见时 rAF/interval 节流属已知浏览器行为，恢复后按真实墙钟差显示，短暂「跳秒」可接受。
退役判据：若引入服务端心跳阶段快照（D-006 复潮路径），超时判定可迁移服务端权威时钟，本地计时降级为兜底。

## D-backend-037@v1 实现方案=方案 A 阶段事件推送（新增 turn_phase 事件 kind）
状态：implemented
变更：2026-10-26-session-stage-progress
原编号：D-004@v1
锚点：`backend/app/modules/daemon/router/notify.py`、`sillyhub-daemon/src/daemon.ts`、`frontend/src/lib/daemon/session-sse.ts`
最近确认：cf17c6a9f
理由：方案 A——新增会话 SSE 事件 kind `turn_phase`。启动准备各步骤边界由 daemon 经既有 endStep 钩子新增 HTTP 上报端点发出（照抄 notify_bash_status 已验证模式）；平台转发段由 backend 在控制指令状态机翻转点（delivered/acked）直接发布（零 daemon 改动）；轮内阶段由已有事件映射。前端 SessionEventKind 加 kind、分发器加 case、状态条消费。
故障面：SSE 无历史（Redis pub/sub 无持久化），断线/刷新期间错过的阶段事件不可回放，重连后只能显示最新已知阶段或回退兜底文案——属轻量形态（D-001）可接受范围。
退役判据：若后续引入会话事件持久化回放（可查询历史阶段轨迹），单行实时文案可升级为轨迹回看而不废弃事件本身。

## D-backend-039@v1 SSE 键名三端逐字对齐（phase/detail/timestamp）
状态：implemented
变更：2026-10-26-session-stage-progress
原编号：D-012@v1
锚点：backend/app/modules/daemon/run_sync/service/publish.py、frontend/src/lib/daemon/session-sse.ts:160
最近确认：cf17c6a9f
理由：我的判断：以发布侧组装为单一事实源，三端逐字对齐为 `phase` / `detail` / `timestamp`（timestamp 复用前端信封既有字段名）——SSE 透传层原样转发不改名（agent/service.py transparent passthrough 实证），键名不一致字段必丢且无映射层。
故障面：后续新增 phase 事件字段时同样必须三端同提交（与 WS 消息类型双侧契约同性质）。
退役判据：无——键名契约长期有效。

## D-backend-040@v1 阶段展示精度包——at 时钟源/run_id 必填/轮终态清理/防重键/并行边界
状态：implemented
变更：2026-10-26-session-stage-progress
原编号：D-013@v1
锚点：frontend/src/components/daemon/session-panel/turn-state.ts、sillyhub-daemon/src/interactive/session-manager/events.ts
最近确认：cf17c6a9f
理由：我的判断：① at=客户端本地 Date.now()（事件到达时刻，规避时钟偏移）；② run_id 必填（daemon 恒带 firstRunId，daemon.ts:9522 守卫后必非空——「create 前 run 未定」原假设与代码不符），前端对缺失 run_id 的 phase 事件防御丢弃；③ turn_completed/failed/killed 终态分支清空 currentPhase（兑现 R-01「不显示陈旧值」，防断线场景假超时警示）；④ first_event 防重键=(session_id, run_id)（run 级标志，新 AgentRun 自然重置）；⑤ 冷启动三步 Promise.all 并行保持独立上报+覆盖式刷新（跳动亚秒级真实，聚合文案违背轻量）；SWR 跳过步不发事件。
故障面：终态清理若漏接（如新增终态类型未清 phase）会复现假警示——测试断言面需覆盖全部终态枚举。
退役判据：无——精度规则跟随轮生命周期语义。

## D-frontend-024@v1 长操作实时感知走独立 turn_heartbeat 事件通道
状态：implemented
变更：2026-10-29-engine-live-perception
原编号：D-001@v1
锚点：sillyhub-daemon/src/types.ts:AgentEvent
最近确认：de68b356befe540e0c77695de92216fb36c1a5e9
理由：用户选定方案二（新增独立心跳事件），事件名细化为 turn_heartbeat（防与 hub-client 机器级 heartbeat 同名混淆，命名细化不改变决策语义）。载荷：kind（awaiting_first_token/generating_tool_args/generating_text）+ est_chars/est_tokens + precision（authoritative/estimated）+ source + parent_tool_use_id；不落库只透传、节流 1s、估算系数 3.5 字符/token（三项 agent 代定，用户核阅无异议）。估算值与权威 usage 彻底分道：预算软切断、计费聚合、ctx 环零污染（对齐 2026-08-27「实时/终态口径必须同类」）；前端专道消费，估算补显标「约」+弱化灰、权威值落定即隐。
故障面：心跳节流器/计数器轮结束未清理导致跨轮残留（R-02）；估算值误入聚合（R-03，类型级排除防护）
退役判据：引擎侧（Claude SDK/智谱/codex）原生提供流式 usage 增量且覆盖工具参数期时，本心跳桥接层可简化退役

## D-unmapped-118@v1 参考粒度＝交互模型与数据口径，不移植 DSH 插件化客户端架构
状态：implemented
变更：2026-10-20-session-page-dsh-alignment
原编号：D-001@v1
锚点：未记录
最近确认：328788cbe
理由：沿用既有裁决，不重新论证（我的判断：继承）。2026-08-19-session-stream-ux 在 A 渐进增强 / B 全量移植 deepseek-harness 架构 / C 共享装配器 三条路线中选定 C——「参考 deepseek-harness 设计思想但不移植其插件化架构」。本仓客户端是 Next.js 14 + React 18 + TanStack Query + antd 的单一应用；DSH 客户端是 Cordis 插件图 + 58 个 `packages/client/*` 包 + slot 注册表。移植成本与回归面远超收益，且本仓已用「单一装配器 + 段模型」达到同一目标（事件 → 结构化轮次模型 → 对话/进度多视图消费）。
故障面：若后续出现「按工具/按视图独立演化」的强需求，集中式渲染（frontend/src/components/agent-log/tool-renderers.tsx，731 行 switch）会先成为瓶颈——届时按需抽轻量注册表，而不是回退到插件化架构。
退役判据：出现 ≥3 个需要独立加载、独立版本的客户端扩展方（第三方插件生态）时重议本边界。

## D-unmapped-119@v1 动机＝日常主力工作台 + 对外演示可用 + 与 DSH 直接对标（非「会话规模爆炸」驱动）
状态：implemented
变更：2026-10-20-session-page-dsh-alignment
原编号：D-003@v1
锚点：未记录
最近确认：328788cbe
理由：用户多选三项动机：①与手边在用的 DSH 直接对比，差距刺眼；②想把它当主力工作台，日常别扭感累积到临界；③要给别人用/演示，观感与可读性要能打。**未选**「会话规模变了（几十轮 + 子代理/团队会话撑不住）」——即本次不是为极端长会话/多并发现场做容量设计。
故障面：「主力工作台」与「演示可用」对同一处有相反要求——前者要高密度、后者要留白与呼吸感；若不分场景一刀切排版，会牺牲其中一侧。
退役判据：若后续出现真实的规模压力证据（单会话轮次/日志量级或并发会话数成为瓶颈实测），重新评估容量线是否入范围。

## D-unmapped-120@v1 视图模型不在对话里拍板——先出 HTML 原型看效果再定（用户选 C）
状态：implemented
变更：2026-10-20-session-page-dsh-alignment
原编号：D-004@v1
锚点：未记录
最近确认：328788cbe
理由：用户选 C——先出 HTML 原型看效果再定视图模型；本轮**不**承诺 A（允许重构）也不承诺 B（保守增强）。
故障面：原型先行把"设计定稿"推迟到原型确认之后；若原型用理想化假数据（无超长轮/大 diff/失败轮），确认结论会落空——原型语料必须覆盖真实形态。
退役判据：用户看过原型并明确选定形态后，本条目由对应的视图模型决策条目取代。

## D-unmapped-121@v1 原型出「A/B 双形态对比」单页（我的判断）
状态：implemented
变更：2026-10-20-session-page-dsh-alignment
原编号：D-005@v1
锚点：未记录
最近确认：328788cbe
理由：我的判断：一份单文件 HTML，可切换地并排呈现 A（单视图可伸缩：整轮折叠 → 过程分组 → 单条 disclosure）与 B（两视图保留 + 细节档位），共用同一份真实形态语料（超长轮、连续工具调用、失败轮、子代理轮），并把 D-003 登记的「高密度 vs 呼吸感」张力做成两套排版参数同页对比。依据：仓内既有 AI-Native 视觉方向与既有原型留档形态。
故障面：两形态同页使状态维度上升（形态 × 展开层 × 档位），需以静态语料 + 少量本地交互实现，避免体积与状态管理失控。
退役判据：用户选定形态后原型仅作留档，不再迭代。

## D-unmapped-122@v1 成功标准延后到原型确认后定稿（草案 SC-01..SC-05 随原型呈现）
状态：implemented
变更：2026-10-20-session-page-dsh-alignment
原编号：D-008@v1
锚点：未记录
最近确认：328788cbe
理由：用户选「先看原型再定」——成功标准（尤其 SC-01/SC-02/SC-04 的尺度）在看过原型后一并定稿。
故障面：若原型轮只确认形态而漏确认 SC，后续 tasks 与 verify 探针会缺少判据锚点。
退役判据：SC 定稿写入 requirements.md 后本条目仅作过程留档。

## D-unmapped-123@v1 方案定稿推迟到原型确认轮；原型出 A/C 双形态（修订 D-005 的 A/B 组合）
状态：implemented
变更：2026-10-20-session-page-dsh-alignment
原编号：D-009@v1
锚点：未记录
最近确认：328788cbe
理由：用户选「先出双形态原型，看完再定」——本轮不承诺 A 或 C；原型按 **A/C 双形态**出（C ＝ A 的全部呈现 + 旧「进度」视图保留为可切回的入口），看完效果再定稿。Step 4 的三方案对比表与推荐（推荐 A）已被接受为讨论基础，但不构成选择。
故障面：若把 A/C 做成两页独立实现，对比成本上升且会掩盖真实差异（C 多出的只有回退入口）；须同页可切换、共用同一份语料与同一套排版参数。
退役判据：方案定稿后本条目由对应的视图模型决策条目取代。

## D-unmapped-124@v1 原型形态升级为 dev 预览路由（直接渲染真实会话组件）
状态：implemented
变更：2026-10-20-session-page-dsh-alignment
原编号：D-010@v1
锚点：frontend/src/app/proto/session-fold/page.tsx
最近确认：328788cbe
理由：用户选 ①「dev 预览路由」+ 改动边界「允许改生产链路」。已落地：新增 dev-only 路由 `frontend/src/app/proto/session-fold/page.tsx`，直接 `import` 真实 `TurnTimeline`，喂 fixture 轮次（`segments` 含 thinking / Grep / Read / Edit(structuredPatch) / Bash）。验证：`tsc --noEmit` 0 错；`next dev` 实测 `GET /proto/session-fold 200`，HTML 98KB 内命中真实组件标记（「思考过程」×2、`Grep` ×2、`turn-timeline.tsx` ×10）——即为真实组件树渲染，非复刻。
故障面：dev 路由需起 `next dev`（本机 spawn 受限，需完整权限跑），且因不受 middleware 守卫而存在未授权访问面——必须保持 dev-only 且不进导航，否则等于新开一个匿名入口。
退役判据：折叠模型正式落到生产组件后，本路由降级为回归对照页或删除。

## D-unmapped-125@v1 「继续用静态 prototype:build 复刻会话页」被否决
状态：rejected
变更：2026-10-20-session-page-dsh-alignment
原编号：D-011@v1
锚点：未记录
最近确认：328788cbe
理由：否决（用户选择 dev 预览路由）。静态管线是 `tsc + react-dom/server`，无浏览器运行时，无法承载 `turn-timeline` 的 antd / zustand `useSession` / `thinking-translate` 依赖；复刻只能逼近观感，功能面永远补不完（用户实测判断「缺很多功能」）。
否决理由：静态产物只能「像」，无法证明真实组件在折叠模型下的行为，且复刻成本无上限。
复潮条件：需要完全无运行时的离线观感稿（对外文档配图）时可临时用静态管线生成素材，但不得作为定稿原型。

## D-unmapped-126@v1 静态交付形态＝真实组件树的 SSR 快照 + 内联 CSS（交互仍走 dev 路由）
状态：implemented
变更：2026-10-20-session-page-dsh-alignment
原编号：D-014@v1
锚点：未记录
最近确认：328788cbe
理由：采用「dev server 的 SSR 输出 → 内联 CSS → 剥 &lt;script&gt;」导出：`export-proto.ps1` 抓 `/proto/session-redesign`（v2）与 `/proto/session-current`（现状）两份快照，产出 `prototype-session-v2.html` / `prototype-session-current.html`（各 ~295KB，零依赖双击可看）。它是**真实组件树的静态投影**，不是手绘复刻。
故障面：快照剥掉了 `<script>`（无 hydrate），任何依赖 JS 的交互或懒渲染内容不会出现——拿静态稿当"功能完整性"证据会误判；CSS 已内联但字体等 url() 资源离线可能缺失（回落系统字体）。
退役判据：若 Next 侧启用 `output: 'export'` 能直接产出静态站，本脚本由官方导出替代。

## D-unmapped-127@v2 视觉基线＝真实页面的**结构**（三主题并存，不把深色当基线）〔取代 D-015@v1〕
状态：implemented
变更：2026-10-20-session-page-dsh-alignment
原编号：D-015@v2
锚点：未记录
最近确认：328788cbe
理由：用户更正（原话）：「不是颜色问题 平台就是有三套主题，我给你de截图是深色而已」。故 @v1 的「浅色稿作废、以深色为基线」判断错误，本版取代：**基线是真实页面的结构与信息组织**（布局、信息项、行式、chip、轮头/轮尾、工具卡形态）；**主题是三个并存维度**（ai-native / blue / dark），三套都必须成立。
故障面：三主题共用一套语义 token 时，某些混色（如 brand 边框 + card 底）在浅色主题下对比度不足——每套主题需各自校验对比度（正文与 muted 至少 4.5:1 / 3:1）。
退役判据：平台若收敛到单主题，则本条的"三主题"要求降为单主题规范。

## D-unmapped-128@v1 视觉稿必须由真实组件产出（手绘 HTML 只作参考，不作定稿）
状态：implemented
变更：2026-10-20-session-page-dsh-alignment
原编号：D-017@v1
锚点：未记录
最近确认：328788cbe
理由：不可以。用户指出（原话）：「这个是不是 直接改的 html 而不是 转换的？ 你这样直接改 html 后面代码实现会有偏差的呀」。该判断与仓规一致——`PROTOTYPE.md` 铁律：手绘定稿后每条意见都要反向翻译回真实代码。故 `prototype-session-v3.html` 降级为**视觉参考稿**，不定稿；定稿原型必须是对真实组件（Tailwind + token + 现有 `.sh-*` 类）改造后、由 dev 路由渲染、再由导出脚本固化的 HTML。
故障面：真实组件改动面大（`turn-timeline` / `turn-segment-views` / `globals.css` / `session-list-panel`），且会话页无 E2E——落地时须逐条配单测断言用户可见行为，否则"稿=实现"只能靠肉眼保证。

## D-unmapped-129@v1 静态原型导出必须「浏览器水合后序列化 DOM」，禁止抓 SSR HTML
状态：implemented
变更：2026-10-20-session-page-dsh-alignment
原编号：D-018@v1
锚点：frontend/scripts/export-hydrated.mjs
最近确认：328788cbe
理由：实测证明 SSR HTML 不可用：`prototype-session-fullpage.html` 含 **138 处 CSR bailout `<template>` 占位、0 个 `.wmde-markdown`**（助手答复正文全缺）。改为 `frontend/scripts/export-hydrated.mjs`：playwright 打开路由 → `networkidle` → `waitForFunction(.wmde-markdown ≥ 50, 120s)` → 逐片收集 `cssRules` → `outerHTML` → 剥 `<script>/<link>/原 style` → 合并单 `<style>` → 落盘，并机械校验各闭合标签恰好一次。
故障面：导出耗时上升（需起浏览器 + 等水合），且依赖 dev server 在跑。
退役判据：Next 启用 `output:'export'` 且能正确产出 CSR 子树时，可改用官方导出。

## D-unmapped-130@v1 此前三次「效果不咋地 / 看不出区别」的判定，基于缺正文的残缺稿，需在修复稿上重判
状态：implemented
变更：2026-10-20-session-page-dsh-alignment
原编号：D-019@v1
锚点：未记录
最近确认：328788cbe
理由：部分不成立。三次判定所看的静态稿缺全部答复正文（见 D-018），等于在"没有回答文字的页面"上评判。修复稿（`prototype-session-final.html`）已含 138 个正文块，需在该稿上重判。
故障面：若重判仍不满意，说明问题不在正文缺失，须回到 D-016 的层次问题继续定位。

## D-unmapped-131@v1 删除轮间 1px hairline，仅以留白分隔轮次（用户方向）
状态：implemented
变更：2026-10-20-session-page-dsh-alignment
原编号：D-020@v1
锚点：未记录
最近确认：328788cbe
理由：用户原话「轮间 1px hairline 多余」→ 删除。`turn-block` 容器 `border-b border-border pb-7 last:border-b-0` → 仅 `pb-7`（28px 留白保留）；`globals.css` 全文核对无其它轮间画线规则（已用测试锁死）。
故障面：长会话滚动时"分轮感"完全依赖留白，若留白被压缩会失去分段感。

## D-unmapped-132@v1 对比加强（答案压过过程）——四组参数定稿
状态：implemented
变更：2026-10-20-session-page-dsh-alignment
原编号：D-021@v1
锚点：未记录
最近确认：328788cbe
理由：用户原话「对比加强」→ 落地为四组：①正文 14.5px/1.78/段距 0.6em → **15px/1.8/0.65em**（标题 16.5/15.5、行内 code 13）②过程行（思考+工具）12px → **11.5px + `text-muted-foreground/80`**，并去掉思考摘要额外 `opacity-75`（叠乘后浅色主题 <3:1 不可读）③工具行左规线静息 `border-border` → **`border-border/60`**（hover 仍 brand）④过程块与答复块间距 6px → **14px**（列 gap 7px + 答复块 mt-7px，过程行彼此仍 7px）。
故障面：11.5px + 80% 墨色在部分浅色主题下接近可读下限，再降即失效。

## D-unmapped-133@v1 轨迹视图形态＝泳道时间轴（共享绝对时间轴 × 输入/模型/工具），账本降为「调用」档
状态：implemented
变更：2026-10-20-session-page-dsh-alignment
原编号：D-024@v1
锚点：未记录
最近确认：328788cbe
理由：用户提供 DSH 轨迹截图作为目标：**三条泳道（输入/模型/工具）+ 一条共享绝对时间轴 + 顶部三档视图（时长/轮次/调用）+ 搜索 + 选中区间高亮**，主视图不是表格。此前实现的「每轮一行小刻度 + 856 行账本」判定为形态错误。
故障面：共享绝对时间轴在 577 分钟窗口下短轮会挤成一小撮，必须有缩放/窗口，否则退化回"看不出哪步慢"。

## D-unmapped-134@v1 过程行采用 DSH 式语义标签（思考 / 运行命令 / 收到任务消息…），daemon 采集缓发
状态：implemented
变更：2026-10-20-session-page-dsh-alignment
原编号：D-025@v1
锚点：未记录
最近确认：328788cbe
理由：用户提供 DSH 截图：每一步是**紧凑单行**——图标 + 语义标签 + 「 · 」+ 一行摘要（如「思考 · The backend model-usage agent finished…」「运行命令 · Regenerate OpenAPI and generated types」），并有独立的 **「收到任务消息」卡片**（带时间、可展开）。**更正**：截图中那张「收到任务消息」实际是变更 `2026-10-21-task-wakeup-restore` 的任务消息**误投到本会话**；用户从未说「daemon 采集缓发」，D-023 的 TTFT/attempt 采集**仍在范围内、不缓**。
故障面：标签是**展示层映射**，不得改写日志原文；未知 event_type 必须回退「其它」而不是丢弃（否则新工具上线即隐身）。

## D-unmapped-135@v1 1b 快照落库点修正——interactive 轮走 `close_run_steps`，不走 `lease/service.complete_lease`〔2026-10-21 execute 期实证〕
状态：implemented
变更：2026-10-20-session-page-dsh-alignment
原编号：D-027@v1
锚点：未记录
最近确认：328788cbe
理由：不成立。实证：`_upsert_batch_model_usage` 唯一调用点是 `lease/service.py:457`（batch `complete_lease` 路径）；interactive 轮的终态是 `daemon/hub-client.notifyRunResult` → `POST /leases/{id}/runs/{run_id}/result` → `router/lease.py:233 close_interactive_run` → `run_sync/service/__init__.py:386-449` → `run_sync/service/close_run_steps.py:_close_apply_terminal`，`agent_run_model_usage` 的 upsert 在 `close_run_steps.py:379-417`。若按原写作落点实现，1b 快照对真实产品路径**永不落库**。
故障面：若未来新增第三条 run 终态写入路径（如离线补报），同样必须在 `_close_apply_terminal` 或新增的共用 helper 处调用，否则快照再次断链；design 的「落库点」表述应改为「`close_run_steps._close_apply_terminal`（interactive）/ `complete_lease`（batch）」两条。

## D-unmapped-136@v1 1b 读模型落点＝`GET /sessions/{id}/runs`（SessionRunRead），`TurnOutlineItemRead` 不加字段〔2026-10-21 execute 期裁决〕
状态：implemented
变更：2026-10-20-session-page-dsh-alignment
原编号：D-029@v1
锚点：未记录
最近确认：328788cbe
理由：放 `SessionRunRead`（`GET /sessions/{id}/runs`）——前端 `runsMeta`（`session-panel-page.tsx:805` 的 `Map<string, SessionRunRead>`）就是消费面，task-11 的轮级卡片与 task-12 的模型泳道都从它取；`TurnOutlineItemRead` 走进程内 LRU 指纹，指纹不含 `daemon_run_snapshots`，快照晚到时会产生**陈旧读**（读到旧快照却不自知），且当前无消费方。
故障面：前端若直接吃 turn-outline 缓存而非 `/runs`，会拿不到快照；task-11 必须以 `runsMeta` 为准（设计已如此要求）。

## D-unmapped-137@v1 后到快照必须在「run 已终态」的二次上报里补写侧表（否则 1b 对 interactive 全废）〔2026-10-21 execute 期实证〕
状态：implemented
变更：2026-10-20-session-page-dsh-alignment
原编号：D-030@v1
锚点：未记录
最近确认：328788cbe
理由：会丢。实测：`close_run_steps.close_interactive_run` 的 terminal 分支（`agent_run.status in TERMINAL_TURN_STATUSES`）先 `rollback()` 再 `return`，**整条不写侧表**；而 daemon 侧 `_onResult` 是「`await onResult(...)`（含首报 close）→ 之后才 fire-and-forget 采集 → 二次上报 file_changes/timing」，因此带快照的那次上报**永远命中 no-op 分支**。若不修，interactive 会话的轮级卡一律退 `tool_only`，1b 数据链路等于没通（只有 batch 路径能出卡）。
故障面：后到快照是一次**额外**的 result 上报（携带首报终态三字段复述）；若未来把 `notifyRunResult` 的幂等改成 409/抛错，这条补写路径会静默失效。批量补发（outbox）同理需保证只写侧表。

## D-unmapped-138@v1 前端降级判据以 capability 为准；`snapshot=null` 且 `capability` 也缺＝「未接线」，不出卡〔2026-10-21 execute 期裁决〕
状态：implemented
变更：2026-10-20-session-page-dsh-alignment
原编号：D-031@v1
锚点：未记录
最近确认：328788cbe
理由：三分法（对齐 design E6/E8）：①`capability="tool_only"`（含 snapshot=null）→ 出「仅工具编辑」降级卡 + 说明行；②`status="failed"|"unavailable"` → 同样降级卡（快照不可信）；③`snapshot=null` **且** `capability` 为 `null/undefined` → **不出卡、不出占位**——这是「挂载方没接线」（dialog / 旧消费方），把它显示成「daemon 老版本」是另一种误导；④`status="ok"` 且 `files=[]` → 不出卡（快照确认零改动，且全树禁止出现「本轮无改动」字样）。
故障面：老 daemon 会话里「每轮一张仅工具编辑卡」会显得吵（20 轮 → 20 张）；这是 E8「显式提示不静默」的代价，收窄需另立设计条目（建议后续：仅末轮/首轮出卡 + 汇总卡统一提示）。

## D-unmapped-139@v1 TTFT/attempt 实际只能 `basis="approx"`（三引擎均无「模型请求起点」事件）；attempt 沿用近似起点而非只记终点〔2026-10-21 execute 期实证〕
状态：implemented
变更：2026-10-20-session-page-dsh-alignment
原编号：D-032@v1
锚点：未记录
最近确认：328788cbe
理由：**不能**，三引擎在 daemon 事件边界都没有稳定的请求起点：①claude 的 SDK `message_start` 被归一化器吃掉（只用于算 `api_duration_ms`，不产 AgentEvent，`:973-1031`）；②codex 的 `turn/started` 只是**轮**起点，工具结果后无通知；③pi 的 `message_start` 当纯生命周期丢弃（`pi-events.ts:36`），`turn_start` 只产 status。故按 plan 降级口径：attempt 起点＝轮首（首段）/「本批工具全部 result 返回」之后；首 token＝首个 text/thinking delta；终点＝下一个 `tool_use` 或轮终态；`basis` 恒 `"approx"`。
故障面：前端会**长期**显示「近似（无 TTFT 采样）」而非「真实占用」——UI 的 observed 分支目前只有单测覆盖、生产不可达；若产品要求「真实占用」必须先在 driver 层补 `request_start` 事件（跨 daemon 驱动改造，不在本变更）。

## D-unmapped-140@v1 迁移链尾锚测试随新迁移一并前移（提交 hook 强制连带）〔2026-10-21 execute 期登记〕
状态：implemented
变更：2026-10-20-session-page-dsh-alignment
原编号：D-033@v1
锚点：backend/tests/test_align_platform_change_events_migration.py
最近确认：328788cbe
理由：仓内 pre-commit hook 的「迁移」钉子会校验迁移链尾锚测试——新增迁移后 `heads[0]` 不再是旧 head，hook **直接拒签**（实测：首次提交被拦，提示「迁移链尾锚测试 heads[0] 前移到新 head（注释链续写）」）。故把 `heads[0]` 由 `c3f8a1d6e2b4` 前移为 `20261021120000` 并在注释链续写一行是本变更的强制连带改动，不是新交付面。
故障面：该锚点测试是「迁移双头」的守护，若把它改成不校验（例如 `assert len(heads) == 1` 以外全放行），未来并行迁移再出双头就无人拦。

## D-unmapped-141@v1 `partial` 且无文件清单时出「一行提示卡」——不得静默成「本轮无改动」〔2026-10-21 execute 期独立审查阻断项修复〕
状态：implemented
变更：2026-10-20-session-page-dsh-alignment
原编号：D-034@v1
锚点：未记录
最近确认：328788cbe
理由：**该出**。独立审查（execute stage review）实测：daemon 超时与队列溢出都返回 `files: []`（`turn-file-changes.ts:813-824`、`tests/interactive/turn-file-changes.test.ts:433-435`），而前端 `toFileChangesCardProps` 先把 partial→`truncated`，随后 `if (files.length === 0) return null` 整卡不渲染 → 用户看到「没有卡」，无法区分「采集没完成」与「本轮真的没改文件」，与 design「partial 卡片照出」相悖（E6/E8 立意）。修法取 A（实现意图，而非改口径）：partial 且无文件清单 → 渲染 28px 单行提示卡（`data-testid="file-changes-notice"`），文案「工作区快照未完成（超时或队列溢出），本轮改动未知」。
故障面：提示卡与「仅工具编辑」降级卡是**两种**话术（前者「没拿到清单」、后者「没有这项能力」），未来若合并会再次丢语义；`reason` 细分（timeout vs queue_overflow）在快照里保留，但 UI 合并表述——若要区分需在 `notice` 上带 reason。

## D-unmapped-151@v1 轨迹面板以 dsh（deepseek-harness）ui-trajectory 为视觉与交互基准
状态：implemented
变更：2026-10-22-trajectory-view-redesign
原编号：D-001@v1
锚点：未记录
最近确认：49fb620463233b8293784c64a08693bbabdfc6a4
理由：用户提供的截图来自 dsh 的轨迹视图，并明确要求「看 dsh 源码」；参考实现为 deepseek-harness/packages/client/ui-trajectory（CSS Modules + DSH token），本项目需用 Tailwind + themes.ts token 等价实现。
故障面：直接照搬 CSS Modules 类名/API 会引错依赖；必须翻译为 Tailwind + 本地数据模型。
退役判据：本项目轨迹视图形成独立设计体系且不再需要对标 dsh 时。

## D-unmapped-152@v1 顶部固定布局——工具栏与时间线不随账本滚动
状态：implemented
变更：2026-10-22-trajectory-view-redesign
原编号：D-002@v1
锚点：未记录
最近确认：49fb620463233b8293784c64a08693bbabdfc6a4
理由：用户明确「顶部是固定位置的」。dsh 根容器为纵向 flex + overflow:hidden，工具栏 sticky 32px、时间线固定 50px，唯一滚动容器是账本 pane。
故障面：若仍挂在 turn-timeline-scroll 内，整页滚动会把顶部带走（当前缺陷根因）。

## D-unmapped-153@v1 工具栏四项语义与行为
状态：implemented
变更：2026-10-22-trajectory-view-redesign
原编号：D-003@v1
锚点：未记录
最近确认：49fb620463233b8293784c64a08693bbabdfc6a4
理由：时长＝时间线比例开关（实际时长 vs 等宽操作，偏好持久化）；轮次＝展开/收起所有轮次（折叠为“… + 摘要”行）；调用＝展开/收起所有工具调用（合并为“N 个工具调用”摘要行）；搜索＝按文本 AND 过滤账本行并绕过折叠，时间线非命中条降透明。

## D-unmapped-154@v1 账本形态——无表头两列紧凑表格
状态：implemented
变更：2026-10-22-trajectory-view-redesign
原编号：D-004@v1
锚点：未记录
最近确认：49fb620463233b8293784c64a08693bbabdfc6a4
理由：dsh 为无表头两列（事件列 122px + 内容列自适应），行高 30px、下边框；内容列＝类型标签（19px，图标+文字）+ 摘要，有结果时右侧“→ 结果摘要”；耗时/token/状态文字不进行内而进详情；按 turn 分组用竖线与 Turn 标签表达，子工具通过缩进 +26px，无嵌套 DOM。
退役判据：账本信息密度与可读性在其他形态下经实测更优时。

## D-unmapped-155@v1 详情面板——多标签 + 可调宽
状态：implemented
变更：2026-10-22-trajectory-view-redesign
原编号：D-005@v1
锚点：未记录
最近确认：49fb620463233b8293784c64a08693bbabdfc6a4
理由：工具行五标签（概述/参数/结果/Schema/计时），消息类/系统类各有自己的标签集；面板宽默认 clamp(320px,38%,440px)、可拖拽 320–720、双击复位；≤760px 改为抽屉；无选中时不渲染。

## D-unmapped-156@v1 采用组件族拆分方案（B）
状态：implemented
变更：2026-10-22-trajectory-view-redesign
原编号：D-009@v1
锚点：未记录
最近确认：49fb620463233b8293784c64a08693bbabdfc6a4
理由：用户选择方案 B——TrajectoryView 只做装配，新增 trajectory-toolbar / trajectory-ledger / trajectory-detail-panel 三个组件，复用现有 trajectory-timeline 与数据层；数据层（build-trajectory / from-turn-views）不动。

## D-unmapped-157@v1 否决「原地重构 trajectory-view.tsx」（方案 A）
状态：rejected
变更：2026-10-22-trajectory-view-redesign
原编号：D-010@v1
锚点：未记录
最近确认：49fb620463233b8293784c64a08693bbabdfc6a4
理由：用户未选方案 A。
否决理由：单文件将膨胀到 1000+ 行，职责混杂、测试耦合，与项目大文件拆分既有方向相反。
复潮条件：若组件族拆分导致回归面显著超出预期（改动文件数或测试返工翻倍），可退回局部原地重构。

## D-unmapped-158@v1 否决「直接移植 dsh 组件」（方案 C）
状态：rejected
变更：2026-10-22-trajectory-view-redesign
原编号：D-011@v1
锚点：未记录
最近确认：49fb620463233b8293784c64a08693bbabdfc6a4
理由：不可行——dsh 使用 CSS Modules + 自有设计 token 与数据模型，本项目为 Tailwind + themes.ts + SessionTurnView，无法直接复制。
否决理由：依赖与数据模型不兼容，移植成本高于重写且会把两套 token 体系混在一起。
复潮条件：仅在 dsh 改为输出可复用、无框架绑定组件库时重新评估。

## D-unmapped-159@v1 总览缩略条随 D-017 一并裁剪，实际时长保留缩放/平移/双击重置
状态：implemented
变更：2026-10-22-trajectory-view-redesign
原编号：D-021@v1
锚点：未记录
最近确认：49fb620463233b8293784c64a08693bbabdfc6a4
理由：50px 高度预算下无法容纳总览条（原 14px）与三泳道+轴；裁决随说明区一并视觉裁剪。实际时长模式仍保留滚轮缩放、拖拽平移、双击重置；等宽模式保持 D-016 的只读概览。D-016 尾句「保持现有全部交互」中的总览刷子部分由本条修订。

## D-unmapped-160@v1 设计方案与真码原型定稿
状态：implemented
变更：2026-10-22-trajectory-view-redesign
原编号：D-012@v1
锚点：未记录
最近确认：49fb620463233b8293784c64a08693bbabdfc6a4
理由：用户确认按该设计实施；原型经 prototype-as-code 管线编译并登记为变更目录 prototype-trajectory-redesign.html。

## D-unmapped-161@v1 搜索时折叠整体失效，时间线不做降透明
状态：implemented
变更：2026-10-22-trajectory-view-redesign
原编号：D-013@v1
锚点：未记录
最近确认：49fb620463233b8293784c64a08693bbabdfc6a4
理由：有搜索词时所有折叠失效、直接显示全部命中行（含其父轮次与调用组）；零命中显示「没有匹配的记录」空态；时间线条块不随搜索变化（不实现 dsh 的非命中降透明，减少无数据支撑的视觉分支）。我的判断：降透明属纯装饰，本平台先不做。

## D-unmapped-162@v1 折叠/搜索隐藏选中行时清空选中，键盘只遍历可见行
状态：implemented
变更：2026-10-22-trajectory-view-redesign
原编号：D-014@v1
锚点：未记录
最近确认：49fb620463233b8293784c64a08693bbabdfc6a4
理由：折叠状态或搜索词变化后，若当前选中行不再可见，立即清空选中并关闭详情；↑/↓ 只在可见行之间移动；scrollIntoView 只对可见行调用。我的判断：保留不可见行的选中会让用户「看不到却占着详情」。

## D-unmapped-163@v1 工具行参数/结果字段来源（允许 from-turn-views 小改）
状态：implemented
变更：2026-10-22-trajectory-view-redesign
原编号：D-015@v1
锚点：未记录
最近确认：49fb620463233b8293784c64a08693bbabdfc6a4
理由：产品路径工具段已有 `raw`（tool_use JSON 原文）与 `result`（配对的 tool_result 文本）、`primary`（主参数摘要）。映射为 inputText=raw、outputText=result ?? primary；from-turn-views.ts 允许本次小改（仅工具行字段映射与行 id 稳定性），build-trajectory.ts 仍零改动。

## D-unmapped-164@v1 等宽模式为只读概览
状态：implemented
变更：2026-10-22-trajectory-view-redesign
原编号：D-016@v1
锚点：未记录
最近确认：49fb620463233b8293784c64a08693bbabdfc6a4
理由：等宽模式只做条块等宽排列的概览——禁用滚轮缩放、拖拽平移、总览刷子与双击重置，不拦截滚轮默认行为（页面正常滚动）；隐藏时间刻度与轮边界竖线；点击条块仍按等宽几何命中并选中对应行。实际时长模式保持现有全部交互。

## D-unmapped-165@v1 D-007 覆盖 D-005 的 Schema 子项
状态：implemented
变更：2026-10-22-trajectory-view-redesign
原编号：D-018@v1
锚点：未记录
最近确认：49fb620463233b8293784c64a08693bbabdfc6a4
理由：D-007 覆盖 D-005 的 Schema 子项；D-005 的其余内容（标签结构、可调宽、抽屉）继续有效。

## D-unmapped-166@v1 时长偏好为全局偏好
状态：implemented
变更：2026-10-22-trajectory-view-redesign
原编号：D-020@v1
锚点：未记录
最近确认：49fb620463233b8293784c64a08693bbabdfc6a4
理由：采用全局偏好（对齐 dsh 的 `dsh.trajectory.duration`），localStorage key `sillyhub.trajectory.scaleMode`，不按会话区分。

## D-unmapped-199@v1 每轮注入【网络环境】前导段，不动首轮一次性策略
状态：implemented
变更：2026-10-23-session-network-context
原编号：D-001@v1
锚点：backend/app/modules/daemon/session/service/inject.py:433
最近确认：55e50da155266013c97475c0c6787bd964170980
理由：每轮注入。复用【页面上下文】的每轮注入通道先例（backend/app/modules/daemon/session/service/inject.py:433 的 page_context 参数，create.py 与 control.py:246 两处复用）；既有 D-002「前导仅首轮拼装」决策不触碰，网络环境走独立每轮段。
故障面：每轮注入若不去重会重复烧 token——由 D-006 去重机制对冲。
退役判据：若平台改为会话级网络信息主动推送（WS 通道）且 agent 可按需查询，可退役每轮注入。

## D-unmapped-200@v1 同网段判定双源——后端观测 daemon 请求源 IP 为 ground truth，daemon 自报网卡列表用于拼访问地址
状态：implemented
变更：2026-10-23-session-network-context
原编号：D-002@v1
锚点：未记录
最近确认：55e50da155266013c97475c0c6787bd964170980
理由：我的判断：双源。①后端从 daemon 心跳/注册请求直接观测来源 IP（复用 auth 模块 _client_ip 的 XFF 最右段逻辑，提为公共工具），这是平台亲眼所见、不可伪造的 ground truth，落库 daemon_instances；②daemon 心跳体新增自报 network_interfaces（os.networkInterfaces 过滤后），用于给 agent 拼「用哪个 IP 访问机器上的服务」（机器多网卡时观测 IP 只有一个，拼 URL 需要网卡列表选合适地址）。CIDR 匹配在两源上做：用户请求源 IP vs daemon 观测 IP（主判定）、vs 各网卡 IP（辅助，找可达地址）。
故障面：daemon 经 NAT 出口访问平台时观测 IP 是 NAT 出口而非机器本机 IP——同网段判定仍成立（用户与 daemon 同 NAT 即同可达域），但拼 URL 必须用自报网卡列表。
退役判据：无（观测 IP 是零成本副产品，长期保留）。

## D-unmapped-201@v1 共享机器的内网 IP 对借用人可见
状态：implemented
变更：2026-10-23-session-network-context
原编号：D-004@v1
锚点：未记录
最近确认：55e50da155266013c97475c0c6787bd964170980
理由：可见。内网 IP 属低敏信息（不出局域网无路由意义），共享语义本身即「授权在这台机器上干活」，拼访问地址是借用场景的核心诉求；方案中已建议、用户「做吧」批准。
故障面：内网拓扑对借用人暴露——接受（共享授权已含更高权限的机器操作权）。

## D-unmapped-202@v2 共享机器权威口径 = grants 表（supersedes D-005@v1）
状态：implemented
变更：2026-10-23-session-network-context
原编号：D-005@v2
锚点：未记录
最近确认：55e50da155266013c97475c0c6787bd964170980
理由：我的判断（经源码查证）：绑定机器仍查 workspace_member_runtimes（本人 runtime 绑定）；共享借用查 daemon grants 表——grants/queries.py:352 的 resolve_granted_daemon_for_borrow 注释明确记录借用判定已从 member_runtimes/queries.py:171 的 binding 表迁移至 grants 表（enabled=TRUE / grantee 工作区+成员 / 非本人 / online，语义逐条等价）。网络环境段的机器清单与派发链路同源，复用该函数族查询。
supersedes：D-005@v1
故障面：口径再迁移（grants 表重构）时本清单滞后——与派发链路共用函数族可同步演进。

## D-unmapped-203@v1 注入去重——内容快照变化才重注 + 会话内最短间隔兜底
状态：implemented
变更：2026-10-23-session-network-context
原编号：D-006@v1
锚点：未记录
最近确认：55e50da155266013c97475c0c6787bd964170980
理由：网络环境段内容做规范化快照（源 IP + 各机器判定结果摘要的 hash），与上一轮相同则不重注（只在首轮注入）；变化（用户切网、机器上下线）才重注；另设最短重注间隔（60s）防移动网络 IP 抖动导致连注。快照存 Redis（会话级 key，TTL 7 天）。
故障面：Redis 快照丢失→多注一次，无正确性影响。

## D-unmapped-204@v1 排队/steering 轮注入语义——入队存用户 IP，派发时重算判定
状态：implemented
变更：2026-10-23-session-network-context
原编号：D-012@v1
锚点：未记录
最近确认：55e50da155266013c97475c0c6787bd964170980
理由：我的判断：镜像 page_context 的入队存储模式——入队时把 user_ip/has_xff 随条目序列化存储（queue.py:304 同款）；派发/steering 重放时用存储的用户 IP + **实时**机器数据（daemon 心跳最新态）重算判定并注入，不重放旧判定文本。排队窗口通常秒级~分钟级，用户 IP 变化概率低，机器状态取最新最准。
故障面：排队期间用户切网→派发用旧 IP 判定——接受（窗口短，且下轮提问即纠正）。

## D-unmapped-205@v1 快照 60s 窗口语义——不吞变化，到点补注
状态：implemented
变更：2026-10-23-session-network-context
原编号：D-013@v1
锚点：未记录
最近确认：55e50da155266013c97475c0c6787bd964170980
理由：我的判断：Redis 存「上次**已注入**的内容 hash + 注入时间戳」。当前渲染 ≠ 上次注入且 ≥60s → 注入并更新；<60s → 不注入也**不更新**快照，下一轮重新比较，到点即补注。变化永不丢失，抖动被窗口吸收。
故障面：无新增（相对 D-006 仅明确写入时机）。

## D-unmapped-206@v1 心跳契约扩展须同步四个钉子测试文件
状态：implemented
变更：2026-10-23-session-network-context
原编号：D-007@v1
锚点：未记录
文件：sillyhub-daemon/src/daemon.ts
最近确认：55e50da155266013c97475c0c6787bd964170980
理由：知识库共享断言面钉子②：daemon 心跳加参（sillyhub-daemon/src/daemon.ts _sendHeartbeatOnce 平铺传参）后，length 钉四文件必须全部 N→N+1：tests/daemon-heartbeat-pending.test.ts、tests/daemon-heartbeat-sillyspec.test.ts、tests/sillyspec-platform-command.test.ts（6 处）、tests/integration/selfupdate-scenarios.test.ts（2 处）。同一变更内完成，否则 CI 补红。
故障面：遗漏任一钉子文件即 CI 红——task 清单显式列出四文件。

## D-unmapped-207@v1 daemon_instances 加 JSON 列 + Alembic 迁移，链尾锚测试前移一行
状态：implemented
变更：2026-10-23-session-network-context
原编号：D-008@v1
锚点：backend/tests/test_align_platform_change_events_migration.py
最近确认：55e50da155266013c97475c0c6787bd964170980
理由：我的判断：daemon_instances 新增 network_info JSON 列（存 {observed_ip, interfaces:[{name,ip,cidr,family}]}，单列整体读写）+ observed 单独查询便利不加独立列（JSON 内取）。不复用 capabilities（语义混杂）。新 Alembic 迁移落库时必须前移链尾锚测试 backend/tests/test_align_platform_change_events_migration.py 的 head 常量一行（知识库钉子①）。
故障面：老版本 daemon 未升级时 network_info 恒 NULL——判定降级为「无网卡数据，仅观测 IP」，不报错。

## D-unmapped-208@v1 实现方案选定——方案 A 平台自动注入（每轮 CIDR 判定 + 前导段注入）
状态：implemented
变更：2026-10-23-session-network-context
原编号：D-009@v1
锚点：未记录
最近确认：55e50da155266013c97475c0c6787bd964170980
理由：用户选定方案 A：daemon 心跳上报网卡 + 后端观测落库 + 每轮 CIDR 判定生成【网络环境】段自动注入。理由：原始诉求是「agent 每次回答时都知道网络情况」，只有注入保证 100% 触达；B 依赖 agent 主动查询、最需要的场景最容易漏；C 浏览器探测被 Chrome mDNS 混淆封死且 agent 依旧无感知。
故障面：见 D-001/D-006（token 成本由去重对冲）。

## D-unmapped-209@v1 落选方案 B——agent 按需查询工具（get_network_info MCP 工具）
状态：rejected
变更：2026-10-23-session-network-context
原编号：D-010@v1
锚点：未记录
最近确认：55e50da155266013c97475c0c6787bd964170980
理由：落选。不主动注入，新增 MCP 查询工具让 agent 按需调用。
否决理由：治不了本——agent 不主动调用就依旧不知道网络情况，而用户最需要的场景（问「怎么访问项目地址」）恰恰最容易漏；且需扩 MCP 工具面、daemon 不掌握用户浏览器源 IP 须回平台查询，链路更长。
复潮条件：若注入 token 成本实测不可接受且 agent 主动调用习惯可被 prompt 稳定养成，可重议按需查询形态。

## D-unmapped-210@v1 落选方案 C——仅前端展示网络徽标不注入
状态：rejected
变更：2026-10-23-session-network-context
原编号：D-011@v1
锚点：未记录
最近确认：55e50da155266013c97475c0c6787bd964170980
理由：落选。仅在聊天界面显示网络徽标，agent 无感知。
否决理由：浏览器侧探测局域网 IP 已被 Chrome mDNS 混淆机制基本封死（返回 *.local），拿不到可用数据；且不解决核心诉求——agent 依旧不知道网络环境，等于不做。
复潮条件：若浏览器重新开放可靠的本机 IP 探测能力且需求退化为「仅人看」，可重议。

## D-unmapped-230@v1 按 dsh 引擎机制做全套（消息来源标记 + 请求头快照），跨三端
状态：implemented
变更：2026-10-25-trajectory-source-model
原编号：D-001@v1
锚点：未记录
最近确认：024af1a9d8d16d48a68fa1dfe07103c16afd049c
理由：用户否决前端启发式（2026-10-25-trajectory-system-rows 已 reject），要求按 dsh 机制做全套：消息来源标记（source）+ 请求级系统提示词/工具快照上报，含 daemon 侧改造，跨 backend + sillyhub-daemon + frontend 三端完整流程。
故障面：盖戳遗漏新增注入点时该类消息回退「用户」行（可发现的标签回退，非数据损坏）。
退役判据：若平台日志层未来引入原生来源列，metadata 键机制可整体退役。

## D-unmapped-231@v1 系统提示词行做「配置面快照」口径（引擎全文不可得）
状态：implemented
变更：2026-10-25-trajectory-source-model
原编号：D-002@v1
锚点：未记录
最近确认：024af1a9d8d16d48a68fa1dfe07103c16afd049c
理由：用户裁决：做配置面快照——daemon 轮边界上报「档案配置的 systemPrompt 追加段 + 工具清单」快照，变更时显示「系统提示词已更新/工具已更新」行；对比对象是配置面非引擎全文，该边界写入设计文档。

## D-unmapped-232@v1 存量历史会话如实呈现（无标记 → 用户行），不做启发式兜底
状态：implemented
变更：2026-10-25-trajectory-source-model
原编号：D-003@v1
锚点：未记录
最近确认：024af1a9d8d16d48a68fa1dfe07103c16afd049c
理由：用户裁决：如实呈现——新机制只对新产生的会话生效，存量无标记的历史注入仍显示「用户」行，不伪造标记、不保留启发式兜底（与 dsh 数据驱动同构）。

## D-unmapped-233@v1 revert 已提交的启发式代码（77ba0588b / c93aafc84）
状态：implemented
变更：2026-10-25-trajectory-source-model
原编号：D-004@v1
锚点：未记录
最近确认：024af1a9d8d16d48a68fa1dfe07103c16afd049c
理由：用户裁决：在新变更中 revert 这两笔提交，方案彻底切换到 dsh 机制（代码已在 main，通过 revert commit 处理，不 reset 历史）。

## D-unmapped-234@v1 采用方案 A——复用日志通道（metadata 盖戳 + 新 channel 快照 + submit 透传修复）
状态：implemented
变更：2026-10-25-trajectory-source-model
原编号：D-005@v1
锚点：未记录
最近确认：024af1a9d8d16d48a68fa1dfe07103c16afd049c
理由：用户选 A：注入点盖 metadata（照 turn_trigger 先例）；daemon 轮边界把配置快照作为新 channel 日志上报；修复 submit_steps metadata 只落 _agent_event 的透传缺陷；前端新增段类型照 turn_trigger 先例装配。全链路复用现有管道，历史回放自动有快照。
故障面：channel 扩枚举后旧前端把快照行当未知日志（需前端兼容分类：未知 channel 归中性系统行不丢）。
退役判据：若日志层拆分内容/元数据双流，快照 channel 可迁离。

## D-unmapped-235@v1 否决「独立快照表 + REST 上报」（方案 B）
状态：rejected
变更：2026-10-25-trajectory-source-model
原编号：D-006@v1
锚点：未记录
最近确认：024af1a9d8d16d48a68fa1dfe07103c16afd049c
理由：用户未选 B。
否决理由：新表+新端点+前端新查询链路，实时/回放各接一套，改动面远大于复用现有日志管道且无对应收益。
复潮条件：日志表容量/查询性能因快照行出现实测问题时重议。

## D-unmapped-236@v1 否决「纯前端不落库」（方案 C）
状态：rejected
变更：2026-10-25-trajectory-source-model
原编号：D-007@v1
锚点：未记录
最近确认：024af1a9d8d16d48a68fa1dfe07103c16afd049c
理由：用户未选 C。
否决理由：刷新即丢、历史会话无快照，不满足 D-001 的历史回放要求。
复潮条件：无（需求本身要求持久化，除非需求变更）。

## D-unmapped-237@v1 设计定稿——三段式（注入盖戳 / daemon 快照 / 前端行）+ 真码原型
状态：implemented
变更：2026-10-25-trajectory-source-model
原编号：D-008@v1
锚点：未记录
最近确认：024af1a9d8d16d48a68fa1dfe07103c16afd049c
理由：用户确认定稿；原型（轨迹原型扩展三类新行）已登记 prototype-trajectory-source-model.html。

## D-unmapped-238@v1 新注入类归 turn_trigger 体系（非独立 sender 键）
状态：implemented
变更：2026-10-25-trajectory-source-model
原编号：D-009@v1
锚点：未记录
最近确认：024af1a9d8d16d48a68fa1dfe07103c16afd049c
理由：我的判断：扩 turn_trigger（team_brief / worker_dispatch / agent_notice 三新 kind）——前端配置表/装配链/轨迹映射全套已就位，零新管道；dsh 的 source.kind 独立轴在本平台等价物即该闭表。

## D-unmapped-239@v1 变更检测在 daemon 侧，只报 initial/change（非每轮落快照）
状态：implemented
变更：2026-10-25-trajectory-source-model
原编号：D-010@v1
锚点：未记录
最近确认：024af1a9d8d16d48a68fa1dfe07103c16afd049c
理由：我的判断：daemon 缓存上次快照做字段级比较，仅 initial 与 change 上报——dsh 同构（agent.ts:635-650 同款条件），省日志量。

## D-unmapped-247@v2 忽略条目按顶层聚合展示，不递归展开（措辞精度修订）
状态：implemented
变更：2026-10-25-explorer-git-status
原编号：D-003@v2
锚点：未记录
最近确认：19783ad99
理由：结论不变（顶层聚合）；normalized_requirement 措辞收敛为「与忽略目录内部文件数无关（--directory 只聚合目录），散落的忽略单文件仍逐条、规模与其线性相关」
supersedes：D-003@v1
故障面：同 D-003@v1
退役判据：同 D-003@v1

## D-unmapped-248@v1 diff 基线一律 HEAD，不区分暂存区；untracked/已删除特例展示
状态：implemented
变更：2026-10-25-explorer-git-status
原编号：D-004@v1
锚点：未记录
最近确认：19783ad99
理由：我的判断：一律与 HEAD（最近一次提交）比，不拆「更改/已暂存更改」两组（平台 agent 场景不走暂存流程，YAGNI）；untracked 文件 diff 展示整文件为新增（全绿）；已删除文件保留在修改集合清单（红色删除线），diff 展示整文件删除（全红）
故障面：用户本地手动 stage 后清单不体现暂存态，可能误判「还有未暂存改动」
退役判据：平台引入暂存区工作流（如平台内提交功能）时重议口径

## D-unmapped-249@v1 explorer 树着色不改点击行为，diff 入口仅修改集合视图
状态：implemented
变更：2026-10-25-explorer-git-status
原编号：D-005@v1
锚点：未记录
最近确认：19783ad99
理由：我的判断（按用户原话字面）：explorer 树点击行为维持现状（右侧内容预览）；「点击看 diff」仅是修改文件集合视图的交互。explorer 树只加状态着色
故障面：用户若预期「树上点文件直接看 diff」会与实现不符——design 图例中写明
退役判据：用户反馈想从 explorer 树直达 diff 时，加辅助入口（如右键菜单/图标按钮）

## D-unmapped-250@v1 状态采集沿用 git_log 既有三层链路，daemon 新增两个平名能力
状态：implemented
变更：2026-10-25-explorer-git-status
原编号：D-006@v1
锚点：未记录
最近确认：19783ad99
理由：我的判断：沿用 git_log 模块既有「backend(GitLogService 绑定解析) → ws_hub.send_rpc → daemon execFile git」链路与安全守卫；daemon 侧新增两个平名 RPC 能力——①文件级状态清单（porcelain v2 文件行 + ignored --directory 聚合行 + numstat 增删行数）②工作区单文件 vs HEAD diff（git diff HEAD --unified=3 --no-color -- <path>，untracked 用 no-index 形态或标记位由前端渲染全文新增）。backend 暴露两个新只读端点（WORKSPACE_READ 门控）
故障面：daemon 旧版本无新平名能力 → backend 需按未知方法映射为 422「daemon 版本过旧」降级（对齐现有 git-log 降级形态）
退役判据：若后续 daemon 与 backend 合并部署形态变化，再评估链路简化

## D-unmapped-251@v1 落选——方案 B（explorer 契约内嵌状态字段）— rejected
状态：rejected
变更：2026-10-25-explorer-git-status
原编号：D-008@v1
锚点：未记录
最近确认：19783ad99
理由：落选
否决理由：懒加载树逐层列目录导致重复采集（每层一次 git status）；逐目录语义拼不出全量修改清单，Git 日志页修改集合另开接口形成两处数据源，一致性无保障；ExplorerEntry DTO 变更牵动 gen:types 双份义务
复潮条件：explorer 树改为一次性全量返回（无逐层懒加载）且修改集合需求取消时，可重议内嵌口径

## D-unmapped-252@v1 落选——方案 C（daemon watch + 实时推送）— rejected
状态：rejected
变更：2026-10-25-explorer-git-status
原编号：D-009@v1
锚点：未记录
最近确认：19783ad99
理由：落选
否决理由：大仓库 fs 监听开销大且 Windows 文件监听坑多；需新增推送通道与连接状态机；当前场景刷新按钮 + react-query 失效机制已覆盖，YAGNI 严重超范围
复潮条件：出现多端同改工作区需秒级感知的真实场景（如多人协作审阅同一工作区）时重议

## D-unmapped-253@v1 untracked diff 采集用局部 execFile 读退出码（exit 0/1 均成功）
状态：implemented
变更：2026-10-25-explorer-git-status
原编号：D-010@v1
锚点：sillyhub-daemon/src/host-fs-handler.ts:1661
最近确认：19783ad99
理由：我的判断：untracked 分支不走 runCmd 的 ok 通道，用局部 execFile（对齐 runGitFetch 先例 sillyhub-daemon/src/host-fs-handler.ts:1661）直接读退出码——exit 0/1 均视为成功（1=有差异，常态），≥2 或 killed 才 error；stderr 的 CRLF warning 行不进 error 文案。备选「改 ExecResult 暴露退出码」影响公共件全调用面，不取
故障面：git 未安装/版本极旧时 no-index 旗标行为差异——退化为 error 通道，前端按 diff 拉取失败降级，不致错数据
退役判据：ExecResult 未来暴露退出码后，可回归统一 runCmd 通道

## D-unmapped-254@v1 porcelain v2 解析契约——末段 rejoin、u 条目按 modified、祖先蓝点不含 ignored
状态：implemented
变更：2026-10-25-explorer-git-status
原编号：D-011@v1
锚点：未记录
最近确认：19783ad99
理由：我的判断：① `1` 条目前段字段以单空格分隔、path 以制表符与前段分隔（git 官方契约）——按行内首个 `\t` 切出 path（含空格安全；path 含 `\t`/换行时 git 自动 C-quote 包裹）；② `u`（unmerged，合并冲突）条目按 modified 归类（四态不扩冲突态，YAGNI，测试用例覆盖）；③ explorer 祖先目录蓝点口径=子树内存在 added/modified/deleted/untracked 任一，ignored 不算改动
故障面：冲突文件显示为「修改」蓝而非专门冲突标识——平台场景罕见，图例不提示；用户在别处解决冲突后状态自然消失
退役判据：平台出现高频合并冲突场景时增补第五态「冲突」

## D-unmapped-255@v1 并行变更遗留红测试的就地对齐（turn-timeline 断言恢复）
状态：implemented
变更：2026-10-25-explorer-git-status
原编号：D-014@v1
锚点：未记录
最近确认：19783ad99
理由：我的判断：该红由并行变更 subagent-card-unify-panel 已提交主仓但漏更新对应测试所致，非本变更文件；为恢复提交门可用，在收口提交 0f3bf815a 中顺带对齐断言（20/20 绿），commit message 留痕
故障面：顺手修复与变更主体混于同一提交，追溯需读 commit message
退役判据：无（一次性修复留痕）

## D-unmapped-266@v1 回退安全性前提=单会话单活跃 run 不变式(反例排查)
状态：implemented
变更：2026-10-26-turn-phase-orphan-fallback
原编号：D-001@v1
锚点：未记录
文件：frontend/src/components/daemon/session-panel/session-panel-dialog.tsx, frontend/src/components/daemon/session-panel/session-panel-page.tsx, frontend/src/components/daemon/session-panel/turn-state.ts, frontend/src/lib/daemon/__tests__/session-stream-turn-phase.test.ts
最近确认：65081d429e74019db614c9b39035464c74bd4be2
理由：前提=平台「单会话单活跃 run」硬不变式。反例逐一排查：①跨轮子代理——parent_tool_use_id 归属派生轮，是轮内事件不建轮，不产生 turn_phase；②团队分身——parent_session_id 独立会话树，事件按 agent_session:{id} 频道各自路由；③忙轮守卫——已有活跃轮时后端拒绝新 run（DaemonSessionTurnConflict）或转排队（排队消息非活跃轮，派发建轮才活跃）；④steering 中途注入——沿用活跃 run 不建新轮；⑤自动续跑——前轮终态后才建新轮。实现侧保险：回退只写 currentRunId 指向的轮（现有状态机维护，只指向 pending/running/interrupting），不做模糊匹配。

## D-unmapped-317@v1 落选——估算并入既有 usage_update 通道
状态：rejected
变更：2026-10-29-engine-live-perception
原编号：D-002@v1
锚点：未记录
最近确认：de68b356befe540e0c77695de92216fb36c1a5e9
理由：不采用（用户选定方案二，本条为落选防复潮记录）。
否决理由：usage 字段语义被估算值污染——预算软切断（liftSessionUsage/aggregateSessionUsage/checkBudgetCutoff）、计费聚合、ctx 环所有既有消费方都需防「估算混入聚合」，漏防一处即钱与切断阈值的事故面；与 2026-08-27「实时/终态口径必须同类」决策正面冲突（轮结束权威值落定必跳变）。
复潮条件：usage 消费面收敛到单一展示用途且预算/计费全部改走独立聚合源时成本反转。

## D-unmapped-318@v1 落选——纯前端等待态分级（不动 daemon）
状态：rejected
变更：2026-10-29-engine-live-perception
原编号：D-003@v1
锚点：未记录
最近确认：de68b356befe540e0c77695de92216fb36c1a5e9
理由：不采用（用户 P0 裁决 C 要求估算数字按引擎能力补显，纯文案不满足）。
否决理由：token 数字全程不动只换文案，不满足用户 P0 裁决 C（估算补显），治标不治本。
复潮条件：daemon 侧改动长期不可行（引擎面冻结）时可作为降级兜底单独启用。

## D-unmapped-084@v1 : PPM 个人工作台头像维持首字占位（用户头像功能非目标）
状态：implemented
原编号：D-003@v1
锚点：未记录
最近确认：41c3b37
理由：2026-09-10-account-avatar-upload——PPM 已上线模块不动，WorkbenchProfile.avatar_text 维持首字；展示范围圈定为个人中心+顶栏+群聊（用户选定）。后续要接入再单独立变更。

## D-frontend-025@v1 2026-09-25-change-detail-assets-usability——本变更四条修复全在「展示与跳转」层，不新增数据源，延续 D-001@v1（沉淀资产=服务端解析 spec 树镜像）与「git/锚点逻辑单一源在工具」两条既有决策
状态：implemented
变更：2026-09-25-change-detail-assets-usability
原编号：D-000@v1
锚点：.sillyspec/changes/archive/2026-09-25-change-detail-assets-usability/design.md
文件：backend/app/modules/change/assets.py, backend/app/modules/change/router.py, backend/app/modules/change/schema.py, backend/app/modules/change/tests/test_assets.py, docs/sillyspec/knowledge-hits-anchor-drift-and-upload-stall.md, frontend/src/app/(dashboard)/workspaces/[id]/__tests__/knowledge-page.test.tsx, frontend/src/app/(dashboard)/workspaces/[id]/changes/[cid]/page.tsx, frontend/src/app/(dashboard)/workspaces/[id]/knowledge/page.tsx, frontend/src/components/changes/__tests__/scope-audit-command-card.test.tsx, frontend/src/components/changes/detail/__tests__/change-assets-card.test.tsx, frontend/src/components/changes/detail/change-assets-card.tsx, frontend/src/components/changes/scope-audit-command-card.tsx, frontend/src/components/knowledge/entry-card-list.tsx, frontend/src/components/mobile/mobile-change-detail.tsx, frontend/src/lib/changes.ts
最近确认：未记录
理由：本变更四条修复全在「展示与跳转」层，不新增数据源，延续 D-001@v1（沉淀资产=服务端解析 spec 树镜像）与「git/锚点逻辑单一源在工具」两条既有决策： 1. 范围对账降级态（FR-05）：卡面按 `degraded_reason` 分支渲染——有降级原因时不渲染三态 chip，改显降级原因 + 口径说明；已归档变更补一句「文件面为当前工作区未提交窗口」并由变更详情页传入 archived 标志。根因是 CLI 降级为「实际侧 only 视图（不出三态列）」时行内无 verdict 字段，前端把 undefined 计成 0 仍照画三个 chip（本机跑 `sillyspec scope-audit --json` 实证）。 2. 沉淀资产卡三组入口：FR/决策行改跳知识库页 URL 参数（`?file=&anchor=`）并落到条目卡；测试绑定行给「看测试文件」入口，弹窗内复用 explorer 的 `FilePreview`（读仓库文件，spec 镜像里没有测试文件）；归档留档列出 change-patch.json 的 files 清单，点击看 change.patch 中该文件的切片（后端切片 + 复用 DiffView）。 3. 知识库页补 URL 参数消费（FR-01/02 的落位端）：新增 `?file=`/`?anchor=` 解析 + 前缀归一 + 条目级滚动；`entry-card-list` 的结构化条目卡补 `data-entry-anchor`（原只有手册形态有，FR/决策条目因此无法作为滚动落点）。 4. 路径校验复用 `change/scope_audit.py::normalize_scope_file_path`（拒 `..`/绝对路径/pathspec magic），不新写一份校验。

## D-frontend-026@v1 2026-09-26-sillyspec-command-queue——daemon.ts `_runSillySpecCommand` 的两臂忙拒（`_sillyspecCommandInFlight` 标志 + `executo
状态：implemented
变更：2026-09-26-sillyspec-command-queue
原编号：D-000@v1
锚点：.sillyspec/changes/archive/2026-09-26-sillyspec-command-queue/design.md
文件：frontend/src/app/(dashboard)/workspaces/[id]/changes/[cid]/__tests__/page-restore-assets.test.tsx, frontend/src/app/(dashboard)/workspaces/[id]/changes/[cid]/page.tsx, sillyhub-daemon/src/daemon.ts, sillyhub-daemon/tests/sillyspec-platform-command.test.ts
最近确认：未记录
理由：daemon.ts `_runSillySpecCommand` 的两臂忙拒（`_sillyspecCommandInFlight` 标志 + `executor.isUpgradeInFlight()`）改为单一 FIFO 串行队列：布尔标志换 `_sillyspecCommandQueueTail` promise 链尾，每条命令 `.then(run, run)` 排尾——前一条完成（含防御 reject 出口）后下一条自动执行；npm 升级臂从「立即记 failed」改为出队执行前轮询等待（`SILLYSPEC_COMMAND_UPGRADE_POLL_MS`=1s，定时器 unref 对齐 manager deferred 重查惯例——npm 正在替换 CLI bin，与其并发 spawn 有半安装件风险，必须等）。选排队而非忙拒+前端自动重试：命令幂等且秒级（resolve/ghost_cleanup 实测 0.2-0.7s + 秒级），FIFO 最简且保序；原 D-001 拒排队裁决依据「单管理员低频场景」被生产实证推翻（2026-09-25 sillyspec 工作区两条裁决与升级链/彼此并发双双被拒，用户判「忙拒绝没必要」）。

## D-frontend-027@v1 2026-09-27-prototype-pipeline——把本会话已验证的「原型即实现」试点固化为常设管线：视图源码迁入 `frontend/src/components/prototype/`（页面类五视图 tsx，
状态：implemented
变更：2026-09-27-prototype-pipeline
原编号：D-000@v1
锚点：.sillyspec/changes/archive/2026-09-27-prototype-pipeline/design.md
文件：.gitignore, frontend/.gitignore, frontend/package.json, frontend/prototype-dist/change-center.html, frontend/prototype-dist/change-detail.html, frontend/prototype-dist/index.html, frontend/prototype-dist/session-portal.html, frontend/prototype-dist/sillyspec-flow.html, frontend/prototype-dist/workspace-list.html, frontend/prototype-dist/workspace-overview.html, frontend/scripts/prototype-build.mjs, frontend/src/components/prototype/README.md, frontend/src/components/prototype/__tests__/flow-diagram.test.tsx, frontend/src/components/prototype/__tests__/prototype-smoke.test.tsx, frontend/src/components/prototype/change-center-view.tsx, frontend/src/components/prototype/change-detail-view.tsx, frontend/src/components/prototype/demo-chrome.tsx, frontend/src/components/prototype/flow-diagram.tsx, frontend/src/components/prototype/session-portal-view.tsx, frontend/src/components/prototype/sillyspec-flow-view.tsx
最近确认：未记录
理由：把本会话已验证的「原型即实现」试点固化为常设管线：视图源码迁入 `frontend/src/components/prototype/`（页面类五视图 tsx，import 生产 primer 组件与 themes.ts token，fixture 数据）；编译器收编为 `frontend/scripts/prototype-build.mjs`（tsc 编译视图子图 → react-dom/server 静态渲染 → Tailwind 按项目配置一次编译 → 逐视图内联为单文件 HTML，附三主题切换与轻交互 vanilla JS），`pnpm prototype:build` 一键触发，产物落 `frontend/prototype-dist/` 入仓对账（重编译 diff 必须为空——原型不可能与源码分家的机械保证）。 流程描述类原型（无对应页面）走同一条管线：新增 FlowDiagram 原语（节点/边 JSON 源 → BFS 分层 → SVG 绝对定位渲染，颜色全 CSS var token，零新增依赖），配一个真实流程示例视图（SillySpec 变更流程状态机）。原型分型规约（页面类/流程类/规则类）落 `.sillyspec/docs/SillyHub/scan/PROTOTYPE.md`。

## D-frontend-028@v1 2026-09-27-session-portal-ia-restructure——诊断（三子代理全量功能清点佐证）：会话门户"乱"的根源不是样式而是信息架构——中栏头部单行挤 9+ 元素（标题/ID/状态/共享徽标/机器/工作区/后台目录/子
状态：implemented
变更：2026-09-27-session-portal-ia-restructure
原编号：D-000@v1
锚点：.sillyspec/changes/archive/2026-09-27-session-portal-ia-restructure/design.md
文件：docs/sillyspec/2026-09-27-spec-sync-413-and-nested-runtime.md, frontend/src/app/(dashboard)/workspaces/[id]/changes/[cid]/page.tsx, frontend/src/app/(dashboard)/workspaces/[id]/changes/__tests__/page.test.tsx, frontend/src/app/(dashboard)/workspaces/[id]/changes/page.tsx, frontend/src/app/(dashboard)/workspaces/[id]/page.test.tsx, frontend/src/app/(dashboard)/workspaces/[id]/page.tsx, frontend/src/app/(dashboard)/workspaces/__tests__/page.test.tsx, frontend/src/app/(dashboard)/workspaces/page.tsx, frontend/src/app/globals.css, frontend/src/components/changes/detail/__tests__/change-stage-header.test.tsx, frontend/src/components/changes/detail/__tests__/change-step-timeline.test.tsx, frontend/src/components/changes/detail/change-stage-header.tsx, frontend/src/components/daemon/__tests__/session-panel-runs-request-dedup.test.tsx, frontend/src/components/daemon/__tests__/session-panel-variant.test.tsx, frontend/src/components/daemon/__tests__/session-usage-panel-mount.test.tsx, frontend/src/components/daemon/session-panel/session-panel-page.tsx, frontend/src/components/primer/__tests__/primer-atoms.test.tsx, frontend/src/components/primer/__tests__/primer-structures.test.tsx, frontend/src/components/primer/counter.tsx, frontend/src/components/primer/empty-state.tsx
最近确认：未记录
理由：诊断（三子代理全量功能清点佐证）：会话门户"乱"的根源不是样式而是信息架构——中栏头部单行挤 9+ 元素（标题/ID/状态/共享徽标/机器/工作区/后台目录/子代理目录/视图tab/搜索/打断）；垂直方向最多 11 层堆叠（AgentLog折叠栏→TaskExecutionPanel→后台提示→UsageBar→消息流→PlanApproval→队列条→定时条→输入栏→配置条→CtxUsageBar）；同类信息散落多处（任务 3 处、用量 2 处）；左栏筛选区 5 控件纵排；右列仅文件预览/子代理详情时出现，平时空置。 方案（收纳而非删除）：①中栏右列（现有子代理详情列）扩展为「收起/详情/子代理」三模式——详情模式收纳 SessionUsageBar、TaskExecutionPanel 与概览元信息（MetaPanel 分组），查看类信息有了统一归处；②头部两层化——主行只留标题+状态+高频操作，元信息（#id 复制/机器/工作区/共享徽标）降级次行 muted 小字；③底部收敛——desktop 移除消息流上方用量条与任务面板（移入右栏），操作类（计划批准/队列/定时/输入/配置）原位保留；④左栏筛选紧凑化——搜索+状态同行、机器/智能体/关联合并紧凑排布。改 `session-panel-page.tsx`（右列+头部+底部）与 `session-list-panel.tsx`（筛选区）两个主文件，`sessions-portal.tsx` 层零改动（文件预览列/群聊/四分支不波及）。视觉沿用上一轮 primer 组件体系（StateLabel/MetaPanel）与主题 token。选此方案因为它把"乱"的根因（无收纳层）解决掉，同时 render 组织层重组不动任何状态机，功能零丢失可对照验收。

## D-frontend-029@v1 2026-09-28-change-detail-header-overflow——两处 CSS 约束补齐（与列表行 2026-09-28-change-ux-detail-batch ① 同类陷阱）： 1. `frontend/src/com
状态：implemented
变更：2026-09-28-change-detail-header-overflow
原编号：D-000@v1
锚点：.sillyspec/changes/archive/2026-09-28-change-detail-header-overflow/design.md
文件：frontend/src/app/(dashboard)/workspaces/[id]/changes/[cid]/page.tsx, frontend/src/components/layout/__tests__/page-header.test.tsx, frontend/src/components/layout/page-header.tsx
最近确认：未记录
理由：两处 CSS 约束补齐（与列表行 2026-09-28-change-ux-detail-batch ① 同类陷阱）： 1. `frontend/src/components/layout/page-header.tsx`：header flex 行的左侧内容列 `<div>` 补 `min-w-0`——flex 项默认 min-width:auto，其内 nowrap 长文（详情页描述行 w-full+truncate）的 min-content 把该列撑到 1861px（生产实测），溢出 header（1228px）并产生页面级横向滚动（scrollWidth 2219 > 视口 1600）。补 min-w-0 后整条收缩链打通：列可收缩 → p/副标题 flex-wrap 受限 → 描述 span w-full=受限宽 + truncate 生效出省略号。组件级修复覆盖全部 41 个使用 PageHeader 的页面。 2. 详情页标题 `frontend/src/app/(dashboard)/workspaces/[id]/changes/[cid]/page.tsx:244`：flex 行内 `<span className="truncate">` 补 `min-w-0`——同为 flex 项 min-width:auto 陷阱，超长标题目前无法收缩截断，防下一起同型报告。 方案选择：改组件而非详情页局部包一层 overflow-hidden——根因在 PageHeader 的宽度约束链，组件级修复一处收口全部使用方；且 min-w-0 只放宽收缩下限，对正常宽度内容零视觉影响。 文件变更清单（自声明，收口对账面）： - `frontend/src/components/layout/page-header.tsx`（task-01：左列 div 补 min-w-0 + 注释） - `frontend/src/app/(dashboard)/workspaces/[id]/changes/[cid]/page.tsx`（task-02：标题 truncate span 补 min-w-0 + 注释） - `frontend/src/components/layout/__tests__/page-header.test.tsx`（task-03：新增回归测试 3 用例） - `.sillyspec/changes/2026-09-28-change-detail-header-overflow/*`（变更四件套 + visual-evidence.md + before-prod-1600.png）

## D-frontend-030@v1 2026-09-28-change-ux-detail-batch——纯前端八点体验修正（用户实测反馈逐条对号）：①列表行描述 span 补 min-w-0——flex 项默认 min-width:auto，长文 nowrap 撑
状态：implemented
变更：2026-09-28-change-ux-detail-batch
原编号：D-000@v1
锚点：.sillyspec/changes/archive/2026-09-28-change-ux-detail-batch/design.md
文件：frontend/src/app/(dashboard)/workspaces/[id]/changes/[cid]/__tests__/page-restore-assets.test.tsx, frontend/src/app/(dashboard)/workspaces/[id]/changes/[cid]/__tests__/page-team-toggle.test.tsx, frontend/src/app/(dashboard)/workspaces/[id]/changes/[cid]/page.tsx, frontend/src/app/(dashboard)/workspaces/[id]/changes/__tests__/page.test.tsx, frontend/src/app/(dashboard)/workspaces/[id]/changes/page.tsx, frontend/src/components/changes/__tests__/scope-audit-command-card.test.tsx, frontend/src/components/changes/detail/__tests__/change-assets-card.test.tsx, frontend/src/components/changes/detail/__tests__/change-stage-actions.test.tsx, frontend/src/components/changes/detail/change-assets-card.tsx, frontend/src/components/changes/detail/change-stage-actions.tsx, frontend/src/components/changes/detail/quicklog-linked-card.tsx, frontend/src/components/changes/platform-sync-section.tsx, frontend/src/components/changes/scope-audit-command-card.tsx
最近确认：未记录
理由：纯前端八点体验修正（用户实测反馈逐条对号）：①列表行描述 span 补 min-w-0——flex 项默认 min-width:auto，长文 nowrap 撑破行宽溢出覆盖右列阶段/时间与 meta 行影响模块，min-w-0 收缩后 truncate 生效；②详情页 PageHeader subtitle 追加描述行（w-full 独占 + truncate + title 悬浮）；③平台同步常驻卡收进工具条「平台同步」按钮 + antd Drawer（destroyOnHidden），组件加 drawerHint prop：未绑定数据源时抽屉内出中性提示而非空白；④ChangeStageActions thin 分支改 return null（协议长文案退役，出身拦截保留）；⑤ChangeAssetsCard 默认展开（useState(true)）+ 自 aside 移主栏 + 分组改 md:grid-cols-2 网格、每组 h-64 固定高度 flex-col + 内层 overflow-y-auto；⑥详情页移除 ChangeAgentRunLog 挂载及其 agentStatus 取数链（getAgentStatus/refreshAgentStatus/panelRunId 全退，组件保留供 mobile-change-detail）；⑦QuicklogLinkedCard 空列表/加载中/失败一律不渲染；⑧ScopeAuditCommandCard 去头部说明副标题、DegradedNotice 双段压单行（保留「不出三态」口径与归档指路）。

## D-frontend-031@v1 2026-09-28-quicklog-title-overflow——三处改动（frontend/src/components/changes/quicklog-table.tsx）： 1. DataTable 加 `tableL
状态：implemented
变更：2026-09-28-quicklog-title-overflow
原编号：D-000@v1
锚点：.sillyspec/changes/archive/2026-09-28-quicklog-title-overflow/design.md
文件：frontend/src/components/changes/__tests__/quicklog-table.test.tsx, frontend/src/components/changes/quicklog-table.tsx
最近确认：未记录
理由：三处改动（frontend/src/components/changes/quicklog-table.tsx）： 1. DataTable 加 `tableLayout="fixed"`——antd 默认 auto 布局下列宽按内容 min-content 协商，标题列（唯一无 width 列）实际分得 ~400px 而标题按钮 `max-w-[420px]` 自适应内容宽，按钮连同 truncate span 直接越过单元格右界压进负责人/影响模块列（生产实测 elRight 875 > cellRight 854，用户 sillyspec 工作区实证）；fixed 布局下标题列稳定分得剩余宽度，截断有确定边界。 2. 标题按钮 `max-w-[420px]` → `block w-full min-w-0 max-w-[420px]`——宽度跟随单元格（宽屏保留 420 视觉上限，窄屏收缩），内部 block truncate span 到边界出省略号。 3. StatusColumn 外层 `inline-flex` → `flex`、备注 `max-w-[160px]` → `max-w-full`——同型隐患：状态列 width 130，固定 160px 上限的备注可越过自身单元格。 放弃方案：仅给标题列配 antd column.ellipsis——只裁单行文本，破坏标题+ql_id 两行结构；仅删 420 上限不换 fixed——auto 布局下 nowrap 内容 min-content 仍会撑爆协商。 文件变更清单（自声明，收口对账面）： - frontend/src/components/changes/quicklog-table.tsx（task-01/02/03 三处） - frontend/src/components/changes/__tests__/quicklog-table.test.tsx（task-04 回归锁定扩展） - .sillyspec/changes/2026-09-28-quicklog-title-overflow/*（变更产物）

## D-frontend-032@v1 2026-09-28-remove-liveness-overview-card——纯删除性前端小改：从工作区详情页（`frontend/src/app/(dashboard)/workspaces/[id]/page.tsx`）摘除 `<Ag
状态：implemented
变更：2026-09-28-remove-liveness-overview-card
原编号：D-000@v1
锚点：.sillyspec/changes/archive/2026-09-28-remove-liveness-overview-card/design.md
文件：frontend/src/app/(dashboard)/workspaces/[id]/page.test.tsx, frontend/src/app/(dashboard)/workspaces/[id]/page.tsx, frontend/src/components/agent-log/agent-liveness-overview-card.tsx
最近确认：未记录
理由：纯删除性前端小改：从工作区详情页（`frontend/src/app/(dashboard)/workspaces/[id]/page.tsx`）摘除 `<AgentLivenessOverviewCard>` 挂载与 import，删除组件文件 `frontend/src/components/agent-log/agent-liveness-overview-card.tsx`，并清掉 `page.test.tsx` 里对该组件的 vi.mock（无断言引用）。选删除而非「无数据时隐藏」：排查实证（2026-09-28）活性上报链路在真实部署从未建立——本机库 platform_agent_logs 724/725 行 state NULL（唯一非 NULL 是 manual_test 手工测试行）、daemon 连远程 crrcdt.ppdmq.top、各 workspace local.yaml 无 platform token 使 daemon liveness 循环空转零上报——卡片对用户恒显示「未知（100）」，无信息量且误导；修复链路（daemon 指回 + token 下发 + 持续在线）成本远超一张总览卡的价值，用户裁决去掉。数据层不动：GET /api/agent-logs 与 listWorkspaceAgentLogs 保留（会话列表 use-session-liveness 仍在用），liveness-badge 五态徽章保留（agent 日志面板行徽章仍在用）。

## D-frontend-033@v1 2026-09-29-change-detail-timeline-files-polish——三处纯展示层优化，不动数据链路： 1. 时间线卡（change-timeline-card.tsx）：事件轴从 border-dashed 平铺改为「节点圆点
状态：implemented
变更：2026-09-29-change-detail-timeline-files-polish
原编号：D-000@v1
锚点：.sillyspec/changes/archive/2026-09-29-change-detail-timeline-files-polish/design.md
文件：backend/app/modules/change/service.py, backend/app/modules/change/tests/test_files_router.py, frontend/src/components/__tests__/change-file-tree.test.tsx, frontend/src/components/change-file-tree.tsx, frontend/src/components/changes/detail/__tests__/change-timeline-card.test.tsx, frontend/src/components/changes/detail/change-timeline-card.tsx, frontend/src/components/files/__tests__/file-preview-modal.test.tsx, frontend/src/components/files/__tests__/preview-registry.test.ts, frontend/src/components/files/__tests__/structured-views.test.tsx, frontend/src/components/files/file-preview-modal.tsx, frontend/src/components/files/preview-registry.ts, frontend/src/components/files/previewers/index.ts, frontend/src/components/files/previewers/json-previewer.tsx, frontend/src/components/files/previewers/jsonl-previewer.tsx, frontend/src/components/files/structured-views.tsx, frontend/src/components/mobile/mobile-change-detail.tsx, frontend/src/lib/change-files.ts
最近确认：未记录
理由：三处纯展示层优化，不动数据链路： 1. 时间线卡（change-timeline-card.tsx）：事件轴从 border-dashed 平铺改为「节点圆点 + 连线」竖向时间轴结构（借用 primer Timeline 的视觉语言但行距收紧，事件密集场景 primer 本体 pb-5 太占空间，不直接复用）；卡内容区限高 max-h 内部滚动；事件超过 30 条默认只渲染最近 30 条 + 「展开全部」切换（useState）。 2. watcher-events.jsonl 预览：后端 _TEXT_SUFFIXES 补 .jsonl（当前被判非文本，内容预览完全不可用，这是用户诉求的根因）；前端 structured-views.tsx 新增 tryParseJsonl + JsonlView（通用逐行视图）+ watcher-events.jsonl 专用表格视图（时刻/kind 中文徽章/阶段/详情，ts epoch ms 转本地时刻）；preview-registry EXT_MAP 加 jsonl 键、新建 jsonl-previewer、file-preview-modal RENDERER_MAP 注册、JsonPreviewer 对 .jsonl 文件名兜底转发（防后端 mime 报 application/json 时走 json 分支）、change-file-tree FilePreview 加 jsonl 分支（内联）。 3. 中文名映射：change-file-tree.tsx 内置固定产物名 → 中文映射表（proposal.md→变更提案 等 14 项，按近三日 49 个变更目录统计）；树节点主显中文名 + muted 小字原名，内容区标题同理；下载/全屏预览 meta.name 保留原文件名（下载文件不被改名）。

## D-frontend-034@v1 2026-09-29-issue-row-grid-misalign——一行核心修复：frontend/src/components/primer/issue-row.tsx 行组件在 leading 缺席时由渲染 null 改为渲
状态：implemented
变更：2026-09-29-issue-row-grid-misalign
原编号：D-000@v1
锚点：.sillyspec/changes/archive/2026-09-29-issue-row-grid-misalign/design.md
文件：frontend/src/components/primer/__tests__/primer-structures.test.tsx, frontend/src/components/primer/issue-row.tsx
最近确认：未记录
理由：一行核心修复：frontend/src/components/primer/issue-row.tsx 行组件在 leading 缺席时由渲染 null 改为渲染空占位 div（aria-hidden），与同文件 IssueRowHeader 既有占位先例（:117 `{leading ? <div>{leading}</div> : <div />}`）对齐。 机理：ISSUE_ROW_GRID 四轨 [auto, auto, minmax(0,1fr), auto] 首轨为 leading 插槽（批量模式勾选框）。无占位时普通行子元素左移一格——主体列落进第 2 轨 auto（按内容 max-content 撑宽）、右列内容落进第 3 轨 minmax(0,1fr)（可缩到 0）：长描述行第 2 轨吃满可用宽、第 3 轨被压到比右列内容窄，右列 flex justify-end 布局的内容**向左溢出画出自身容器盒**（生产实测：容器盒 left 1519 而内容 step-sub-row left 1083），与描述文字互相叠压——即用户报告的 desc(basis-full truncate) × step-sub-row 重叠（sillyspec 工作区归档 unclear-req-to-brainstorm 行 Playwright 复现，包围盒交集 true）。补占位后主体落 1fr 轨（可收缩、truncate 有确定边界）、右列落 auto 轨（按内容定宽、永不左溢）。 此前三轮修复未触此根因的教训：测量一直比对右列容器盒界（1519）而其内容已左溢出盒（1083）——凡 flex/grid 容器 justify-end + overflow，判定必须量内容元素而非容器盒。 文件变更清单（自声明，收口对账面）： - frontend/src/components/primer/issue-row.tsx（task-01：leading 空占位） - frontend/src/components/primer/__tests__/primer-structures.test.tsx（task-02：占位回归用例） - .sillyspec/changes/2026-09-29-issue-row-grid-misalign/*（变更产物）

## D-frontend-035@v1 2026-09-29-jump-empty-turn-dup——session-panel-page.tsx handleJumpToTurn 单轮直达路径两处修补：①新增 `jumpEmptyJumpedRunIdsRef
状态：implemented
变更：2026-09-29-jump-empty-turn-dup
原编号：D-000@v1
锚点：.sillyspec/changes/archive/2026-09-29-jump-empty-turn-dup/design.md
文件：frontend/src/app/(dashboard)/sessions/__tests__/page.test.tsx, frontend/src/components/daemon/session-panel/session-panel-page.tsx
最近确认：未记录
理由：session-panel-page.tsx handleJumpToTurn 单轮直达路径两处修补：①新增 `jumpEmptyJumpedRunIdsRef`（Set&lt;string&gt;）幂等标记——直达拉回的日志装配后无可渲染正文（segments/output 全空，群聊空 user_input 形态）时记名该 run，该轮后续点击直接定位高亮、不再发 run_id 请求；会话切换时重置（新会话同名 run 日志形态可能不同）。②prepend 门控——零正文（或装配无产出）不再 prepend：run_id 直达与已装配状态同日志源，重拉必同形，prepend 只会造装饰键（jump-&lt;该轮最旧日志id&gt; 恒相同）撞 React key 的重复空块。用 ref 而非 state：handleJumpToTurn 的 deps 刻意不含 turnState（防每帧重建击穿导航列 memo），原 loadedTurn 查找受陈旧闭包拖累本就不可靠（本次诊断实证），ref 读取恒当前。

## D-frontend-036@v1 2026-09-30-assets-testfile-nodeid-anchor——只改前端读侧归一纯函数 `normalizeTestFilePath`（frontend/src/components/changes/detail/chang
状态：implemented
变更：2026-09-30-assets-testfile-nodeid-anchor
原编号：D-000@v1
锚点：.sillyspec/changes/archive/2026-09-30-assets-testfile-nodeid-anchor/design.md
文件：frontend/src/components/changes/detail/__tests__/change-assets-card.test.tsx, frontend/src/components/changes/detail/change-assets-card.tsx
最近确认：未记录
理由：只改前端读侧归一纯函数 `normalizeTestFilePath`（frontend/src/components/changes/detail/change-assets-card.tsx，2026-09-26-assets-testfile-path-resolve / 2026-09-27-assets-testfile-bracket-note 同一函数的续修）：在既有「」注解剥离之后新增两步——取首个用例锚界符（:: / # / >）之前的路径段，再剥尾部粘联的全角括号注解残段（未闭合截断形与闭合形）。选这个方案因为它就是 2026-09-26-binding-anchor-fidelity 落定契约（tests[] 带锚原样收录、文件面剥锚、展示面保持完整锚点）的读侧补齐——CLI 侧 testAnchorFile 已统一剥锚，平台读侧此前只落了「」一种形态，:: 形整串进 basename 必零命中。TestFileBody 的 basename 派生与 resolveTestFilePath 的等值/后缀比较均消费同一归一结果，一处修改两处生效；不改数据侧（归档 test-trace 是冻结审计件，先例 2026-09-26 摘录保真坑同判不可补）。

## D-frontend-037@v1 2026-10-07-ci-failures-sweep——main 上 backend-ci 5 用例 + frontend-ci 3 用例失败，逐一核对生产契约后确认全部为测试侧债（生产代码零改动）：①迁移链尾锚测试
状态：implemented
变更：2026-10-07-ci-failures-sweep
原编号：D-000@v1
锚点：.sillyspec/changes/archive/2026-10-07-ci-failures-sweep/design.md
文件：backend/app/modules/change/tests/test_files_router.py, backend/app/modules/daemon/tests/test_attachment_pipeline.py, backend/app/modules/workspace/tests/test_archived_write_guard.py, backend/tests/test_align_platform_change_events_migration.py, frontend/src/app/(dashboard)/sessions/__tests__/page.test.tsx, frontend/src/components/knowledge/__tests__/precipitate-dialog.test.tsx, frontend/src/components/sessions/__tests__/pre-session-picker.test.tsx
最近确认：未记录
理由：main 上 backend-ci 5 用例 + frontend-ci 3 用例失败，逐一核对生产契约后确认全部为测试侧债（生产代码零改动）：①迁移链尾锚测试自带「新迁移接续后锚前移」约定（测试注释原文），20261006200000 成为新 head 后锚未随动——更新锚与注释；②test_files_router fixture 取 items[0] 依赖 updated_at desc 排序，fixture 内归档 change（目录在 changes/archive/ 子树）在 CI Linux 同刻 mtime 下稳定排首，拼 changes/<key>/ 写 watcher-events.jsonl FileNotFoundError——fixture 固定选取 location=="active" 行；③群装配用例 member 夹具缺 D-003 新增的 config_snapshot 属性——补属性并顺势断言 model_name 透传/None 兜底两形态；④归档守卫用例断言停留在已退役的懒激活分支语义——改断言现行 409 TOOL_REPORT_TAKEOVER_INVALID，docstring 注明写入口兜底链。选测试侧修复而非改生产：每处均有生产侧契约依据（后端 schema/查表实态/特性 docstring），属规则 9 允许的「测试逻辑/夹具过时」情形。

## D-frontend-038@v1 2026-10-07-ci-sweep-jsonl-mock——frontend-ci 第 4 处失败（2026-10-07-ci-failures-sweep 首轮排查时 tail 截断漏看）：onlyoffice-pre
状态：implemented
变更：2026-10-07-ci-sweep-jsonl-mock
原编号：D-000@v1
锚点：.sillyspec/changes/archive/2026-10-07-ci-sweep-jsonl-mock/design.md
文件：frontend/src/components/files/__tests__/onlyoffice-preview.test.tsx
最近确认：未记录
理由：frontend-ci 第 4 处失败（2026-10-07-ci-failures-sweep 首轮排查时 tail 截断漏看）：onlyoffice-preview.test.tsx 枚举式 vi.mock("../previewers") 缺 fa799e68b（2026-09-29）新增的 JsonlPreviewer 导出，file-preview-modal.tsx 的 RENDERER_MAP 引用该导出时在模块作用域炸掉，整套件收集失败。修法：mock 补一行桩导出并更新注释溯源；顺带审计全仓其余枚举式 previewers mock（仅 file-preview-modal.test.tsx 一处，已含 JsonlPreviewer，无需动）。选测试侧补桩而非改生产：测试文件自有注释即约定「枚举式工厂须随桶文件新导出同步补齐」，属既定惯例漏补，生产桶导出契约无恙。

## D-frontend-039@v1 2026-10-08-shared-assertion-surfaces——两轮 CI 清偿复盘：14 个失败用例中 9 个同模式——生产契约变更只更新了本变更内测试，漏了散落在其它文件钉住同一契约的断言（六面：迁移链尾锚/daemon
状态：implemented
变更：2026-10-08-shared-assertion-surfaces
原编号：D-000@v1
锚点：.sillyspec/changes/archive/2026-10-08-shared-assertion-surfaces/design.md
文件：backend/app/modules/llm_provider/schema.py, frontend/src/components/files/previewers/index.ts, frontend/src/components/workspace-tabs.tsx, frontend/src/lib/provider-caps.ts, sillyhub-daemon/src/daemon.ts
最近确认：未记录
理由：两轮 CI 清偿复盘：14 个失败用例中 9 个同模式——生产契约变更只更新了本变更内测试，漏了散落在其它文件钉住同一契约的断言（六面：迁移链尾锚/daemon 心跳参长/前端 TABS 数量/caps 全对象/previewers 枚举 mock/backend 词表对账正则）。方案是把这些「共享断言面」显性登记：①knowledge/testing-gotchas.md 新增条目逐面登记（契约源→钉子测试→动作），INDEX.md 挂关键词索引——flow start 知识注入与子代理 INDEX 查询可命中，这是工具链原生提醒通道；②五个契约源码处加一行同步提醒注释（schema.py/daemon.ts/workspace-tabs.tsx/provider-caps.ts/previewers/index.ts），动手改契约的人当场可见。选注释+知识库而非自动生成清单脚本：登记一次成本低、命中面即改契约现场与 flow start 两处，自动方案（AST 扫描钉子）复杂度不成比例。

## D-frontend-040@v1 2026-10-09-graph-raf-settle——`graph-canvas.tsx` 的 force 引擎 rAF 循环加收敛截止：新增导出纯函数 `forceSettled`（Verlet 步后 x−px
状态：implemented
变更：2026-10-09-graph-raf-settle
原编号：D-000@v1
锚点：.sillyspec/changes/archive/2026-10-09-graph-raf-settle/design.md
文件：frontend/src/components/knowledge/__tests__/graph-canvas.test.ts, frontend/src/components/knowledge/graph-canvas.tsx
最近确认：未记录
理由：`graph-canvas.tsx` 的 force 引擎 rAF 循环加收敛截止：新增导出纯函数 `forceSettled`（Verlet 步后 x−px 即本帧位移，全节点位移和 < FORCE_SETTLE_EPSILON=0.25 判静止，NaN 防御）+ 组件内 `forceLiveRef`/`forceSettledFramesRef` 两 ref。循环的力场块加 `forceLiveRef.current` 门：步进后累计连续静止帧，达 FORCE_SETTLE_FRAMES=30 即置 false 停步进，并在该帧未交互时做终局 fitView（承接收敛跟随）；数据重建 effect 与拖拽命中分支复位重启。选「停步进保留 rAF 渲染循环」而非「取消 rAF 按需重启」：渲染循环本就有 dirty 早退（非 dirty 帧仅一个空回调，成本可忽略），取消/重启 rAF 需要在所有 dirty 置位点接线，改动面大收益边际。连续 30 帧守卫防弹簧转折点瞬时零速误判（单帧判定会在振荡系统上早停）；拖拽活跃守卫（dragRef 非空不判静止）防被拖节点位移恒零导致的误停冻结（首轮评审 P1 修复）；forceSettled 对 px/py 的 NaN 同防御（NaN>x 恒 false 缝隙，首轮评审 P3 修复）。

## D-frontend-041@v1 2026-10-10-change-patch-cross-repo-view——纯前端读侧适配，单文件改动：`frontend/src/components/files/structured-views.tsx` 的 `ScopeAudit
状态：implemented
变更：2026-10-10-change-patch-cross-repo-view
原编号：D-000@v1
锚点：.sillyspec/changes/archive/2026-10-10-change-patch-cross-repo-view/design.md
文件：frontend/src/components/files/__tests__/structured-views.test.tsx, frontend/src/components/files/structured-views.tsx
最近确认：未记录
理由：纯前端读侧适配，单文件改动：`frontend/src/components/files/structured-views.tsx` 的 `ScopeAuditView`（scope-audit.json 独立报告与 change-patch.json 的 scopeAudit 子对象共用同一渲染）增量渲染跨仓冻结面。数据链：sillyspec 仓变更 2026-10-10-cross-repo-patch-freeze（已归档，commit e7a50f35）已把 `scopeAudit.repos[]`（key/anchor/totals/degraded/degradedReason/patch/patchSha256）冻结进 change-patch.json；平台文件预览链（change-file-tree 内联预览 + json-previewer 全屏弹窗）把 JSON 全文交给 `knownJsonView` → `ChangePatchView` → `ScopeAuditView`——在这一个渲染函数补齐，两个入口同时生效，后端/daemon 零改动。 视觉形态对齐变更中心 scope-audit-command-card 的跨仓分组渲染（2026-09-20-scope-audit-cross-repo-platform 已上线范式）：主仓 brand 色标识、锚点 chip、三态 chips。一处差异：daemon 链的 `anchor_label` 短哈希是 daemon 投影产出，冻结件里没有——前端从 `anchor.base` 自行短化（`slice(0, 7)`）。patch 正文折叠块默认收起，展开后复用 `DiffView`（自带 2000 行增量渲染，大 diff 不铺满）。

## D-frontend-042@v1 2026-10-13-load-earlier-full-turn——问题根因：`handleLoadEarlier`（session-panel-page.tsx）按 `(ts,id)` 复合游标固定 `HISTORY_PAGE
状态：implemented
变更：2026-10-13-load-earlier-full-turn
原编号：D-000@v1
锚点：.sillyspec/changes/archive/2026-10-13-load-earlier-full-turn/design.md
文件：frontend/src/app/(dashboard)/sessions/__tests__/page.test.tsx, frontend/src/components/daemon/__tests__/session-history-scroll.test.tsx, frontend/src/components/daemon/__tests__/session-panel-load-earlier-full-turn.test.tsx, frontend/src/components/daemon/session-panel/session-panel-page.tsx
最近确认：未记录
理由：问题根因：`handleLoadEarlier`（session-panel-page.tsx）按 `(ts,id)` 复合游标固定 `HISTORY_PAGE_SIZE=400` 行翻页，页边界与「已加载窗口最旧行」边界都会把一轮（run） 切成两半——触顶加载后顶部那轮只有后半段（提问在更早未加载区）；「回到会话开头」 复用同一翻页链路，到头后跨页同轮分裂成多个轮块（每页独立 `logsToTurns` 装配）。 方案（轮边界对齐）：翻页拉回一页后判两类跨界轮——① 窗口侧：页轮集合 ∩ 窗口终态 轮集合（新增模块级纯函数 `collectCrossBoundaryRuns`，经 `turnsRef` 快照镜像读取， 不进回调 deps）；② 页顶侧：满页时发 `limit=1` 探查请求（同 before 复合游标语义） 取紧邻更早一行，与页内最旧行同 run 即被切。命中的跨界轮用既有 `run_id` 直达端点 （`getAgentSessionLogs({runId, slim})`，先例：handleJumpToTurn 单轮直达）拉整轮行， 当页该轮行替换为整轮行重新装配，并在 prepend 的 `setTurnState` updater 里摘掉窗口 内同轮终态旧块——一轮收敛为单个完整块（提问 + 全部输出同块）。游标推进取合并后 行集的最旧行。选此方案而非「续拉整页直到轮边界」：后者多拉无关行且仍分裂显示； 选此方案而非「重写装配层做跨块段合并」：直达整轮重装天然产出单块，改动收敛在 handleLoadEarlier 一个函数内，SSE 实时链路零触碰。

## D-frontend-043@v1 2026-10-14-decision-anchor-change-qualified——根因：`decisions/unmapped.md` 等聚合文件里多个变更各有同名决策号（实证：D-003@v1 出现 3+ 次），既有锚 `文件#决策号` 不
状态：implemented
变更：2026-10-14-decision-anchor-change-qualified
原编号：D-000@v1
锚点：.sillyspec/changes/archive/2026-10-14-decision-anchor-change-qualified/design.md
文件：frontend/src/app/(dashboard)/workspaces/[id]/__tests__/knowledge-page.test.tsx, frontend/src/app/(dashboard)/workspaces/[id]/changes/[cid]/page.tsx, frontend/src/app/(dashboard)/workspaces/[id]/knowledge/page.tsx, frontend/src/components/changes/detail/__tests__/change-assets-card.test.tsx, frontend/src/components/changes/detail/change-assets-card.tsx, frontend/src/components/knowledge/__tests__/entry-card-list.test.tsx, frontend/src/components/knowledge/entry-card-list.tsx
最近确认：未记录
理由：根因：`decisions/unmapped.md` 等聚合文件里多个变更各有同名决策号（实证：D-003@v1 出现 3+ 次），既有锚 `文件#决策号` 不唯一，`querySelector` 命中文件序第一个同号卡——沉淀资产卡弹窗（上一变更新增）与知识库页深链滚动都会落错卡。修复采用「复合锚」：结构化条目卡新增 `data-entry-anchor-qualified="文件#变更号#决策号"`（变更号取条目自身的「变更：」字段，与仓库既有跨变更引用约定 `变更名#D-xxx@vN` 同构），裸锚保留兼容。 改动三点：① `entry-card-list.tsx` DecisionCard 输出复合属性（id+变更字段齐备才输出）；② `change-assets-card.tsx` 资产卡新增 `changeKey` prop（变更详情页已有 `change.change_key`，一处透传），FR/决策行深链 anchor 参数带变更号前缀，弹窗定位先试复合锚再退裸锚；③ `knowledge/page.tsx` 深链滚动对含 `#` 的 anchor 先试复合属性、查无退裸锚。知识触达/手册/INDEX 锚点不动。

## D-frontend-044@v1 2026-10-14-session-bottom-switch-remount——第三层根因：SPA 内列表点击切换会话时 SessionPanelPage/TurnTimeline 不卸载重挂，滚动判定 refs 跨会话残留（上滚读历史后
状态：implemented
变更：2026-10-14-session-bottom-switch-remount
原编号：D-000@v1
锚点：.sillyspec/changes/archive/2026-10-14-session-bottom-switch-remount/design.md
文件：frontend/src/components/daemon/session-panel/session-panel-dialog.tsx, frontend/src/components/daemon/session-panel/session-panel-page.tsx
最近确认：未记录
理由：第三层根因：SPA 内列表点击切换会话时 SessionPanelPage/TurnTimeline 不卸载重挂，滚动判定 refs 跨会话残留（上滚读历史后 isNearBottomRef=false）→ 新会话贴底跟随被守卫拦下（真浏览器复现：会话 A 上滚→切 f231ca18→停距底 3963px）。前两轮修复（length 分量/被动增高）只覆盖整页加载路径。修法：React 惯例——同组件不同实体用 key 隔离：page/dialog 两处 <TurnTimeline> 挂 key={会话标识}，切换即重挂载、全部滚动状态归零（初始贴底语义恢复）。agent-replay-body（本地回放单会话展示）不 key 化。

## D-frontend-045@v1 2026-10-14-session-preview-defect-fixes——上一变更（2026-10-14-session-turn-preview-cards）上线实测两缺陷，本修复最小改面两处： ①失败轮点不动——根因：单轮「有内容
状态：implemented
变更：2026-10-14-session-preview-defect-fixes
原编号：D-000@v1
锚点：.sillyspec/changes/archive/2026-10-14-session-preview-defect-fixes/design.md
文件：frontend/src/app/(dashboard)/sessions/__tests__/page.test.tsx, frontend/src/components/daemon/__tests__/session-preview-integration.test.tsx, frontend/src/components/daemon/session-panel/__tests__/preview-merge.test.ts, frontend/src/components/daemon/session-panel/preview-merge.ts, frontend/src/components/daemon/session-panel/session-panel-page.tsx
最近确认：未记录
理由：上一变更（2026-10-14-session-turn-preview-cards）上线实测两缺陷，本修复最小改面两处： ①失败轮点不动——根因：单轮「有内容」判定（anyBody/hasBody/loadedHasBody 共 5 处）只认 segments/output，额度耗尽失败轮（日志含 user_input 无答复）被判零正文进幂等黑名单，点击短路无响应。修法：5 处统一口径补「非空 prompt 也是可渲染正文」（用户消息气泡本身是内容；失败详情卡由 runs 快照 error_detail 经既有 enrichDisplayTurns 注入，块进来即渲染）。真零正文（prompt/output 双空，群聊空 user_input）维持 2026-09-29 幂等语义——探针实证空串不被放行。 ②轮号错乱——根因：logsToTurns 按批次局部编号（初始窗口末块=12、单轮直达恒 1、翻页各批各起 1），归并层有大纲权威 seq 却未盖到已加载块，与预览卡/导航轮号错位穿帮。修法：归并层透传时盖章（stampOutlineSeq：seq 不一致才克隆），WeakMap 按原引用缓存产物——流式期间每 delta 重派生 displayTurns 不因盖章全量克隆（TurnRow memo 不击穿），seq 已一致零克隆。

## D-frontend-046@v1 2026-10-15-ci-recurrence-guard——把 2026-10-15-fix-ci-red 灭火中归因的三类本地拦截面缺口机制化：① 断言面闸门规则⑦ requires 补齐三件套（admin/menus
状态：implemented
变更：2026-10-15-ci-recurrence-guard
原编号：D-000@v1
锚点：.sillyspec/changes/archive/2026-10-15-ci-recurrence-guard/design.md
文件：.claude/CLAUDE.md, backend/.pre-commit-config.yaml, backend/tests/test_check_assertion_surfaces.py, frontend/src/app/(dashboard)/workspaces/[id]/__tests__/knowledge-page.test.tsx, frontend/src/app/(dashboard)/workspaces/[id]/knowledge/page.tsx, frontend/src/components/changes/detail/__tests__/change-assets-card.test.tsx, frontend/src/components/changes/detail/change-assets-card.tsx, frontend/src/components/knowledge/__tests__/entry-card-list.test.tsx, scripts/check-assertion-surfaces.py
最近确认：未记录
理由：把 2026-10-15-fix-ci-red 灭火中归因的三类本地拦截面缺口机制化：① 断言面闸门规则⑦ requires 补齐三件套（admin/menus 序钉 + menu-permissions.test.ts 数量锚 + permission.test.ts 分区条目）——历史事故正是「只重算序钉漏数量锚」，闸门当时只盯序钉；② 新增规则⑨ openapi.json 契约源 → 前端+daemon 双 api-types 生成物同提交——规则 21 长期只写前端义务，daemon 漏生成无人记得；③ pre-push 新增 ci-fast-gate 快检（frontend/daemon typecheck + 双 gen:types:check，与 CI 同源四命令前移到推送时）。同步 CLAUDE.md 第 21 条与 knowledge/testing-gotchas.md（脚本 docstring 规定的两处同步登记）。选扩展既有闸门而非新建脚本：改契约必须同提交配对测试的防呆模式 2026-10-11 已实证有效，本次只是补规则；pre-push 而非 pre-commit 放 typecheck——每次提交跑 1 分钟太重，推送是 CI 前最后闸口。

## D-frontend-047@v1 2026-10-15-graph-type-cluster——用户实测反馈：neighbors 等查询切片的力场布局里不同类型节点混成一坨。
状态：implemented
变更：2026-10-15-graph-type-cluster
原编号：D-000@v1
锚点：.sillyspec/changes/archive/2026-10-15-graph-type-cluster/design.md
文件：frontend/src/app/(dashboard)/workspaces/[id]/knowledge/graph/page.tsx, frontend/src/components/knowledge/__tests__/graph-canvas.test.ts, frontend/src/components/knowledge/graph-canvas.tsx
最近确认：未记录
理由：用户实测反馈：neighbors 等查询切片的力场布局里不同类型节点混成一坨。现 slice 力场只有斥力（成对近距）+ 边弹簧 + 向心 0.004 三种力，无任何让同类型靠近的力；而 >200 节点的静态降级 staticLayout 已按类型分环。本变更让力场面对齐该语义：在 stepForceLayout 每步弹簧段之后新增「类型内聚」力——先统计各类型有限坐标节点的质心，再对每个节点施加朝本类型质心的弱牵引（TYPE_COHESION_PULL，量级与 CENTER_PULL 同数量级、略强）。同类成簇、异类被对称斥力推开出块；跨类型边弹簧照常拉出"桥"，正好呈现用户草图期望的形态。选质心牵引而非固定扇区锚：零配置自适应任意类型数、不与既有向心/弹簧参数打架、单成员类型自动零力。

## D-frontend-048@v1 2026-10-17-session-envelope-rev-stale-guard——改 `frontend/src/stores/session.ts`：SessionState 新增单调 rev 计数器（持久化进信封）——setTokens/
状态：implemented
变更：2026-10-17-session-envelope-rev-stale-guard
原编号：D-000@v1
锚点：.sillyspec/changes/archive/2026-10-17-session-envelope-rev-stale-guard/design.md
文件：frontend/src/stores/session.test.ts, frontend/src/stores/session.ts
最近确认：未记录
理由：改 `frontend/src/stores/session.ts`：SessionState 新增单调 rev 计数器（持久化进信封）——setTokens/setUser/clear 三个用户驱动变更加一，storage 回放不自行加一而是采纳远端 rev；回放守卫先判 rev（远端更旧 = 迟到旧值，整体忽略），再走既有的差异比对（乒乓切断逻辑原样保留）。 选此方案依据：迟到旧信封覆盖新值的危害是「已登出/已续票标签页被幽灵复活」（2026-10-17-session-replay-pingpong-fix 评审 P3-3），窗口虽小但属刚出过 11 小时生产事故的同源子系统；rev 是最小充分方案——单调性天然定义「谁新谁旧」，不依赖时钟，不改 persist 中间件。旧形状信封无 rev 字段自动回落既有内容比对，混合版本标签页安全（新版代码的静默路径会饿死任何它参与的环）。

## D-frontend-049@v1 2026-10-17-session-replay-pingpong-fix——改 `frontend/src/stores/session.ts` 的跨标签 storage 回放监听器：回放前先与本地当前状态逐字段比对——accessTo
状态：implemented
变更：2026-10-17-session-replay-pingpong-fix
原编号：D-000@v1
锚点：.sillyspec/changes/archive/2026-10-17-session-replay-pingpong-fix/design.md
文件：frontend/src/stores/session.test.ts, frontend/src/stores/session.ts
最近确认：未记录
理由：改 `frontend/src/stores/session.ts` 的跨标签 storage 回放监听器：回放前先与本地当前状态逐字段比对——accessToken/refreshToken 字符串直比，user 用键序无关稳定键（键排序后序列化）比较——只对真实差异字段 setState，全等时静默返回（不 setState 即不产生 persist 写盘）。 选此方案依据：乒乓环路的自持能量来自「回放→persist 写盘→对方 storage 事件→回放」，从回放侧掐掉同值写盘即让环路失去自持条件（生产实证 2026-10-17：两标签各持不同过期 token，/api/auth/me 每秒 10 条 401 刷屏 11 小时）；同时不改 persist 配置、不动任何调用方，真实跨标签同步语义完整保留，改动面最小。

## D-frontend-050@v1 2026-10-19-preview-card-empty-turn-fix——根因：切换档案产生「纯切换轮」（backend inject.py silent_config_switch，inject.py:608）——建 run 刻意零
状态：implemented
变更：2026-10-19-preview-card-empty-turn-fix
原编号：D-000@v1
锚点：.sillyspec/changes/archive/2026-10-19-preview-card-empty-turn-fix/design.md
文件：docs/releases/2026-10-19-013-205a79f71.md, docs/releases/2026-10-19-014-5b9c2ce4c.md, frontend/src/app/(dashboard)/sessions/__tests__/page.test.tsx, frontend/src/components/daemon/__tests__/session-preview-integration.test.tsx, frontend/src/components/daemon/session-panel/__tests__/preview-merge.test.ts, frontend/src/components/daemon/session-panel/preview-merge.ts, frontend/src/components/daemon/session-panel/session-panel-page.tsx
最近确认：未记录
理由：根因：切换档案产生「纯切换轮」（backend inject.py silent_config_switch，inject.py:608）——建 run 刻意零日志（实测会话 54317e42 第 2/4/7 轮均 0 条日志、started_at 空、无 engine_anchor）。刷新后轮次大纲（agent_runs 全量投影）包含该轮，归并层把「大纲有、无实质内容」一律合成「未加载 · 点击展开」预览卡；点击后单轮直达查回 0 条日志走 empty 静默短路（session-panel-page.tsx fetchAndAttachTurn）并记入零正文幂等黑名单，卡片永久展不开且无反馈。 方案（前端两处小改）：① preview-merge.ts 新增 isContentlessTerminalItem 判定（started_at 空 + error_code 空 + 摘要双空 + previewTurnStatusOf 映射 completed/killed 终态），命中该类大纲条目不再合成预览卡——turns 有命中（孤儿配置行/已加载空壳）原引用透传并盖 seq（恢复 2026-10-14 design 非目标「静默配置切换轮紧凑配置行语义保留」），无命中不生成条目（深历史静默轮回到 preview-cards 之前的不可见语义）；② handleExpandPreview 对 empty 结果补 notify.warning 轻提示，兜底消灭「点了没反应」。判据核心是 started_at：正常轮派发引擎后必有值，纯切换轮从未派发恒空；群聊空 user_input 轮（2026-09-29 幂等语义）、失败族（失败卡是内容）、活跃族（后续可能出内容）都被 started_at/error_code/终态三条件天然排除，行为零变化。 追加（真机验收发现，同缺陷家族第三面——导航跳转链路）：③ 修复上线后真机点左侧导航的静默轮刻度弹「操作失败」——直达链路对零日志轮走 notify.error("该轮次日志不存在…")，纯字符串被 errMessage 吞成默认「操作失败」（errors.ts misuse guard），且无内容终态轮本就不该报错。修法：isContentlessTerminalItem 导出复用（单一判定源），handleJumpToTurn 命中即早退——不发请求，直接定位高亮既有配置行并记幂等；三处固定文案（直达零日志 / 回退翻页到头 / 展开失败）改 notify.warning 原文；prefetchNearbyTurns 跳过无内容邻居不再发无效请求。

## D-frontend-051@v1 2026-10-20-preset-engine-endpoint——前端两文件：①`config/llmProviderPresets.ts`——预设类型加可选 `codex: { base_url; default_model
状态：implemented
变更：2026-10-20-preset-engine-endpoint
原编号：D-000@v1
锚点：.sillyspec/changes/archive/2026-10-20-preset-engine-endpoint/design.md
文件：docs/releases/2026-10-20-005-6fa3a31.md, frontend/src/components/llm-providers/__tests__/llm-provider-form.test.tsx, frontend/src/components/llm-providers/__tests__/llmProviderPresets.test.ts, frontend/src/components/llm-providers/llm-provider-form.tsx, frontend/src/config/llmProviderPresets.ts
最近确认：未记录
理由：前端两文件：①`config/llmProviderPresets.ts`——预设类型加可选 `codex: { base_url; default_model? }`，智谱 GLM 与 OpenCode Go 两条声明实测过的 codex 端点；②`components/llm-providers/llm-provider-form.tsx`——预设应用抽成按引擎分派（claude 形态=现有行为，codex 形态=覆盖端点+模型+清 env），引擎勾选 onChange 加联动：勾 Codex 且选中预设带覆盖 → 切 codex 形态并自动取消 Claude（平台一条凭证一个端点，两引擎同勾必有一坏）；取消 Codex → 回 claude 形态。选「勾选联动」而非「预设拆两条」（OpenCode Go Codex 预设另列）：预设选择器已拥挤、且用户先选供应商再选引擎是自然顺序，联动把「这家供应商对 codex 需要别的端点」这一平台约束显性化。

## D-frontend-052@v1 2026-10-20-session-error-visibility——生产实证（会话 71419980）：backend close_run_steps.py:277 把 SDK status=error_during_execu
状态：implemented
变更：2026-10-20-session-error-visibility
原编号：D-000@v1
锚点：.sillyspec/changes/archive/2026-10-20-session-error-visibility/design.md
文件：docs/releases/2026-10-20-003-50dfdf2.md, frontend/src/components/agent-log/__tests__/run-error-item.test.tsx, frontend/src/components/agent-log/run-error-item.tsx, frontend/src/components/daemon/__tests__/page-helpers-error-visibility.test.ts, frontend/src/components/daemon/session-panel/page-helpers.tsx, frontend/src/components/daemon/session-panel/session-panel-dialog.tsx, frontend/src/components/daemon/session-panel/session-panel-page.tsx
最近确认：未记录
理由：生产实证（会话 71419980）：backend close_run_steps.py:277 把 SDK status=error_during_execution（涵盖全部模型错误：429/断流/codex spawn 失败）统一落 error_code=interactive_interrupted；前端 runTerminalTurnStatus（快照路径）与 deriveTurnTerminalStatus（实时路径）据此把该类轮归 killed「已中止」且不回填 errorDetail → RunErrorItem 错误卡永不渲染，真实错误（error_detail.raw）对用户完全不可见。 修复利用既有事实做精确区分：模型失败 = interactive_interrupted **且 error_detail 非空**（daemon classifyModelError 产物，模型错误键存在）；真打断 = interactive_interrupted 且 error_detail 空。两处渲染路径按此精化：① 快照路径（page-helpers.tsx enrichOne）terminal 判定为 killed 但 meta.status=failed 时尝试 buildErrorLogItem(meta.error_detail)，可解析则升级为 failed（status failed + errorDetail 回填，错误卡渲染），真打断维持 killed；② 实时路径（session-panel-page.tsx 终态回调）错误详情拉取条件扩展，拉回 error_detail 可解析则翻 status=failed + errorDetail；③ RunErrorItem raw 首行摘要默认渲染。选此方案而非后端拆新 error_code：后者需 daemon/backend/前端三方发版且存量 run 无法重写，error_detail 判定对存量数据即刻生效。

## D-frontend-053@v1 2026-10-21-proto-data-exposure-guard——三步收口两条风险：①真实会话导出数据从 `frontend/public/__proto/` 移至 `frontend/.proto-staging/`——Ne
状态：implemented
变更：2026-10-21-proto-data-exposure-guard
原编号：D-000@v1
锚点：.sillyspec/changes/archive/2026-10-21-proto-data-exposure-guard/design.md
文件：.gitignore, frontend/.gitignore
最近确认：未记录
理由：三步收口两条风险：①真实会话导出数据从 `frontend/public/__proto/` 移至 `frontend/.proto-staging/`——Next.js 只静态服务 `public/`，移出即断「免鉴权可下载」暴露通道，且该目录不进构建产物（数据从此物理上无法随部署分发）；②`staged-session-export.ts` 读取路径常量随迁（`["public","__proto",...]` → `[".proto-staging",...]`），`view.tsx` 移除对 public URL 的运行时 fetch 兜底（数据不在可 fetch 面，兜底成死码），4 处注释同步真实位置；③根/前端 `.gitignore` 补 `/.tmp/`、`backend/pytest-of-*/`、`frontend/.proto-staging/`、`frontend/public/__proto/`、`*.TMP`——审查实证这五类残留全部裸奔在 untracked 面，多 agent 共享仓下「禁目录级 add」只是纪律，gitignore 才是机制。 选「移出」而非「脱敏后留 public/」：导出含 1271 条真实日志，逐条脱敏成本高，而 dev 预览恰恰依赖真实文本形态（字号/密度/长文本折行都是评审对象）；移出服务面零成本达成同等安全目标，SSR 读盘路径保留真实数据可用性。

## D-frontend-054@v1 2026-10-22-file-card-hide-empty——把「无数据的轮级文件变更卡」从**渲染降级卡**改成**不出卡**：唯一判定点收敛在纯映射 `toFileChangesCardProps`（`frontend
状态：implemented
变更：2026-10-22-file-card-hide-empty
原编号：D-000@v1
锚点：.sillyspec/changes/archive/2026-10-22-file-card-hide-empty/design.md
文件：frontend/src/components/daemon/__tests__/turn-timeline-conversation-file-card.test.tsx, frontend/src/components/daemon/file-changes/__tests__/file-changes-summary.test.tsx, frontend/src/components/daemon/file-changes/__tests__/turn-file-changes.test.ts, frontend/src/components/daemon/file-changes/file-changes-card.tsx, frontend/src/components/daemon/file-changes/file-changes-summary.tsx, frontend/src/components/daemon/file-changes/turn-file-changes.ts, frontend/src/components/daemon/turn-timeline.tsx
最近确认：未记录
理由：把「无数据的轮级文件变更卡」从**渲染降级卡**改成**不出卡**：唯一判定点收敛在纯映射 `toFileChangesCardProps`（`frontend/src/components/daemon/file-changes/turn-file-changes.ts`）——`capability="tool_only"` / `snapshot=null` / `status=failed|unavailable` 三条分支一律 `return null`，轮级挂载层（`turn-timeline.tsx` 已是「`null` 不出卡」语义）零改动，因此不会出现「映射改了但挂载层还占位」的错位。 会话级汇总同步收窄：`aggregateTurnFileChanges` 跳过无可信快照的轮（不再计入 `degradedTurns`、不再把状态压到 `partial`），`FileChangesSummary` 在 `totalFiles === 0` 时整卡零渲染，「其中 N 轮无工作区快照（仅工具编辑）」提示行删除。选这个方案的理由：缺陷是**呈现策略**而不是数据链路——daemon 侧实测无故障（0.2.0 采集器 `status=ok` / 46 files / 165ms），历史轮本来就拿不到快照（部署前的轮没有 `daemon_run_snapshots` 行），所以只需在「无信息」的判定处收口，不动 DTO、不动后端、不动 daemon。

## D-frontend-055@v1 2026-10-22-file-changes-card-fix——daemon 采集器（`sillyhub-daemon/src/interactive/turn-file-changes.ts`）把「文件清单真相源」从 `g
状态：implemented
变更：2026-10-22-file-changes-card-fix
原编号：D-000@v1
锚点：.sillyspec/changes/archive/2026-10-22-file-changes-card-fix/design.md
文件：frontend/e2e/proto-file-card.spec.ts, frontend/src/app/proto/session-file-changes/page.tsx, frontend/src/components/daemon/__tests__/turn-timeline-conversation-file-card.test.tsx, frontend/src/components/daemon/file-changes/__tests__/file-changes-card.test.tsx, frontend/src/components/daemon/file-changes/__tests__/turn-file-changes.test.ts, frontend/src/components/daemon/file-changes/file-changes-card.tsx, frontend/src/components/daemon/file-changes/turn-file-changes.ts, sillyhub-daemon/src/interactive/session-manager.ts, sillyhub-daemon/src/interactive/turn-file-changes-types.ts, sillyhub-daemon/src/interactive/turn-file-changes.ts, sillyhub-daemon/tests/interactive/session-manager-turn-file-changes.test.ts, sillyhub-daemon/tests/interactive/turn-file-changes.test.ts
最近确认：未记录
理由：daemon 采集器（`sillyhub-daemon/src/interactive/turn-file-changes.ts`）把「文件清单真相源」从 `git status` 单源改为 **status ∪ `git diff --name-status <baselineHead>`**：status 覆盖未提交/未跟踪，baseline→工作区的 name-status 覆盖轮内已提交改动；行数统一取 `git diff --numstat <baselineHead>`。采集过程改为分阶段记录（status / name-status / numstat），任一 diff 阶段超时只降级行数或状态精度，不再丢弃已完成清单。预算按工作区分层：默认 1500ms，`/mnt/` 挂载 ≥8000ms，超时后进程内自动升级到 15000ms 封顶，并支持 `SILLYHUB_FILE_CHANGES_TIMEOUT_MS` 覆盖。前端把 DTO 的 `status` 带进视图模型，渲染状态徽标；未跟踪/mtime 行不再显示 +0 −0；删除行不可点击；「改N次」改为编辑调用次数（daemon 侧不再按工具名去重）；notice 按 reason+collectMs 生成文案，并在 notice 态渲染共享工作区提示。

## D-frontend-056@v1 2026-10-23-askuser-history-live-sync——根因：dialogHistory（驱动对话/进度内容流 AskUser 穿插渲染的数据源）只在 sessionId 变化的 effect 里 REST 拉一次，
状态：implemented
变更：2026-10-23-askuser-history-live-sync
原编号：D-000@v1
锚点：.sillyspec/changes/archive/2026-10-23-askuser-history-live-sync/design.md
文件：backend/app/core/client_ip.py, backend/app/modules/auth/router.py, backend/app/modules/daemon/model.py, backend/app/modules/daemon/router/heartbeat.py, backend/app/modules/daemon/router/version.py, backend/app/modules/daemon/runtime/service.py, backend/app/modules/daemon/service.py, backend/app/modules/daemon/session/network_context.py, backend/migrations/versions/20261023090000_add_daemon_instances_network_info.py, backend/tests/modules/daemon/test_network_context.py, backend/tests/test_align_platform_change_events_migration.py, frontend/src/components/daemon/__tests__/session-panel-dialog.test.tsx, frontend/src/components/daemon/__tests__/turn-timeline-conversation-file-card.test.tsx, frontend/src/components/daemon/file-changes/__tests__/file-changes-card.test.tsx, frontend/src/components/daemon/file-changes/__tests__/turn-file-diff-dialog.test.tsx, frontend/src/components/daemon/file-changes/file-changes-card.tsx, frontend/src/components/daemon/file-changes/turn-file-diff-dialog.tsx, frontend/src/components/daemon/session-panel/__tests__/refetch-dialog-history.test.ts, frontend/src/components/daemon/session-panel/page-helpers.tsx, frontend/src/components/daemon/session-panel/session-panel-dialog.tsx
最近确认：未记录
理由：根因：dialogHistory（驱动对话/进度内容流 AskUser 穿插渲染的数据源）只在 sessionId 变化的 effect 里 REST 拉一次，SSE 两个 permission 事件（onPermissionRequest ~1674 / onPermissionResolved ~1687）都只维护 pendingRequests——待答卡原先渲染在时间线内容流内，提问实时可见掩盖了历史不实时；2026-10-22-askuser-dock-inputbar 把卡迁到输入框位置后，内容流对提问/回答完全无实时回显（刷新页面才显示）。 方案：在 page-helpers 新增共享函数 `refetchDialogHistory(sessionId, setDialogHistory, seqRef)`（带序号防护的重拉动作函数；评审 P3 收敛：原稿契约名 createDialogHistoryRefetch 系笔误，实态为直接执行型函数），两挂载点（session-panel-page / session-panel-dialog）在 onPermissionRequest 与 onPermissionResolved 回调里各调用一次重拉——提问到达时后端 dialogs 已落库 pending 项（fetchPendingDialogs 同源可证），resolved 时答案已写库（backend 落库后推事件），重拉即得权威数据。前端不手工把 SSE 事件转 SessionDialogRead（resolved 事件不含 answers，伪造会与后端不一致）；事件频率为问答级（人答），重拉开销可忽略。

## D-frontend-057@v1 2026-10-23-diff-copy-p3-cleanup——答：三处小清偿，全部在 turn-file-diff-dialog.tsx 与其测试。
状态：implemented
变更：2026-10-23-diff-copy-p3-cleanup
原编号：D-000@v1
锚点：.sillyspec/changes/archive/2026-10-23-diff-copy-p3-cleanup/design.md
文件：frontend/src/components/daemon/file-changes/__tests__/turn-file-diff-dialog.test.tsx, frontend/src/components/daemon/file-changes/turn-file-diff-dialog.tsx
最近确认：未记录
理由：答：三处小清偿，全部在 turn-file-diff-dialog.tsx 与其测试。①复制按钮由 `text={diffRowsToText(section.rows)}` 改 `getText={() => diffRowsToText(section.rows!)}`——CopyButton 的 getText 路径本就为「渲染期惰性、点击期取值」设计（注释明确「组件不在渲染期调用以保持惰性」），反之用 text 会在每次渲染（含流式/字体状态等任何重渲染）对全部 rows 做字符串拼接。②补丁区底部脚注（原「内容来自本轮 agent 日志…仅计入行数统计」）追加边界说明：复制文本为行级内容、不含 hunk 头、不可直接用于 git apply——把上一变更 design 声称而未落地的文案补上。③无补丁用例改为 `findByText` 等待说明文案（NO_PATCH 文案片段）出现后再断言无按钮，删除态同理（已等「本轮被删除」，保留）；loading 态不再作为 ready 判据。 不改 diffRowsToText 实现（纯函数正确性已由 5 个用例钉住）；不改 CopyButton 共享组件；不动归档件（FR-02 措辞矛盾属上一变更归档文档，不回改历史，教训记入本变更 requirement 语境）。

## D-frontend-058@v1 2026-10-23-diff-dialog-pairing-fix——答：根因两层（第二层为评审修正后的关键发现）： **第一层（表象）**：`collectTurnFilePatches` 的②回退配对把无主补丁「按日志序塞给路
状态：implemented
变更：2026-10-23-diff-dialog-pairing-fix
原编号：D-000@v1
锚点：.sillyspec/changes/archive/2026-10-23-diff-dialog-pairing-fix/design.md
文件：docs/sillyspec/active-pitfalls.md, docs/sillyspec/edit-patch-tool-use-id-missing.md, frontend/src/app/globals.css, frontend/src/app/proto/session-live-marquee/page.tsx, frontend/src/components/daemon/__tests__/turn-live-marquee.test.tsx, frontend/src/components/daemon/__tests__/turn-timeline-history-loading.test.tsx, frontend/src/components/daemon/file-changes/__tests__/turn-file-diff.test.ts, frontend/src/components/daemon/file-changes/turn-file-diff-dialog.tsx, frontend/src/components/daemon/file-changes/turn-file-diff.ts, frontend/src/components/daemon/session-panel/__tests__/initial-window-merge.test.ts, frontend/src/components/daemon/session-panel/__tests__/session-first-load-staged.test.tsx, frontend/src/components/daemon/session-panel/initial-window-merge.ts, frontend/src/components/daemon/session-panel/session-panel-page.tsx, frontend/src/components/daemon/turn-live-marquee.tsx, frontend/src/components/daemon/turn-timeline.tsx
最近确认：未记录
理由：答：根因两层（第二层为评审修正后的关键发现）： **第一层（表象）**：`collectTurnFilePatches` 的②回退配对把无主补丁「按日志序塞给路径命中目标文件的第一个未用编辑调用」——隐含假设「无主补丁都属于弹窗目标文件」，多文件编辑轮必然张冠李戴（2026-10-23 实证：会话 49c5c3ec / run 63130ca1，点 task-runner.test.ts 显示 design.md 内容）。 **第二层（真根因）**：①精确配对读的是日志行顶层 `entry.tool_use_id`，但 `agent_run_logs` **没有该列**（backend schema 注释明写「DB 无此列」，仅 slim 截断时由路由内存回填）——真实配对键在 `metadata.agent_event.call_id`（新轨事件逐行落库，`submit_steps.py:594/628`）。因此①在弹窗的真实 REST 链路上**从未生效**，全部补丁都落进②启发式配对，这才是错配的系统性成因。 **修法**：①配对键改为 `entryCallId(entry)`——`metadata.agent_event.call_id` 为主，回退顶层 `tool_use_id`（slim）与 content JSON 内 `tool_use_id`（旧轨）；id 索引全量预建（容忍乱序批次）。②回退改为**子代理轨道隔离 + 同轨唯一悬置**：按 `parent_tool_use_id` 分轨，候选取「同轨、日志序已出现、未消费的编辑族调用」，恰好一个才配、否则丢弃（平台支持后台子代理并行，跨轨配对会把 A 的补丁挂到 B 名下；同轨多悬置亦无法确证）。 为什么先误判为「数据面丢 id」：初版只看到补丁行顶层 `tool_use_id` 为空，误以为数据链丢键；独立评审核对 backend 后确认该字段本就不是 DB 列、真实键在 `metadata.agent_event.call_id`——根因属于前端读错来源，无需改数据面（FR-04 因此改为「事实登记」）。回退配对保留为旧轨/异常数据的兜底，按轨道隔离 + 同轨唯一悬置，宁缺勿错。

## D-frontend-059@v1 2026-10-23-marquee-blank-track-fix——**根因**：`applyTarget` 在「达到 200 条上限后的窗口滑动」分支执行 `next = min(previousTarget, base) -
状态：implemented
变更：2026-10-23-marquee-blank-track-fix
原编号：D-000@v1
锚点：.sillyspec/changes/archive/2026-10-23-marquee-blank-track-fix/design.md
文件：frontend/src/app/proto/session-live-marquee/page.tsx, frontend/src/components/daemon/__tests__/turn-live-marquee.test.tsx, frontend/src/components/daemon/turn-live-marquee.tsx
最近确认：未记录
理由：**根因**：`applyTarget` 在「达到 200 条上限后的窗口滑动」分支执行 `next = min(previousTarget, base) - step`。每新增一条事件都会滑动一次，目标就在上一次目标基础上再减一条宽度， 长期运行后 target/offset 无限负向，超过 track 内容总宽，整条轨道被推出视口——只剩状态点与 LIVE。 **修复**：把目标规则抽成纯函数 `resolveMarqueeTarget`： - 滑动（`slideStep != null`）→ 目标**回到 base**（最新条贴右缘的位置），不再累减； - 普通内容增长 → `min(previousTarget, base)`（只向更负，不回滚）。 视觉连续性由 offset 补偿实现：滑动瞬间 DOM 内容整体左移一条，先把 `offset += step`（并 clamp ≤ 0） 抵消视觉跳变，再把目标设为 base，由现有 rAF 缓出从补偿后的 offset 平滑滚回 base——每次滑动只前进一条， 位移不累积。原型页新增「长会话（210 条）」入口用于复现与核验。

## D-frontend-060@v1 2026-10-23-session-first-load-ux——用户痛点：进入会话面板，轮次列表出现慢（大会话多等数秒）且加载中无任何动态指示。
状态：implemented
变更：2026-10-23-session-first-load-ux
原编号：D-000@v1
锚点：.sillyspec/changes/archive/2026-10-23-session-first-load-ux/design.md
文件：docs/sillyspec/active-pitfalls.md, docs/sillyspec/edit-patch-tool-use-id-missing.md, frontend/src/components/daemon/__tests__/turn-timeline-history-loading.test.tsx, frontend/src/components/daemon/file-changes/__tests__/turn-file-diff.test.ts, frontend/src/components/daemon/file-changes/turn-file-diff.ts, frontend/src/components/daemon/session-panel/__tests__/initial-window-merge.test.ts, frontend/src/components/daemon/session-panel/__tests__/session-first-load-staged.test.tsx, frontend/src/components/daemon/session-panel/initial-window-merge.ts, frontend/src/components/daemon/session-panel/session-panel-page.tsx, frontend/src/components/daemon/turn-timeline.tsx
最近确认：未记录
理由：用户痛点：进入会话面板，轮次列表出现慢（大会话多等数秒）且加载中无任何动态指示。根因两条： 1. **渲染门槛被 2026-10-23-session-first-window-turn-align 拉高**——establish() 内底窗日志（400 行）返回后还要串行走 buildInitialWindow（probe → 锚点轮直达 ≤2000 行 → 并行补 8 轮 ≤8×2000 行，3 个串行 RTT），全部完成才 setTurnState 首次渲染；大会话（40+ 轮、上万行日志）明显变慢。 2. **加载态缺失**——详情返回后、历史在飞时，TurnTimeline 在 `turns.length === 0` 分支渲染静态空态文案（「XX 已就绪」），无任何加载动画，用户以为页面卡死。 方案（两段化 establish + 骨架屏）： - **FR-02 分阶段渲染**：establish() 拆两段。第一段：底窗日志到达 → 既有 logsToTurns 装配 → setTurnState 立即渲染 + 写底窗游标（hasEarlier 满页即真）；第二段：buildInitialWindow 照旧在后台跑（请求链、AbortSignal、失败回退语义零变化），完成后把窗口结果相对已渲染底窗的**新增行**（按 log id 差集：锚点轮直达补齐段 + earlierRuns 各轮）经 logsToTurns 装配成轮块 prepend 进 turnState（复用「加载更早」的头部拼接语义，同 run 跨块由 #e 变体机制天然承接），游标推进到 adaptive.cursorLog。SSE 建流时序不变（仍在补拉完成后，streamCursor 语义零风险）。 - **FR-01 骨架屏**：新增 `initialHistoryLoading` state（sessionId 变化置 true，establish 尾部置 false）；SessionPanelPage 给 TurnTimeline 传可选 prop；TurnTimeline 在 turns 为空且该 prop 为真时渲染 3 张轮次卡片形状骨架（antd Skeleton，经 ConfigProvider 主题 token 着色，动画自带），替代静态空态分支。dialog 模式（session-panel-dialog.tsx 独立实现）不传新 prop，行为不变（本变更不触达）。 选择该方案而非「整体取消补拉」：first-window-turn-align 的轮次对齐目标（首屏窗口起点不落轮中段、轮首 user_input 不丢）仍由第二段达成，只是渲染时机前移；最终窗口状态与现版一致。

## D-frontend-061@v1 2026-10-25-session-config-deferred-switch——答：根因是 `session-config-bar.tsx` 的 `executeSwitch` 在会话空闲态点选供应商/模型/档案时立即调 `injectSe
状态：implemented
变更：2026-10-25-session-config-deferred-switch
原编号：D-000@v1
锚点：.sillyspec/changes/archive/2026-10-25-session-config-deferred-switch/design.md
文件：docs/releases/2026-10-25-002-d21c3a70c.md, frontend/src/components/daemon/__tests__/session-panel-variant.test.tsx, frontend/src/components/daemon/session-panel/__tests__/config-change-line.test.ts, frontend/src/components/daemon/session-panel/page-helpers.tsx, frontend/src/components/daemon/session-panel/session-panel-page.tsx, frontend/src/components/daemon/turn-timeline.tsx, frontend/src/components/sessions/__tests__/session-config-bar.test.tsx, frontend/src/components/sessions/session-config-bar.tsx
最近确认：未记录
理由：答：根因是 `session-config-bar.tsx` 的 `executeSwitch` 在会话空闲态点选供应商/模型/档案时立即调 `injectSession(sessionId, "")`（空 prompt 静默切换），后端 `inject.py` 为其建一个空的切换 run；思考档位则是点选即 POST `set-thinking-level`。用户要求点选不立即生效。 方案：**纯前端暂存，零后端改动**（执行期 D-001 用户定调修订：暂存静默无标记 + 时间线切换说明行）。面板页（`session-panel-page.tsx`）持有暂存 state（provider/model/profile/thinking_level 四字段），传给 `SessionConfigBar` 受控显示；组件在空闲态点选时不再 `executeSwitch`，改为上抛 `onStagedSwitch` patch（静默——控件直接显示暂存值，无「待生效」标记、无 toast，D-001）；选回当前生效值即取消该字段暂存（组件持当前值判定 cancel flag）。发送路径（空闲直发 `sendFromQueue`、忙轮排队 `sendToServerQueue`、历史重发 `handleResend`）在 `injectSession` options 中并入暂存的 provider/model/profile，暂存档位先调 `setSessionThinkingLevel`（失败警告不阻塞），受理成功后清暂存并 invalidate `agentSessionDetail`。暂存为空时请求形态与现状逐字段一致（零回归）。运行中点选保持现状（后端忙轮排队，本就不建轮）；ended/provisional 行为不变。 切换说明行（FR-06 / D-001）：`SessionTurnView` 新增 `configChangeLine`，`TurnRow` 轮块顶部独占一行渲染（形态对齐 system_event 虚线药丸）。双链路生成共用 `page-helpers.buildConfigChangeLine` 纯函数：**实时路**——发送受理成功时面板以「会话当前生效值 ⊕ 暂存值」预置占位轮（发送方前端权威，含会话级模型覆盖维度）；**历史路**——`enrichDisplayTurns` 排序后相邻轮快照对比（whoLine 扩 `modelName` = 档案快照 model；供应商/档案维度）。run 快照无会话级模型覆盖列（后端确认），历史路的模型维如实缺失、由实时路补足，不编造。 依据：`frontend/src/components/sessions/session-config-bar.tsx`（executeSwitch/props 契约）、`frontend/src/lib/daemon/sessions.ts`（injectSession options / setSessionThinkingLevel）、`backend/app/modules/daemon/session/service/inject.py`（带切换字段的普通消息即时生效）、`session-panel-page.tsx`（发送三路径 + provisional 暂存先例 ql-20260823-008）。

## D-frontend-062@v1 2026-10-26-subagent-card-width-unify——2026-10-25-session-tab-visual-unify 把 agent 侧文本类信息块（TextSegmentView/PreambleSegm
状态：implemented
变更：2026-10-26-subagent-card-width-unify
原编号：D-000@v1
锚点：.sillyspec/changes/archive/2026-10-26-subagent-card-width-unify/design.md
文件：frontend/src/components/daemon/__tests__/task-line-assembler.test.ts, frontend/src/components/daemon/__tests__/turn-segment-views.test.tsx, frontend/src/components/daemon/session-log-assembler.ts, frontend/src/components/daemon/session-panel/session-panel-dialog.tsx, frontend/src/components/daemon/session-panel/session-panel-page.tsx, frontend/src/components/daemon/session-panel/turn-state.ts, frontend/src/components/daemon/turn-segment-views.tsx, frontend/src/lib/daemon/__tests__/session-stream-turn-phase.test.ts
最近确认：未记录
理由：2026-10-25-session-tab-visual-unify 把 agent 侧文本类信息块（TextSegmentView/PreambleSegmentView/CompactSegmentView/TurnTriggerView/file 段容器/旧路径正文）统一到 `max-w-[calc(100%-120px)]`，但**过程类组件漏网**——用户 2026-10-26 实证：子代理卡片、进度视图工具调用行仍铺满整行。本变更补漏：turn-segment-views.tsx 内五个过程组件根容器统一加限宽——SubagentBlockView 两分支（`w-full self-stretch` → `w-full max-w-[calc(100%-120px)] self-start`，self-stretch 撤除防 flex 父容器 stretch 反噬，对齐 file 段容器先例）、TeamWorkerBlockView（同款）、ToolRowView / ThinkingRowView（根 div `w-full` → `w-full max-w-[calc(100%-120px)]`）、StderrRowView（根加 `max-w-[calc(100%-120px)]`，原本无 w-full 但在 flex-col 父容器里被 stretch 铺满）。 选 calc 相对值而非固定像素上限：弹窗版/整页版/移动端容器宽度不同，口径沿用已归档变更的裁决（固定值会在窄容器越界）。

## D-frontend-063@v1 2026-10-26-subagent-task-meta-restore——生产实证（会话 83a96b92，2026-10-26 06:18 UTC）：daemon 同一毫秒批量落库四行（[TOOL_USE] Agent stdout
状态：implemented
变更：2026-10-26-subagent-task-meta-restore
原编号：D-000@v1
锚点：.sillyspec/changes/archive/2026-10-26-subagent-task-meta-restore/design.md
文件：frontend/src/components/daemon/__tests__/task-line-assembler.test.ts, frontend/src/components/daemon/__tests__/turn-segment-views.test.tsx, frontend/src/components/daemon/session-log-assembler.ts, frontend/src/components/daemon/session-panel/session-panel-dialog.tsx, frontend/src/components/daemon/session-panel/session-panel-page.tsx, frontend/src/components/daemon/session-panel/turn-state.ts, frontend/src/components/daemon/turn-segment-views.tsx, frontend/src/lib/daemon/__tests__/session-stream-turn-phase.test.ts
最近确认：未记录
理由：生产实证（会话 83a96b92，2026-10-26 06:18 UTC）：daemon 同一毫秒批量落库四行（[TOOL_USE] Agent stdout 投影 / tool_call JSON（尾部 tool_use_id） / [TASK_STARTED]（parent 归属列） / [TOOL_RESULT] async 回执），DB 无二级排序键，历史回放喂入顺序不定——[TASK_STARTED] 先于 tool_call 段建立时 task 分支 findToolById 未命中即丢弃，段元数据（taskStatus/taskAsync）永久丢失；随后 async 回执按"桶内最近未配对 tool 段"配对把段翻成假终态（ok + 8~11 秒 endedAt 差值），metaStatus 优先级压不住 → 用户看到子代理卡片假"已完成"+ 冻结假时长（本地真实数据复现铁证：三段 taskStatus=null / durationText "00:08"/"00:11"）。 修法（装配器单文件内聚）：悬挂回填——task 分支 targetId 未命中且行带 parent_tool_use_id 时不再丢弃，写入 turn 链共享悬挂表（新 symbol PENDING_TASK_METAS，Map<parentToolUseId, TaskLineMeta[]>，挂载/流转模式同 SUPERSEDED_SEG_IDS：enumerable symbol 键随对象展开流转，attachInternals/transferAssemblerInternals 同步携带）；tool_use 段建立点（tool_use case 建段 + 步骤 1 stub→tool 合并后的段）按 resolvedToolUseId 查悬挂表，按到达序逐条 applyTaskMeta 回填并删条目。显示层零改动——subagentHeaderOf 既有"元数据 > 段三态"优先级回填后自然压住假终态（FR-02 是验收不是新代码）。

## D-frontend-064@v1 2026-10-26-turn-phase-orphan-fallback——改 frontend/src/components/daemon/session-panel/turn-state.ts 的 applyTurnPhase 一处
状态：implemented
变更：2026-10-26-turn-phase-orphan-fallback
原编号：D-000@v1
锚点：.sillyspec/changes/archive/2026-10-26-turn-phase-orphan-fallback/design.md
文件：frontend/src/components/daemon/session-panel/session-panel-dialog.tsx, frontend/src/components/daemon/session-panel/session-panel-page.tsx, frontend/src/components/daemon/session-panel/turn-state.ts, frontend/src/lib/daemon/__tests__/session-stream-turn-phase.test.ts
最近确认：未记录
理由：改 frontend/src/components/daemon/session-panel/turn-state.ts 的 applyTurnPhase 一处：run_id 精确匹配（含 realRunId）未命中时，若 currentRunId 指向活跃轮（pending/running/interrupting）则把 {phase, at} 回退写入该轮，否则维持原丢弃。方案=「回退活跃轮」而非「暂存池」：借平台单会话单活跃 run 不变式（后端忙轮守卫+排队机制硬保证），零新增状态、零 TTL、零补写钩子；暂存池（缓存未命中事件+过期+两处补写）是补丁性质且复杂度更高，已与用户对比后否决。背景：生产实证（会话 221ac351）daemon 每轮正常上报（TRACE 记点成对）但事件跑赢 HTTP 响应（占位轮未换真实 run_id）时被前端按"孤 phase 丢弃"设计吞掉，间歇性永远卡「执行器已接收」超时警示；本机 daemon 事件路径快，竞态高发。

## D-frontend-065@v1 2026-10-26-worktree-group-collapse——Git 日志页「工作区更改」卡的三个分组头（更改/未纳入版本管理/已忽略）原为纯展示 div（箭头字符写死），改为可点击 button + 折叠状态：组件内加
状态：implemented
变更：2026-10-26-worktree-group-collapse
原编号：D-000@v1
锚点：.sillyspec/changes/archive/2026-10-26-worktree-group-collapse/design.md
文件：frontend/src/components/git-log/__tests__/worktree-changes-card.test.tsx, frontend/src/components/git-log/worktree-changes-card.tsx
最近确认：未记录
理由：Git 日志页「工作区更改」卡的三个分组头（更改/未纳入版本管理/已忽略）原为纯展示 div（箭头字符写死），改为可点击 button + 折叠状态：组件内加 `groupOpen` state（`{ changed: true, untracked: false, ignored: false }`——用户实测反馈要求后两组默认收起省屏），三个分组头换成与目录行同款的 ChevronRight 旋转箭头按钮（aria-expanded + data-testid），内容区按开合条件渲染；收起态头行右缘显示该组计数（N 个文件 / N 项），收起不丢信息量。选这个方案是因为分组折叠与目录折叠在卡内已是同构交互（StatusTreeRows 的 toggleDir 先例），零新增依赖。

## D-frontend-066@v1 2026-10-27-turn-phase-observability-monotonic——生产实证（2026-10-27 会话 7eff99e1，run 4f2e2cdd）：first_event 信号丢失后前端 phase 停 delivered
状态：implemented
变更：2026-10-27-turn-phase-observability-monotonic
原编号：D-000@v1
锚点：.sillyspec/changes/archive/2026-10-27-turn-phase-observability-monotonic/design.md
文件：frontend/src/components/daemon/session-panel/turn-state.ts, frontend/src/lib/daemon/__tests__/session-stream-turn-phase.test.ts, sillyhub-daemon/src/daemon.ts, sillyhub-daemon/tests/turn-phase-report.test.ts
最近确认：未记录
理由：生产实证（2026-10-27 会话 7eff99e1，run 4f2e2cdd）：first_event 信号丢失后前端 phase 停 delivered 干等 141 秒；排障时发现 daemon 上报是 fire-and-forget，**桥层**（session-manager 转发点 daemon.ts:4887 起，inject_received/first_event 等运行时 phase 的必经路）失败仅 debug 日志——生产 info 级不可见；创建链五步（daemon.ts:9537 reportTurnPhase）已有首警 warn 惯例， 桥层是漏网点。另评估确认：steering 忙轮注入时 backend 会为同活跃轮再发 dispatched/delivered， 前端 applyTurnPhase 无条件 last-write-wins 会把已推进 phase **退化回投递段**（first_event 每 run 防重不会重发 → 卡投递段直到终态）——显示退化真实存在，需单调守卫。 三项改动（daemon 前端各一点）： 1. **桥层失败首警**（daemon.ts:4914-4937 两处）：debug 前补 warnOncePhaseFailure（对齐 9537 惯例：首警 warn 同 (session_id, phase) 去重 + debug 明细并存，成功仍静默）。 2. **applyTurnPhase 单调守卫**（turn-state.ts）：词表九值定序，回退写（新 phase 序 < 现值序，双方均词表内）静默丢弃；前跳/同值覆盖/词表外值透传维持 last-write-wins。 3. **log 退位集合扩展**：retireDeliveryPhase 的集合从 {dispatched, delivered} 增 inject_received（AI 已输出的场合「消息已送达 AI」同样失去展示意义），函数名保留。

## D-frontend-067@v1 2026-10-27-turn-phase-stall-honest-ui——生产实证（2026-10-27 会话 7eff99e1）：会话忙时用户消息在 backend 排队/派发链路滞留 9 分钟（10:38 发出、10:47:36
状态：implemented
变更：2026-10-27-turn-phase-stall-honest-ui
原编号：D-000@v1
锚点：.sillyspec/changes/archive/2026-10-27-turn-phase-stall-honest-ui/design.md
文件：frontend/src/components/daemon/__tests__/turn-status-bar-phase.test.tsx, frontend/src/components/daemon/session-panel/turn-state.ts, frontend/src/components/daemon/turn-status-bar.tsx, frontend/src/lib/daemon/__tests__/session-stream-turn-phase.test.ts
最近确认：未记录
理由：生产实证（2026-10-27 会话 7eff99e1）：会话忙时用户消息在 backend 排队/派发链路滞留 9 分钟（10:38 发出、10:47:36 才注入 daemon，daemon.log 全程零 turn_phase 打点佐证）， 期间前端轮状态条唯一 phase=delivered 无限计时，用户等 141 秒截图误以为卡死。精确滞留 环节需 backend（腾讯云）日志，本变更只做纯前端显示层双兜底： 1. **停滞文案**（turn-status-bar.tsx）：dispatched/delivered 停留超 30 秒（沿用 PHASE_TIMEOUT_MS）时标签切 DELIVERY_STALL_LABEL「等待执行器开始处理」排队语义， 告知「尚未开始处理、可能在排队」而非干等计时；执行期阶段（skills_sync/spawning/…） 超时仍显词表文案，零变化。 2. **log 退位**（turn-state.ts）：log 事件有 DB 兜底必达——轮收到真实输出时仍挂的 dispatched/delivered 已失去展示意义，upsertTurn 内对 log 事件的 apply 结果统一过 retireDeliveryPhase 清除（page/dialog 双模式共用 upsertTurn 单点覆盖）。只清投递 两阶段，执行期阶段不越权清除。

## D-frontend-068@v1 2026-10-28-change-detail-sessions-source-fix——核查结论（云端生产库直接取证）：`2026-10-26-mobile-four-page-layout-fix` 在库层只挂 1 个会话（ee002255，真执
状态：implemented
变更：2026-10-28-change-detail-sessions-source-fix
原编号：D-000@v1
锚点：.sillyspec/changes/archive/2026-10-28-change-detail-sessions-source-fix/design.md
文件：backend/app/modules/agent/router.py, backend/app/modules/agent/tests/test_agent_sessions_include_ended.py, backend/app/modules/change/router.py, backend/app/modules/change/tests/test_change_sessions_cap.py, backend/app/modules/daemon/router/session_crud.py, backend/app/modules/daemon/tests/test_sessions_list_filters.py, backend/app/modules/platform_sync/router.py, backend/app/modules/platform_sync/tests/test_hits_cli_direct.py, backend/app/modules/session_attachment/service.py, backend/app/modules/session_attachment/tests/test_capability.py, backend/openapi.json, frontend/src/app/(dashboard)/workspaces/[id]/changes/[cid]/__tests__/page-back-to-list.test.tsx, frontend/src/app/(dashboard)/workspaces/[id]/changes/[cid]/__tests__/page-last-signal.test.tsx, frontend/src/app/(dashboard)/workspaces/[id]/changes/[cid]/__tests__/page-rename-title.test.tsx, frontend/src/app/(dashboard)/workspaces/[id]/changes/[cid]/__tests__/page-restore-assets.test.tsx, frontend/src/app/(dashboard)/workspaces/[id]/changes/[cid]/__tests__/page-sessions-source.test.tsx, frontend/src/app/(dashboard)/workspaces/[id]/changes/[cid]/__tests__/page-tabs.test.tsx, frontend/src/app/(dashboard)/workspaces/[id]/changes/[cid]/__tests__/page-team-toggle.test.tsx, frontend/src/app/(dashboard)/workspaces/[id]/changes/[cid]/page.tsx, frontend/src/components/changes/detail/__tests__/change-overview-side.test.tsx
最近确认：未记录
理由：核查结论（云端生产库直接取证）：`2026-10-26-mobile-four-page-layout-fix` 在库层只挂 1 个会话（ee002255，真执行该变更的会话，首条输入即手机截图附件），全库各变更挂 2-3 会话均正常——**关联没乱，乱的是显示**。桌面变更详情页 `page.tsx` 把 `listWorkspaceAgentSessions(workspaceId)`（工作区全量会话）塞给概览侧栏「会话」区（slice(0,3)）与审批卡「绑定会话」（sessions[0]），与该变更零关联；叠加首条输入为附件时标题显示 `[附件:<uuid>` 前 30 字，形成「乱七八糟」观感。移动端 `mobile-change-detail.tsx` 数据源本就正确，不动。 修复分两端：① 前端 `page.tsx` 数据源换成既有 `listChangeSessions(workspaceId, changeId)`（change_session_links 真实关联，与后端审批注入 `_notify_bound_session` 同源），侧栏状态列改中文标签；② 后端新增共享标题剥离 helper，change/agent 两处窗口查询消费，daemon 侧在读展示时消费（存量 title_fallback 列不重算、零迁移）。

## D-frontend-069@v1 2026-11-04-session-quota-pill-follow-provider——`frontend/src/components/sessions/ctx-usage-bar.tsx` 的 `QuotaPill` 目前把「选中供应商」只当排
状态：implemented
变更：2026-11-04-session-quota-pill-follow-provider
原编号：D-000@v1
锚点：.sillyspec/changes/2026-11-04-session-quota-pill-follow-provider/design.md
文件：frontend/src/components/daemon/session-panel/session-panel-page.tsx, frontend/src/components/sessions/__tests__/ctx-usage-bar.test.tsx, frontend/src/components/sessions/ctx-usage-bar.tsx
最近确认：3e91e3a44893f1cb98505f181e817b3857656980
理由：`frontend/src/components/sessions/ctx-usage-bar.tsx` 的 `QuotaPill` 目前把「选中供应商」只当排序提示，胶囊面固定取 `sortedEntries[0]`（全量可查供应商里排第一的），选中供应商不可查时它根本不在 `entries` 里，于是面就落到别家。改为两级展示源： 1. **有选中供应商**：胶囊面严格用该供应商的条目（`entries.get(providerId)`）；该供应商不可查或本轮无数据时，面渲染短状态「不支持」/「无数据」（供应商名与完整说明在 title 与浮层，D-001），不再取别家数据。浮层第一节固定是该供应商（有数据列明细，无数据列状态说明），其余可查供应商按名称序跟在后面。 2. **无选中供应商（本机默认）**：完全保留现有聚合行为（面取排序第一家、空数据灰字提示）。 页面接线（`session-panel-page.tsx`）把会话态传入的 `providerId` 改为「配置条暂存值优先」，经导出纯函数 `resolveQuotaPillProviderId(staged, session)` 解析：暂存有定义时用其值（空串=本机默认→null），否则用 `session.llm_provider_id`。这样配置条切换供应商（暂存、未发送）时胶囊立即跟随。预会话态已传 `preProviderId`，天然跟随。 供应商目录改用 `listUsableProviders()`（自己的 + 共享给自己的），与会话配置条候选同源：选中共享供应商时也能解析到它，按「不支持」展示且不发起额度查询（额度端点仅属主可查，接收方查询必失败），绝不回落聚合显示自己的别家额度（评审 P1 修复）。 查询集合：只对「非共享且 `detectUsageProvider` 非空」的供应商发起 quota/usage 请求；选中供应商不可查/共享时不额外请求，直接从 `listUsableProviders` 结果判定并渲染状态。
