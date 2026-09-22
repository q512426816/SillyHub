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
