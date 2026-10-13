---
author: flow-machine-draft
created_at: 2026-10-13T11:11:17.652Z
---
# 决策记录（Decisions）— 2026-10-13-load-earlier-full-turn

## D-001@v1: 风险与死路（design 槽4 收割）
- 类型：process
- 状态：confirmed
- 答案：最大风险：摘窗口旧块的匹配键错误导致误摘（表现为内容丢失）——防护：匹配键取 `realRunId ?? stripPageKeySuffix(runId)`（与 upsertTurn / handleJumpToTurn 既有口径 同源），且只摘终态块（`TERMINAL_TURN_STATUSES` 闸），运行中轮（currentRunId 所在） 天然非终态不进集合。次风险：超长轮（>2000 行）被后端直达 ASC 上限截断丢最新段 ——采纳闸（评审 P2 修复）：直达行集未覆盖到当页该轮最新行即判定截断，该轮整体 降级现状分裂显示（内容零丢失），判定不依赖上限魔法数。试过放弃的 方案：① 续拉整页直到轮边界——多拉无关行、请求量翻倍且不解决显示分裂；② 装配层 跨块段合并（把已装配块的 segments 拼接）——段去重/prompt 归并/子代理重挂语义复杂， 触碰 SSE 共享装配器风险大；③ 探查改为「拉一页看首行」——多拉 400 行只为看一行， 浪费带宽。已裁决边界：limit=1 探查受后端 run 块序影响在交错 run 场景可能漏检页顶 切轮（假阴性，仅保持现状分裂显示，无内容丢失，可接受）；「回到会话开头」请求量约 增 1~2 倍（每页多探查/直达，显式重操作可接受）。
