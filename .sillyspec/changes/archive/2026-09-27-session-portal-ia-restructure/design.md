---
author: flow-machine-draft
created_at: 2026-09-27T10:15:36.195Z
---
# 设计记录（Design Record）— 2026-09-27-session-portal-ia-restructure

> 四节的「问题」是机器段（指纹保护，勿改）；你的回答写在每节问题下方的 AGENT 槽里。
> 每节至少一行——小改动可写「不适用：<理由>」；flow done 空槽拒收。

## 做法概述
<!-- MACHINE-DRAFT:design-approach:4fa550e9aac26c5f5a3c89b853d9af0ad0749943358808fbc1196064a42c1173:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-09-27-session-portal-ia-restructure 留痕重锚 -->
本变更怎么解决问题？改哪里、为什么选这个方案（一两段）。
<!-- MACHINE-DRAFT:design-approach:end -->

<!--AGENT:槽1 做法概述作答——例外裁决书写面（机器段之外合法） -->
诊断（三子代理全量功能清点佐证）：会话门户"乱"的根源不是样式而是信息架构——中栏头部单行挤 9+ 元素（标题/ID/状态/共享徽标/机器/工作区/后台目录/子代理目录/视图tab/搜索/打断）；垂直方向最多 11 层堆叠（AgentLog折叠栏→TaskExecutionPanel→后台提示→UsageBar→消息流→PlanApproval→队列条→定时条→输入栏→配置条→CtxUsageBar）；同类信息散落多处（任务 3 处、用量 2 处）；左栏筛选区 5 控件纵排；右列仅文件预览/子代理详情时出现，平时空置。

方案（收纳而非删除）：①中栏右列（现有子代理详情列）扩展为「收起/详情/子代理」三模式——详情模式收纳 SessionUsageBar、TaskExecutionPanel 与概览元信息（MetaPanel 分组），查看类信息有了统一归处；②头部两层化——主行只留标题+状态+高频操作，元信息（#id 复制/机器/工作区/共享徽标）降级次行 muted 小字；③底部收敛——desktop 移除消息流上方用量条与任务面板（移入右栏），操作类（计划批准/队列/定时/输入/配置）原位保留；④左栏筛选紧凑化——搜索+状态同行、机器/智能体/关联合并紧凑排布。改 `session-panel-page.tsx`（右列+头部+底部）与 `session-list-panel.tsx`（筛选区）两个主文件，`sessions-portal.tsx` 层零改动（文件预览列/群聊/四分支不波及）。视觉沿用上一轮 primer 组件体系（StateLabel/MetaPanel）与主题 token。选此方案因为它把"乱"的根因（无收纳层）解决掉，同时 render 组织层重组不动任何状态机，功能零丢失可对照验收。

## 接口契约
<!-- MACHINE-DRAFT:design-contract:86ee80e3cad9ae1c299a0c54bf5503a112d318bb2e5490a32fcd5c1724293a0b:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-09-27-session-portal-ia-restructure 留痕重锚 -->
动了哪些函数/端点/命令/文件格式？对外可见的签名或行为变化是什么（含「无」的说明）？
<!-- MACHINE-DRAFT:design-contract:end -->

<!--AGENT:槽2 接口契约作答——例外裁决书写面（机器段之外合法） -->
无后端端点/DTO/路由/props 接口变更（不触发 pnpm gen:types）。前端内部契约变化：①SessionUsageBar 与 TaskExecutionPanel 组件本身 props 零改动，仅挂载点从消息流上方迁移至右列详情模式（desktop 全部 page 宿主——含分身浮层/悬浮助手，评审 P1 修复后右列不再依赖子代理宿主 props）；mobile 维持原挂载路径（组件被两处条件引用）；②session-panel-page 右列状态从单值 openSubagentId 扩展为「列模式」派生态（详情/子代理互斥，openSubagentId 语义保留，子代理模式即现有行为）；③新增 localStorage 键 `sillyhub.sessions.detailPanel`（值 JSON：{open: boolean}，仅记忆开合——模式由子代理选中态派生不落盘，重载后默认详情模式），宽度继续共用现有 filePreviewWidth 键；④左栏筛选控件仅重排 JSX 容器，各 Select 的受控 props/联动回调不变。对外可见行为唯一变化是信息呈现位置（头部次行/右列详情/紧凑筛选），无任何功能入口消失。

## 边界与并发（盲维四问——每问必答，答不了即设计缺口）
<!-- MACHINE-DRAFT:design-boundaries:98046ccf043ed9302175b492d297f70dfd943c39f2e8770e8a6039ea302cbb6a:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-09-27-session-portal-ia-restructure 留痕重锚 -->
1. 乱序/迟到到达：输入或事件乱序时，本设计的假设还成立吗？
2. 并发写：两个执行体同时操作同一数据/文件会发生什么？
3. 切换/生命周期：会话、请求或变更中途切换/中断时状态是否安全？
4. 作用域：跨工作区/跨仓/多实例时数据会不会串台？
<!-- MACHINE-DRAFT:design-boundaries:end -->

<!--AGENT:槽3 盲维四问作答——例外裁决书写面（机器段之外合法） -->
1. 乱序/迟到到达：TaskExecutionPanel 的实时事件注入（taskPanelRef.applyEvent）与 SessionUsageBar 的轮终态 refreshSignal 都绑定组件实例而非 DOM 位置，迁移挂载点后订阅链路不变；SSE 事件乱序时行为与现状一致（组件内部已处理）。
2. 并发写：右列「详情/子代理」互斥由单一列模式状态派生（last-write-wins，与现有 openSubagentId 单槽位语义同构）；portal 层 filePreview 与 panel 层右列是两个独立状态，同时打开时中栏右侧两列并排（flex 布局，总宽有 resizer 上限约束），不产生写冲突——与现状「文件预览+子代理互斥」相比此处放宽为可并存，因详情/子代理属查看类低频组合，互斥逻辑只保留在 portal↔panel 既有清零链路（本变更不改它）。
3. 切换/生命周期：会话切换时既有 key={sessionId} 重挂载机制清流零改动；detailOpen 是纯 UI 偏好，重挂载后从 localStorage 恢复（跨会话保持开合——「边聊边看」偏好语义，与宽度/视图模式记忆同口径），子代理模式随 openSubagentId 由宿主既有清零链路重置；SSE/轮询的卸载与重挂载由既有 key 机制承担。desktop 详情收起期间 TaskExecutionPanel 不挂载，实时事件注入（taskPanelRef.current?.applyEvent）经 optional chaining 静默跳过，重开面板后组件自取数（快照+runs 全量）兜底——无数据损坏，仅收起期间不累积增量事件（查看类可接受边界）。
4. 作用域：详情侧栏数据全部来自当前 SessionPanel 的 props/自取数 hook（按会话 id 维度），切会话即切数据源，无跨工作区串台；localStorage 模式键为全局用户偏好（不按会话隔离，与现有宽度/展开记忆一致口径）。

## 风险与死路
<!-- MACHINE-DRAFT:design-risks:03ff22f024c81093b38d2bb78b9d095acf5be70d5c09b17c10da44e4655ddb72:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-09-27-session-portal-ia-restructure 留痕重锚 -->
本方案最大的风险是什么？试过但放弃的方案及放弃理由？
<!-- MACHINE-DRAFT:design-risks:end -->

<!--AGENT:槽4 风险与死路作答——例外裁决书写面（机器段之外合法） -->
最大风险：session-panel-page.tsx（4615 行）JSX 大块迁移时破坏隐蔽行为——占位轮 SSE 抢先认领、触顶加载锚钉回、跳转抑制窗、发送窗口期打断回退等防呆逻辑都缝在 render 与 effect 的交界处。对策：只移动 JSX 块的容器位置，不动任何 hooks/回调/数据派生；每完成一个 task 跑相关测试再进下一步；收口时对 diff 逐行审查确认「仅 render 组织层」。实际暴露（独立评审 P1）：desktop 非 portal 宿主（分身浮层/悬浮助手）不传 onOpenSubagent，右列初版绑定宿主 props 导致它们的用量条与任务面板消失——已修复（右列容器与子代理 Provider 解耦，desktop 一律有右列）。另注：本变更工作区基线叠加于上一轮 2026-09-26-core-pages-visual-redesign 未提交的 staged 快照之上，冻结件 change.patch 因此含上一轮 38 文件捆绑（主仓库已分两笔 commit 剥离归属：先 staged 快照落地为上一轮 commit，再本变更独立 commit）。

试过放弃的方案：①ChatGPT 式单栏+抽屉布局（推翻三栏）——深链/群聊/文件模式/四分支全部重做，风险与收益不成比，放弃；②把 SessionConfigBar/CtxUsageBar 也收进右栏——配置与压缩上下文是输入前高频操作，收进右栏断操作流，放弃；③portal 层做统一四栏容器——群聊分支与文件树模式联动复杂，波及面大，放弃（改为 panel 层内解决）；④TaskExecutionPanel/UsageBar 彻底只留右栏——mobile 无右列会丢功能，放弃（mobile 维持原位）。
