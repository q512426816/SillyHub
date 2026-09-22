---
author: qinyi
created_at: '2026-09-15 16:27:12'
---

# 提案书（Proposal）— 2026-09-15-background-task-permission-lockout

## 动机

线上会话 6e213eb3（奖惩功能开发，2026-09-15）排查实锤：主轮次收尾后仍在运行的后台
Task 子代理被写通道守卫整体锁死，重试最长 94.5 分钟 / 1030 次工具调用，烧掉 ~87M
cache-read token（~$46 估价）；后端权限受理端对重启后到达的权限/问答请求 fail-soft
静默丢弃，用户永远看不到问答卡且 SDK 侧无界挂起。本变更从根上修复「后台任务存活期
× 轮次生命周期错位」这一族缺陷。

## 关键问题

1. **守卫不感知后台任务注册表**：`onResult` 清 `currentRunId` 后，`writeChannelGuardDeny`
   对后台子代理全部写类工具调用 fail-closed deny（`session not in running turn`），
   同 run 重试不可自愈——本会话至少发生 5 次（复审/TaskCard/task-03/task-04 子代理与
   主会话各一次），是最大效率杀手与费用黑洞。
2. **后端受理端静默丢弃**：backend 重启终态化 run 后，仍在执行的 SDK 轮次发出的
   PERMISSION_REQUEST（含 AskUserQuestion 问答卡）被 `permission_request_run_mismatch`
   静默丢弃（日志实锤 current_run_id=null）；dialog 类请求两侧均无超时——无界挂起。
3. **重启终态化无错误码 + 用量归属误导**：`_cleanup_stale_runs_impl` 标 failed 不写
   error_code；SDK 会话级累计用量差分把后台任务消耗记到下一个收口的 run（19 秒小轮
   被记 $24.10），排障与账单两头误导。

## 变更范围

- daemon：`onResult` 后台锚点（注册表非空保留 currentRunId，任务全终态清除）；守卫
  新增 `hasBackgroundTaskGrace` 放行；4 处可达 register 调用点统一注入
  `background_task` 标记；后台 dialog 请求启用 5 分钟有界兜底；守卫/拒收 deny 文案带
  `PLATFORM_NO_RUNNING_TURN:` / `PLATFORM_PERMISSION_DROPPED:` 稳定故障码前缀；
  run 用量上报时追加 `[USAGE_NOTE]` 标注日志行；SessionManager 新增
  `hasLiveBackgroundTasks` 只读访问器。
- backend：`PermissionRequestPayload.background_task` 字段；受理端对带标记请求放宽
  active-turn 校验（run 直查 + 会话归属校验）；全部校验失败分支推即时 deny（带
  runtime_id ack 键）；`_cleanup_stale_runs_impl` 补 `error_code=SERVICE_RESTART_INTERRUPTED`。

## 不在范围内（显式清单）

- 按任务拆分用量（SDK 只给会话级累计快照，无数据源）
- 上游 CLI `task_progress` 的 `total_tokens=0`（忠实透传，纯 cosmetic）
- 真实计费价目表（`total_cost_usd` 维持 SDK 估价并如实呈现）
- 问答卡「复活/补发」机制（本变更保证有界拒收可见，不复活历史卡）
- daemon 自更新在后台任务存活期的重启策略（R-06，现状非回归，留后续）
- 后台任务通知截断/风暴（P1-1/P1-2，另立变更 2026-09-15-background-task-notification-delivery）
- 前端 UI 任何改动

## 成功标准（可验证）

- 旧 daemon + 新 backend：行为与现状完全一致（`background_task` 缺省 None 走原校验）
- 新 daemon + 新 backend：主轮收尾后注册表非空时，后台子代理写类工具调用放行且
  权限请求被后端受理；任务全终态后守卫自动恢复 fail-closed
- 权限请求被后端拒收时，daemon 在有界时间内（普通=即时、dialog≤5min）收到带
  `PLATFORM_PERMISSION_DROPPED:` 前缀的 deny；主轮进行中的 dialog 仍无超时（语义不变）
- 重启终态化的 run 带 `error_code=SERVICE_RESTART_INTERRUPTED` + error_detail
- 后台任务存活期收口的 run 有一条 `[USAGE_NOTE]` 标注日志行
- 既有 permission/session 相关测试保持绿（fail-soft 断言按新行为修订）
