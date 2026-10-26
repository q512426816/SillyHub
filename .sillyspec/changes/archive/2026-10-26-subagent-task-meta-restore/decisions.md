---
author: flow-machine-draft
created_at: 2026-10-26T13:37:40.658Z
---
# 决策记录（Decisions）— 2026-10-26-subagent-task-meta-restore

## D-001@v1: 设计期风险与放弃方案（底稿）
- 类型：process
- 状态：confirmed
- 答案：- 风险：①悬挂 Map 在 asAssembled 收窄视图构造点若漏 transfer 会断链（悬挂后恰逢收窄再回填的窗口）——实现时 transferAssemblerInternals 必须同步携带（改动点已列）；②tool_use 建段点有两处（顶层新建 + stub 合并）漏一处则该路径悬挂不回填——测试覆盖 stub 先于 TASK 行形态。③进程退出导致的真僵尸任务（daemon 无终态信号，快照表无记录）本变更**不治**——卡片将统一显示"后台运行中"走秒（一致但仍在走），终态补写属 daemon 侧独立缺陷，建议另立变更（生产 06:22:43 进程退出实证）。 - 放弃方案一：治 DB 排序（backend 落库加二级排序键 seq）——动后端且存量行已乱序，历史数据救不回，前端防御普适，弃。 - 放弃方案二：tool_result 配对处加 taskAsync 豁免（不翻终态）——元数据回填后 metaStatus 优先级已压住显示，配对层再加豁免会让"真完成（同步 Agent）"与"回执（async）"歧义化（回执文本判定脆弱），收益低风险高，弃（endedAt 污染由 FR-02 显示优先级兜住）。 - 放弃方案三：一并修 [TOOL_USE] stdout 行与 tool_call 行双段并存（tool:uuid 孤儿段）——独立缺陷（显示为普通工具行，非本诉求主因），改动面涉及双行合并语义，超 thin 范围，弃（design 记录在案，后续另立）。
