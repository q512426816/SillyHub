---
author: flow-machine-draft
created_at: 2026-09-28T14:02:06.343Z
---
# 设计记录（Design Record）— 2026-09-28-remove-liveness-overview-card

> 四节的「问题」是机器段（指纹保护，勿改）；你的回答写在每节问题下方的 AGENT 槽里。
> 每节至少一行——小改动可写「不适用：<理由>」；flow done 空槽拒收。

## 做法概述
<!-- MACHINE-DRAFT:design-approach:4fa550e9aac26c5f5a3c89b853d9af0ad0749943358808fbc1196064a42c1173:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-09-28-remove-liveness-overview-card 留痕重锚 -->
本变更怎么解决问题？改哪里、为什么选这个方案（一两段）。
<!-- MACHINE-DRAFT:design-approach:end -->

<!--AGENT:槽1 做法概述作答——例外裁决书写面（机器段之外合法） -->
纯删除性前端小改：从工作区详情页（`frontend/src/app/(dashboard)/workspaces/[id]/page.tsx`）摘除 `<AgentLivenessOverviewCard>` 挂载与 import，删除组件文件 `frontend/src/components/agent-log/agent-liveness-overview-card.tsx`，并清掉 `page.test.tsx` 里对该组件的 vi.mock（无断言引用）。选删除而非「无数据时隐藏」：排查实证（2026-09-28）活性上报链路在真实部署从未建立——本机库 platform_agent_logs 724/725 行 state NULL（唯一非 NULL 是 manual_test 手工测试行）、daemon 连远程 crrcdt.ppdmq.top、各 workspace local.yaml 无 platform token 使 daemon liveness 循环空转零上报——卡片对用户恒显示「未知（100）」，无信息量且误导；修复链路（daemon 指回 + token 下发 + 持续在线）成本远超一张总览卡的价值，用户裁决去掉。数据层不动：GET /api/agent-logs 与 listWorkspaceAgentLogs 保留（会话列表 use-session-liveness 仍在用），liveness-badge 五态徽章保留（agent 日志面板行徽章仍在用）。

## 接口契约
<!-- MACHINE-DRAFT:design-contract:86ee80e3cad9ae1c299a0c54bf5503a112d318bb2e5490a32fcd5c1724293a0b:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-09-28-remove-liveness-overview-card 留痕重锚 -->
动了哪些函数/端点/命令/文件格式？对外可见的签名或行为变化是什么（含「无」的说明）？
<!-- MACHINE-DRAFT:design-contract:end -->

<!--AGENT:槽2 接口契约作答——例外裁决书写面（机器段之外合法） -->
无后端/接口变化。前端变化：workspaces/[id] 详情页右栏不再有「Agent 状态总览」卡（右栏由既有 About 侧栏 MetaPanel 承接，两栏网格结构不变）；导出组件 AgentLivenessOverviewCard 消失（全仓唯一消费方即详情页，删后无残留 import）。保留不动：lib/agent-logs.ts 的 listWorkspaceAgentLogs（use-session-liveness.ts 消费）、liveness-badge.tsx（LivenessBadge/LivenessDot/livenessTitle，agent 日志面板行徽章消费）。

## 边界与并发（盲维四问——每问必答，答不了即设计缺口）
<!-- MACHINE-DRAFT:design-boundaries:98046ccf043ed9302175b492d297f70dfd943c39f2e8770e8a6039ea302cbb6a:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-09-28-remove-liveness-overview-card 留痕重锚 -->
1. 乱序/迟到到达：输入或事件乱序时，本设计的假设还成立吗？
2. 并发写：两个执行体同时操作同一数据/文件会发生什么？
3. 切换/生命周期：会话、请求或变更中途切换/中断时状态是否安全？
4. 作用域：跨工作区/跨仓/多实例时数据会不会串台？
<!-- MACHINE-DRAFT:design-boundaries:end -->

<!--AGENT:槽3 盲维四问作答——例外裁决书写面（机器段之外合法） -->
1. 乱序/迟到到达：不适用——纯 UI 删卡，无事件流；数据层（states 上报端点）不动，迟到的上报数据只会落库不再有该展示面。
2. 并发写：不适用——只删前端组件与测试 mock，不碰任何共享状态写入。
3. 切换/生命周期：用户正在浏览详情页时升级部署，新页面少一张卡，无中间态风险；React Query 的 agent-liveness-overview 缓存键随组件消失自然失效。
4. 作用域：不适用——改动仅本仓前端详情页与测试，不跨 workspace；会话列表的活性链路（use-session-liveness）独立于本卡，不受影响。

## 风险与死路
<!-- MACHINE-DRAFT:design-risks:03ff22f024c81093b38d2bb78b9d095acf5be70d5c09b17c10da44e4655ddb72:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-09-28-remove-liveness-overview-card 留痕重锚 -->
本方案最大的风险是什么？试过但放弃的方案及放弃理由？
<!-- MACHINE-DRAFT:design-risks:end -->

<!--AGENT:槽4 风险与死路作答——例外裁决书写面（机器段之外合法） -->
最大风险：误删共享受害面——agent-liveness-overview-card.tsx 删除若连带删 lib 层（listWorkspaceAgentLogs / liveness-badge）会打断会话列表活性链路；已核对引用（grep 全仓）确认仅摘卡不动数据层。放弃的方案：①「无有效数据时隐藏卡片」——判定条件含糊（库里恰有一条 manual_test idle 测试行会让门失效），且链路未建立期间卡片等于死代码，不如删干净；日后链路修复可从 git 历史整卡恢复。②「修链路保功能」——需 daemon 指回本机后端 + 各 workspace local.yaml 下发 platform token + daemon 常驻，为一个总览卡付出整条运维链路成本，用户已裁决不值得。
