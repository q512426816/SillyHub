---
author: qinyi
created_at: 2026-09-10 08:55:00
change: 2026-09-10-auto-resume-interrupted-turn
---

# 需求（Requirements）— daemon 重启后自动续跑被中断的交互轮

## 背景

- daemon 重启恢复链现状（2026-08-28 起）：中断 run → `failed(daemon_restarted)`，
  会话 → reconnecting → daemon restoreAndReconnect（上下文恢复）→ confirm 翻
  active。上下文不丢，但被中断的**任务**需用户手动点失败卡「重新发送」。
- 生产实例：会话 e3d7ddfa（pi）单日 3 轮被 daemon 重启打断，均需人工重发。
- 既有可复用件：排队消息通道（AgentSessionQueuedMessage + D-008 confirm 钩子 +
  dispatch_next_queued_message）、worker 自动重派先例（守卫/节流思想）。

## 功能需求（FR）

- **FR-01 恢复链自动入队续跑**：`recover_session_after_daemon_restart` 守卫全过时，
  取被中断 run 的最后一条 `user_input` 日志文本，包续跑提示词后以
  `origin='auto_resume'` 落 pending 排队消息（与 run 收敛同事务；幂等去重）。
- **FR-02 复用派发链**：confirm 翻 active 后由既有 D-008 钩子派发（排队消息通道
  原样，含行锁/current_run 复查/失败兜底）；恢复失败路径既有
  `_fail_pending_queued_messages` 收敛续跑条目。
- **FR-03 守卫矩阵**（任一不满足 → 不自动，保留手动按钮；入队时 G1-G9+满员，派发时 G10）：
  1. 触发错误码白名单：仅 `daemon_restarted`；
  2. 范围：主会话（`parent_session_id IS NULL` 且 `session_kind='chat'`）；
  3. 开关：`session.config.auto_resume_interrupted` 显式 `false` 才关（缺省开）；
  4. 输入存在且未截断：被中断 run 有 `user_input` 日志且长度未触 5000 截断上限；
  5. 无附件：输入不含附件标记行（复用后端 `attachment_marker_line` 单一源宽松前缀）；
  6. 最新轮（入队时）：该 run 是会话最新 run；
  7. 链上限 2：沿 `run.metadata.auto_resume_of` 链回溯计数；
  8. 幂等：同 source_run 的 pending `auto_resume` 条目已存在不重复入队；
  9. 无被取消 pending dialog：中断时正挂 AskUser 提问的轮不自动续跑（断点语义不同，降级手动）；
  10. 队列未满员：pending < 5（SESSION_QUEUE_MAX_PENDING）才入队；
  11. **派发时守卫**：派发重放前复查 source_run 之后无更新 run（用户已手动重发/新发言 → 静默删行跳过）。
- **FR-03a 入队事务语义**：入队段包 SAVEPOINT——DB 级失败弃续跑保恢复主链（recover 照常 commit）；进程崩溃则 run 收敛+入队全有或全无。
- **FR-03b 队列序**：续跑条目 position 置队首（先于重启前已 pending 的追问——恢复原执行顺序）；edit/reorder 对续跑条目 409 拒绝（防改坏包装头/固定队首语义），delete 允许（=用户手动取消自动续跑）。
- **FR-04 续跑提示词包装**：固定中文包装头（声明中断事实+先自查已完成部分+从断点
  继续+勿重复已完成步骤）+ 分隔线 + 原输入全文。包装模板单一源常量。
- **FR-05 续跑轮审计标记**：派发落地的新 run 写 `metadata.auto_resume_of=<源 run id>`
  （供链上限计数与前端识别）。
- **FR-06 会话级开关**：SessionConfigBar 加「中断自动续跑」开关（默认开），新端点
  `PATCH /sessions/{id}/auto-resume`（路由照 ctx-window 先例、存储照 config merge
  先例）持久化到 `session.config.auto_resume_interrupted`。
- **FR-07 前端可见性**：daemon_restarted 失败卡 hint 由父级按开关状态注入（开=
  "会话恢复后将自动续跑本轮"；关="会话已保留，可手动重发"——该错误码当前不在
  前端映射表，无既有 hint）；续跑轮徽标（识别 run metadata.auto_resume_of）。

## 非功能需求（NFR）

- **NFR-01** 不改变既有恢复/排队语义：recover/confirm/mark-failed 既有行为与测试
  零回归（新逻辑全部旁路 best-effort，异常不阻断恢复主链）。
- **NFR-02** migration 线性追加（`agent_session_queued_messages.origin` TEXT NULL、
  `agent_runs.metadata` JSON NULL），downgrade 对称；PPM 模块零涉及。
- **NFR-03** 续跑入队失败（如日志查询异常）仅记日志不回滚恢复事务——会话恢复
  优先于续跑。
- **NFR-04** 三端兼容（Windows/Linux/macOS）：纯 backend+frontend，无平台分支。

## 验收标准（部分）

- 守卫矩阵 8 条各有正反用例（触发/不触发各一）；
- 崩溃循环场景：连续 2 次自动续跑后第 3 次中断不再自动（手动仍可）；
- 恢复失败场景：续跑 pending 条目随 `_fail_pending_queued_messages` 收敛 failed；
- 既有 test_session_recovery / queue 全量零回归。
