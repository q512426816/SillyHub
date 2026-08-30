---
author: qinyi
created_at: 2026-08-27 09:26:00
change: 2026-08-27-background-subagent-progress
---

# 任务清单（Tasks）

> 注册表（唯一真相）：与 `tasks/task-NN.md` 卡片一一对应，编号连续 task-01~task-15。
> brainstorm 雏形的 task-00 spike 对应本文 task-01；雏形 task-01~15 重排为 task-02~15（共享文件分 Wave 与契约先行的重排说明见 plan.md §1）。

## 任务注册表

- [x] task-01 spike：验证 CLI 0.3.181 运行时 task_* 发射与频率，回填 design.md §10，定节流参数与兜底权重
- [x] task-02 daemon 事件载荷契约（types.ts / hub-client.ts / cli.ts 扩展）
- [x] task-03 session-manager 综合改造（任务表 + task_* 拦截 + 异步回执兜底 + [TASK_*] 持久行 + 节流）
- [x] task-04 daemon 单测（task_* 映射 / 回执解析 / 行格式 / 节流）
- [x] task-05 backend schema 扩展 + notify 端点透传 + Redis publish
- [x] task-06 submit_messages 跨轮归位（LRU + 冷启动反查 + run_id 改写）
- [x] task-07 空 prompt inject 422（SessionEmptyPrompt + 中文文案）
- [x] task-08 backend 单测（透传 / 归位 / 422 / l10n）
- [x] task-09 gen:types 重生成（frontend api-types.ts + backend openapi.json 提交）
- [x] task-10 前端事件类型与 SSE 分发（lib/daemon.ts）
- [x] task-11 assembler [TASK_*] 行解析为段元数据
- [x] task-12 后台卡片全生命周期 + agentTasks state 扩展
- [x] task-13 子代理目录/状态栏/会话块异步感知
- [x] task-14 发送按钮空内容禁点
- [x] task-15 frontend 单测（卡片 / assembler / collectSubagents / 目录）
