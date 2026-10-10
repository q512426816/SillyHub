---
author: flow-machine-draft
created_at: 2026-10-10T02:36:32.435Z
---
# 决策记录（Decisions）— 2026-10-10-usage-note-to-daemon-log

## D-001@v1: 风险与死路（design 槽4 收割）
- 类型：process
- 状态：confirmed
- 答案：最大风险：排障入口从"用户可见的会话行"变为"daemon 日志事件"，运维需知道去日志找 `run_cost_may_include_bg_tasks`——通过模块文档 `daemon.md` 同步与本记录留痕缓解。试过放弃的方案：a) 阈值版"只在用量差分明显异常时报"——无真值基准，阈值任意、误报/漏报两头错（见做法概述）；b) 彻底删除不留任何痕迹——丢失原始 FR-04 排障意图（$24.10 归属误导类问题将无现场线索）。
