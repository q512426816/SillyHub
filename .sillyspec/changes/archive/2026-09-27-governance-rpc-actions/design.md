---
author: flow-machine-draft
created_at: 2026-09-27T12:01:05.918Z
---
# 设计记录（Design Record）— 2026-09-27-governance-rpc-actions

> 四节的「问题」是机器段（指纹保护，勿改）；你的回答写在每节问题下方的 AGENT 槽里。
> 每节至少一行——小改动可写「不适用：<理由>」；flow done 空槽拒收。

## 做法概述
<!-- MACHINE-DRAFT:design-approach:4fa550e9aac26c5f5a3c89b853d9af0ad0749943358808fbc1196064a42c1173:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-09-27-governance-rpc-actions 留痕重锚 -->
本变更怎么解决问题？改哪里、为什么选这个方案（一两段）。
<!-- MACHINE-DRAFT:design-approach:end -->

<!--AGENT:槽1 做法概述作答——例外裁决书写面（机器段之外合法） -->
①单源收敛：daemon 新增 KnowledgeGovernanceHandler（runtime-handler.ts 同文件，runSillyspecCmd 扩 cwd 可选参）——knowledge.digest RPC（root_path 元字符黑名单→cwd=仓库根 spawn sillyspec knowledge digest --json，CLI JSON 信封透传；旧版 CLI→method_not_found、超时→timeout、非 JSON→internal）与 knowledge.action RPC（kind 白名单 repair-paths/redomain 硬编码；域名 [a-z0-9-]+ 元字符防线——spawn shell:true 命令串拼接注入面）；daemon.ts 注册两 handler。backend governance_signals RPC 优先（RuntimeLiveService._resolve_binding 解绑定→ws_hub.send_rpc 60s），任何失败（离线/超时/未绑定/未注册）回退本地 _compute（degrade 不 502）；响应加 source（daemon-rpc|local）与 actions_available。②动作回传：POST /knowledge/governance/actions（KNOWLEDGE_WRITE；kind/域名 422 校验）→RPC 执行→输出尾部透传。frontend：GovernanceOut +source/actions_available；actions_available 时坏绑定卡[执行 repair]按钮、伪域卡[迁移到…]输入目标域按钮（[a-z0-9-]+ 前端预校验），useMutation+invalidateQueries；local 模式按钮隐藏。

## 接口契约
<!-- MACHINE-DRAFT:design-contract:86ee80e3cad9ae1c299a0c54bf5503a112d318bb2e5490a32fcd5c1724293a0b:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-09-27-governance-rpc-actions 留痕重锚 -->
动了哪些函数/端点/命令/文件格式？对外可见的签名或行为变化是什么（含「无」的说明）？
<!-- MACHINE-DRAFT:design-contract:end -->

<!--AGENT:槽2 接口契约作答——例外裁决书写面（机器段之外合法） -->
daemon RPC：knowledge.digest{workspace_id,root_path}→{digest}；knowledge.action{workspace_id,root_path,kind,from?,to?}→{output}。backend：GET /knowledge/governance 响应 +source/actions_available；POST /knowledge/governance/actions {kind,from_domain?,to_domain?}→{output}（422：kind 非白名单/redomain 域名不合法或缺 to）。frontend：lib postKnowledgeGovernanceAction + GovernanceOut 两新可选字段；governance-cards 按钮面。runSillyspecCmd 签名 +cwd?: string（可选参，既有调用零变化）。

## 边界与并发（盲维四问——每问必答，答不了即设计缺口）
<!-- MACHINE-DRAFT:design-boundaries:98046ccf043ed9302175b492d297f70dfd943c39f2e8770e8a6039ea302cbb6a:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-09-27-governance-rpc-actions 留痕重锚 -->
1. 乱序/迟到到达：输入或事件乱序时，本设计的假设还成立吗？
2. 并发写：两个执行体同时操作同一数据/文件会发生什么？
3. 切换/生命周期：会话、请求或变更中途切换/中断时状态是否安全？
4. 作用域：跨工作区/跨仓/多实例时数据会不会串台？
<!-- MACHINE-DRAFT:design-boundaries:end -->

<!--AGENT:槽3 盲维四问作答——例外裁决书写面（机器段之外合法） -->
乱序：digest 每请求现采无缓存；action 幂等性由 CLI 端保证（repair-paths 幂等/redomain 同 ID 冲突防线）。并发写：动作串行经 daemon 单 spawn；digest 读与 action 写并发时读到旧一拍快照可接受（信号非账本）。切换/生命周期：RPC 失败全谱回退本地计算（页面不因 daemon 抖动 502——runtime-live degrade 同族）；action 失败显式报错不回退（写操作无本地等价物）。作用域：_resolve_binding 按当前用户绑定行（各成员读自己本机）；root_path 元字符+域名元字符双防线。

## 风险与死路
<!-- MACHINE-DRAFT:design-risks:03ff22f024c81093b38d2bb78b9d095acf5be70d5c09b17c10da44e4655ddb72:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-09-27-governance-rpc-actions 留痕重锚 -->
本方案最大的风险是什么？试过但放弃的方案及放弃理由？
<!-- MACHINE-DRAFT:design-risks:end -->

<!--AGENT:槽4 风险与死路作答——例外裁决书写面（机器段之外合法） -->
最大风险：spawn shell:true 命令串注入——kind 白名单硬编码 + 域名 [a-z0-9-]+ + root_path 元字符黑名单三层，且 root 只进 cwd 不拼命令串。次风险：RPC 优先路径的 backend 测试只验回退（happy path 由 daemon 侧 handler 测试 + 真实链路 E2E 留部署后——ws_hub mock 成本高，披露）；digest 超时 60s 偏宽（CLI 大仓绑定扫描秒级实测，留观察）。放弃方案：平台直接 spawn CLI（无 daemon 链路）——平台容器不可达成员仓工作树（2026-09-11 skills-central-library 同款结论）。
