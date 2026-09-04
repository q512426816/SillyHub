# CLI 把远端 401 误报为 "Not logged in · Please run /login"

- 发现：2026-09-03（会话 cb56fabf，用户反馈「服务器重新部署后发消息 agent 提示 Not logged in」）
- 状态：已缓解（ql-20260903-011：后端自动重投一次 + 前端中文错误卡片）；CLI 误导文案本身仍在，靠签名识别兜底

## 现象

智能会话里发消息，agent「回复」**Not logged in · Please run /login**，看上去像本地凭证丢失。用户重新选择模型（k3→k3-256→k3）后再发就正常，误以为「供应商模型配置没正确生效」。

## 根证（四层取证结论）

1. **文案不是平台产出**：前后端代码库全文搜不到该字符串；它来自 claude CLI 自身。
2. **是 CLI 合成错误消息**：事发会话 transcript 里该消息 `model=<synthetic>`、`error=authentication_failed`、`isApiErrorMessage=true`——CLI 把**模型网关返回的 401** 统一翻译成本地鉴权错误文案，与本地凭证无关。
3. **纯远端瞬时抖动**：同一 CLI 进程、同一份注入密钥，13 秒后重发同一消息即成功（事故 run `b49316a4` 0.08s 失败 vs 下一 run `15d0eacb` 43s 正常完成）。
4. **与服务器重新部署无因果**：部署 11:42（UTC 03:42），事故 14:07（UTC 06:07），间隔两个多小时；Kimi 网关是外部服务。用户把「部署后第一次回来发消息」的时间错觉当成了因果。
5. **切模型不是修复手段**：切模型未改写供应商记录（`llm_providers.updated_at` 停在事发前 10:40），真正恢复靠的是消息重发。

## 历史频次

`agent_run_logs` 里 8 月初起就反复出现 `[ASSISTANT] Not logged in · Please run /login`（多次历史 run），是长期存在的已知形态，非新引入。

## 缓解（ql-20260903-011）

- **后端**：`run_sync.close_interactive_run` 终态 commit 后，error.raw 命中 CLI 鉴权签名（`Not logged in` / `Please run /login`）→ 把本 run 的 user_input 追加为排队消息（携带 run 的 llm_provider_id/agent_profile_id 快照），由 close 末尾既有排队派发钩子随即重放一次。防循环：上一条同会话同 prompt run 也鉴权失败 = 已是重投结果，不再追加；同文 pending 去重。
- **前端**：`isAssistantApiErrorText` 识别该签名（[ASSISTANT] 行归 error 类，不再当 agent 回复文本）；`buildErrorLogItem` 把这类 error_detail 升级为 `auth_failed` + retryable=true + 中文文案「模型服务鉴权瞬时失败（远端返回 401）/平台已自动重试一次」。

## 排查教训（工具/方法层）

- **全库搜索坑**：`agent_run_logs.run_id` 物理列是 varchar，直接 join `agent_runs.id`（uuid）会把记录静默过滤掉——第一次「全库搜 Not logged in 零命中」即此因；按 `content_redacted ILIKE` 单表搜才命中。跨表搜 varchar/uuid 列先校对类型。
- **时间定位坑**：用户说「重新部署之后」，实际事故点比部署晚 2.5 小时；先按用户叙述的时间窗搜会漏，应以实际产物（run 行/transcript 条目）的时间戳为准。
- **daemon 日志盲区**：现行 daemon（PID 变化后）的实时日志落点未找到（daemon.log 停在 8/23），排障主要靠 DB + transcript 两层。

## 遗留

- CLI 把远端 401 一律翻译成 "Not logged in" 的行为无法在本仓修；若未来出现同签名但非瞬时的持续性 401（密钥真失效），自动重投一次失败后会停在错误卡片（retryable=true，用户可手动重发/切换供应商），不会无限循环。
- daemon 侧 classifyModelError 未对 CLI 合成错误特判（回传 type=unknown/retryable=false），靠后端签名识别兜底；若 daemon 升级了错误分类，前后端两处签名识别需同步复核。

## 处置记录（2026-09-04 定时巡检，验证归档）

- 缓解双层落地均已实证：后端 `run_sync/service.py` ql-20260903-011（error.raw 签名识别 + 排队重投一次，防循环/同文去重在位）；前端 `agent-log/normalize.ts` `isAssistantApiErrorText`（[ASSISTANT] 行归 error 类 + 中文错误卡片 retryable，含配套测试）。
- 遗留两条维持原状定性：CLI 合成文案本仓不可修（持续性 401 由错误卡片手动出口兜底，不会无限循环）；daemon classifyModelError 特判为观察项（若 daemon 升级错误分类需同步复核签名识别）。
- 四层取证与排查教训（varchar/uuid join 静默过滤、以产物时间戳为准、daemon 日志盲区）价值高，随文件归档备查。
