---
author: flow-machine-draft
created_at: 2026-10-23T16:20:53.971Z
---
# 设计记录（Design Record）— 2026-10-24-close-run-quota-fallback

## 做法概述

本变更怎么解决问题？改哪里、为什么选这个方案（一两段）。

答：根因（2026-10-23 会话 OpenCode Go 限额轮 run 0278895b 实证）——出错会话所在机器（DESKTOP-VBOLHBH）的 daemon 版本旧，终态上报（notifyRunResult → close_interactive_run）只带 is_error=true 不带 error（ModelError），后端只能落兜底文案「本轮执行失败（执行端未回传详细原因）」，前端显示「运行失败 · unknown」。而真实错误文本（`API Error: Request rejected (429) · [1308][已达到 5 小时的使用上限。您的限额将在 2026-10-23 13:27:04 重置。]`）其实已随消息事件落库在 agent_run_logs。

修复选**后端兜底**而非升级所有 daemon：在 `close_interactive_run` 编排层（close_run_steps.py）增加推断步——`is_error=True 且 error=None` 时查该 run 已落库日志行（channel='stdout' 且 content 含 "API Error"，timestamp 倒序 LIMIT 3）拼同 result_summary，命中「429 + 限额关键词」即构造 ModelErrorDTO(type=quota_exceeded) 补进 error 参数，再走既有 `_close_apply_terminal`（error_detail 落库）与 `_close_post_commit`（auto_resume quota 链到 reset_at+120s 自动续跑排期）。分类关键词/文案/code 提取/reset_at 解析逐条对齐 daemon `model-error/classifier.ts`（classifyBlob 规则 1 + extractCode 方括号码 + extractResetAt），后端实现处注释注明对齐源，防双源漂移。

范围有意收窄为 quota_exceeded 专项：它是实证痛点（限额文本稳定携带 429+上限关键词，误报面小），且 error_detail.type==quota_exceeded 直接接通 auto_resume 的到点自动续跑——价值不止展示；auth/network/timeout 等类型后端不猜（文本特征弱、误报会误导用户），仍以 daemon 回传为唯一来源，等旧 daemon 升级自然恢复。

## 接口契约

动了哪些函数/端点/命令/文件格式？对外可见的签名或行为变化是什么（含「无」的说明）？

答：
- `close_interactive_run`（run_sync/service/close_run_steps.py + run_sync/service/__init__.py 壳）：对外 HTTP 契约零变化——error 参数仍可选，None 语义从「不写 error_detail」变为「尝试日志推断，命中限额才写」。响应体（AgentRunRead）不变。
- 新增模块内 helper（非导出 API）：`_infer_quota_model_error_from_logs(svc, agent_run, result_summary) -> ModelErrorDTO | None`（async，查日志）与纯函数 `_infer_quota_error(blob: str) -> ModelErrorDTO | None`（可单测，正则与文案对齐 classifier.ts）。
- `AgentRun.error_detail` JSON 形状不变（ModelErrorDTO.model_dump(mode="json")），前端 buildErrorLogItem 现有 quota_exceeded 分支（normalize.ts）零改动即可正确渲染「额度或配额已耗尽 + 重置时间」。
- auto_resume.maybe_auto_recover_failed_turn 零改动——它读 error_detail dict 的 type/reset_at，推断补写后自动接上（新 daemon 回传与后端兜底两条路径行为一致）。

## 边界与并发（盲维四问——每问必答，答不了即设计缺口）

1. 乱序/迟到到达：输入或事件乱序时，本设计的假设还成立吗？

答：日志行与 close 请求的先后——daemon 侧 `onTurnResult` 开头 `await flushInteractiveBatches`（daemon.ts:4129）保证消息事件先于 close 落库（新版逐事件直发时代也是 await 串行），close 时日志可查成立；若个别旧 daemon 顺序颠倒，最坏结果是本轮推断不到（行为退化为现状，无害），后续轮不受影响。日志行查询按 timestamp DESC 只取 3 行并要求含 "API Error" 锚点，早轮残留错误文本不参与本轮推断（每 run 日志天然按 run_id 隔离）。幂等性：close 对已终态 run 整体 no-op（既有守卫），推断不会在重试中反复触发。

2. 并发写：两个执行体同时操作同一数据/文件会发生什么？

答：推断只读日志 + 写本 run 行（`_close_verify_and_load` 已持 FOR UPDATE 行锁），与 dispatch/submit_messages（追加日志行）无锁冲突；auto_resume 链计数（_count_chain_type）在 commit 后钩子里跑，与本推断无共享可变状态。两个 daemon 同时 close 同一 run 不可能（lease claim_token 单持）。

3. 切换/生命周期：会话、请求或变更中途切换/中断时状态是否安全？

答：推断失败（查日志抛错）必须 try/except 吞掉并 warn——close 是终态收口主链路，兜底绝不能反向卡死收口（对齐 model_usage 落库的 best-effort 范式）；run 已终态（重试/迟到）走既有 no-op 分支，推断代码不执行。

4. 作用域：跨工作区/跨仓/多实例时数据会不会串台？

答：查询按 run_id 精确锚定，不读其它 run/会话/工作区数据；多 runtime（DESKTOP-HJ0AM09 / DESKTOP-VBOLHBH 并存）下各自 run 独立推断，无串台。关键词正则不区分供应商（OpenCode Go/GLM/Kimi 同一套），与 daemon classifier 的 provider 无关规则一致。

## 风险与死路

本方案最大的风险是什么？试过但放弃的方案及放弃理由？

答：最大风险是**误报**——把非限额失败标成 quota_exceeded。缓解：双重锚定（必须同时含 429 状态码与限额关键词，正则逐条对齐 classifier.ts 规则 1），且 429 语义即 Too Many Requests、配限额关键词才定 quota（纯 429 落 rate_limited 的情形本方案不推断、保持现状）；实测 9-04/10-23 两批真实限额文本均稳定命中。次风险：推断规则的维护漂移（daemon 侧改文案后端不知道）——注释钉死对齐源路径，daemon classifier 改动时须同步（评审检查点）。

试过但放弃的方案：① 前端兜底（失败卡渲染时翻时间线日志找 API Error 行）——前端拿不到结构化 run 日志查询入口，且 error_detail 为空时 buildSystemFailureItem 只吃 error_code/failure_summary 两参，跨组件翻日志链路重、auto_resume（后端读 error_detail）完全受益不到，放弃。② 后端复制 daemon 全类型分类规则——双源维护面大，auth/timeout 等类型文本特征弱误报高，收窄为 quota 专项（理由见做法概述）。③ 只升级 daemon 不改后端——那台机器不归本平台代码库管，升级排期不可控，且未来任何机器的 daemon 版本倒挂都会复发，后端兜底是对部署倒置的结构性防御。

## 文件变更清单

| 操作 | 路径 | 说明 |
|---|---|---|
| 修改 | backend/app/modules/daemon/run_sync/service/close_run_steps.py | 新增 `_infer_quota_error` 纯函数 + `_infer_quota_model_error_from_logs` helper；`close_interactive_run` 编排层 is_error=True 且 error=None 时接线推断 |
| 新增 | backend/app/modules/daemon/tests/test_close_interactive_run_quota_log_fallback.py | FR-01/02/03 场景用例（复用 test_close_interactive_run_model_error.py 的 seed 范式） |
