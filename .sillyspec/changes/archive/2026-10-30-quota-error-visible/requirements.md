---
author: flow-machine-draft
created_at: 2026-10-30T07:46:14.817Z
---
# 需求规格（Requirements）— 2026-10-30-quota-error-visible

## 功能需求

### FR-01: 后端收口时若上报 success 且最后一条 [ASSISTANT] 输出命中模型错误文本（API Error / Request rejected 等）且同时含 429 与额度关键词，则将该 run 落为 failed、error_code=interactive_failed、error_detail.type=quota_exceeded（保留 code/raw/reset_at）。

- 后端 `close_interactive_run` 必须在 `status="success"` 且 `is_error=False` 时检查该 run 最后一条 `[ASSISTANT]` stdout 日志行；若该行（剥去 `[ASSISTANT]` 前缀后）以模型错误特征词开头且同时命中 429 与额度关键词，则**必须**把本轮按失败收口：`status="failed"`、`exit_code=1`、`error_code="interactive_failed"`、`error_detail.type="quota_exceeded"`（带 `code` / `raw` / `reset_at`）。禁止让该组合继续落成 `completed`。

#### 场景：共享守护进程额度耗尽（生产实证 b696aa0c）

- Given daemon 以 `status="success" / is_error=false` 收口，最后一条 `[ASSISTANT]` 日志为 `API Error: Request rejected (429) · [1308][已达到 5 小时的使用上限。您的限额将在 2026-10-30 17:13:29 重置。]`
- When 后端执行 `close_interactive_run`
- Then run 终态为 `failed`、`error_code=interactive_failed`，`error_detail.type=quota_exceeded`、`code=1308`、`reset_at=2026-10-30T17:13:29+08:00`，`raw` 保留原始错误文本

### FR-02: 错误行之后仍有正常 [ASSISTANT] 文本（CLI 自动重试成功）或最后一条是 [MODEL_RETRY] 协议行时不得误判，run 保持 completed 且 error_detail 为空。

- 收口兜底**禁止**仅因 run 中出现过 API Error 行就判失败：`[ASSISTANT]` 日志中只有**最后一条**具备终态语义；若其后还有正常 `[ASSISTANT]` 文本，或最后一条是 `[ASSISTANT] [MODEL_RETRY]` 协议行，则 run **必须**保持 `completed`、`error_detail` 为 NULL。同一 timestamp 的多行（daemon 微批落库）无法用随机 id 表达先后，**必须**按「同刻组内出现任一非错误文本即判成功」的保守规则处理，禁止依赖 id 排序误杀重试成功的轮次。

#### 场景：CLI 自动重试后成功

- Given 同一 run 的日志依次为额度错误行、`[MODEL_RETRY]` 协议行、正常 `[ASSISTANT]` 答复
- When 后端执行 `close_interactive_run`（success / is_error=false）
- Then run 保持 `completed`，`error_detail` 为 NULL

#### 场景：重试协议行是最后一条

- Given 最后一条 `[ASSISTANT]` 行是 `[ASSISTANT] [MODEL_RETRY] {...}`（载荷含 429 字样）
- When 后端执行 `close_interactive_run`（success / is_error=false）
- Then 不推断额度错误，run 保持 `completed`

### FR-03: 前端会话页（历史回看与刷新恢复路径）对这类轮次渲染「额度耗尽」RunErrorItem 错误卡，含原始错误摘要与重发/切换供应商入口，不再整轮空白。

- 前端 `logsToTurns` **必须**对每个 run 的最后一条 `[ASSISTANT]` 日志做同样的终态判定；命中额度错误时给该 turn 回填 `status="failed"` 与 `errorDetail`（`type=quota_exceeded`，`raw` 为原始错误文本），使会话页渲染既有 `RunErrorItem` 错误卡（含原因、原始错误摘要、重发/切换供应商入口）。禁止继续丢弃该轮全部内容造成空白轮。

#### 场景：刷新后历史轮显示额度卡

- Given 历史日志含 `[ASSISTANT] API Error: Request rejected (429) · [1308]…使用上限…` 且该 run 无 run 快照 error_detail
- When 会话页通过 `logsToTurns` 还原该轮
- Then 该 turn 的 `errorDetail.type=quota_exceeded`、`status=failed`，页面渲染「额度耗尽」错误卡而非空白

### FR-04: daemon 已回传 is_error=true 的既有失败轮错误卡行为零变化；成功且无错误文本的轮次零变化。

- 本变更**禁止**改动 daemon 已回传 `is_error=true` / `error_detail` 的既有失败轮映射（daemon 回传优先，日志兜底不覆盖）；成功且末条 `[ASSISTANT]` 非模型错误文本的轮次**必须**保持 `completed`、无错误卡。前端合并 turn 时，run 快照回传的 `error_detail` **必须**优先于 `logsToTurns` 的日志兜底（含系统级 error_detail 占位），日志兜底只在快照无 error_detail 时补位。

#### 场景：daemon 回传额度错误不被覆盖

- Given daemon 已回传 `error=quota_exceeded`（或其它 ModelError）
- When 后端收口
- Then `error_detail` 保持 daemon 回传值，日志兜底不参与

#### 场景：普通成功轮零变化

- Given run 成功且最后一条 `[ASSISTANT]` 是正常答复
- When 后端收口与前端还原
- Then run 仍为 `completed`，页面无错误卡

### FR-05: 新增 backend 收口兜底用例与 frontend logsToTurns 兜底用例，相关测试全绿。

- 本次变更**必须**新增覆盖 FR-01 / FR-02 的后端用例与覆盖 FR-03 的前端用例，并保证所触及测试文件全部通过。

#### 场景：回归门

- Given 上述新增用例与既有相关用例
- When 执行 backend `test_close_interactive_run_quota_log_fallback.py` 与 frontend `runtime-session-helpers.test.tsx`
- Then 全部通过，且既有失败轮/成功轮断言零改动失败

## 测试绑定（每条 FR 至少一行——`FR-NN: test/路径「用例名」`；空行/待填在 flow done 拒收）

FR-01: backend/app/modules/daemon/tests/test_close_interactive_run_quota_log_fallback.py「test_success_result_with_quota_error_log_closed_as_failed」
FR-02: backend/app/modules/daemon/tests/test_close_interactive_run_quota_log_fallback.py「test_quota_error_followed_by_normal_assistant_text_keeps_completed」「test_model_retry_line_as_last_assistant_keeps_completed」「test_same_timestamp_normal_answer_keeps_completed」；frontend/src/components/daemon/__tests__/runtime-session-helpers.test.tsx「logsToTurns 同刻正常答复与额度错误并存 → 保守 completed（同刻组判定）」
FR-03: frontend/src/components/daemon/__tests__/runtime-session-helpers.test.tsx「logsToTurns 末条 [ASSISTANT] 额度错误文本回填 quota_exceeded 与 failed」
FR-04: backend/app/modules/daemon/tests/test_close_interactive_run_quota_log_fallback.py「test_daemon_error_takes_precedence_over_log_inference」；frontend/src/components/daemon/__tests__/page-helpers-error-visibility.test.ts「run 快照 error_detail 优先于 turn 日志兜底（2026-10-30 评审 P1）」「run 快照无 error_detail 时保留 turn 日志兜底（额度卡）」；frontend/src/components/daemon/__tests__/runtime-session-helpers.test.tsx「logsToTurns 正常成功轮不产生 errorDetail」
FR-05: 不适用：验收由 FR-01..FR-04 所列测试用例的执行结果承担（无独立可执行面）
