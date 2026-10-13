---
author: flow-machine-draft
created_at: 2026-10-13T01:07:19.831Z
---
# 任务注册表（Tasks）— 2026-10-13-agent-task-stuck-running

- [x] task-01: daemon claude-events.ts `_toolUseSessionSignals` Task/Agent 分支 metadata 补带 tool_use_id（值=call id）——验证：daemon 既有 claude-events 相关测试跑绿 + 新断言
- [x] task-02: daemon background-tasks.ts `handleTaskNotificationEvent` 终态处理加别名条目注销/补发（主条目缺失才补发 emit+落行）+ 三无分支 WARN 日志——验证：background-tasks 新增用例跑绿
- [x] task-03: frontend session-log-assembler.ts task 行提取 task_id 落段元数据（SessionLogSegment.taskTaskId / ToolTurnSegment.taskTaskId / applyTaskMeta）+ parent 未命中按 task_id 轮内 DFS 兜底吸收——验证：task-line-assembler 新增用例跑绿
- [x] task-04: 跑 daemon 与 frontend 触达模块全部相关测试确认零回归——验证：两套测试命令退出码 0
