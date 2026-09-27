---
author: flow-machine-draft
created_at: 2026-09-27T09:43:47.555Z
---
# 设计记录（Design Record）— 2026-09-27-knowledge-governance-cards

> 四节的「问题」是机器段（指纹保护，勿改）；你的回答写在每节问题下方的 AGENT 槽里。
> 每节至少一行——小改动可写「不适用：<理由>」；flow done 空槽拒收。

## 做法概述
<!-- MACHINE-DRAFT:design-approach:4fa550e9aac26c5f5a3c89b853d9af0ad0749943358808fbc1196064a42c1173:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-09-27-knowledge-governance-cards 留痕重锚 -->
本变更怎么解决问题？改哪里、为什么选这个方案（一两段）。
<!-- MACHINE-DRAFT:design-approach:end -->

<!--AGENT:槽1 做法概述作答——例外裁决书写面（机器段之外合法） -->
三层治理②层的平台出口：backend knowledge 模块新增 GET /workspaces/{ws}/knowledge/governance（KNOWLEDGE_READ，字面量路由注册在 {filename:path} 通配之前——声明顺序铁律），service.governance_signals 经 asyncio.to_thread 调模块级纯函数 _compute_governance_signals 从已同步 spec 内容根直接扫描：fr/*.md 待复核行按域计数（阈 100）+ auto-* 伪域条目（阈 0 恒报）+ uncategorized.md 收件箱（阈 20）；unmapped 大池只进 totals 不当警报（local.yaml 不入同步集、无 fr_unmapped_baseline 可读——与 CLI digest 的口径差异，有意取舍）。绑定类信号留 CLI 侧（需仓工作树做文件存在性校验，平台 spec 树无源码）。frontend：GovernanceCards 组件（useQuery 消费 getKnowledgeGovernance，OpsDashboard stats 同款模式）挂知识 tab OpsDashboard 之下；healthy 单行安语带底数，超阈逐卡（kind 图标/计数/明细/处置 CLI 命令文案；动作回传 v2 走 merge/reject 同款 RPC）。

## 接口契约
<!-- MACHINE-DRAFT:design-contract:86ee80e3cad9ae1c299a0c54bf5503a112d318bb2e5490a32fcd5c1724293a0b:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-09-27-knowledge-governance-cards 留痕重锚 -->
动了哪些函数/端点/命令/文件格式？对外可见的签名或行为变化是什么（含「无」的说明）？
<!-- MACHINE-DRAFT:design-contract:end -->

<!--AGENT:槽2 接口契约作答——例外裁决书写面（机器段之外合法） -->
新端点 GET /workspaces/{ws}/knowledge/governance → GovernanceOut{healthy,signals[{kind,title,count,detail,suggestion}],totals{rot,inbox,pseudo,unmapped_pool}}；前端 lib/knowledge.ts 增 getKnowledgeGovernance + GovernanceSignal/GovernanceOut 本地类型（api-types.ts 带并行会话未提交改动、gen:types 守卫拦再生成——本地声明过渡，形状与 backend 逐字一致，该会话落地后可切生成式）；知识页 OpsDashboard 下挂 <GovernanceCards workspaceId>。

## 边界与并发（盲维四问——每问必答，答不了即设计缺口）
<!-- MACHINE-DRAFT:design-boundaries:98046ccf043ed9302175b492d297f70dfd943c39f2e8770e8a6039ea302cbb6a:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-09-27-knowledge-governance-cards 留痕重锚 -->
1. 乱序/迟到到达：输入或事件乱序时，本设计的假设还成立吗？
2. 并发写：两个执行体同时操作同一数据/文件会发生什么？
3. 切换/生命周期：会话、请求或变更中途切换/中断时状态是否安全？
4. 作用域：跨工作区/跨仓/多实例时数据会不会串台？
<!-- MACHINE-DRAFT:design-boundaries:end -->

<!--AGENT:槽3 盲维四问作答——例外裁决书写面（机器段之外合法） -->
乱序：信号每次请求现扫同步树，无缓存态。并发写：只读扫描零竞态；与 spec sync 并发时读到的是最后一次落盘的一致快照。切换/生命周期：healthy/超阈/加载/错误四态自理，不依赖知识列表加载态（与 stats 同为独立数据链）。作用域：spec 内容根按 _spec_content_root 既有解析（spec_root 优先、root_path/.sillyspec 兜底），跨工作区天然隔离。

## 风险与死路
<!-- MACHINE-DRAFT:design-risks:03ff22f024c81093b38d2bb78b9d095acf5be70d5c09b17c10da44e4655ddb72:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-09-27-knowledge-governance-cards 留痕重锚 -->
本方案最大的风险是什么？试过但放弃的方案及放弃理由？
<!-- MACHINE-DRAFT:design-risks:end -->

<!--AGENT:槽4 风险与死路作答——例外裁决书写面（机器段之外合法） -->
最大风险：与 CLI digest 的口径分叉（unmapped 基线消音平台侧没有、绑定信号缺失）——双出口数字可能不一致；缓解：unmapped 只进 totals 降展示级、绑定信号 CLI 独有已在两端注释与卡面处置文案交叉指引，v2 可经 daemon RPC 直采 CLI digest --json 收敛单源。次风险：伪域 v1 只读卡（迁移动作 CLI 手工）——动作回传 v2；阈值与 CLI 同值但两处字面量（跨仓无法单源），注释互指。放弃方案：daemon RPC 实时跑 CLI digest——正确终态但需 daemon+RPC 双端改造，v1 平台直算已解 3/4 信号可见性，性价比不对等。
