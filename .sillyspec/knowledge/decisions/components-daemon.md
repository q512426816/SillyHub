# 决策知识 — components-daemon

> decision-distill 从变更 decisions.md 幂等提炼（「最近确认」= 归档时 HEAD）。条目字段行为 docs-check 机械解析契约，勿手改。

## D-components-daemon-001@v2 变更计数徽标双色——蓝=blue-* 固定阶真信息蓝
状态：implemented
变更：2026-10-26-session-change-progress-hover
原编号：D-012@v2
锚点：frontend/src/components/daemon/session-change-files-hover.tsx:211
最近确认：33f4154a3
理由：有未完成（active>0）时徽标改蓝；无未完成（active=0，仅剩归档）保持绿色（完成态语义）。蓝色用 **blue-* 固定阶**（本场景是 CLAUDE.md 规则 20 的"真信息蓝"语义，不随主题换肤）——semantic.info 不可用（两主题下均为青，themes.ts D-003@v2"info 不再是蓝"）。
supersedes：D-012@v1

## D-components-daemon-002@v1 2026-10-10-att-ref-badge-hover——问题：编辑态引用标签的 × 角标常显，视觉噪音大；用户要求悬停标签才显示。
状态：implemented
变更：2026-10-10-att-ref-badge-hover
原编号：D-000@v1
锚点：.sillyspec/changes/archive/2026-10-10-att-ref-badge-hover/design.md
文件：frontend/src/components/daemon/__tests__/input-ref-overlay.test.tsx, frontend/src/components/daemon/input-ref-overlay.tsx, frontend/src/components/daemon/session-input-bar.tsx, frontend/src/components/group-chat/group-chat-panel.tsx
最近确认：未记录
理由：问题：编辑态引用标签的 × 角标常显，视觉噪音大；用户要求悬停标签才显示。 关键约束：镜像高亮层位于 textarea **下方**（z 序），标签文字区域被 textarea 覆盖，纯 CSS `:hover` 在 span 上永不触发（指针事件被 textarea 截获），也不能给 span 开 pointer-events（会挡住下方 textarea 的光标定位/选字）。 方案：**宿主 wrapper 级 pointermove 命中测试**。 附带修复（用户实测 2026-10-10）：token 占位 span 的 mx-px 外边距是多标签场景背景错位的根因（每标签多 2px 累积漂移，overlay 与 textarea 逐字符失配）——已移除并立守卫用例：占位 span 禁带 margin/padding 布局类，背景块只用 background+radius 零布局影响。InputRefOverlay 的每个 token 占位 span 带 `data-att-ref-occ`（出现序号）；新增导出 `hitTestAttRefOverlay(container, x, y)`——遍历这些 span 的 getBoundingClientRect（外扩 8px，覆盖右上角外挂的角标区），返回命中序号或 null。宿主（session-input-bar / group-chat-panel）在 overlay+textarea 的共同 wrapper 上挂 `onPointerMove`（React 合成事件从 textarea 冒泡到 wrapper）调 hitTest 写 `hoveredRefOcc` state，`onPointerLeave` 清空；`hoveredRefOcc` 经新 prop `visibleBadgeIndex` 传回 overlay——只有命中的角标 `opacity-100 + pointer-events-auto`，其余 `opacity-0 + pointer-events-none`（隐藏态不吃点击）。指针移到角标本体上时：外扩 8px 的命中区仍覆盖角标位置，状态不闪灭，可正常点击。

## D-components-daemon-003@v1 2026-10-12-ws-ref-atomic-caret——用户反馈：引用标签应是一个整体——当前光标能点进标签内部改字、左右移动被当普通文字逐字符穿过。
状态：implemented
变更：2026-10-12-ws-ref-atomic-caret
原编号：D-000@v1
锚点：.sillyspec/changes/archive/2026-10-12-ws-ref-atomic-caret/design.md
文件：frontend/src/components/daemon/__tests__/use-atomic-ref-caret.test.tsx, frontend/src/components/daemon/session-input-bar.tsx, frontend/src/components/daemon/use-atomic-ref-caret.ts, frontend/src/components/group-chat/group-chat-panel.tsx
最近确认：未记录
理由：用户反馈：引用标签应是一个整体——当前光标能点进标签内部改字、左右移动被当普通文字逐字符穿过。根因是 textarea 纯文本方案（D-001 架构）下 token 就是普通文本。本变更不动编辑器架构，新增公共 hook `use-atomic-ref-caret.ts` 以事件拦截补「整体感」：① 方向键跳块（无选区时 ←/→ 在标签区间边界一次跨过整块，shift 选区扩展不拦）；② 落位吸附（click/keyup/select 后光标无选区且在标签内部 → 吸附最近边界，兜底 Home/End/Ctrl+方向落入内部的情况）；③ 内部编辑拒绝（beforeinput 目标 range 与任一标签部分重叠且未完整覆盖 → preventDefault，覆盖打字/删字/IME 组字/粘贴；选区完整覆盖整块放行随选删除）。单聊与群聊两输入区同款接线；退格贴尾整删与 × 角标删除既有处理器不触碰。

## D-components-daemon-004@v1 2026-10-13-subagent-stub-reconcile——根因（浏览器实测 + 真实数据复现实证）：历史日志分页窗口（400 行）截断使子代理派发 tool_call 行落在窗口外 → 装配器为子代理消息创建 stub
状态：implemented
变更：2026-10-13-subagent-stub-reconcile
原编号：D-000@v1
锚点：.sillyspec/changes/archive/2026-10-13-subagent-stub-reconcile/design.md
文件：frontend/src/components/daemon/__tests__/subagent-task-reconcile.test.ts, frontend/src/components/daemon/__tests__/tool-args-detail.test.tsx, frontend/src/components/daemon/session-log-assembler.ts, frontend/src/components/daemon/session-panel/session-panel-page.tsx, frontend/src/components/daemon/subagent-detail-panel.tsx, frontend/src/components/daemon/turn-segment-views.tsx, frontend/src/hooks/use-session-tasks.ts
最近确认：未记录
理由：根因（浏览器实测 + 真实数据复现实证）：历史日志分页窗口（400 行）截断使子代理派发 tool_call 行落在窗口外 → 装配器为子代理消息创建 stub 兜底段（名字回落 subagentType=「general-purpose」）→ stub 无任务元数据槽 → 头部 status 恒 running、durationText 恒「运行中」（turn-segment-views.tsx:795 的占位）。前两个变更（冒名行收口、task_id 兜底路由）修的是数据与路由环节，本变更修渲染环节：**以服务端任务快照为权威，在渲染层按 tool_use_id 对账**。选渲染层对账而非装配层补元数据，是因为快照（GET /sessions/{id}/tasks，AgentSessionTaskRead 已含 tool_use_id，后端零改动、零 gen:types）天然覆盖所有窗口截断形态，且 stub 无元数据槽的装配器契约不需要动。 改动面（纯前端三处 + 接线）：① `use-session-tasks.ts` 视图行补 `toolUseId`（快照映射 + 事件合并透传）+ 导出 `buildSubagentTaskLookup` 纯函数与 `SubagentTaskSnapshotInfo` 类型；② `turn-segment-views.tsx` `subagentHeaderOf` 增第三参 `reconciled`（可选，{taskName,status,elapsedMs}），stub 与「无元数据且 running」的 tool 段命中时按快照展示名称/徽标/时长，并导出 `SubagentTaskLookupContext`；③ `subagent-detail-panel.tsx` 右栏面板同源接入；④ `session-panel-page.tsx` 页面级建一份 `useSessionTasks` 实例（复用既有 refreshSignal），useMemo 构建 Map 后以 **Context Provider** 下发（同时覆盖时间线与右栏面板/抽屉三处槽位）。 实现偏离说明（相对初稿）：容器头对账的下发用 **Context** 而非 TurnTimelineProps 逐层透传——SegmentView 递归链（TurnRow→SegmentView→SubagentBlockView）层级深且 memo 化，prop 钻取要动 4 层组件签名；Context 值经 useMemo 稳定引用，memo 收益不受损，且 DetailPanel/Drawer（portal 的 React 树仍继承 context）天然覆盖。TurnTimelineProps 零改动。

## D-components-daemon-005@v1 2026-10-14-session-bottom-follow-insert——根因：会话初始加载有两个异步源——日志窗口（贴底完成）与全量大纲（turn-outline）。
状态：implemented
变更：2026-10-14-session-bottom-follow-insert
原编号：D-000@v1
锚点：.sillyspec/changes/archive/2026-10-14-session-bottom-follow-insert/design.md
文件：frontend/src/components/daemon/turn-timeline.tsx
最近确认：未记录
理由：根因：会话初始加载有两个异步源——日志窗口（贴底完成）与全量大纲（turn-outline）。大纲后到时归并层把 N 张预览卡插进列表中段：末轮不变、列表长度剧增；贴底跟随触发签名 lastSig（runId:outputLen:status）不含长度 → 不触发滚动，且 2.5s 高度重申窗口已过 → 视口绝对位置不动、内容被推下，停在倒数第几轮（时序依赖故偶发）。 修法（单行签名扩展）：turn-timeline.tsx [turns] effect 的 lastSig 补 turns.length 分量——中段/尾部插入（预览卡、孤儿补建、预取装配）与末轮变化同权触发贴底（仅当用户在底部）。为什么不选「outline 到达主动滚」：滚动收敛在 TurnTimeline 单点（prepend 锚定/重申窗/守卫链都在这里），page 层再起一条滚动路径会双写竞态。三道既有守卫（isPrepend 早退+3s 静默窗 / isNearBottomRef / suppressFollowBottom）原样保留，翻页与跳转行为不变。

## D-components-daemon-006@v1 2026-10-14-session-bottom-no-restore——滚动写入审计+对照实验锁定第五层根因：切换会话路径渐进贴底序列健康（387→13594 delta=0），故障为刷新专有——Chrome scroll rest
状态：implemented
变更：2026-10-14-session-bottom-no-restore
原编号：D-000@v1
锚点：.sillyspec/changes/archive/2026-10-14-session-bottom-no-restore/design.md
文件：frontend/src/components/daemon/turn-timeline.tsx
最近确认：未记录
理由：滚动写入审计+对照实验锁定第五层根因：切换会话路径渐进贴底序列健康（387→13594 delta=0），故障为刷新专有——Chrome scroll restoration 恢复上次容器滚动位置，恢复晚到时覆盖初始贴底 scrollTo 且恢复写入（scrollTop 骤减+scrollHeight 稳定）走 handleScroll 正常分支清 isNearBottomRef，贴底链全死，停在上次位置（落位随上次停留位置随机）。修法：TurnTimeline 挂载期间 history.scrollRestoration=manual（斩断恢复通道），卸载还原。刷新=重新打开会话，落底与切换语义一致。

## D-components-daemon-007@v1 2026-10-14-session-bottom-resize-observer——第四层根因（前三轮修复各覆盖特定触发器后的通解缺位）：内容迟到撑高只改 scrollHeight——不触发 scroll 事件（scrollTop 未变）、无
状态：implemented
变更：2026-10-14-session-bottom-resize-observer
原编号：D-000@v1
锚点：.sillyspec/changes/archive/2026-10-14-session-bottom-resize-observer/design.md
文件：frontend/src/components/daemon/turn-timeline.tsx
最近确认：未记录
理由：第四层根因（前三轮修复各覆盖特定触发器后的通解缺位）：内容迟到撑高只改 scrollHeight——不触发 scroll 事件（scrollTop 未变）、无 turns 提交，2.5s 重申窗过期后无修正源（真浏览器注入取证：贴底稳定 6 秒后注入 2000px → delta=2000 永久停住）。修法：ResizeObserver 观察滚动容器的内容子元素（容器自身 borderBox 由 flex 固定，须观察子元素），任何来源增高且用户在底部 → rAF 合帧 scrollTo 底。这是「高度变化」的权威事件源，覆盖图片/markdown/注入全部路径，与既有三触发器（turns 提交/scroll 事件/重申窗）互补不冲突。

## D-components-daemon-008@v1 2026-10-25-askuser-keyword-overkill-fix——会话 96b55567 排查实证：`classifySessionLog` 首道丢弃规则 `trimmed.includes("AskUserQuestion"
状态：implemented
变更：2026-10-25-askuser-keyword-overkill-fix
原编号：D-000@v1
锚点：.sillyspec/changes/archive/2026-10-25-askuser-keyword-overkill-fix/design.md
文件：frontend/src/components/daemon/__tests__/session-log-sanitize.test.ts, frontend/src/components/daemon/session-log-assembler.ts, frontend/src/components/daemon/session-log-sanitize.ts
最近确认：未记录
理由：会话 96b55567 排查实证：`classifySessionLog` 首道丢弃规则 `trimmed.includes("AskUserQuestion")`（session-log-assembler.ts:318）是全子串匹配——daemon 落库的 `[ASSISTANT]` 回复正文只要*提到*该词（本次事故：会话恰好在做 AskUser 组件统一，收尾汇报含「AskUserQuestion 工具卡片」字样），整条回复即被静默丢弃，前端对话视图丢内容且无任何失败卡兜底。生产库形态分布实证：含该词的行里真正需要丢弃的只有 AskUser 工具调用行（tool_call JSON 权威行、stdout `[TOOL_USE] AskUserQuestion:` 双发文本行、无 channel 裸 JSON），其中 `[TOOL_USE]` 文本行已被下方既有 `[TOOL_USE]` 通用丢弃规则（347 行）兜底。 方案：把 318 行收紧为「正文前缀行豁免」——`if (!/^\[(ASSISTANT|THINKING)\]\s?/.test(trimmed) && trimmed.includes("AskUserQuestion")) return null;`。即 `[ASSISTANT]`/`[THINKING]` 前缀行不再做该子串判定（落回各自正常分类分支：reply / thinking / API 错误行首锚定检查），其余行（tool_call JSON、裸 JSON、[TOOL_USE] 文本行等）维持原丢弃行为零变化。同款收紧同步到垫片 `sanitizeSessionLogContent`（session-log-sanitize.ts:44 同种子串规则，生产零消费方但文档声明与 classifySessionLog 同一套规则，防规则漂移——规则 18）。收紧思路对齐 ql-20260906-001 对 `isAssistantApiErrorText` 的行首锚定先例（该先例注释明确记录过「全文任意位置匹配会把正文提到这些词的合法回复整条吞掉」的同型事故）。
