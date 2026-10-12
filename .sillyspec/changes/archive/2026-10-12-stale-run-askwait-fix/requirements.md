---
author: flow-machine-draft
created_at: 2026-10-12T10:18:11.320Z
---
# 需求规格（Requirements）— 2026-10-12-stale-run-askwait-fix

## 功能需求

### FR-01: 后端：启动清理判死前检查「最后一条 ask 信号日志（pending_input 通道或 tool_call 通道 tool_kind=ask）晚于最后一条 user_input 日志」，命中则跳过判死保持 running。

- 后端启动清理（`_cleanup_stale_runs_impl`）必须在对日志停滞的 running 轮判死（`_mark_stale_run_failed`）之前检查等待用户回答状态（`_run_awaiting_user_input`：最后一条 ask 信号日志（`pending_input` 通道或 `tool_call` 通道且 `tool_kind='ask'`）晚于最后一条 `user_input` 日志，或存在 ask 信号而无 user_input），命中时禁止终态化该轮（status 保持 running、不写 error_code/finished_at）。

#### 场景：主路径（等待回答豁免）

- Given 一个 num_turns=0/exit_code=None 的 running 轮，日志仅有 user_input（30 分钟前）与 tool_call/tool_kind=ask（25 分钟前）
- When 启动清理执行
- Then 该轮保持 running，error_code 为空，cleaned 计数不含该轮

#### 场景：边界（已回答不豁免）

- Given ask 信号（30 分钟前）早于 user_input（25 分钟前，已回答）
- When 启动清理执行
- Then 该轮照常判死：status=failed + error_code=SERVICE_RESTART_INTERRUPTED（防永卡兜底不缩小）

#### 场景：边界（pending_input 通道同享豁免）

- Given 日志仅有 pending_input 通道 ask 信号（25 分钟前）且已停滞超宽限窗
- When 启动清理执行
- Then 该轮保持 running

### FR-02: 后端：SERVICE_RESTART_INTERRUPTED 终态化的 output_redacted 改为中文可读原因（经 failure_summary 透出前端错误卡），error_detail 形状不变。

- `_mark_stale_run_failed` 必须 writes 中文可读原因「平台服务重启，本轮执行被中断；会话上下文已保留，可重新发送继续。」到 output_redacted（经 SessionRunRead.failure_summary 透出前端错误卡 message），并禁止改动 error_code=SERVICE_RESTART_INTERRUPTED 与 error_detail={reason, finished_by} 的既有形状（迟到成功回正匹配键兼容）。

#### 场景：主路径

- Given 无可恢复元数据的停滞 running 轮被启动清理判死
- When 落库完成
- Then output_redacted 为上述中文文案，error_code/error_detail 与既有断言一致

### FR-03: 前端：buildErrorLogItem 对无模型错误键（type/code/message/retryable/hint/raw/reset_at 均缺）的字典返回 null，回落 buildSystemFailureItem。

- `buildErrorLogItem` 对不含任何模型错误键（type/code/message/retryable/hint/raw/reset_at 均缺）的字典必须返回 null（调用方 `??` 链回落 `buildSystemFailureItem`）；对含至少一个模型错误键的字典必须保持既有解析行为（8 类映射/CLI 鉴权升级/用量上限升级均不回归）。

#### 场景：主路径

- Given error_detail = {reason, finished_by}（启动清理落库形状）
- When buildErrorLogItem 解析
- Then 返回 null

#### 场景：边界（部分键仍解析）

- Given error_detail = {message: "x"}（仅一个模型错误键）
- When buildErrorLogItem 解析
- Then 返回 non-null item（type=unknown 兜底，既有行为）

### FR-04: 前端：SYSTEM_ERROR_CODE_META 收录 SERVICE_RESTART_INTERRUPTED（PowerOff 图标、中性蓝灰、中文 hint）。

- `SYSTEM_ERROR_CODE_META` 必须收录 `SERVICE_RESTART_INTERRUPTED`（label「服务重启中断」、PowerOff 图标、slate 色系、defaultHint「平台服务重启中断了本轮，会话与上下文已保留，可重新发送继续。」），使 errorMetaFor（code 优先）对该码渲染系统错误卡而非 unknown 兜底。

#### 场景：主路径

- Given item = {type: "unknown", code: "SERVICE_RESTART_INTERRUPTED", message: 中文原因}
- When RunErrorItem 渲染
- Then 徽标显示「服务重启中断 · SERVICE_RESTART_INTERRUPTED」，message/hint 均中文，无「unknown」字样

### FR-05: 前端：任务日志页（agent-run-panel/agent-log-viewer）透传 error_code + failure_summary，normalizeLogs 兜底链接入 buildSystemFailureItem。

- `AgentRunPanel` 必须在既有 listSessionRuns 拉取处同批取出 error_code/failure_summary 并透传 `AgentLogViewer`（新可选 props `runErrorCode`/`runFailureSummary`）；`normalizeLogs` 的 NormalizeOptions 必须新增 errorCode/failureSummary 并把末尾兜底链扩为 `buildErrorLogItem ?? buildSystemFailureItem(errorCode, failureSummary)`，仍无果且 runStatus=failed 才落「运行失败（无详情）」；不传新 props 时行为必须与既有完全一致。

#### 场景：主路径

- Given failed run 的 error_detail 为系统字典（无模型错误键）、error_code=SERVICE_RESTART_INTERRUPTED、failure_summary=中文原因
- When 任务日志页 normalizeLogs
- Then 末尾追加 error 类结构化项（code=SERVICE_RESTART_INTERRUPTED、message=中文原因、hidden=false）

#### 场景：边界（成功路径零回归）

- Given 无 errorDetail/errorCode/failureSummary 且 runStatus 非 failed
- When normalizeLogs
- Then 不追加任何 error 项

### FR-06: 后端测试：等待用户回答的 running 轮豁免判死（保持 running）；已回答（user_input 晚于 ask）的停滞轮照常判死；failed 分支补 output_redacted 中文断言。

- 后端测试必须覆盖：ask 晚于 user_input 豁免（保持 running）、pending_input 通道豁免、user_input 晚于 ask 照常判死（failed + SERVICE_RESTART_INTERRUPTED）、failed 分支 output_redacted 中文文案断言。

#### 场景：主路径

- When 跑 `backend/app/modules/agent/tests/test_cleanup_stale_runs_error_code.py` 全文件
- Then 全部用例通过（含 3 个新增豁免用例 + 中文断言）

### FR-07: 前端测试：alien 字典回落、SERVICE_RESTART_INTERRUPTED 卡片元数据、normalizeLogs 兜底链。

- 前端测试必须覆盖：buildErrorLogItem 对 {reason, finished_by} 与空字典返回 null、SERVICE_RESTART_INTERRUPTED 渲染（标签/中文 message/hint/无 unknown 字样）、normalizeLogs 的 errorCode+failureSummary 兜底链与系统字典回落路径。

#### 场景：主路径

- When 跑 `frontend/src/components/agent-log/__tests__/normalize.test.ts` 与 `run-error-item.test.tsx` 全文件
- Then 全部用例通过（含新增 4 个用例：normalize 3 + run-error-item 1）

## 测试绑定（每条 FR 至少一行——`FR-NN: test/路径「用例名」`；空行/待填在 flow done 拒收）

FR-01: backend/app/modules/agent/tests/test_cleanup_stale_runs_error_code.py「test_stale_run_awaiting_user_answer_skipped」「test_stale_run_awaiting_user_pending_input_channel_skipped」「test_stale_run_user_answered_after_ask_still_killed」
FR-02: backend/app/modules/agent/tests/test_cleanup_stale_runs_error_code.py「test_stale_run_failed_branch_writes_error_code」（output_redacted 中文断言）
FR-03: frontend/src/components/agent-log/__tests__/normalize.test.ts「buildErrorLogItem 无模型错误键的系统字典 → null（回落 buildSystemFailureItem）」
FR-04: frontend/src/components/agent-log/__tests__/run-error-item.test.tsx「SERVICE_RESTART_INTERRUPTED → 「服务重启中断」标签 + 中文 message/hint（不再 unknown）」
FR-05: frontend/src/components/agent-log/__tests__/normalize.test.ts「normalizeLogs errorCode + failureSummary → 末尾追加系统失败项（中文 message）」「normalizeLogs errorDetail 为系统字典（无模型错误键）→ 回落系统失败映射」
FR-06: backend/app/modules/agent/tests/test_cleanup_stale_runs_error_code.py（全文件 5 用例）
FR-07: frontend/src/components/agent-log/__tests__/normalize.test.ts + run-error-item.test.tsx（全文件 144 用例）
