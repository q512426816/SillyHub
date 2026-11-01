---
author: flow-machine-draft
created_at: 2026-11-01T23:20:09.257Z
---
# 设计记录（Design Record）— 2026-11-01-provider-share-audit-fixes

## 做法概述

本变更怎么解决问题？改哪里、为什么选这个方案（一两段）。

只读审查 2026-10-30 三变更后遗留 5 项待闭环问题，本变更逐一修复，**不改任何已裁决的设计**（密钥下发信任模型、共享授权语义均不动）：①`_parse_id` 从裸 `uuid.UUID` 改为捕获 ValueError 抛 `LlmProviderIdInvalid(AppError 422)`（沿 service.py 既有 `HTTP_422_*` 范式），router 单点修复全体端点受益；②ShareProviderDialog 描述区补密钥可见性告知 + llm_provider 模块卡补共享语义小节（评审 P3 accepted 附带建议的落地）；③迁移 20261030160000 注释如实化（SQL 零改动）；④⑤补两组测试——test_router.py 的 HTTP 层 /usable+shares 用例、test_lease_context_provider_share.py 的 `_inject_provider_config` 真实注入链用例（评审两个 P3 open）。

## 接口契约

动了哪些函数/端点/命令/文件格式？对外可见的签名或行为变化是什么（含「无」的说明）？

- `GET|POST /api/llm-providers/{id}/shares`、`DELETE .../{grantee}` 及全体以 `{provider_id}` 为路径参的端点：畸形 UUID 的响应从 500 变 422（新错误码 `HTTP_422_LLM_PROVIDER_ID_INVALID`），合法路径行为零变化。openapi.json 不受影响（错误码非 schema 面）。
- ShareProviderDialog DialogDescription 文案增加一句密钥可见性告知（纯 UI 文案，无 API 变化）。
- 迁移 20261030160000：仅 docstring/注释文案，revision/down_revision/SQL 零改动。
- 生产代码签名无其他变化（新增测试不计契约）。

## 边界与并发（盲维四问——每问必答，答不了即设计缺口）

1. 乱序/迟到到达：输入或事件乱序时，本设计的假设还成立吗？

   不适用——本变更无新事件流/异步输入；422 判定是纯函数式输入校验（字符串→UUID 解析），告知文案是静态文本。

2. 并发写：两个执行体同时操作同一数据/文件会发生什么？

   不适用——不新增并发写路径；`_parse_id` 无状态；迁移文件只改注释，SQL 零改动，不重跑任何已应用迁移（本地/线上库均未应用该迁移链尾，文案改动无升级影响）。

3. 切换/生命周期：会话、请求或变更中途切换/中断时状态是否安全？

   不适用——无会话/请求状态机变更；弹窗文案在打开时渲染，与加载态/错误态无交互。

4. 作用域：跨工作区/跨仓/多实例时数据会不会串台？

   不会——测试用例各自构造独立 user/provider/session 行（uuid 随机前缀隔离）；HTTP 层用例沿用 test_router.py 既有 `client+auth_headers` 夹具（固定 admin 身份 + 另建 other 用户验证 owner 语义）。

## 风险与死路

本方案最大的风险是什么？试过但放弃的方案及放弃理由？

最大风险：422 改动若误伤合法 UUID 语义（如把空串/none 误判路径）会破坏既有端点——用「合法 UUID 仍走原 404/200 语义用例 + 既有全量回归」双护栏。放弃的方案：把畸形 UUID 归入 404（更贴近「不泄漏存在性」哲学）——但畸形输入是客户端格式错误而非资源不存在，422 语义更准且与 RequestValidationError 同族；前端 apiFetch 对 4xx 已有统一错误面，无需适配。
