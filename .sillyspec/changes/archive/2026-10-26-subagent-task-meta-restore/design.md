---
author: flow-machine-draft
created_at: 2026-10-26T07:18:49.445Z
---
# 设计记录（Design Record）— 2026-10-26-subagent-task-meta-restore

## 做法概述

本变更怎么解决问题？改哪里、为什么选这个方案（一两段）。

生产实证（会话 83a96b92，2026-10-26 06:18 UTC）：daemon 同一毫秒批量落库四行（[TOOL_USE] Agent stdout 投影 / tool_call JSON（尾部 tool_use_id） / [TASK_STARTED]（parent 归属列） / [TOOL_RESULT] async 回执），DB 无二级排序键，历史回放喂入顺序不定——[TASK_STARTED] 先于 tool_call 段建立时 task 分支 findToolById 未命中即丢弃，段元数据（taskStatus/taskAsync）永久丢失；随后 async 回执按"桶内最近未配对 tool 段"配对把段翻成假终态（ok + 8~11 秒 endedAt 差值），metaStatus 优先级压不住 → 用户看到子代理卡片假"已完成"+ 冻结假时长（本地真实数据复现铁证：三段 taskStatus=null / durationText "00:08"/"00:11"）。

修法（装配器单文件内聚）：悬挂回填——task 分支 targetId 未命中且行带 parent_tool_use_id 时不再丢弃，写入 turn 链共享悬挂表（新 symbol PENDING_TASK_METAS，Map<parentToolUseId, TaskLineMeta[]>，挂载/流转模式同 SUPERSEDED_SEG_IDS：enumerable symbol 键随对象展开流转，attachInternals/transferAssemblerInternals 同步携带）；tool_use 段建立点（tool_use case 建段 + 步骤 1 stub→tool 合并后的段）按 resolvedToolUseId 查悬挂表，按到达序逐条 applyTaskMeta 回填并删条目。显示层零改动——subagentHeaderOf 既有"元数据 > 段三态"优先级回填后自然压住假终态（FR-02 是验收不是新代码）。

## 接口契约

动了哪些函数/端点/命令/文件格式？对外可见的签名或行为变化是什么（含「无」的说明）？

- session-log-assembler.ts 内部：新增 PENDING_TASK_METAS symbol 与 carrier 字段、attachInternals/transferAssemblerInternals 增可选悬挂表参数（对外导出签名 transferAssemblerInternals(target, source) **不变**——内部多转一个 symbol 键）；applyLogToSegments 的 task 分支与 tool_use 建段点行为变化如上。
- 对外可见行为：历史回放/实时 SSE 中乱序到达的 [TASK_*] 行不再丢失元数据；TurnSegment 字段类型**零变化**（回填复用既有 applyTaskMeta）。
- 后端 / daemon / api-types.ts：**无变化**。

## 边界与并发（盲维四问——每问必答，答不了即设计缺口）

1. 乱序/迟到到达：输入或事件乱序时，本设计的假设还成立吗？
   - 成立——本变更就是治乱序：TASK 行任意早到悬挂、任意晚到（段已建）即时写；同毫秒四行全排列均收敛（测试锁定）。迟到 PROGRESS/NOTIFICATION 悬挂后回填，字段语义与即时路径一致（applyTaskMeta 同一函数）。
2. 并发写：两个执行体同时操作同一数据/文件会发生什么？
   - 悬挂表是单 turn 链内共享可变 Map（同 seenLogIds/superseded 模式），React setState updater 串行执行，无跨线程并发写；StrictMode double-invoke 由既有 applyResultMemo/seenLogIds 幂等门拦截。
3. 切换/生命周期：会话、请求或变更中途切换/中断时状态是否安全？
   - 安全。悬挂表随 turn 链流转，轮终态/切换会话时随 turn 对象丢弃，无全局残留；悬挂条目仅在对应段建立时消费，永不匹配（孤儿 TASK 行无段）则随链淘汰——语义等价于现状丢弃，仅时机后移。
4. 作用域：跨工作区/跨仓/多实例时数据会不会串台？
   - 不会。悬挂表键为 tool_use_id（会话内唯一），Map 挂 turn 对象局部，无跨会话共享。

## 风险与死路

本方案最大的风险是什么？试过但放弃的方案及放弃理由？

- 风险：①悬挂 Map 在 asAssembled 收窄视图构造点若漏 transfer 会断链（悬挂后恰逢收窄再回填的窗口）——实现时 transferAssemblerInternals 必须同步携带（改动点已列）；②tool_use 建段点有两处（顶层新建 + stub 合并）漏一处则该路径悬挂不回填——测试覆盖 stub 先于 TASK 行形态。③进程退出导致的真僵尸任务（daemon 无终态信号，快照表无记录）本变更**不治**——卡片将统一显示"后台运行中"走秒（一致但仍在走），终态补写属 daemon 侧独立缺陷，建议另立变更（生产 06:22:43 进程退出实证）。
- 放弃方案一：治 DB 排序（backend 落库加二级排序键 seq）——动后端且存量行已乱序，历史数据救不回，前端防御普适，弃。
- 放弃方案二：tool_result 配对处加 taskAsync 豁免（不翻终态）——元数据回填后 metaStatus 优先级已压住显示，配对层再加豁免会让"真完成（同步 Agent）"与"回执（async）"歧义化（回执文本判定脆弱），收益低风险高，弃（endedAt 污染由 FR-02 显示优先级兜住）。
- 放弃方案三：一并修 [TOOL_USE] stdout 行与 tool_call 行双段并存（tool:uuid 孤儿段）——独立缺陷（显示为普通工具行，非本诉求主因），改动面涉及双行合并语义，超 thin 范围，弃（design 记录在案，后续另立）。

## 文件变更清单

| 操作 | 路径 | 说明 |
| --- | --- | --- |
| 修改 | frontend/src/components/daemon/session-log-assembler.ts | PENDING_TASK_METAS symbol + carrier 字段 + attachInternals/transfer 携带；task 分支悬挂暂存；tool_use 建段点（新建 + stub 合并）回填 |
| 修改 | frontend/src/components/daemon/__tests__/task-line-assembler.test.ts | 乱序排列用例（TASK 最先/回执在前/常态/无 parent 丢弃）+ 悬挂表清空断言 |
| 修改 | frontend/src/components/daemon/__tests__/turn-segment-views.test.tsx | 回填后 metaStatus 优先压假终态的头部派生用例 |
