---
author: qinyi
created_at: 2026-09-10 08:55:00
change: 2026-09-10-auto-resume-interrupted-turn
---

# 提案（Proposal）— daemon 重启后自动续跑被中断的交互轮

## 问题

daemon 重启时，进行中的一轮（run）被收敛为 `failed(daemon_restarted)`、会话经
reconnecting→active 自动恢复（上下文完整保留）——但**被中断那轮的任务不会自动继续**：
用户必须注意到失败卡、手动点「重新发送」。生产实例（阿里云会话
e3d7ddfa-666e-4c2d-9d52-eb0ccb16079d，2026-09-09）：一天内 daemon 重启 3 次，
打断 3 轮，每轮都需人工重发。

用户期望：**重启恢复后，被中断的任务自动继续执行**（不是仅恢复会话连接）。

## 方案（用户已确认：全自动 + 续跑提示词包装 + 默认开启）

- **入队点 = `recover_session_after_daemon_restart`**（backend，recovery.py）：该函数
  手里有 `interrupted_run_id` 且与中断 run 收敛同事务（入队段包 SAVEPOINT——DB 失败
  弃续跑保恢复主链）——守卫全过时，取被中断 run 的最后一条 `user_input` 日志，包一层
  续跑提示词（告知 agent 已中断、先自查已完成部分再继续，防副作用重复执行），以
  `origin='auto_resume:<源run id>'` 复合值标记落 `AgentSessionQueuedMessage`
  （pending，position 置队首）。
- **派发 = 复用为主**：`confirm_session_reconnected` 翻 active 后的 D-008 排队消息
  补派发钩子（已存在）发现有 pending 条目即走既有 `dispatch_next_queued_message` →
  inject 既有链路（会话行锁/current_run 复查/失败兜底全继承）；派发侧仅加一道
  派发时守卫（source 轮之后用户已手动重发/新发言 → 删行跳过）与打标传递。
- **恢复失败兜底 = 已存在**：restoreAndReconnect 抛错 → `mark_session_recovery_failed`
  → `_fail_pending_queued_messages`（续跑条目随会话终态收敛 failed，不残留）。
- **守卫矩阵**（详见 design）：仅 `daemon_restarted` 触发（`daemon_stopped` 优雅停
  止不自动复活）；仅主会话（parent NULL 且 kind=chat）；带附件标记的输入降级手动
  （附件不随自动重发复活）；无 user_input 不触发；**续跑链上限 2 次**（防 daemon
  崩溃循环反复自动重发——沿 run metadata.auto_resume_of 链回溯计数）；幂等去重
  （同 source_run 的 pending auto_resume 条目已存在不重复入队）。
- **配置**：`session.config.auto_resume_interrupted`（缺省=开启，false=关闭），
  会话配置条（SessionConfigBar）加开关。
- **审计/可见性**：派发时给新 run 打 `metadata.auto_resume_of=<源 run id>`（前端
  可识别渲染「自动续跑」标记）；失败卡对 daemon_restarted 显示"恢复后将自动续跑"
  提示。

## 预期收益

- daemon 重启/崩溃后，被中断的任务无人工介入自动继续（上下文完整，带自查防重复）；
- 复用排队消息通道与 inject 既有链路——派发侧零新逻辑、daemon 零改动；
- 续跑轮有完整审计链（origin 标记 + run metadata 链），前端可识别。

## 不在范围内（Non-Goals）

- 群聊影子会话（group_member）与 worker 子会话（后者已有 worker_redispatch 自动重派）；
- `daemon_stopped`（用户主动优雅停止）自动复活；`interactive_inject_send_failed` 等其它错误码；
- 附件自动重发（附件引用快照过期风险，降级手动按钮）；
- 跨机器续跑 / daemon 侧本地自注入（方案 B 已否）。

## 风险摘要

最大风险 = 副作用重复执行（agent 中断前已做一半的操作被做两遍）——由续跑提示词
包装（先自查再继续）+ 仅 daemon_restarted 触发 + 链上限 2 次三重收敛；次风险 =
崩溃循环自动重发风暴——链上限 + 幂等去重；其余见 design.md 风险登记。
