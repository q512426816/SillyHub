---
author: flow-machine-draft
created_at: 2026-10-30T07:46:14.817Z
---
# 设计记录（Design Record）— 2026-10-30-quota-error-visible

## 做法概述

本变更怎么解决问题？改哪里、为什么选这个方案（一两段）。

畸形组合是「daemon 上报 success + 末条助手输出为模型额度错误文本」：后端 close 只管 is_error=true 的兜底，前端装配器又把 `[ASSISTANT] API Error` 行无条件丢弃（假定错误卡由 turn.errorDetail 承载），于是两边都没接管，页面整轮空白。

后端在 `backend/app/modules/daemon/run_sync/service/close_run_steps.py` 增加 success 轮终态兜底：查该 run 最后一条 `channel='stdout'` 且以 `[ASSISTANT]` 开头的日志，剥前缀后按行首锚定匹配模型错误特征词，再复用既有 `_infer_quota_error`（429 + 额度关键词双锚定）推断 `quota_exceeded`；命中则把本轮按 is_error=true 收口（failed + error_detail），未命中保持 completed。前端在 `frontend/src/components/daemon/runtime-session-helpers.tsx` 的 `logsToTurns` 里对每个 run 做同口径判定，命中时给 turn 回填 `status="failed"` 与 `quota_exceeded` 的 ErrorLogItem，交给既有 RunErrorItem 渲染错误卡——历史/刷新路径立即恢复可见，也是后端上线前旧数据的兜底。

## 接口契约

动了哪些函数/端点/命令/文件格式？对外可见的签名或行为变化是什么（含「无」的说明）？

- 后端新增内部函数 `_infer_quota_error_from_last_assistant_output(svc, agent_run) -> ModelErrorDTO | None`（`close_run_steps.py`，仅供收口路径使用，不新增 HTTP 端点）。
- `close_interactive_run` 行为变化：`status="success" and not is_error` 时若末条 `[ASSISTANT]` 命中额度错误，则按 failed 落库（`error_code=interactive_failed`、`error_detail` 为 ModelError JSON：type/code/message/retryable/hint/raw/reset_at）。其余签名与字段零变化。
- 前端新增内部函数 `terminalQuotaErrorFromEntries(entries) -> ErrorLogItem | null`（`runtime-session-helpers.tsx`，仅模块内/测试可见），复用 `buildErrorLogItem({type:"unknown", raw})` + `isAssistantApiErrorText`；`logsToTurns` 产出的 turn 在该形态下 `status="failed"`、`errorDetail` 非空。`SessionTurnView` 结构零变化。
- 无新增/修改 HTTP 端点、无数据库迁移、无配置文件格式变化。

## 边界与并发（盲维四问——每问必答，答不了即设计缺口）

1. 乱序/迟到到达：输入或事件乱序时，本设计的假设还成立吗？

   以 `timestamp desc, id desc` 取最后一条 `[ASSISTANT]` 行，不依赖事件到达顺序；同毫秒并发用 id 兜底排序。仅末条具备终态语义，因此「错误后又有正常答复」不会误判（FR-02）。日志微批可能晚于 close 请求落库：与既有 quota 兜底同风险面——最坏退化为保持 completed（行为同今日），不新增错误。

2. 并发写：两个执行体同时操作同一数据/文件会发生什么？

   收口路径已持 run 行锁且幂等（TERMINAL_TURN_STATUSES no-op），兜底只发生在首次收口内，无新写入点；前端 `logsToTurns` 是纯函数，无共享写。

3. 切换/生命周期：会话、请求或变更中途切换/中断时状态是否安全？

   判定只读该 run 已终态的日志，不依赖会话当前供应商/engine；若 run 已终态则 close 直接 no-op，不二次改写。前端实时路径由后端终态驱动，历史路径由纯函数还原，刷新前后一致。

4. 作用域：跨工作区/跨仓/多实例时数据会不会串台？

   查询与推断均以 `run_id` 为唯一范围，不跨 run/会话聚合；前端按 `run_id` 分组后逐组判定，不会把上一轮的错误带到下一轮。

## 风险与死路

本方案最大的风险是什么？试过但放弃的方案及放弃理由？

最大风险是误判「重试后成功但无最终文本」的轮次。已用两道门收窄：① 只看最后一条 `[ASSISTANT]` 行（`[MODEL_RETRY]` 协议行不匹配错误特征词，直接放行）；② 必须同时命中 429 与额度关键词（复用既有双锚定 `_infer_quota_error`）。放弃的方案：改 daemon 侧识别 `isApiErrorMessage/apiErrorStatus` 字段——需要重建并重启共享守护进程，影响所有在线用户，且平台侧对旧 daemon 版本仍需兜底；放到后续 daemon 变更单独处理。第二个放弃方案：前端装配器不再丢弃 API Error 行——会在已失败轮上产生「原文气泡 + 错误卡」双显，改为按末条错误回填结构化卡。

## 文件变更清单

| 操作 | 路径 | 说明 |
| --- | --- | --- |
| 修改 | backend/app/modules/daemon/run_sync/service/close_run_steps.py | success 轮末条 [ASSISTANT] 额度错误兜底推断并落 failed/error_detail |
| 修改 | backend/app/modules/daemon/tests/test_close_interactive_run_quota_log_fallback.py | 新增 FR-01/FR-02 用例（success 形态 / 重试后成功 / 最后一条 MODEL_RETRY） |
| 修改 | frontend/src/components/daemon/runtime-session-helpers.tsx | logsToTurns 末条 [ASSISTANT] 额度错误回填 errorDetail + failed |
| 修改 | frontend/src/components/daemon/__tests__/runtime-session-helpers.test.tsx | 新增 FR-03/FR-04 前端用例 |
| 修改 | frontend/src/components/daemon/turn-timeline.tsx | errorDetail 字段注释同步 logsToTurns 回填语义（注释级，无行为变化） |
