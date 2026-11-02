---
author: flow-machine-draft
created_at: 2026-11-02T01:26:08.615Z
---
# 设计记录（Design Record）— 2026-11-02-stale-test-sync-contract

## 做法概述

本变更怎么解决问题？改哪里、为什么选这个方案（一两段）。

10 个存量失败经 worktree 二分坐实为三簇「生产契约有意演进、测试未同步」，修复全部在测试侧对齐新契约，生产代码零改动：

①占位键形态（7 用例）：1015aa22f 有意规定「绑定通道拒为无日期前缀新名建占位」（CLI flow start 强制 YYYY-MM-DD- 前缀，无前缀名命令必败、占位即幽灵）。把 test_agent_log_push.py / test_session_service.py 中 `change-hub-*`、`change-degrade-*`、`shared-key` 等旧形态键改为日期前缀合法名（如 `2026-10-27-change-hub-claude`）——测试再次验证占位创建/link 语义/跨区 D-004/降级行为本身，而非快照被拒后的空集。

②schema 字段（2 用例）：cdcb97fdb 给 AgentLogMessageItem 增 bg_task_final 可选字段（user_input 系统注入段配对面，缺省 None）。test_agent_log_messages.py 两处精确断言补入该字段：messages[0] dict 增 `"bg_task_final": None`；openapi properties 全集增 `bg_task_final`。

③monkeypatch 缝（1 用例）：2ca991c0 把 attachments 切换轮解析入口换为 resolve_session_provider_config（attachments.py 函数体内延迟 import，patch 源模块属性即生效）。test_inject_orchestrator_tagging.py 回滚用例的 patch 目标同步换缝，DaemonSessionConfigInvalid 的 DID-raise 语义与全部回滚断言原样保留。

## 接口契约

动了哪些函数/端点/命令/文件格式？对外可见的签名或行为变化是什么（含「无」的说明）？

无——零生产代码改动，仅四个测试文件内部的键形态/断言集/patch 目标对齐既有生产契约（三契约分别由 1015aa22f / cdcb97fdb / 2ca991c0 落地并有各自变更的正式验收）。

## 边界与并发（盲维四问——每问必答，答不了即设计缺口）

1. 乱序/迟到到达：输入或事件乱序时，本设计的假设还成立吗？

不适用：测试改动无运行时序表面——用例内 Given/When/Then 顺序由测试代码固定，键改名不改变条目到达顺序语义（push 测试仍按 entries 数组序上行）。

2. 并发写：两个执行体同时操作同一数据/文件会发生什么？

不适用：测试进程内单 DB session 顺序执行；改名键在各用例内自洽（entry 键与断言键同改），无跨用例共享状态（每用例独立 db_session）。

3. 切换/生命周期：会话、请求或变更中途切换/中断时状态是否安全？

不适用：无生产状态被引入。唯一语义面是 tagging 回滚用例换缝后仍覆盖「inject 事务后段失败→整体回滚」——异常注入点从旧解析函数移到新解析函数，事务边界与断言不变。

4. 作用域：跨工作区/跨仓/多实例时数据会不会串台？

不适用且被测试正向覆盖：跨区绑定用例（shared-key→日期前缀）验证的正是 D-004「占位只建在会话自有工作区、不跨区串扰」——键改前缀后 ws_b 既有行与 ws_a 占位行同键不同区，断言两行并存且 link 只连本区行。

## 风险与死路

本方案最大的风险是什么？试过但放弃的方案及放弃理由？

最大风险：「改测试让它变绿」若方向反了会把真回归洗白。防御：三簇均有引入提交的设计文档背书（1015aa22f design FR-01 逐字规定拒建占位；cdcb97fdb schema 字段是交付面；2ca991c0 换缝是共享特性的既载实现），且修复原则是让测试重新验证原行为语义（占位创建/回滚/schema 形状）而非把断言改成现状快照——每处断言恢复后都要能被空实现打红。放弃的方案：回滚三个引入提交的生产契约——三者均为有意设计且有独立验收（幽灵占位是生产实证事故修复），为绿测试翻生产契约本末倒置。
