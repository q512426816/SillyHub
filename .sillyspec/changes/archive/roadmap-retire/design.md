---
author: flow-machine-draft
created_at: 2026-09-28T06:08:40.809Z
---
# 设计记录（Design Record）— roadmap-retire

> 四节的「问题」是机器段（指纹保护，勿改）；你的回答写在每节问题下方的 AGENT 槽里。
> 每节至少一行——小改动可写「不适用：<理由>」；flow done 空槽拒收。

## 做法概述
<!-- MACHINE-DRAFT:design-approach:4fa550e9aac26c5f5a3c89b853d9af0ad0749943358808fbc1196064a42c1173:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change roadmap-retire 留痕重锚 -->
本变更怎么解决问题？改哪里、为什么选这个方案（一两段）。
<!-- MACHINE-DRAFT:design-approach:end -->

<!--AGENT:槽1 做法概述作答——例外裁决书写面（机器段之外合法） -->
git rm 删除 .sillyspec/ROADMAP.md 一个文件，零代码改动。手工字典职能已被真源覆盖（knowledge/fr 归档机器铸号可 search、changes/archive/ 全量留档、progress show 活跃面、变更中心归档 tab 描述行），且该文件结构性过时：lite/thin 归档明确豁免它（run/complete-handlers.js liteArchiveChange 注释与措辞），quick 退役后主力通道永不更新它；现存内容实证腐烂（时间序漂移/300-600 字密排/165-166 行 ### 2026-0 截断残骸/「当前活跃」节 6 月化石）。CLI 读点全部条件化自失活（stages/archive.js「存在→」、stages/status.js cat 2>/dev/null、run/next.js 绿地探测为通用功能保留），daemon sillyhub-daemon/src/sillyspec-manager.ts:2184 仅为注释示例非消费点。

## 接口契约
<!-- MACHINE-DRAFT:design-contract:86ee80e3cad9ae1c299a0c54bf5503a112d318bb2e5490a32fcd5c1724293a0b:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change roadmap-retire 留痕重锚 -->
动了哪些函数/端点/命令/文件格式？对外可见的签名或行为变化是什么（含「无」的说明）？
<!-- MACHINE-DRAFT:design-contract:end -->

<!--AGENT:槽2 接口契约作答——例外裁决书写面（机器段之外合法） -->
无函数/端点/命令/文件格式变更。交付面 = 删除一个 tracked 文件（.sillyspec/ROADMAP.md）。对外可见变化：sillyspec run status「项目基础信息」步 cat 该文件从此输出空（cat 本就 2>/dev/null 容缺）；重新扫描/归档等一切流程零变化。平台侧 .claude/skills 两处文案提及（sillyspec-archive 描述「+ 更新 ROADMAP」、sillyspec-explore cat 行）为提示面自失活，留待后续产品级变更（skills 源面在 sillyspec 仓 .claude/skills，init 复制分发）一并出清。

## 边界与并发（盲维四问——每问必答，答不了即设计缺口）
<!-- MACHINE-DRAFT:design-boundaries:98046ccf043ed9302175b492d297f70dfd943c39f2e8770e8a6039ea302cbb6a:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change roadmap-retire 留痕重锚 -->
1. 乱序/迟到到达：输入或事件乱序时，本设计的假设还成立吗？
2. 并发写：两个执行体同时操作同一数据/文件会发生什么？
3. 切换/生命周期：会话、请求或变更中途切换/中断时状态是否安全？
4. 作用域：跨工作区/跨仓/多实例时数据会不会串台？
<!-- MACHINE-DRAFT:design-boundaries:end -->

<!--AGENT:槽3 盲维四问作答——例外裁决书写面（机器段之外合法） -->
1. 乱序/迟到到达：不适用——纯静态文件删除；若某次归档循旧 skill 文案迟到重写该文件，将以 untracked 脏文件显式可见。
2. 并发写：git rm 原子；他侧在写则冲突显式暴露，无半态。
3. 切换/生命周期：单次原子删除，flow done 断点续无残留。
4. 作用域：仅本仓工作树一个路径。spec-sync 平台同步为 best-effort 后台任务，根级 spec 文件缺席属合法状态（同步面已有缺席文件语义），不产生跨仓串台；sillyspec 仓的同名污染拷贝由彼仓变更 roadmap-copy-purge 独立处理，互不牵连。

## 风险与死路
<!-- MACHINE-DRAFT:design-risks:03ff22f024c81093b38d2bb78b9d095acf5be70d5c09b17c10da44e4655ddb72:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change roadmap-retire 留痕重锚 -->
本方案最大的风险是什么？试过但放弃的方案及放弃理由？
<!-- MACHINE-DRAFT:design-risks:end -->

<!--AGENT:槽4 风险与死路作答——例外裁决书写面（机器段之外合法） -->
最大风险：误判「无消费」——已复核：平台仓自有代码（frontend/backend/daemon src）grep 仅 daemon 注释 1 处；消费真实来自 sillyspec CLI 的通用读点（全条件化）；.claude/skills 为提示面。放弃的方案：机器化维护单行条目——lite/thin 豁免使字典永远缺主力通道数据，补齐需动 lite 归档语义，为已被四套真源覆盖的文件不值。
