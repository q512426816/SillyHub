---
author: flow-machine-draft
created_at: 2026-10-20T04:50:02.475Z
---
# 设计记录（Design Record）— 2026-10-20-codex-models-fetch-candidates

## 做法概述

本变更怎么解决问题？改哪里、为什么选这个方案（一两段）。

改 `backend/app/modules/llm_provider/service.py` 两处常量/函数：① `_STRIP_SUFFIXES` 追加 `"/openai/v1"`（OpenCode 网关范式：`…/inference/go/openai/v1` 剥到网关根再拼 `/v1/models`）；② `_candidate_urls` anthropic 分支在既有候选之后追加 `base + "/models"` 兜底候选（OpenAI 风格 base 已含版本段：智谱 coding `/api/v1` → `/api/v1/models`）。两路径均上游实测 200（2026-10-20，匿名 GET）。选候选追加而非按 provider 名特判：候选序列天然容错（404 自动尝试下一个），不引入 per-vendor 分支；追加位置放最后保证既有命中路径的尝试顺序零变化。

## 接口契约

动了哪些函数/端点/命令/文件格式？对外可见的签名或行为变化是什么（含「无」的说明）？

- `LlmProviderService._STRIP_SUFFIXES`（类常量）：`("/anthropic", "/compatibility", "/api")` → 追加 `"/openai/v1"`。
- `LlmProviderService._candidate_urls`（类方法，内部）：anthropic 分支返回列表尾部多一个 `base+"/models"` 候选（去重）。
- HTTP 端点 `POST /api/llm-providers/fetch-models` 行为：对上述两种 base_url 形态从恒 404（报「该供应商不支持拉取模型列表」）变为命中返回模型列表；其余形态响应不变。
- DB schema / daemon / 前端：无变化。

## 边界与并发（盲维四问——每问必答，答不了即设计缺口）

1. 乱序/迟到到达：输入或事件乱序时，本设计的假设还成立吗？
   候选尝试是同步顺序循环（NFR-03 不并发），无乱序面；假设成立。

2. 并发写：两个执行体同时操作同一数据/文件会发生什么？
   fetch_models 是无状态查询（design §9 豁免生命周期契约），不写任何持久数据；无并发面。

3. 切换/生命周期：会话、请求或变更中途切换/中断时状态是否安全？
   候选循环中途超时/异常按既有四类错误分类自然冒泡，无残留状态。

4. 作用域：跨工作区/跨仓/多实例时数据会不会串台？
   候选仅由单条供应商 base_url 派生，SSRF 防护对每个新候选 URL 依旧逐一生效（assert_public_hostname 在循环内）；无串台面。

## 风险与死路

本方案最大的风险是什么？试过但放弃的方案及放弃理由？

最大风险：追加候选使「全候选 404」场景多一次上游请求（每条 models 拉取至多多 1 次 GET），对中转站限流面略增——量级可忽略（手动触发的低频操作）。次风险：`base+"/models"` 对某些会把 `/models` 当模型名路由的网关返回 200 非 models JSON——`_parse_models_response` 已有「body 不可解析/缺 data 字段 → AllFailed」兜底，不会误报成功。

试过但放弃的方案：
- 按 provider 名/域名特判端点（如 bigmodel → /api/paas/v4/models）：vendor 分支进 service，维护面差、新供应商每次都要改代码；放弃。
- 前端对 codex 条目隐藏拉取按钮：不解决根因，且智谱/OpenCode 端点本就支持拉取；放弃。

## 文件变更清单

| 操作 | 路径 | 说明 |
|---|---|---|
| 修改 | backend/app/modules/llm_provider/service.py | _STRIP_SUFFIXES 追加 /openai/v1；_candidate_urls anthropic 分支追加 base+/models 兜底候选（去重、置于最后） |
| 修改 | backend/app/modules/llm_provider/tests/test_fetch_models.py | 新增智谱范式/OpenCode 范式 2 用例（断言候选 URL 序列与命中） |
| 修改 | backend/app/modules/llm_provider/tests/test_api_format.py | 3 个 NFR-02 候选锚用例同步尾候选（前缀顺序仍被守卫，新候选为有意行为变化） |
