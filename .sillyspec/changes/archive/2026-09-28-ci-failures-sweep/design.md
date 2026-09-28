---
author: flow-machine-draft
created_at: 2026-09-28T04:20:18.434Z
---
# 设计记录（Design Record）— 2026-09-28-ci-failures-sweep

> 四节的「问题」是机器段（指纹保护，勿改）；你的回答写在每节问题下方的 AGENT 槽里。
> 每节至少一行——小改动可写「不适用：<理由>」；flow done 空槽拒收。

## 做法概述
<!-- MACHINE-DRAFT:design-approach:4fa550e9aac26c5f5a3c89b853d9af0ad0749943358808fbc1196064a42c1173:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-09-28-ci-failures-sweep 留痕重锚 -->
本变更怎么解决问题？改哪里、为什么选这个方案（一两段）。
<!-- MACHINE-DRAFT:design-approach:end -->

<!--AGENT:槽1 做法概述作答——例外裁决书写面（机器段之外合法） -->
四 workflow 红=四类独立根因，逐类修复：
①daemon 12 用例 60s 超时=26e362d61 给 spawn 前新增真实 fs 调用（applyClaudeSettings 空对象改 unlink 撤下语义），「setImmediate 等一拍」不再够用→fake child exit 事件早于 listener 注册→runLease 永等（fake-child.ts waitForSpawn docblock 记载的同款死锁链，2026-07-08 linkSkillsToWorkdir 复发）。修：4 测试文件 12 处固定一拍换 waitForSpawn()+helper 加 minCalls 参数（第二轮 lease 的 mock.calls 跨轮累计陷阱）。
②daemon runtime-handler=实现按 2026-09-27-governance-rpc-actions design 注册 knowledge.digest/action 两 RPC，测试「四方法名」断言未同步→改六方法断言+补 _knowledgeGovHandler stub。
③backend platform_sync 双缺口=守卫 B（thin stage 不被 CLI scan 洗回，01a9dfcbd 遗留 patch 从未提交）+复活通道（fed6e9e9a 的 _heal_deleted_row_to_archive 被 304eba982 基于旧基线的 hits 改动整段误冲掉）→前者应用遗留 patch，后者从 fed6e9e9a 原样恢复。
④frontend 4 用例=task-08 泛化时把 closeLabel 缺省 aria-label 从「关闭分身会话」误统一为「返回主控」（与其自身「零回归」注释矛盾，实现回归→修实现）；caps 第 16 键 sessionFork 与 quick 徽标「（存量）」文案为测试断言漂移→修测试。
⑤backend 其余 3=测试自身问题：thin_stage_guard 事件构造用旧批量 body/旧 ts:int shape（r18 重构后 422）；scandir mock 遇 Linux rmtree fd 优化路径传 int 炸；rbac platform_level 用例漏跟 9109db20b 段 2 收紧（该变更自述「存量 6 旧语义用例修正」漏掉此例）。
⑥e2e N2/N3=779b7d6d3 菜单权限化只给现存角色种子授权，e2e 每次运行新建的冒烟角色（仅 workspace:read）不再渲染智能体会话/档案/技能菜单→fixtures.ts 冒烟角色补 agent_session/agent_profile/skill:read 三键。
⑦daemon mtime flaky=utimes 按秒+纳秒 timespec 设置，Linux stat().mtimeMs 浮点毫秒与整数期望 ≤1ms 舍入差偶发红→容差断言。

## 接口契约
<!-- MACHINE-DRAFT:design-contract:86ee80e3cad9ae1c299a0c54bf5503a112d318bb2e5490a32fcd5c1724293a0b:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-09-28-ci-failures-sweep 留痕重锚 -->
动了哪些函数/端点/命令/文件格式？对外可见的签名或行为变化是什么（含「无」的说明）？
<!-- MACHINE-DRAFT:design-contract:end -->

<!--AGENT:槽2 接口契约作答——例外裁决书写面（机器段之外合法） -->
对外行为变化两处（均为恢复既定设计语义，非新契约）：
①backend upsert_progress 已删拒收分支恢复 archived 复活通道：body changes[] 同名条目 status=='archived' 且行 location=='deleted' 时翻回 'archive' 并走正常接受（200）；其余已删形态维持 409 change_deleted（fed6e9e9a 原语义）。
②backend _sync_change_stage_status 加 thin 守卫 B：平台行 current_stage=='thin' 且上行 status 非 archived → 跳过 current_stage 覆盖（CLI scan 停留态不洗回 thin），status/时间戳照常（01a9dfcbd/2026-09-25-change-center-thin-flow task-05 原设计）。
③frontend WorkerSessionOverlay 关闭按钮缺省 aria-label 恢复「关闭分身会话」（可见文本「返回主控」不变；closeLabel 显式传入时两者同源，分叉场景「关闭」不变）。
其余全为测试自身修正（断言/shape/mock 形态）与测试 helper 扩参（waitForSpawn 加可选 minCalls=1 缺省，既有调用零变化）；e2e fixtures 冒烟角色权限集扩三键（e2e 内部夹具，非产品接口）。

## 边界与并发（盲维四问——每问必答，答不了即设计缺口）
<!-- MACHINE-DRAFT:design-boundaries:98046ccf043ed9302175b492d297f70dfd943c39f2e8770e8a6039ea302cbb6a:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-09-28-ci-failures-sweep 留痕重锚 -->
1. 乱序/迟到到达：输入或事件乱序时，本设计的假设还成立吗？
2. 并发写：两个执行体同时操作同一数据/文件会发生什么？
3. 切换/生命周期：会话、请求或变更中途切换/中断时状态是否安全？
4. 作用域：跨工作区/跨仓/多实例时数据会不会串台？
<!-- MACHINE-DRAFT:design-boundaries:end -->

<!--AGENT:槽3 盲维四问作答——例外裁决书写面（机器段之外合法） -->
1. 乱序/迟到：复活通道只认「行当前 location=='deleted' 且本次载荷 status=='archived'」，先 deleted 后 archived 的顺序依赖与 CLI 终态透传链一致；乱序（archived 先到）走正常接受无复活需求，幂等（heal 已是 archive 返回 False）。thin 守卫 B 是纯读侧跳过覆盖，无顺序假设。
2. 并发写：heal 与拒收同在 upsert_progress 入口串行段；waitForSpawn 是测试 helper 仅测试进程内。
3. 切换/生命周期：复活通道 commit 后行进正常接受分支，中断窗口与既有 upsert 相同；守卫 B 无独立生命周期。
4. 作用域：heal 查询带 (workspace_id, change_key) 精确条件；e2e 冒烟角色 per-run 唯一 key，权限补键不外溢；rbac 语义变化是恢复 9109db20b 既定语义（平台级业务权限非成员本就不应收工作区广播）。

## 风险与死路
<!-- MACHINE-DRAFT:design-risks:03ff22f024c81093b38d2bb78b9d095acf5be70d5c09b17c10da44e4655ddb72:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-09-28-ci-failures-sweep 留痕重锚 -->
本方案最大的风险是什么？试过但放弃的方案及放弃理由？
<!-- MACHINE-DRAFT:design-risks:end -->

<!--AGENT:槽4 风险与死路作答——例外裁决书写面（机器段之外合法） -->
最大风险：daemon 超时修复依赖「waitForSpawn 轮询 mock.calls」的既有 helper 语义，若未来 spawn 前路径再加真实 IO，waitForSpawn 本身仍稳（真实时间预算轮询）；但**同文件多轮 runLease** 的用例若忘传 minCalls 会复发第二轮丢事件——已在 helper docblock 写死该死锁链与用法。
放弃的方案：①给 applyClaudeSettings 打 mock 挡 unlink——放弃，撤下语义是有意产品行为，mock 会掩盖真实 IO 时序；②e2e 改用平台 admin 身份绕过菜单权限——放弃，N4 负向断言依赖非 admin 形态，且冒烟角色语义就是普通成员。
残留风险：e2e N2/N3 本机无 Docker 全栈未实证（e2e-ci 验证）；304eba982 冲掉 fed6e9e9a 的模式提示并行会话基于旧基线提交会回退他人已合入改动——本仓库已知协作形态，非本次可根治。
