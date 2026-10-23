---
author: flow-machine-draft
created_at: 2026-10-23T16:20:53.971Z
---
# 需求规格（Requirements）— 2026-10-24-close-run-quota-fallback

## 功能需求

### FR-01: close_interactive_run 收到 is_error=true 且 error=None 时，从该 run 已落库日志的 [ASSISTANT] 行提取 API Error 文本，命中限额特征（429 + 上限/额度/配额/quota/usage limit 等）时补写 error_detail（type=quota_exceeded，code/message/hint/raw/reset_at 语义与 daemon model-error/classifier 对齐）

- 交互轮失败终态收口时，若 daemon 未回传模型错误详情（error=None）且 is_error=true，后端必须从该 run 已落库日志行（channel='stdout'，含 "API Error" 的行，按 timestamp 倒序最多取 3 行）与 result_summary 拼接文本做限额推断：文本同时命中 429 状态码与限额关键词（上限/额度/配额/quota/limit reached/usage limit 等，正则语义对齐 sillyhub-daemon/src/model-error/classifier.ts classifyBlob 规则 1）时，必须补写 AgentRun.error_detail 为 ModelErrorDTO(type=quota_exceeded, code=方括号业务码如 "1308", message="额度或配额已耗尽", retryable=false, hint="额度耗尽，需充值或切换供应商", raw=原始错误文本, reset_at=从「将[在于] YYYY-MM-DD HH:MM:SS 重置」解析的 +08:00 ISO-8601 时刻，解析失败为 None)。
- 补写发生在终态字段映射之前（编排层把 error 参数补好再传入 _close_apply_terminal），使 quota_exceeded 的到点自动续跑排期（auto_resume.maybe_auto_recover_failed_turn）与新 daemon 回传路径行为一致。
- 补写生效时必须记 info 日志（事件名含 quota_log_fallback）留审计痕迹。

#### 场景：限额错误日志兜底补写（主路径，2026-10-23 实证形态）

Given 一个 running 的交互 run，其日志已落库一行 `channel='stdout'`、内容为 `[ASSISTANT] API Error: Request rejected (429) · [1308][已达到 5 小时的使用上限。您的限额将在 2026-10-23 13:27:04 重置。]`，
When close_interactive_run 以 is_error=True、error=None、status="error_max_turns" 收口，
Then run.status=="failed" 且 error_code=="interactive_failed"，且 run.error_detail 非空并满足 type=="quota_exceeded"、code=="1308"、message=="额度或配额已耗尽"、retryable==False、hint=="额度耗尽，需充值或切换供应商"、raw 含该日志原文、reset_at=="2026-10-23T13:27:04+08:00"。

#### 场景：result_summary 携带限额文本同样兜底

Given 一个 running 的交互 run 且无相关日志行，
When close_interactive_run 以 is_error=True、error=None、result_summary="API Error: Request rejected (429) · weekly usage limit reached" 收口，
Then run.error_detail 非空且 type=="quota_exceeded"（reset_at 解析失败为 None）。

### FR-02: 新 daemon 已回传 error 时不覆盖，现行为不变

- daemon 已回传 error（非 None）时，后端禁止执行日志推断、禁止覆盖该 error——error_detail 必须与 daemon 回传值逐字段一致。

#### 场景：daemon 回传优先

Given 一个 running 的交互 run，其日志已落库限额错误文本行，
When close_interactive_run 以 is_error=True、error=ModelErrorDTO(type=auth_failed, code="401", message="API 凭证无效或已失效", retryable=False) 收口，
Then run.error_detail["type"]=="auth_failed"（未被日志推断的 quota_exceeded 覆盖），且本次收口不产生 quota_log_fallback 日志。

### FR-03: 日志无 API Error 行或不命中限额特征时行为不变（error_detail 保持 NULL，既有兜底文案照旧）

- 日志与 result_summary 中均无 "API Error" 文本、或命中 "API Error" 但不同时满足 429 与限额关键词时，后端禁止伪造 error_detail（保持 NULL），error_code 与 output_redacted 的既有兜底行为（「本轮执行失败（执行端未回传详细原因）」映射）必须逐字不变；仅识别 quota_exceeded 专项，禁止推断其它错误类型（auth/network/timeout 等仍以 daemon 回传为唯一来源）。

#### 场景：非限额错误不伪造

Given 一个 running 的交互 run，其日志已落库 `[ASSISTANT] API Error: 401 invalid api key`（无 429），
When close_interactive_run 以 is_error=True、error=None 收口，
Then run.error_detail 保持 None，error_code=="interactive_failed"，output_redacted 为「本轮执行失败（执行端未回传详细原因）」兜底文案。

#### 场景：无任何错误日志行不伪造

Given 一个 running 的交互 run 且无任何含 "API Error" 的日志行、result_summary=None，
When close_interactive_run 以 is_error=True、error=None 收口，
Then run.error_detail 保持 None，既有兜底文案照旧落 output_redacted。

### FR-04: 补 backend 测试覆盖上述分支，既有相关测试不回归

- 上述 FR-01/FR-02/FR-03 每个场景必须有对应 pytest 用例（新测试文件），且既有 test_close_interactive_run_model_error.py 全部用例（含「不传 error → error_detail 保持 None」断言，因其无日志行场景下兜底不触发）必须保持通过。

#### 场景：回归面

When 对 backend/app/modules/daemon/tests/test_close_interactive_run_model_error.py 与新测试文件跑 pytest，
Then 全部用例通过。

## 测试绑定（每条 FR 至少一行——`FR-NN: test/路径「用例名」`；空行/待填在 flow done 拒收）

FR-01: backend/app/modules/daemon/tests/test_close_interactive_run_quota_log_fallback.py「test_quota_error_log_inferred_into_error_detail」「test_quota_error_via_result_summary_inferred」
FR-02: backend/app/modules/daemon/tests/test_close_interactive_run_quota_log_fallback.py「test_daemon_error_takes_precedence_over_log_inference」
FR-03: backend/app/modules/daemon/tests/test_close_interactive_run_quota_log_fallback.py「test_non_quota_api_error_not_inferred」「test_no_api_error_log_keeps_legacy_behavior」
FR-04: backend/app/modules/daemon/tests/test_close_interactive_run_quota_log_fallback.py（全文件）+ backend/app/modules/daemon/tests/test_close_interactive_run_model_error.py（回归）
