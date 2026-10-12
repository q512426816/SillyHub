---
author: flow-machine-draft
created_at: 2026-10-12T10:18:11.320Z
---
# 设计记录（Design Record）— 2026-10-12-stale-run-askwait-fix

## 做法概述

本变更怎么解决问题？改哪里、为什么选这个方案（一两段）。

生产实证（阿里云会话 47e2ff1a run e31ec8fc）：交互轮在 15:21:06 调 AskUserQuestion（tool_kind=ask）等待用户回答，日志自此静默；15:40 后端重启，启动清理 `_cleanup_stale_runs_impl` 按 10 分钟日志活性宽限窗把这轮误判为 `SERVICE_RESTART_INTERRUPTED`；且该错误落库形状（error_detail={reason, finished_by}）前端 `buildErrorLogItem` 解析成 type=unknown/「运行失败」，又把 `??` 链后面的 `buildSystemFailureItem` 挡住，最终用户只看到「运行失败 · unknown」无任何原因。

修复分两层。**后端治本**：判死前加「等待用户回答」豁免——run 的最后一条 ask 信号日志（`pending_input` 通道或 `tool_call` 通道且 `tool_kind='ask'`，即 AskUserQuestion 类提问的落库形态）晚于最后一条 `user_input` 日志即视为在等用户，跳过判死保持 running；同时 `_mark_stale_run_failed` 的 output_redacted 改中文可读原因（经 SessionRunRead.failure_summary 透出错误卡）。选日志信号而非 SessionDialogRequest 表：生产实证该交互轮在 dialog 表无行（交互会话 AskUserQuestion 不走 permission dialog 扩展），日志列是唯一可靠落库形态；且纯日志判定重启免疫（lease/心跳在重启瞬间必然陈旧，`_run_daemon_alive` 在启动清理时点不可用）。**前端治标**：`buildErrorLogItem` 对无模型错误键（type/code/message/retryable/hint/raw/reset_at 均缺）的字典返回 null，让 `page-helpers` 的 `??` 链回落 `buildSystemFailureItem`；`SYSTEM_ERROR_CODE_META` 收录 `SERVICE_RESTART_INTERRUPTED`（对齐 daemon_* 码族的 PowerOff/中性蓝灰样式）；任务日志页（agent-run-panel → agent-log-viewer）把已拉到的 error_code/failure_summary 透传进 `normalizeLogs` 兜底链。

## 接口契约

动了哪些函数/端点/命令/文件格式？对外可见的签名或行为变化是什么（含「无」的说明）？

- `_run_awaiting_user_input(session, run_id) -> bool`（backend agent/service.py 新增模块级函数）：读 agent_run_logs 两个 max(timestamp)（ask 信号行 / user_input 行），ask 更晚（或无 user_input）→ True。私有 helper，不对外。
- `_cleanup_stale_runs_impl`：无锁预判段在日志活性宽限检查之后追加 awaiting-user 豁免（命中 → log `stale_run_cleanup_deferred_awaiting_user` + continue），行锁面不变。行为变化：等待用户回答的停滞轮不再被启动清理终态化。
- `_mark_stale_run_failed`：output_redacted 文案英文 → 中文（「平台服务重启，本轮执行被中断；会话上下文已保留，可重新发送继续。」）；status/error_code/error_detail 形状不变（迟到成功回正 FR-02 匹配键不动）。
- `buildErrorLogItem(errorDetail)`（frontend normalize.ts）：无模型错误键的字典返回值 non-null → null。调用方（page-helpers `??` 链、normalizeLogs 兜底链）回落系统失败映射。
- `NormalizeOptions` 增可选 `errorCode`/`failureSummary`；`normalizeLogsImpl` 末尾兜底链扩为 `buildErrorLogItem ?? buildSystemFailureItem(errorCode, failureSummary)`，仍无果且 failed → 「运行失败（无详情）」既有兜底。`hasStructuredError` 同步纳入两新字段。
- `AgentLogViewer` 增可选 props `runErrorCode`/`runFailureSummary`；`AgentRunPanel` 在既有 listSessionRuns 拉取处同批 set 并透传。均向后兼容（不传行为不变）。
- OpenAPI schema 无改动（未动 DTO/端点），无需 `pnpm gen:types`（SessionRunRead 的 error_code/failure_summary 字段既有）。

## 边界与并发（盲维四问——每问必答，答不了即设计缺口）

1. 乱序/迟到到达：输入或事件乱序时，本设计的假设还成立吗？

判定只依赖「最后 ask vs 最后 user_input」的相对时序，不依赖日志到达顺序；用户回答（user_input 晚于 ask）后即使日志尚未恢复流动，豁免即失效、判死兜底照常——不会把已回答的轮永久豁免。迟到成功结果经 FOR UPDATE 重读守卫（既有）不受影响。

2. 并发写：两个执行体同时操作同一数据/文件会发生什么？

豁免判定在无锁预判段（零锁面，对齐 2026-10-09 锁粒度收窄哲学），跳过时不取行锁不写行；判定与落库之间无新竞态窗（跳过路径零写入）。真正判死路径的并发收口守卫（populate_existing 重读）原样保留。

3. 切换/生命周期：会话、请求或变更中途切换/中断时状态是否安全？

豁免的 run 保持 running；daemon 真死由 daemon 离线清扫（sweep，worker/主会话双分组落 daemon_interrupted）兜底，不产生永久僵尸；用户回答后 inject 链路恢复日志流动，回正常终态路径。前端老数据（无新键的旧 error_detail）回落系统映射，展示口径统一。

4. 作用域：跨工作区/跨仓/多实例时数据会不会串台？

豁免按 run_id 维度查自身日志，跨会话/跨工作区/多实例（多 daemon）互不串台；启动清理本就全库扫 running 轮，逐轮独立判定。

## 风险与死路

本方案最大的风险是什么？试过但放弃的方案及放弃理由？

最大风险：**豁免过宽导致 run 永卡 running**——若提问落库形态判定漏/多。控制：信号仅两种窄形态（pending_input 通道、tool_call+tool_kind=ask，均实证于生产数据），且 daemon 死亡面有 sweep 独立兜底，宽限跳过与判死兜底（延迟复扫）链路不变。

试过但放弃的方案：
- **复用 `_run_daemon_alive` 给启动清理加活性门**——放弃：启动清理发生在后端重启瞬间，daemon 可能尚未重连续约，lease updated_at 必然陈旧 → 活性门恒 False，等于没加；且多一次 lease/runtime/instance 三级查询。日志 ask 信号是重启免疫的确定性判据。
- **SessionDialogRequest pending 行作豁免信号**——放弃：生产实证交互会话的 AskUserQuestion 不落该表（run e31ec8fc 在 dialog 表 0 行），信号覆盖率不足。
- **error_detail 直接补 type/message 键**（不动前端）——放弃：调度层错误不是模型错误，硬塞 type 会进 8 类模型错误映射语义；且存量已落库的 {reason, finished_by} 行仍显示 unknown，前端回落才是全量修复。

## 文件变更清单

本变更交付面（与提交 c782a9249 一致）：

- backend/app/modules/agent/service.py（FR-01/02：`_run_awaiting_user_input` 新增 + 启动清理豁免 + `_mark_stale_run_failed` 中文原因）
- backend/app/modules/agent/tests/test_cleanup_stale_runs_error_code.py（FR-06：3 个豁免用例 + 中文断言）
- backend/tests/modules/daemon/test_close_interactive_run_retroactive.py（FR-02 夹具同步：output_redacted 英文 → 新中文文案）
- frontend/src/components/agent-log/normalize.ts（FR-03/05：alien 字典返回 null + NormalizeOptions 扩展 + 兜底链接入）
- frontend/src/components/agent-log/run-error-item.tsx（FR-04：SYSTEM_ERROR_CODE_META 收录 SERVICE_RESTART_INTERRUPTED）
- frontend/src/components/agent-log/__tests__/normalize.test.ts（FR-07：alien 回落 + 兜底链用例）
- frontend/src/components/agent-log/__tests__/run-error-item.test.tsx（FR-07：SERVICE_RESTART_INTERRUPTED 渲染用例）
- frontend/src/components/agent-log-viewer.tsx（FR-05：runErrorCode/runFailureSummary props 透传）
- frontend/src/components/agent-run-panel.tsx（FR-05：listSessionRuns 同批取码并透传）

