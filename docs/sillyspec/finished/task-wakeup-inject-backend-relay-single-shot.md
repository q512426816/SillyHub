# 任务唤醒注入经后端中转单发无重试——会话楔死至用户手动来消息

**发现**：2026-10-26 22:41，会话 e132e9bf（runtime e9da368c）生产实证。
**状态**：✅ 已关闭（2026-10-27，变更 2026-10-27-task-wakeup-inject-retry 修复，随 seq46 部署 4597eab86 上线）。

## 现象与根因

后台任务终态唤醒注入链：daemon `scheduleTaskWakeup`（2s debounce）→ `deps.onTaskWakeupInject`（cli.ts）→ `hub-client.injectSessionPrompt` POST 后端 `/api/daemon/sessions/{id}/inject` → 后端建 run/user_input 后经 WS 回推 daemon 本地投递。原实现**单发即弃**——catch 仅 console.error，注入撞后端短暂不可用窗即 `interactive_inject_send_failed` 永久丢失；且末任务终态注销已先清后台锚点（注册表清空+active→currentRunId=undefined），会话 active 无 currentRunId 楔死：agent 只读工具放行、写工具 `PLATFORM_NO_RUNNING_TURN` 拒绝，直到用户真实消息才恢复。

**实证链**（daemon.log + 会话导出）：

- 22:38:31 run 4966a9c3 failed `interactive_inject_send_failed`（早前失败任务合并通知，回合关闭同秒竞态）
- 22:41:34.922 `task wakeup inject failed: HTTP 504 DAEMON_RUNTIME_OFFLINE`（daemon.log:323275）
- 22:47:13 `daemon.heartbeat_failed HTTP 502`——后端正被另一会话部署重建（22:48:30 seq41 部署完成）
- runs 4966a9c3/f74aa3f4 双 failed started=None；会话楔死过夜至用户次日来消息

## 修复（2026-10-27-task-wakeup-inject-retry）

- `scheduleTaskWakeup` 注入改**退避重试循环**：默认 5s/15s/30s/60s/120s/300s 六档（总窗约 9.3min 盖住部署重建窗），成功即止；退避等待后查 `_store` 会话终态即中止；耗尽 error 留痕。
- env `SILLYHUB_TASK_WAKEUP_RETRY_DELAYS_MS` 可配计划、`0`/空=禁用回单发（止血开关，对齐 QUIET_MS 惯例）。
- 重试幂等性依据：backend 忙轮排队合并 `_merge_task_wakeup_prompt` 恒≤1 条 + prompt 自带「不要重复执行」指令。
- 附带修：`notePhaseEmit` 增 per(point,session,run) 有界防重——TRACE 开启时记点曾随 envelope 同秒刷 30+ 行（daemon.log 323219-323256）。
- 测试：重试四态 + 防重两用例，两文件 36 用例全绿；子代理独立评审 PASS 零发现。

## 备选方向评估（落选理由存档）

- **B 唤醒注入成功才清锚点**：锚点（hasBackgroundTaskGrace）只影响「CLI 执行中写通道守卫放行」，不产生新轮次——注入失败会话仍不醒，楔死未解决。
- **C daemon 本地直投不经后端**：run/user_input 落库与前端时间线是 backend inject 职责，绕不开后端建 run；后端不可用窗内 run 记录同样建不了，故障后移。

## 关联

- 变更归档：`.sillyspec/changes/archive/2026-10-27-task-wakeup-inject-retry/`
- 上线：docs/releases/2026-10-27-003（seq46，commit 4597eab86，"唤醒退避重试"）
- 同族观测坑（turn_phase first_event 刷屏）已随本变更防重修复一并关闭。
