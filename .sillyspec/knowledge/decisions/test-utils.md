# 决策知识 — test-utils

> decision-distill 从变更 decisions.md 幂等提炼（「最近确认」= 归档时 HEAD）。条目字段行为 docs-check 机械解析契约，勿手改。

## D-test-utils-001@v1 2026-09-27-session-fast-replay——诊断（双子代理调研实证）：回显慢的根因是「按日志行翻页」而非「按轮」——44 轮会话 1.1 万条日志，400 条/页需几十次串行往返；每条日志含 tool r
状态：implemented
变更：2026-09-27-session-fast-replay
原编号：D-000@v1
锚点：.sillyspec/changes/archive/2026-09-27-session-fast-replay/design.md
文件：.zcode/skills/sillyspec-quick/SKILL.md, backend/app/modules/agent/schema.py, backend/app/modules/change/parser.py, backend/app/modules/change/schema.py, backend/app/modules/change/service.py, backend/app/modules/change/tests/test_enrich_projection.py, backend/app/modules/change/tests/test_parser.py, backend/app/modules/change/tests/test_timeline.py, backend/app/modules/change/timeline.py, backend/app/modules/daemon/router/__init__.py, backend/app/modules/daemon/router/session_insights.py, backend/app/modules/daemon/schema.py, backend/app/modules/daemon/tests/test_session_fast_replay.py, backend/app/modules/daemon/tests/test_session_runs_endpoint.py, backend/openapi.json, docs/sillyspec/finished/2026-09-27-spec-sync-413-and-nested-runtime.md, docs/sillyspec/finished/change-birth-stage-scan-to-brainstorm.md, docs/sillyspec/finished/parallel-session-stale-snapshot-carried-in-commit-静默回滚.md, docs/sillyspec/finished/test-trace-extract-truncates-case-suffix-测试绑定用例名被截.md, frontend/src/app/(dashboard)/sessions/__tests__/page.test.tsx
最近确认：未记录
理由：诊断（双子代理调研实证）：回显慢的根因是「按日志行翻页」而非「按轮」——44 轮会话 1.1 万条日志，400 条/页需几十次串行往返；每条日志含 tool result 全文 TEXT（单页数 MB）；/runs 全量 500 条含 system_prompt 原文无 gzip 且每轮重拉；TurnCatalog 30px 窄轨命中区 18px 两次扩容仍被抱怨、600 轮密度失效、>500 轮截断。对标 deepseek-harness（本地源码调研）：打开只取尾页窗口（约 50 条消息）+ 服务端全轮大纲投影一次下发，点旧轮 loadThrough 直达；「秒开」= 少加载+服务端缓存，不是虚拟滚动。 方案（对齐该模式）：①后端新增 turn-outline 端点——runs 轻列全量 + 窗口函数抽每 run 首条 user_input/reply 摘要（PARTITION BY run_id, channel），进程内 LRU 缓存按数据指纹失效（hermes coldLogMemo 同款思路）；②/logs 增 run_id 单轮直达与 slim 截断（tool content 2000 字符 + content_truncated 标记），配套单条全文端点；③/runs 剥 system_prompt（前端实证仅消费 name）+ gzip；④前端打开并行 [大纲+尾页(slim)]，未加载轮点击 run_id 直达（interval 循环翻页退役为回退），触顶翻页保留；⑤TurnCatalog 重做常驻行式导航列（大纲全量数据源，未加载轮有摘要）。选此方案因为三层数据问题（分页单位/payload/投影缺失）与导航形态同根，仅调前端参数（方案 B）治标不治本。

## D-test-utils-002@v1 2026-10-07-ci-sweep-focus-visible-flake——frontend-ci 偶发失败（本轮修复提交 4dcce0b21 上一次，本地 ~1/20）：delete-change-confirm.test.tsx「o
状态：implemented
变更：2026-10-07-ci-sweep-focus-visible-flake
原编号：D-000@v1
锚点：.sillyspec/changes/archive/2026-10-07-ci-sweep-focus-visible-flake/design.md
文件：frontend/src/components/__tests__/delete-change-confirm.test.tsx
最近确认：未记录
理由：frontend-ci 偶发失败（本轮修复提交 4dcce0b21 上一次，本地 ~1/20）：delete-change-confirm.test.tsx「owner 本人在 PageHeader 右侧看到危险按钮」用例抛 nwsapi SyntaxError——jsdom cssom 级联匹配缺陷族（坑档案 docs/sillyspec/finished/active-antd-jsdom-has-deploy-login-account.md 已甄别为 jsdom 特有，真实浏览器原生 CSS 引擎不受影响）：getComputedStyle 对每条注册规则做 DOM 匹配，遇 antd Checkbox 的 focus-visible 现代伪类规则会把候选元素 tag+className 拼回选择器再查询，候选元素带含逗号/括号字符的 tailwind 任意值类时生成非法选择器（CI 实测 span.text-,,,,px,, 前缀）→ 偶发炸用例。修法照同族先例 agent-profile-form.test.tsx：文件级 stub window.getComputedStyle 返回空样式表阻断 cascade（本文件断言不依赖计算样式），注释完整引用机制与坑档案。选文件级 stub 而非全局 setup：缺陷按文件渲染面触发，先例即此口径，全局 stub 会掩盖其它文件真实样式依赖。

## D-test-utils-003@v1 2026-10-08-menu-permissions-page-audit——问题：2026-10-08-sessions-menu-permissions 修完 sessions 后，全站 38 菜单逐页对账发现另外 7 个菜单卡存在同
状态：implemented
变更：2026-10-08-menu-permissions-page-audit
原编号：D-000@v1
锚点：.sillyspec/changes/archive/2026-10-08-menu-permissions-page-audit/design.md
文件：frontend/src/lib/__tests__/menu-permissions.test.ts, frontend/src/lib/menu-permissions.ts
最近确认：未记录
理由：问题：2026-10-08-sessions-menu-permissions 修完 sessions 后，全站 38 菜单逐页对账发现另外 7 个菜单卡存在同类「页面实际接口鉴权与菜单卡权限不匹配」——页面需要的权限没挂卡（勾选器配不了或菜单可见性错位）：components（列表端点要 workspace:read）、changes（任务子页要 task:read）、knowledge（写按钮要 knowledge:write）、mcp（平台库写要 settings:admin）、approvals（agent-sessions/dialogs 列表要 task:read、权限面板要 task:run_agent）、audit（审计日志端点要 change:read，platform:audit:read 零消费）、incidents（上报按钮要 deploy:staging）。 方案：与 sessions 变更同款纯数据面补齐——只改 menu-permissions.ts 7 个菜单卡的 permissions 数组（既有 key 不删、门控主 key 保持首位）+ 同步测试断言。勾选器/菜单显隐/菜单管理页均消费同一数据源，改一处全生效。可见性语义仍为任一命中即可见，跨卡重复挂载（workspace:read/task:read/settings:admin/task:run_agent/change:read/deploy:staging 均已在其它卡）有 change:approve 等先例。

## D-test-utils-004@v1 2026-10-08-turn-nav-hover-mark——问题根因：`TurnNavList`（frontend/src/components/sessions/turn-nav-list.tsx）浮层行高亮只由 `a
状态：implemented
变更：2026-10-08-turn-nav-hover-mark
原编号：D-000@v1
锚点：.sillyspec/changes/archive/2026-10-08-turn-nav-hover-mark/design.md
文件：frontend/src/components/sessions/__tests__/turn-nav-list.test.tsx, frontend/src/components/sessions/turn-nav-list.tsx
最近确认：未记录
理由：问题根因：`TurnNavList`（frontend/src/components/sessions/turn-nav-list.tsx）浮层行高亮只由 `activeTurnKey`（聊天滚动联动当前轮）驱动，鼠标悬浮窄轨刻度（横条）展开浮层后，浮层内没有任何「鼠标正指向哪一轮」的标记——刻度本身不带轮号，用户无法建立横条与浮层行的对应关系。 方案：组件内新增 `hoverTurnKey` 本地 state（纯视觉态，props 契约不动）。窄轨刻度 button 与浮层行 button 均挂 `onMouseEnter` 写入该 key（单一指向源，最后进入者生效）；浮层行渲染命中时加细 ring 描边（`ring-1 ring-inset ring-brand-400` + `data-hovered` 测试锚点）——ring 描边与 active 行的底色高亮（`bg-muted/60` + inset brand 竖线）正交，同行叠加不冲突，语义上「描边=我在指它、底色=聊天当前停在哪轮」。滚动联动 effect 扩为指向优先（`hoverTurnKey ?? activeTurnKey`，`expanded` 进依赖让悬停展开瞬间补滚一次），指向清除后自动回落既有 active 联动。清除点收口在四个既有收起/离开路径：组件 mouseleave 的 250ms 防抖回调、pin 切换、组件外 pointerdown 收起、浮层行跳转收起。

## D-test-utils-005@v1 2026-10-10-dialog-qa-inplace——用户实证：SillySpec 断点七连问在同一轮内发生，对话视图把全部 ❓ 提问记录整组渲染在轮头部、agent 回复之前（`turn-timeline.tsx
状态：implemented
变更：2026-10-10-dialog-qa-inplace
原编号：D-000@v1
锚点：.sillyspec/changes/archive/2026-10-10-dialog-qa-inplace/design.md
文件：frontend/src/components/daemon/__tests__/turn-timeline-dialog-inplace.test.tsx, frontend/src/components/daemon/turn-timeline.tsx
最近确认：未记录
理由：用户实证：SillySpec 断点七连问在同一轮内发生，对话视图把全部 ❓ 提问记录整组渲染在轮头部、agent 回复之前（`turn-timeline.tsx` 旧块按 `run_id` 过滤后前置），时序全丢；「全部」视图早已按时间戳穿插（既有 `timeline` memo + 旧路径 `TurnDetailsList` 合并排序，注释明示该差异），对话视图是遗留旧路径。修法对齐「全部」视图既有约定：`SegmentedTurnBody` 新增 `convoTimeline` memo（对话段 `textSegments` 以 `segmentTsOf`、❓ 块以 `created_at` 为键，稳定排序缺 ts 视 0），对话流按合并序渲染；❓ 块标记抽出 `DialogQaBlock` 组件（视觉逐字不变）供 v2 穿插与旧回退两处复用；旧块门控收紧为 `segments === undefined`（孤儿轮/旧数据回退，行为不变）。不选「给 dialog 落一条 chat 日志行」——动数据写入链路面大且历史数据不回填，纯渲染层合并零数据改动。

## D-test-utils-006@v1 2026-10-10-single-turn-nav-and-jump-head——线上实证（会话 47e2ff1a，单 run 6969 行活跃流）：左侧轮次导航 `MIN_ENTRIES=3` 把单轮会话整条隐藏；触顶「加载更早」每页 40
状态：implemented
变更：2026-10-10-single-turn-nav-and-jump-head
原编号：D-000@v1
锚点：.sillyspec/changes/archive/2026-10-10-single-turn-nav-and-jump-head/design.md
文件：frontend/src/components/daemon/__tests__/page-helpers-enrich-api-duration.test.ts, frontend/src/components/daemon/__tests__/session-history-scroll.test.tsx, frontend/src/components/daemon/session-panel/page-helpers.tsx, frontend/src/components/daemon/session-panel/session-panel-page.tsx, frontend/src/components/sessions/__tests__/turn-catalog.test.tsx, frontend/src/components/sessions/__tests__/turn-nav-list.test.tsx, frontend/src/components/sessions/turn-catalog.tsx, frontend/src/components/sessions/turn-nav-list.tsx
最近确认：未记录
理由：线上实证（会话 47e2ff1a，单 run 6969 行活跃流）：左侧轮次导航 `MIN_ENTRIES=3` 把单轮会话整条隐藏；触顶「加载更早」每页 400 行 + prepend 锚定钉回原视口，慢服务器（2C，接口 1s+）上体感为「滚动不了、一直刷新、还是最后这点」，且面板重开进度归零（24h 内重开 19 次）。本变更两点： 1. **阈值放宽**：`turn-nav-list.tsx` 与 `turn-catalog.tsx` 的隐藏阈值 3 → 1（空数组仍不渲染），单轮会话显示「第1轮」导航，点击走既有 `onJump`/`handleJumpToTurn`。 2. **回到会话开头**：时间线顶部（`renderHistoryAndLocalReport` 位置）新增「回到会话开头」入口（仅 `hasEarlier=true` 渲染），点击后以 interval 轮询循环（40ms，对齐 `fallbackLoop` 惯例——纯 async/await 循环在生产环境有冻结前科 ql-20260916-014）连续驱动既有 `loadEarlierOnce()` 翻页，直至 `hasEarlierRef=false`（到头）或 50 页上限（toast 提示可再点）；到头后清 prepend 滚动锚（`pendingAnchorRef`/`anchorPinRef`，防 300ms 重申钉回）并双 rAF 后 `scrollTo(0)` 定位到最早内容。不选「修触顶手感/虚拟化」——无浏览器复现条件下动高测试密度滚动机制回归风险大，留给确证后的后续变更。

## D-test-utils-007@v1 2026-10-10-system-opened-turn-usermsg——用户实证（服务器 run 4296aa6a）：轮次由 [后台任务通知] 系统消息开启，跑 14 分钟 240 行输出后用户⚡中途注入「国际销售合同 不要动！」—
状态：implemented
变更：2026-10-10-system-opened-turn-usermsg
原编号：D-000@v1
锚点：.sillyspec/changes/archive/2026-10-10-system-opened-turn-usermsg/design.md
文件：frontend/src/components/daemon/__tests__/runtime-session-helpers.test.tsx, frontend/src/components/daemon/__tests__/steered-usermsg-guard.test.tsx, frontend/src/components/daemon/runtime-session-helpers.tsx, frontend/src/components/daemon/session-panel/session-panel-dialog.tsx, frontend/src/components/daemon/session-panel/session-panel-page.tsx
最近确认：未记录
理由：用户实证（服务器 run 4296aa6a）：轮次由 [后台任务通知] 系统消息开启，跑 14 分钟 240 行输出后用户⚡中途注入「国际销售合同 不要动！」——该消息成了此轮首条「有效」user_input，回放被提升为轮 prompt（顶部气泡）、实时被 prompt 补写路径写进 prompt，时序全丢。根因：系统通知行被 `extractPreambleText/stripPreambleText` 剥空后 `continue`，不占 prompt 槽，首条真实消息错误补位。修法最小侵入三处：①回放 `logsToTurns`——首条 user_input 剥空时压入一个占位空组（键含控制字符不可碰撞），prompt 保持空、真实消息自然落组 2+ 走既有 user_msg 段按 ts 插入链路；②共享函数 `appendDeliveredUserMsgIfAbsent` 守卫放宽（prompt 空 + 已有输出段 → 照常追加 delivered 段）；③page/dialog 两模式 prompt 补写加「新鲜轮（无输出段）」条件。不动后端/数据（时间戳本就正确），全部复用既有 user_msg 段渲染与插入机制。

## D-test-utils-008@v1 2026-10-11-mobile-subagent-drawer——用户实测：手机端会话页回显子代理内容时，内部会话整段内联刷进对话流。
状态：implemented
变更：2026-10-11-mobile-subagent-drawer
原编号：D-000@v1
锚点：.sillyspec/changes/archive/2026-10-11-mobile-subagent-drawer/design.md
文件：frontend/src/components/daemon/__tests__/session-panel-mobile-subagent.test.tsx, frontend/src/components/daemon/session-panel/session-panel-page.tsx
最近确认：未记录
理由：用户实测：手机端会话页回显子代理内容时，内部会话整段内联刷进对话流。根因：SubagentPanelContext 的挂载条件显式排除 mobile（session-panel-page `hasSubagentPanelHost = !mobile && onOpenSubagent != null`，2026-09-15 设计「移动端窄屏不做右栏」），无 context 时 SubagentBlockView 回退内联展开分支；且手机页宿主不传 portal 专属三 props（openSubagentId/onOpenSubagent/onSubagentPanelClose），槽位状态无处承载。修法最小侵入：①mobile 恒挂 Provider——宿主未传时用组件内状态（mobileSubagentId）承载开合（会话切换清槽），openSubagent/closeSubagent 收敛为统一槽位出口（context / 失效自动关 / 右栏 ✕ / Drawer 关闭共用）；②mobile 命中段时右侧滑出 antd Drawer（size min(92vw, 420px)，与移动端轮次导航 Drawer 同款用法）内嵌既有 SubagentDetailPanel——与 PC 右栏同一组件零复制，嵌套子代理单槽位换内容天然生效。desktop 分支（portal 三 props / 悬浮宿主回退）逐字不动。

## D-test-utils-009@v1 2026-10-12-ws-ref-emoji-inline——用户反馈（2026-10-12）：引用标签类型图标不要左上角悬浮，要一直回显在标签文字最前面。
状态：implemented
变更：2026-10-12-ws-ref-emoji-inline
原编号：D-000@v1
锚点：.sillyspec/changes/archive/2026-10-12-ws-ref-emoji-inline/design.md
文件：frontend/src/components/daemon/__tests__/attachment-refs.test.ts, frontend/src/components/daemon/__tests__/input-ref-overlay.test.tsx, frontend/src/components/daemon/__tests__/session-input-bar-upload.test.tsx, frontend/src/components/daemon/input-ref-overlay.tsx, frontend/src/components/daemon/session-input-bar.tsx, frontend/src/components/group-chat/__tests__/group-chat-panel.test.tsx, frontend/src/components/group-chat/group-chat-panel.tsx, frontend/src/components/sessions/__tests__/sessions-portal.test.tsx, frontend/src/lib/attachment-refs.ts
最近确认：未记录
理由：用户反馈（2026-10-12）：引用标签类型图标不要左上角悬浮，要一直回显在标签文字最前面。实现取 emoji 文本字符内嵌 token（`【📄 name】`，attachment-refs.ts 构造层统一落字：附件 📎 / 文件 📄 / 目录 📁 / 代码块 🧾）——这是唯一保住镜像高亮层「overlay 与 textarea 逐字符对齐」铁律的形态：emoji 是文本，占位文本与 textarea 天然同宽；lucide 等 inline 图标元素会撑宽背景块造成后续 token 累积漂移（2026-10-10 mx-px 教训），不可用。InputRefOverlay 删除左上类型角标渲染（KIND_ICON/data-ws-ref-kind-badge 退役）；悬停完整绑定提示改由宿主 hitTest 命中后经 hoverTip prop 渲染 fixed 气泡（overlay 层 pointer-events:none，原生 title 不可依赖）。

## D-test-utils-010@v1 2026-10-12-ws-ref-hover-tip-flip——用户反馈输入框标签的悬停路径浮层看不到。
状态：implemented
变更：2026-10-12-ws-ref-hover-tip-flip
原编号：D-000@v1
锚点：.sillyspec/changes/archive/2026-10-12-ws-ref-hover-tip-flip/design.md
文件：frontend/src/components/daemon/__tests__/input-ref-overlay.test.tsx, frontend/src/components/daemon/input-ref-overlay.tsx
最近确认：未记录
理由：用户反馈输入框标签的悬停路径浮层看不到。根因（浏览器实测定位）：会话输入框贴页面最底缘，标签悬停时鼠标 y 通常 >880，浮层定位在鼠标下方 16px（y+16）直接落到 940 高的视口之外（实测浮层 y=965）——DOM 存在但物理不可见，截图也拍不到。修复：浮层定位加「底部空间不足翻转到鼠标上方」逻辑（系统 tooltip 同款行为）——`y+16+TIP_EST_HEIGHT(48) > innerHeight` 时改为 `y-48-10`（顶部 clamp 8px）；同时 left 的视口 clamp 从 `-320` 对齐实际 max-width 改 `-336`。

## D-test-utils-011@v1 2026-10-12-ws-ref-hover-tip-portal——hover-tip-flip 修复上线后浏览器实测浮层仍不可见。
状态：implemented
变更：2026-10-12-ws-ref-hover-tip-portal
原编号：D-000@v1
锚点：.sillyspec/changes/archive/2026-10-12-ws-ref-hover-tip-portal/design.md
文件：frontend/src/components/daemon/__tests__/input-ref-overlay.test.tsx, frontend/src/components/daemon/input-ref-overlay.tsx
最近确认：未记录
理由：hover-tip-flip 修复上线后浏览器实测浮层仍不可见。决定性证据：元素 style.top=824px 而 getBoundingClientRect().top=965——偏移 141px，说明浮层的某页面祖先（布局/动画容器）带 transform 创建了 containing block，position:fixed 相对该祖先而非视口定位，按视口坐标计算的 clamp/翻转数学全部错位（此前偶尔可见是布局巧合）。修复：浮层 div 经 createPortal 挂 document.body——body 下无该祖先，fixed 恢复相对视口，坐标系归位。

## D-test-utils-012@v1 2026-10-13-session-changefiles-archive-gate——用户实测反馈：某变更已归档，悬浮面板仍显示「进行中」。
状态：implemented
变更：2026-10-13-session-changefiles-archive-gate
原编号：D-000@v1
锚点：.sillyspec/changes/archive/2026-10-13-session-changefiles-archive-gate/design.md
文件：frontend/src/components/daemon/__tests__/session-change-files-hover.test.tsx, frontend/src/components/daemon/session-change-files-hover.tsx
最近确认：未记录
理由：用户实测反馈：某变更已归档，悬浮面板仍显示「进行中」。根因：平台侧「已归档」是两套独立信号——`status='archived'`（CLI 归档 progress 上行 → ingest 落库/读时投影，平台设计明确「不动 location」）与 `location='archive'`（reparse 扫描文件系统目录收敛）；平台既有终态口径是**双条件**（`changes/page.tsx:226` isTerminalChange 注释「终态可测试定义」、`[cid]/page.tsx:68`、`mobile-change-detail.tsx:499` 三处同源），而本面板首版只认 `location` 单信号——归档信号只到 status 侧（或 location 未收敛）时误报「进行中」。修法：新增导出纯函数 `isArchivedChange(c) = c.status === "archived" || c.location === "archive"`，`splitByArchive`/`stageLabel`/弹窗 Select 选项 label 三处判定统一走它（对齐平台口径，与变更中心行为一致）。

## D-test-utils-013@v1 2026-10-13-session-changefiles-select-fix——用户实测反馈：会话页悬浮变更文件弹窗头部的切换下拉「选择不了」。
状态：implemented
变更：2026-10-13-session-changefiles-select-fix
原编号：D-000@v1
锚点：.sillyspec/changes/archive/2026-10-13-session-changefiles-select-fix/design.md
文件：frontend/src/components/daemon/__tests__/session-change-files-hover.test.tsx, frontend/src/components/daemon/session-change-files-hover.tsx
最近确认：未记录
理由：用户实测反馈：会话页悬浮变更文件弹窗头部的切换下拉「选择不了」。根因：radix Dialog 以 modal 模式打开时对 body 施加 `pointer-events: none`（仅在 DialogContent 子树内恢复），而 antd Select 下拉默认 portal 到 `document.body` 直挂节点——下拉项既点不动（pointer-events 被禁），点按又会被 radix 判定为弹窗外部交互（onPointerDownOutside）触发弹窗关闭，表现为「看得到、选不了」。方案：给 Select 配 `getPopupContainer={(trigger) => trigger.closest('[role="dialog"]') ?? document.body}`，把下拉 DOM 挂进 DialogContent（radix 弹窗节点，role="dialog"）内部——pointer-events 恢复、z 层级随弹窗、radix 不再视为 outside。顺带修标签文案：`is_thin` 徽标「轻量」与 thin 阶段映射「轻量变更」拼出「轻量·轻量变更」重复，按原型口径将 `current_stage === "thin"` 的阶段标签改为「干活中」。

## D-test-utils-014@v1 2026-10-13-session-scroll-layout-storm——现象：系统 Chrome 上会话页连续滚动（触顶自动加载 / 回到开头后快速滚到底）100% 单标签白屏崩溃（renderer 被杀）；ZCode 内置 web
状态：implemented
变更：2026-10-13-session-scroll-layout-storm
原编号：D-000@v1
锚点：.sillyspec/changes/archive/2026-10-13-session-scroll-layout-storm/design.md
文件：frontend/src/components/daemon/__tests__/session-history-scroll.test.tsx, frontend/src/components/daemon/session-panel/session-panel-page.tsx
最近确认：未记录
理由：现象：系统 Chrome 上会话页连续滚动（触顶自动加载 / 回到开头后快速滚到底）100% 单标签白屏崩溃（renderer 被杀）；ZCode 内置 webview 实测同路径全部稳定（内存峰值 56MB、DOM ~5800 节点）。Chrome 对主线程长挂起的 tab 有查杀机制，webview 无——这是可复现性差异的解释。 根因（代码实证）：`session-panel-page.tsx` onScroll 程序性滚动分支（非 isTrusted）同步调用 `anchorPinRef.current?.()`——apply 读 `row.offsetTop`（强制同步布局）+ 写 `el.scrollTop`（再派发 scroll 事件）→ 事件反馈环；Chrome 真实滚轮高频事件（10-30+/秒，惯性滚动持续派发）叠加触顶翻页 prepend 的高度突变，每秒可打满数百次全文档强制布局（scrollHeight 3.6 万 px、content-visibility 懒布局放大单次成本），主线程持续打满 → Chrome 判挂杀 tab。 方案：最小侵入的 rAF 合帧——钉回重申从 scroll 事件同步执行改为 requestAnimationFrame 合帧（同帧多次 scroll 只排一个回调，句柄判重），每帧至多一次 apply；用户真实滚动（isTrusted）弃锚时同步取消挂起 rAF，effect cleanup 一并清理。不选「删除钉回重申」（ql-20260916-019 引入它修视口被未知写入者拉走的实际问题，删除是行为回归）；不选「IntersectionObserver 重构 activeTurn 联动」（改动面大、非本次根因——联动已有 rAF 节流）；轮询合并（单页 4 份 useDaemonMachines 独立轮询）是确认存在但独立的背景负载问题，另立变更。

## D-test-utils-015@v1 2026-10-13-slim-subagent-false-running——根因（会话 f231ca18 实证）：2026-09-27-session-fast-replay 的 slim 截断把超 2000 字符的 tool_call
状态：implemented
变更：2026-10-13-slim-subagent-false-running
原编号：D-000@v1
锚点：.sillyspec/changes/archive/2026-10-13-slim-subagent-false-running/design.md
文件：backend/app/modules/agent/schema.py, backend/app/modules/daemon/router/session_insights.py, backend/app/modules/daemon/tests/test_session_fast_replay.py, backend/openapi.json, frontend/src/components/daemon/__tests__/runtime-session-helpers.test.tsx, frontend/src/components/daemon/__tests__/session-log-assembler.test.ts, frontend/src/components/daemon/__tests__/subagent-async-derive.test.tsx, frontend/src/components/daemon/__tests__/turn-segment-views.test.tsx, frontend/src/components/daemon/runtime-session-helpers.tsx, frontend/src/components/daemon/session-log-assembler.ts, frontend/src/components/daemon/turn-segment-views.tsx, frontend/src/components/daemon/turn-status-bar.tsx, frontend/src/lib/agent.ts, frontend/src/lib/api-types.ts
最近确认：未记录
理由：根因（会话 f231ca18 实证）：2026-09-27-session-fast-replay 的 slim 截断把超 2000 字符的 tool_call JSON 截残，前端 `parseToolUseRaw`/`statusFromToolUseRaw` 解析失败拿不到 `tool_use_id` → 子代理日志路由不进派发 tool 段、跌落为 `subagent_stub`，而 stub 状态在渲染层写死 running（turn-segment-views.tsx subagentStatus）→ 已结束会话永久「运行中」；同因连锁：regroupSubagentLogsByParent 登记失败（跨 run 终态行不重挂）、[TASK_*] 元数据路由失败（findToolById 不中）。 方案 A（主修，传输层回传配对键）：后端 slim 截断分支在截断**前**对完整原文做一次 `json.loads`，解析出的 `tool_use_id` 写入 `AgentRunLogEntry` 新可选字段 `tool_use_id`（仅在「该行被截断」时设置，其余路径恒 null）。前端三处消费：① `AssemblerLogInput` 增可选 `toolUseId`，装配器 tool_use 分支在行内解析失败时回退采用（段 id / extractStubById 合并键 / ids 登记同源）；② `toAssemblerInput` 透传；③ `regroupSubagentLogsByParent` 登记回退。选此方案因为：改动集中（后端 1 处截断点 + 前端 3 处回退点）、一次性修好所有存量历史会话、不动 slim 传输优化的性能收益。 方案 C（兜底，数据病理中性化）：`logsToSegments` 批量装配收尾时给仍残留的 `subagent_stub` 标记 `orphaned: true`（历史批量结束时 stub 必然意味着派发行缺失/不可解析）；渲染层 `subagentStatus` 对孤儿 stub 返回 "stopped"（灰点、无脉冲、无「运行中」文案，不渲染状态徽标药丸）。实时路径（applyLogToSegments 逐条）不标记，暂态 stub 行为零变化。

## D-test-utils-016@v1 2026-10-13-turn-nav-initial-scroll——上一变更（2026-10-13-turn-nav-rail-overflow-fix）让窄轨轨内滚动真正生效后暴露 P3 留债：长会话首屏轨道 scrollTo
状态：implemented
变更：2026-10-13-turn-nav-initial-scroll
原编号：D-000@v1
锚点：.sillyspec/changes/archive/2026-10-13-turn-nav-initial-scroll/design.md
文件：frontend/src/components/sessions/__tests__/turn-nav-list.test.tsx, frontend/src/components/sessions/turn-nav-list.tsx
最近确认：未记录
理由：上一变更（2026-10-13-turn-nav-rail-overflow-fix）让窄轨轨内滚动真正生效后暴露 P3 留债：长会话首屏轨道 scrollTop 停在顶部，当前轮（最新）刻度沉在可视区外。根因是滚动联动 effect 的 mountedRef 守卫「首次渲染不滚」——这是 2026-09-08-session-turn-nav（design §5）TurnCatalog 刻度居中形态时代的决策（当时轨道满铺居中、无滚动，首渲滚动无意义），窄轨+轨内滚动形态下语义反转：首渲恰恰最需要对齐 active。 修复为删除 mountedRef 守卫（turn-nav-list.tsx 滚动联动 useEffect），让 effect 首挂载即执行：focusKey = hoverTurnKey ?? activeTurnKey，命中 [data-turn-key] 的窄轨刻度 scrollIntoView({ block: "nearest" })；activeTurnKey 为 null 时 focusKey 为空自然短路不滚。选此方案因为改动最小（删 5 行守卫）、与既有变化联动共用同一条 effect 路径（无双机制）、block:"nearest" 保证短会话（刻度本就全可见）零滚动位移。旧组件 turn-catalog.tsx（未挂载、仅回退保留）的「首渲不滚」语义不动。

## D-test-utils-017@v1 2026-10-13-turn-nav-rail-overflow-fix——根因是窄轨 flex 钳制链断裂：desktop 挂载行（`session-panel-page.tsx` 外层 `flex min-h-0 flex-1`，行
状态：implemented
变更：2026-10-13-turn-nav-rail-overflow-fix
原编号：D-000@v1
锚点：.sillyspec/changes/archive/2026-10-13-turn-nav-rail-overflow-fix/design.md
文件：frontend/src/components/sessions/__tests__/turn-nav-list.test.tsx, frontend/src/components/sessions/turn-nav-list.tsx
最近确认：未记录
理由：根因是窄轨 flex 钳制链断裂：desktop 挂载行（`session-panel-page.tsx` 外层 `flex min-h-0 flex-1`，行高=面板剩余高度）→ root `turn-nav-column` 交叉轴 stretch 高度=行高，但中间层 `turn-nav-rail` 带 `shrink-0` 且高度 basis auto——轮次内容总高（把手 36px + N×11px）超过面板高时轨道拒绝收缩、直接溢出 root（root 无 overflow 裁切），刻度叠到输入区/底部配置条上；nav 的 `flex-1 min-h-0 overflow-y-auto` 因 rail 高度恒等于内容高度而拿不到高度钳制，轨内滚动永不生效。 修复取最小改动：`turn-nav-rail` 去掉 `shrink-0`（保留 `min-h-0`），让 rail 可收缩到面板高、nav `flex-1+overflow-y-auto` 真正生效，超出轮次轨内滚动；nav 补 `[scrollbar-width:none] [&::-webkit-scrollbar]:hidden`（与 turn-catalog.tsx:226 同款）避免 Windows 露滚动条。选此方案因为与既有工作先例 turn-catalog（nav 直接被 stretch 行钳制）机制等价，两处 className 改动、少量轮次 flex-basis auto 形态零变化。

## D-test-utils-018@v1 2026-10-13-write-tool-diff——会话面板 Write 工具展开区此前只渲染纯文本全文（`<pre>`），diff 渲染只接给了 Edit 分支。
状态：implemented
变更：2026-10-13-write-tool-diff
原编号：D-000@v1
锚点：.sillyspec/changes/archive/2026-10-13-write-tool-diff/design.md
文件：frontend/src/components/daemon/__tests__/tool-args-detail.test.tsx, frontend/src/components/daemon/__tests__/turn-segment-views.test.tsx, frontend/src/components/daemon/tool-args-detail.tsx
最近确认：未记录
理由：会话面板 Write 工具展开区此前只渲染纯文本全文（`<pre>`），diff 渲染只接给了 Edit 分支。数据侧 `edit_patch`（SDK `tool_use_result.structuredPatch` 序列化）的抓取与配对链路本就不限工具名（backend sdk_pipeline.py / daemon claude-events.ts 抓取，session-log-assembler.ts 配对写入 `segment.editPatch`），Write 覆盖已有文件时数据现成，纯属性前端没接线。 故只改 `frontend/src/components/daemon/tool-args-detail.tsx` 一处：`WriteArgsDetail` 接 `segment.editPatch` 走 `parseStructuredPatch`→`DiffView`（与 Edit 完全同管线）；无 patch（新建文件 type:"create" 天然无 structuredPatch、非 claude provider 无此通道）回退整文件按新增行全绿展示。实证依据：本机 Claude Code 会话 JSONL 抽样，structuredPatch 仅 Edit 与 Write 覆盖写（type:"update"）携带。

## D-test-utils-019@v1 2026-10-14-ci-flaky-probe-mock——frontend-ci 在 d850b45fe 仍红：`session-history-scroll.test.tsx`「连续 before 翻页到头」`exp
状态：implemented
变更：2026-10-14-ci-flaky-probe-mock
原编号：D-000@v1
锚点：.sillyspec/changes/archive/2026-10-14-ci-flaky-probe-mock/design.md
文件：frontend/src/components/daemon/__tests__/session-history-scroll.test.tsx
最近确认：未记录
理由：frontend-ci 在 d850b45fe 仍红：`session-history-scroll.test.tsx`「连续 before 翻页到头」`expected 3 to be 2`。本地插桩实证：0bd70bc47（2026-10-13-load-earlier-full-turn）给满页翻页新增 limit=1 页顶探查（轮边界对齐）后，该用例真实 API 序列 = 翻页(400) → 探查(1) → 翻页(400)，共 3 次 before 调用；探查 push 使计数在微任务级窗口内短暂为 3，而断言 `waitFor(toBe(2))` 依赖「探查 push 后、翻页#2 push 前」的瞬态窗口命中 2——本地快机碰巧命中，CI 慢机必挂。属测试 mock 未适配探查请求形态（同文件 105 行先例已适配：空响应不进游标记账），非生产缺陷。 修法：FR-03 用例 mock 照抄 105 行先例——`if (opts?.before && opts.limit === 1) return [];`（探查空响应、不 push），opts 类型补 `limit?: number`。修后计数只含翻页本体，单调升至 2 后恒定，断言命中终态。

## D-test-utils-020@v1 2026-10-14-session-bottom-grace-window——用户实测刷新落位随机（本机 19 轮复现 1 次），复现态特征完整锁定：scrollTop=602=布局早期瞬态假底、贴底判定 near 在加载期被某事件误清、
状态：implemented
变更：2026-10-14-session-bottom-grace-window
原编号：D-000@v1
锚点：.sillyspec/changes/archive/2026-10-14-session-bottom-grace-window/design.md
文件：frontend/src/components/daemon/__tests__/turn-timeline-scroll.test.tsx, frontend/src/components/daemon/turn-timeline.tsx
最近确认：未记录
理由：用户实测刷新落位随机（本机 19 轮复现 1 次），复现态特征完整锁定：scrollTop=602=布局早期瞬态假底、贴底判定 near 在加载期被某事件误清、RO 与 [turns] 贴底全死且无自愈路径。凶手路径低频竞态无法稳定复现定位（多轮写入审计在绿轮无异常）——放弃追凶，改加固式自愈：贴底记忆宽限窗（最近贴底 10s 内 + 无用户真实输入），期间任何内容变化/turns 提交强制钉底。不管谁误清 near，宽限窗内自动复活。

## D-test-utils-021@v1 2026-10-20-pill-dock-drag-align-keep——用户实测:左停靠的 pill 组拖拽过程中内容固定右对齐,松手吸附后才恢复。
状态：implemented
变更：2026-10-20-pill-dock-drag-align-keep
原编号：D-000@v1
锚点：.sillyspec/changes/archive/2026-10-20-pill-dock-drag-align-keep/design.md
文件：.gitignore, frontend/src/components/daemon/__tests__/session-floating-pill-dock.test.tsx, frontend/src/components/daemon/session-floating-pill-dock.tsx
最近确认：未记录
理由：用户实测:左停靠的 pill 组拖拽过程中内容固定右对齐,松手吸附后才恢复。根因:`onPointerMove` 的中间态走 `clampPos`,其返回值不携带吸附侧标记 `left`(2026-10-20-pill-dock-left-align 引入),渲染按 `pos.left` 缺省兜底 items-end。 方案:`clampPos` 返回值透传 `p.left`——拖拽中间态继承最近吸附态的侧别标记,渲染保持拖拽前对齐方向;松手吸附时 `snapPos` 重新判定并覆盖 left(既有行为)。核心改动一行,不新增状态、不动持久化格式。

## D-test-utils-022@v1 2026-10-22-sillyspec-probe-db-missing-evict——生产实证：平台已删除的工作区 `urgent`（root_path=/mnt/e/Java/crrc/qmdp/urgent）仍被 centos8 daemon
状态：implemented
变更：2026-10-22-sillyspec-probe-db-missing-evict
原编号：D-000@v1
锚点：.sillyspec/changes/archive/2026-10-22-sillyspec-probe-db-missing-evict/design.md
文件：backend/app/modules/daemon/router/session_crud.py, backend/app/modules/daemon/schema.py, backend/app/modules/daemon/tests/test_sessions_list_pending_dialog.py, backend/openapi.json, frontend/src/app/(dashboard)/sessions/__tests__/page.test.tsx, frontend/src/components/daemon/__tests__/attachment-refs.test.ts, frontend/src/components/daemon/__tests__/message-queue-bar.test.tsx, frontend/src/components/daemon/__tests__/session-history-scroll.test.tsx, frontend/src/components/daemon/__tests__/session-input-bar-plus-menu.test.tsx, frontend/src/components/daemon/message-queue-bar.tsx, frontend/src/components/daemon/runtime-session-helpers.tsx, frontend/src/components/daemon/scheduled-messages-bar.tsx, frontend/src/components/daemon/session-input-bar.tsx, frontend/src/components/daemon/session-panel/session-panel-page.tsx, frontend/src/components/daemon/turn-timeline.tsx, frontend/src/components/sessions/__tests__/ctx-usage-bar.test.tsx, frontend/src/components/sessions/__tests__/session-config-bar.test.tsx, frontend/src/components/sessions/__tests__/session-status-indicator.test.tsx, frontend/src/components/sessions/ctx-usage-bar.tsx, frontend/src/components/sessions/session-config-bar.tsx
最近确认：未记录
理由：生产实证：平台已删除的工作区 `urgent`（root_path=/mnt/e/Java/crrc/qmdp/urgent）仍被 centos8 daemon 持久化在 `sillyspec-status-roots.json` 反复探测；该仓未初始化进度库，`sillyspec progress show --json` 恒定 exit 2（envelope `codes=['db_missing']`），daemon 记瞬态失败并进 backoff，日志噪音与 `sillyspec_status_error` 常驻非空。 修法（全部在 daemon 侧，CLI 零改动）：`SillySpecManager._collectOneTarget` 在非零退出时解析 stdout envelope 的 `codes`——含 `db_missing` 视为「项目侧永久缺库」，按 cwd 计连败，连败 3 次后把 cwd 加入进程内 skip 表并经新可选依赖 `statusRootEvict(workspaceId, cwd)` 通知 daemon 从 `_sillyspecStatusRoots` 删除条目并持久化 roots 文件（重启不再恢复）；淘汰路径不计瞬态失败、清心跳 map 槽位。同时在 nonzero_exit 日志附 stdout 首行，让「exit 2 到底是什么」不再靠猜。选择 stdout envelope 而非退出码细分，是因为 CLI 已保证 `progress show --json` 失败时 stdout 恒为合法 JSON envelope（`runStatusOverview` 全路径），零协议改动即可拿到精确原因。

## D-test-utils-023@v1 2026-10-25-marquee-inactive-awaiting-fix——根因：「等待模型响应」合成条目假设组件处于**运行中**宿主（外部跑马灯由消费方门控只在运行中轮渲染）； 但子代理卡片在子代理终态后仍渲染内嵌流动条（Subag
状态：implemented
变更：2026-10-25-marquee-inactive-awaiting-fix
原编号：D-000@v1
锚点：.sillyspec/changes/archive/2026-10-25-marquee-inactive-awaiting-fix/design.md
文件：frontend/src/components/daemon/__tests__/turn-live-marquee.test.tsx, frontend/src/components/daemon/__tests__/turn-segment-views.test.tsx, frontend/src/components/daemon/turn-live-marquee.tsx, frontend/src/components/daemon/turn-segment-views.tsx
最近确认：未记录
理由：根因：「等待模型响应」合成条目假设组件处于**运行中**宿主（外部跑马灯由消费方门控只在运行中轮渲染）； 但子代理卡片在子代理终态后仍渲染内嵌流动条（SubagentBlockView 无条件挂载），latest 非 running 即触发等待条目—— 子代理早已结束，转圈永远不停。 修复：`TurnLiveMarquee` 新增 `active?: boolean`（默认 true）；`isAwaiting = active && latest.status !== "running"`， 等待 interval 依赖 isAwaiting（active=false 自然不启动）。`SubagentBlockView` 内嵌条传 `active={running}` （卡片自身状态：终态 → 无等待、条目显示总耗时）。外部消费点不传 active，零变化。

## D-test-utils-024@v1 2026-10-25-subagent-card-unify-panel——统一子代理卡片形态（用户裁决：去掉弹窗原地展开）： 1. **SubagentBlockView 删内联展开分支**：删除 open state、aria-ex
状态：implemented
变更：2026-10-25-subagent-card-unify-panel
原编号：D-000@v1
锚点：.sillyspec/changes/archive/2026-10-25-subagent-card-unify-panel/design.md
文件：frontend/src/app/proto/session-live-marquee/page.tsx, frontend/src/components/daemon/__tests__/session-panel-dialog-subagent-drawer.test.tsx, frontend/src/components/daemon/__tests__/session-panel-mobile-subagent.test.tsx, frontend/src/components/daemon/__tests__/turn-segment-views.test.tsx, frontend/src/components/daemon/session-panel/session-panel-dialog.tsx, frontend/src/components/daemon/turn-live-marquee.tsx
最近确认：未记录
理由：统一子代理卡片形态（用户裁决：去掉弹窗原地展开）： 1. **SubagentBlockView 删内联展开分支**：删除 open state、aria-expanded、children 原地渲染与 progressLine 展开区；无面板上下文时渲染同款头部纯展示（无按钮语义）。生产宿主中仅剩 回放体/悬浮助手等无 Provider 场景走纯展示（信息不丢，详情不可达为声明边界）。 2. **dialog 挂面板能力**：`session-panel-dialog` 增加 activeId 状态 + `SubagentPanelContext.Provider`（toggle/close/activeId，与 page 同一 context 值形状）； 段解析复用 `findSegmentById` DFS；详情出口为弹窗内 antd Drawer（右侧滑出， `min(92vw, 420px)`，与 page 移动端 Drawer 同构），内嵌既有 `SubagentDetailPanel`。 Drawer 而非固定右栏的原因：弹窗宽度不定，浮层不压缩消息流布局。 3. **卡片内嵌内部活动流（2026-10-25 用户澄清）**：`TurnLiveMarquee` 新增 `layout="inline"` 变体（无 ml-9、w-full、h-7、贴卡片底色、独立 testid）与可选 `testId` prop； `SubagentBlockView` 两分支在头部下方渲染 `<TurnLiveMarquee layout="inline" entries={deriveLiveMarqueeEntries(segment.children)} />` ——子代理内部过程在框内流动展示（运行中转圈/走秒/等待指示同外部机制）， children 为空不渲染。外部会话跑马灯维持上轮的容器条目（名称/状态/时间）。

## D-test-utils-025@v1 2026-10-27-sessions-panes-gap-remove——用户在 DevTools 指明元素 data-testid="sessions-portal-panes"（class 含 gap-3）——会话门户双栏容器栏间
状态：implemented
变更：2026-10-27-sessions-panes-gap-remove
原编号：D-000@v1
锚点：.sillyspec/changes/archive/2026-10-27-sessions-panes-gap-remove/design.md
文件：frontend/src/components/sessions/__tests__/sessions-portal.test.tsx, frontend/src/components/sessions/sessions-portal.tsx
最近确认：未记录
理由：用户在 DevTools 指明元素 data-testid="sessions-portal-panes"（class 含 gap-3）——会话门户双栏容器栏间 12px 横向空隙，属上轮七类点名样式中的 gap-3（当时因不在输入区链未动）。改法：sessions-portal.tsx:809 该容器 className 删 gap-3 一词，其余类不动。可行性依据：栏间分隔与拖拽由 PanelResizer 独立承担（自身 w-1.5=6px 条 + cursor-col-resize），不依赖容器 gap；删后列表栏/聊天栏/预览栏贴合，仅剩把手条分隔。补一条 panes 容器类名断言（上轮弱绑定教训）。

## D-test-utils-026@v1 2026-10-28-session-list-loadmore-fetch——对 2026-10-28-session-list-refresh-and-paging 的两处设计错误返工（用户实证 反馈：「点击怎么都没触发后端接口」「显示
状态：implemented
变更：2026-10-28-session-list-loadmore-fetch
原编号：D-000@v1
锚点：.sillyspec/changes/archive/2026-10-28-session-list-loadmore-fetch/design.md
文件：frontend/src/components/sessions/__tests__/session-list-panel.test.tsx, frontend/src/components/sessions/session-list-panel.tsx
最近确认：未记录
理由：对 2026-10-28-session-list-refresh-and-paging 的两处设计错误返工（用户实证 反馈：「点击怎么都没触发后端接口」「显示还有 28 条，点击只加载 1 条变还有 27 条」），改动收敛在 session-list-panel.tsx： 1. **递增计数语义改「跳过已显示」**：visibleGroupSessionsWithExtra 从 「head=10+extra ∪ 在线全显」改为 filter 预算计数——默认展示（前 10 ∪ 在线全显）之外的条目按服务端序给 extra 个预算，每点一次 +20 恰好新增 20 条**此前未显示**的行（原实现 head 扩 20 的位置被默认已显示的在线 条目占据，净增可能只有 1——「还有 28→还有 27」实证根因）。 2. **点击即触网**：组内「加载更多」点击时若服务端总数 > 已加载数，立即调 loadMoreSessions（相同筛选参 offset 续拉，**每次 20 条**，续拉步长从 500 收敛为 20——用户拍板「每次点击加载更多在无限加载每次 20 条」）； 树底部入口同一函数。首屏仍 limit=500 一次拉（树分组基础不动）。

## D-test-utils-027@v1 2026-10-29-floating-scope-loadmore-fix——问题根因：`frontend/src/components/floating/floating-session-host.tsx:578` 以内联对象传 `sc
状态：implemented
变更：2026-10-29-floating-scope-loadmore-fix
原编号：D-000@v1
锚点：.sillyspec/changes/archive/2026-10-29-floating-scope-loadmore-fix/design.md
文件：frontend/src/components/sessions/__tests__/session-list-panel.test.tsx, frontend/src/components/sessions/session-list-panel.tsx
最近确认：未记录
理由：问题根因：`frontend/src/components/floating/floating-session-host.tsx:578` 以内联对象传 `scope`（`lockedRuntime ? { kind: "runtime", runtimeId: lockedRuntime.id } : undefined`），宿主每次重渲染产生新引用；`b9949cdbf` 在 `session-list-panel.tsx` 新增的附加段清理 effect 以 `[scope, isArchivedView, assocFilter]` 为依赖（React `useEffect` 用 `Object.is` 引用比较），宿主重渲染即误判「口径变化」→ `setExtraItems([])` 清附加段 + `extraOffsetRef` 游标归 null——锁定 runtime 悬浮面板点「加载更多会话」拉回的条目随宿主重渲染消失、计数回跳、再点从首屏 offset 重复拉取。 修法（根修在消费组件，对所有调用方免疫）：`session-list-panel.tsx` 新增模块级纯函数 `sessionScopeStableKey(scope)`——按判别联合四个分支（workspace/change/runtime/quicklog）拼 `kind` + 全部标识字段（workspaceId/changeId/runtimeId/qlId）的标量串；清理 effect 的依赖把 `scope` 对象换成该稳定键。同值新引用 → 键相等 → effect 不触发（附加段/游标保留）；口径真实变化（kind 或任一标识字段变）→ 键变 → 照旧清空复位。不动 floating-session-host（消费端单点修只保一个入口，且组件自身对引用不稳定免疫后该传参模式无害——react-query queryKey 走结构化哈希本就不受引用影响，全仓唯一落坑点就是这个 effect）；不动 `listParamsBase` 的 useMemo 依赖（scope 引用不稳定时它内容不变地重建，无行为影响，最小改动面）。

## D-test-utils-028@v1 2026-10-30-marquee-awaiting-loop-scroll——现状（frontend/src/components/daemon/turn-live-marquee.tsx MarqueeItemView）：条目内 tic
状态：implemented
变更：2026-10-30-marquee-awaiting-loop-scroll
原编号：D-000@v1
锚点：.sillyspec/changes/archive/2026-10-30-marquee-awaiting-loop-scroll/design.md
文件：frontend/src/components/daemon/__tests__/turn-live-marquee.test.tsx, frontend/src/components/daemon/turn-live-marquee.tsx
最近确认：未记录
理由：现状（frontend/src/components/daemon/turn-live-marquee.tsx MarqueeItemView）：条目内 ticker 为单份文本，rAF 从 offset=0 一次滚到 `marqueeTickerEnd(textWidth, viewWidth) = min(0, viewWidth - textWidth)`（文本末尾贴窗口右缘）即停。用户实测终态出现"末尾后一大段空白"（测量宽度与视觉宽度不一致的残局），且一次滚到末尾即停对每秒都在变的等待状态文本（秒数/token/30s 提示语追加）语义不佳——屏上常驻的恰是信息量最低的尾部提示语。 方案：MarqueeItemView 增加可选 prop `scrollMode: "once" | "loop"`（默认 "once"）；"loop" 模式渲染双份相同文本（第二份 aria-hidden，带固定间隔 padding，如 48px），rAF 以恒速 TICKER_LOOP_SPEED=72px/s 向左平移，offset ≤ -周期宽度时加回周期宽度无缝回卷（窗口内第一份末尾与第二份开头内容相同，视觉连续、永无空白区段）。跑马灯宿主渲染 marquee-awaiting 条目处传 `scrollMode="loop"`。回卷折算逻辑提为纯函数 wrapLoopOffset 供单测。

## D-test-utils-029@v1 2026-11-04-steered-msg-attachment-chips——缺陷点在渲染层：`UserMsgSegmentView`（`frontend/src/components/daemon/turn-segment-views.
状态：implemented
变更：2026-11-04-steered-msg-attachment-chips
原编号：D-000@v1
锚点：.sillyspec/changes/2026-11-04-steered-msg-attachment-chips/design.md
文件：frontend/src/components/daemon/__tests__/turn-segment-views-user-msg-attachments.test.tsx, frontend/src/components/daemon/turn-segment-views.tsx
最近确认：3e91e3a44893f1cb98505f181e817b3857656980
理由：缺陷点在渲染层：`UserMsgSegmentView`（`frontend/src/components/daemon/turn-segment-views.tsx`）只取 `parseAttachmentMarkers(segment.text).text`，把同一次解析得到的 `attachments` 丢弃，导致引导消息 （mid-turn steer）气泡上不出现附件卡片。上游数据链路已完整：后端 inject 在 user_input 留痕头部写 `[附件:<uuid>|<kind>|<name>]`（`backend/app/modules/daemon/session/service/inject.py` 附件标记段）， 前端引导发送在展示文本里拼同样的标记行并上送 `attachment_ids` （`session-panel-dialog.tsx` 的 submitFollowup / sendToServerQueue），历史回放装配保留 marker 版本 （`runtime-session-helpers.tsx` 的 `withMarker` 优先）。 做法：在 `UserMsgSegmentView` 内保留完整解析产物，按 phase 选择 chips 色调后渲染既有 `AttachmentChips`（图片缩略图 / 文件 chip / 点击预览全部复用，不新造组件）；正文容器只在 `text` 非空时渲染，纯附件引导消息呈现「chips + 状态行」。`AttachmentChips` 的 `tone` 只有 `onPrimary`（实色主气泡）与 `brand`（浅底）两档：delivered 用 onPrimary，steering / ended 用 brand。 三态共用同一份标记解析结果，不复制解析逻辑。

## D-test-utils-030@v1 2026-11-06-api-body-read-timeout——frontend/src/lib/api.ts 的 apiFetch：把超时计时器清理与外部 signal 监听移除从「fetch resolve（响应头到达）
状态：implemented
变更：2026-11-06-api-body-read-timeout
原编号：D-000@v1
锚点：.sillyspec/changes/2026-11-06-api-body-read-timeout/design.md
文件：frontend/src/lib/__tests__/api.test.ts, frontend/src/lib/api.ts
最近确认：5dc292626257ac2e75ef1dde91c08aa572515b88
理由：frontend/src/lib/api.ts 的 apiFetch：把超时计时器清理与外部 signal 监听移除从「fetch resolve（响应头到达）即执行」挪到「响应体读取完成后执行」，并为 `await resp.text()` 补异常归因（timedOut → code=timeout 走熔断计数；否则 network_error）。fetch 的 init.signal（timeoutController）按 fetch 规范对 body 流同样生效（abort 中断读取），因此无需为读体新建控制器——仅调整既有清理时点 + 读体异常按既有错误语义归因。调试期实证发现并同步修复一个连带缺陷：原 finally 在 fetch 后即移除外部 signal 监听，外部 abort 在读体阶段不再传导（streamSession resync 等调用方契约要求可中断）——监听器移除一并挪到读体完成后。
