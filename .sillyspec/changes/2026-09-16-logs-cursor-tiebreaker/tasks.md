---
author: qinyi
created_at: 2026-09-16 08:35:00
change: 2026-09-16-logs-cursor-tiebreaker
---

# 任务清单（Tasks）— 2026-09-16-logs-cursor-tiebreaker

> Wave 划分对齐 design.md 总体方案；依赖关系行内注解 `(depends_on: ...)` 供 taskcard 反填。

## Wave 1（backend 复合游标）

- [ ] task-01: read_model.py get_agent_session_logs 新增 before_id 参数与复合过滤分支（(ts<before) OR (ts=before AND id<before_id)；缺省保持 <= 现行语义逐字一致），docstring 游标段同步
- [ ] task-02: session_insights.py 日志端点新增 before_id Query 参数透传 + 单独传 before_id 无 before 422 校验（先例 machines.py:488-494 / session_team.py:420-436）
- [ ] task-03: backend 复合游标测试（test_group_logs_pagination.py）：同 ts 150 行批两页可达零重叠 / 缺省 before_id 行为回归 / 单独 before_id 422 (depends_on: task-01, task-02)
- [ ] task-04: openapi.json 重导出 + 前端 pnpm gen:types（api-types.ts 提交，rule 21 不欠类型债）(depends_on: task-02)

## Wave 2（frontend 二元组游标）

- [ ] task-05: sessions.ts getAgentSessionLogs opts+params 加 beforeId（仅与 before 同时传）
- [ ] task-06: session-panel-page.tsx 游标二元组化——新 historyCursorIdRef；**翻页 :1074 与初始加载 :689 两写点均设 id**；换会话重置 :662 同步清；请求透传 :1053；pageKey 加游标 id 前 8 位后缀 :1093；loadEarlierOnce 进度判定二元组比较 :1129-1131 (depends_on: task-04, task-05)
- [ ] task-07: frontend 翻页测试——before_id 透传 / 同 ts 不同 id 判定有进度（跳转循环不误 break）/ 换会话游标重置 / 初始加载后首翻带 beforeId；**连带回归**：session-history-scroll.test.tsx 三场景（触顶 loadEarlier+prepend/连续 3 页 cursor 递减/overflowAnchor）与既有 getAgentSessionLogs mock 参数断言套件随改校准 (depends_on: task-06)

## 验收

- [ ] task-08: verify——proposal 成功标准逐条对账（150 行批两页取尽/缺省逐字节回归/422/gen:types:check/双端相关测试绿）+ R-02 执行计划观察（分页测试耗时无显著回退）(depends_on: task-03, task-07)
