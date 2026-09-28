---
author: flow-machine-draft
created_at: 2026-09-28T01:46:04.845Z
---
# 设计记录（Design Record）— 2026-09-28-turn-nav-hover-flyout

> 四节的「问题」是机器段（指纹保护，勿改）；你的回答写在每节问题下方的 AGENT 槽里。
> 每节至少一行——小改动可写「不适用：<理由>」；flow done 空槽拒收。

## 做法概述
<!-- MACHINE-DRAFT:design-approach:4fa550e9aac26c5f5a3c89b853d9af0ad0749943358808fbc1196064a42c1173:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-09-28-turn-nav-hover-flyout 留痕重锚 -->
本变更怎么解决问题？改哪里、为什么选这个方案（一两段）。
<!-- MACHINE-DRAFT:design-approach:end -->

<!--AGENT:槽1 做法概述作答——例外裁决书写面（机器段之外合法） -->
用户实测反馈「左侧轮次导航列太占地方」（220px 常驻挤压聊天区）；结合此前 30px 刻度轨被嫌「命中区小看不见轮号」的历史，做折中形态：平时 44px 窄轨（紧凑刻度+当前轮高亮+把手显示当前轮号），悬停 300ms 防抖滑出完整行式浮层（absolute 覆盖聊天区左缘不挤压布局，宽 272px 固定），整体移开 250ms 收起；把手点击 pin 锁定常开（触屏 hover:none 主通道）；浮层内保留全部能力（轮号+大纲摘要+时间、当前轮高亮滚动联动、点击跳转含 run_id 直达、非 pin 态选完即收）。刻度本身是 button 且 aria-label 与行式版同构——可达性不降级，点击直跳。改动集中在 turn-nav-list.tsx 单组件重写（props 契约不变、挂载处零改动）+ 测试适配。

## 接口契约
<!-- MACHINE-DRAFT:design-contract:86ee80e3cad9ae1c299a0c54bf5503a112d318bb2e5490a32fcd5c1724293a0b:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-09-28-turn-nav-hover-flyout 留痕重锚 -->
动了哪些函数/端点/命令/文件格式？对外可见的签名或行为变化是什么（含「无」的说明）？
<!-- MACHINE-DRAFT:design-contract:end -->

<!--AGENT:槽2 接口契约作答——例外裁决书写面（机器段之外合法） -->
无后端/无路由/props 契约零变化（entries/activeTurnKey/loadingEarlier/onJump 不变，session-panel-page 挂载处零改动）。前端内部变化：TurnNavList 由 220px 常驻列（usePanelWidth 拖宽 + localStorage sillyhub.sessions.turnNavWidth + PanelResizer）改为 44px 窄轨 + 悬停/ Pin 浮层（固定 272px，不再拖宽——宽度记忆键与 resizer 随之退役，旧键遗留无害）；新增组件内 UI 状态（pinned/hoverOpen + 双计时器防抖），不触状态机/数据流。

## 边界与并发（盲维四问——每问必答，答不了即设计缺口）
<!-- MACHINE-DRAFT:design-boundaries:98046ccf043ed9302175b492d297f70dfd943c39f2e8770e8a6039ea302cbb6a:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-09-28-turn-nav-hover-flyout 留痕重锚 -->
1. 乱序/迟到到达：输入或事件乱序时，本设计的假设还成立吗？
2. 并发写：两个执行体同时操作同一数据/文件会发生什么？
3. 切换/生命周期：会话、请求或变更中途切换/中断时状态是否安全？
4. 作用域：跨工作区/跨仓/多实例时数据会不会串台？
<!-- MACHINE-DRAFT:design-boundaries:end -->

<!--AGENT:槽3 盲维四问作答——例外裁决书写面（机器段之外合法） -->
1. 乱序/迟到：纯 UI 展开态（pinned/hoverOpen 布尔），与数据到达时序无关——entries 更新只影响刻度/行内容重渲。
2. 并发写：双计时器（open/close）由 clearTimers 统一取消，enter/leave 交错最坏产生一次迟到的开/合状态翻转（幂等布尔，无累积）；卸载 effect 清计时器。
3. 切换/生命周期：会话切换 → entries/activeTurnKey 变化自然重渲；展开态不跨会话持久化（内存态，切走重置为收起）——符合「平时不占地方」的默认。
4. 作用域：浮层 absolute 相对本组件根容器（relative），z-30 覆盖聊天区但不越出面板；无跨会话/跨面板串台面。

## 风险与死路
<!-- MACHINE-DRAFT:design-risks:03ff22f024c81093b38d2bb78b9d095acf5be70d5c09b17c10da44e4655ddb72:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-09-28-turn-nav-hover-flyout 留痕重锚 -->
本方案最大的风险是什么？试过但放弃的方案及放弃理由？
<!-- MACHINE-DRAFT:design-risks:end -->

<!--AGENT:槽4 风险与死路作答——例外裁决书写面（机器段之外合法） -->
最大风险：浮层覆盖聊天区可能遮挡阅读中的内容——对策：默认收起（仅 44px），悬停防抖 300ms 防掠过误触，移开 250ms 即收，非 pin 态点行选完即收；浮层带阴影+边框视觉区分，聊天区不被挤压（absolute 不改布局）。
放弃的方案：①并入右栏详情 tab——中栏最干净但跳转多一步且右栏已有详情/文件/子代理三态；②默认 120px 收窄常驻——仍占一列，没解决本质；③保留拖宽——浮层不占布局后拖宽失去意义，砍掉（宽度记忆键随之退役）。
