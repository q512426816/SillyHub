---
author: flow-machine-draft
created_at: 2026-10-05T17:26:47.337Z
---
# 设计记录（Design Record）— 2026-10-06-opencode-go-direct-anthropic

> 四节每节必答——问题行原样保留（勿删勿改勿用答案替换），答案另起一行写在问题行下方；小改动可写「不适用：<理由>」；flow done 空节拒收。
> 需要列改动文件时加独立「## 文件变更清单」章节+表格（| 操作 | 路径 | 说明 |）——章节标题是 parseFileChangeList 的识别面，勿写在「接口契约」节内（收口声明面解析不到会误报夹带嫌疑）。
> 四问原文/FR 标题/镜像任务行是收口锚——问题行/标题从本模板原样保留或复制，勿删勿改、勿用答案整块替换问题原文、勿手打重写（标点也要逐字：2026-10-05 三度实证——句号手写成问号、答案整块替换问题原文均被锚对比拒收）。

## 做法概述

本变更怎么解决问题？改哪里、为什么选这个方案（一两段）。

opencode go 端点原生提供 Anthropic `/v1/messages`（仅认 x-api-key；Claude Code 原生 session 头被上游识别，真机 2.1.216 纯文本 + Read 工具往返实测通过），故放弃依赖已隔离 LiteLLM 的 openai_chat 转换链，改走与 GLM/DeepSeek/Kimi 同型的 anthropic 直连。改动两处：① 阿里云服务器 llm_providers 行 OpenCode Go（api_format=anthropic / base_url=https://opencode.ai/zen/go / auth_field=ANTHROPIC_API_KEY / model=deepseek-v4.1-flash + 4 角色槽同填，key 按平台 cipher 重加密，经 backend 容器内一次性脚本执行）；② 仓内前端 opencode_go 预设同口径修正（auth_field 原照抄 cc-switch 为 ANTHROPIC_AUTH_TOKEN，配出来必 401；模型 4 槽 deepseek-v4-flash→deepseek-v4.1-flash 并补 FABLE 槽）+ 回归断言。选直连而非修 litellm：坑 litellm-v1950-image-entrypoint-not-found 已矩阵证伪「健康镜像 + gap-A」无 tag 可 pin，直连零新增组件、少一个 SPOF。

## 接口契约

动了哪些函数/端点/命令/文件格式？对外可见的签名或行为变化是什么（含「无」的说明）？

无代码接口变更（无函数/端点签名改动）。可见行为变化：① 前端预设 opencode_go 的 auth_field 值（ANTHROPIC_AUTH_TOKEN→ANTHROPIC_API_KEY）、default_model（deepseek-v4-flash→deepseek-v4.1-flash）、settings_config_partial.env 四槽模型值 + 新增 FABLE 槽——用户从预设新建供应商时预填内容变化；② 服务器上 OpenCode Go 供应商行的 api_format/base_url/auth_field/model/model_role_mappings/encrypted_api_key 数据修正（运维数据面，非 schema）。

## 边界与并发（盲维四问——每问必答，答不了即设计缺口）

1. 乱序/迟到到达：输入或事件乱序时，本设计的假设还成立吗？

不适用：本变更是静态配置数据修正（预设常量 + DB 行），无事件流/时序语义。

2. 并发写：两个执行体同时操作同一数据/文件会发生什么？

不适用：预设文件由 git 单写者管理；DB 行修正是后台无流量时隙的一次性 UPDATE（原链路已死无并发读者），之后行内容只被常规表单更新路径触碰。

3. 切换/生命周期：会话、请求或变更中途切换/中断时状态是否安全？

安全：anthropic 直连形态与平台既有 GLM/DeepSeek/Kimi 供应商完全同型（resolve_*_provider_config anthropic 分支逐字段复用，injector 6 规则既有路径），无新生命周期语义。旧 openai_chat 形态残留的 litellm deployment（usr-<uid>-<pid>）因 litellm 服务本就隔离停用而无副作用，后续 litellm 分叉拍板时一并清理。

4. 作用域：跨工作区/跨仓/多实例时数据会不会串台？

不会：预设是前端编译期常量（所有部署实例同源）；DB 行修正只针对该服务器该供应商行（WHERE id= 主键），密钥加密用该部署实例自身 SECRET_KEY 派生的 cipher，本实例写本实例读，无跨实例串台。

## 风险与死路

本方案最大的风险是什么？试过但放弃的方案及放弃理由？

最大风险：opencode go 端点行为是实测口径（仅认 x-api-key、识别 Claude Code 原生 session 头、全模型可经 /v1/messages 路由），上游未来变更口径（如强制专有 session 头、收敛 /v1/messages 模型面）会使直连失效——缓解：平台探活（GET /zen/go/v1/models）与每次会话请求会立即暴露，届时按报错口径再调整，且此形态与 cc-switch 生态用户同型，上游破坏面大、概率低。放弃的方案：① 修 litellm 换 tag 复活 openai_chat 链——2026-10-05 本地矩阵已证伪无可 pin tag（两个 v1.95.x 变体坏构建、1.96+ anthropic adapter 不认 mode=chat 恒打上游 /responses）；② 注入 x-opencode-session 自定义头——实测 Claude Code 原生 session 头已被识别（官方文档明示 + 真机验证），无需加复杂度；③ opencode_zen_openai 预设（zen 计费）也切直连——该 key 无 zen 余额（实测 Insufficient account funds），且 zen 端点 anthropic 面未验证，留待 litellm 分叉拍板一并处置。

## 文件变更清单

| 操作 | 路径 | 说明 |
| --- | --- | --- |
| 修改 | frontend/src/config/llmProviderPresets.ts | opencode_go 预设 auth_field→ANTHROPIC_API_KEY、模型 4 槽→deepseek-v4.1-flash + 补 FABLE 槽、注释更新为实测口径 |
| 修改 | frontend/src/components/llm-providers/__tests__/llmProviderPresets.test.ts | 补 opencode_go auth_field + 4 角色槽回归断言 |
| 修改 | docs/sillyspec/litellm-v1950-image-entrypoint-not-found.md | 补 2026-10-06 处置记录（opencode 直连绕开 LiteLLM） |
| 修改 | .sillyspec/docs/multi-agent-platform/modules/frontend.md | 模块文档补本变更条目 |
| 运维数据 | 服务器 47.113.145.252 llm_providers 行 68b4b5b9 | OpenCode Go 切 anthropic 直连（一次性容器内脚本，不入仓） |
