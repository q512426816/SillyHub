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
