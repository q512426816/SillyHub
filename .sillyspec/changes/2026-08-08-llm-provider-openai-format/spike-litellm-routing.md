# spike-litellm-routing 结论

> change 2026-08-08-llm-provider-openai-format / Wave2 P0 前置门（plan.md）。
> 验证 LiteLLM 作为 Anthropic↔OpenAI 转换网关的路由机制，定稿 task-08~12 实现假设。

## 验证环境

- Docker LiteLLM（`ghcr.io/berriai/litellm:main-stable`）+ 独立 litellm-db（postgres:16-alpine）
- 起：`cd deploy && docker compose -f docker-compose.dev.yml up -d litellm litellm-db`
- master key：随机生成（`sk-$(openssl rand -hex 24)`），仅本地 .env（gitignored），不入库不入日志
- 端口：dev compose `127.0.0.1:4000`（仅本地回环，R-05 网络隔离）
- STORE_MODEL_IN_DB=True（admin API 动态注册需 DB 持久化）
- litellm-config.yaml：`model_list: []`（空起步，运行时 admin API 注册）+ `drop_params: true` + `simple-shuffle`

## 第 1 项：admin API 注册/注销（✅ 实测 2026-08-09，不需上游 token）

### 1.1 POST /model/new 注册（✅ 假设正确）

```
POST /model/new  Authorization: Bearer <master_key>
body: {"model_name":"usr-spike-test","litellm_params":{"model":"gpt-4","api_base":"http://dummy:8080/v1","api_key":"sk-dummy","provider":"openai"}}
→ HTTP 200 {"model_id":"<uuid>","model_name":"usr-spike-test","litellm_params":{...master_key 加密存储...}}
```

- ✅ master key 鉴权（Authorization Bearer）正确：无 auth → `401 "Authentication Error, No api key passed in."`
- ✅ model_name 接受字符串（含 uuid 连字符，usr-<uid>-<pid> 格式 OK）
- ✅ litellm_params 值经 master key 加密存储（GET /model/info 返回乱码，非明文）
- ✅ task-09 register 鉴权 + 端点 + body 契约**全部正确，无需返工**

### 1.2 重复注册行为（⚠️ 推翻 task-09 幂等假设，但功能等价）

```
POST /model/new（同 model_name 重复）→ HTTP 200 {"model_id":"<新 uuid>",...}
```

- ⚠️ 重复 POST /model/new 同 model_name **不返 400/409 "Already present"**，而是 **200 创建新 deployment**（新 model_id）
- DB 累积多行同 model_name（不同 model_id）；GET /model/info 按 model_name 去重显示但底层多 deployment
- **功能影响**：LiteLLM 按 model_name 路由，多 deployment 同上游 simple-shuffle 轮询——**无害**（都打同 openai 上游）
- task-09 register 的 400/409 分支永远不触发，但 200=成功已覆盖，**register 返 True 语义正确**（重复注册幂等语义对）
- task-09 修复：register 注释更新（spike 实测），400/409 分支保留作防御

### 1.3 POST /model/delete 注销（⚠️ 推翻 task-09 id 假设，已返工）

```
POST /model/delete  body: {"id":"usr-spike-test"}（model_name）
→ HTTP 400 {"error":{"message":"Model with id=usr-spike-test not found in db"}}

POST /model/delete  body: {"id":"585dbd8d-..."}（model_id uuid）
→ HTTP 200 {"message":"Model: 585dbd8d-... deleted successfully"}
```

- ⚠️ `/model/delete` 的 `id` 期望 **model_id（uuid）**，**不是 model_name**（传 model_name → 400 not found）
- ✅ model_id 从 GET /model/info 的 `data[].model_info.id` 获取
- task-09 原 unregister(model_name) POST /model/delete {id: model_name} **失败**——已返工（commit dabf73c9）
- task-09 修复：unregister 重写为 GET /model/info 找 model_name 匹配的 model_id → 逐个 POST /model/delete {id: model_id}（处理重复注册多 deployment）；model_id 不持久化 backend（运行时查 LiteLLM，不增 provider 表字段）

### 1.4 GET /model/info（✅ 用于 unregister 查 model_id）

```
GET /model/info  Authorization: Bearer <master_key>
→ HTTP 200 {"data":[{"model_name":"usr-spike-test","litellm_params":{...},"model_info":{"id":"<uuid>",...}},...]}
```

- ✅ 返回所有 deployment，含 `model_info.id`（model_id uuid）+ `model_name`
- ✅ master key 鉴权
- 用于 unregister 过滤 model_name 匹配的 model_id

## 第 4 项：Claude Code 经 LiteLLM 路由（✅ 路由命中验证通过 2026-08-09，不需上游 token）

验证方式：注册 model_name=usr-route-test 指向快速失败上游（127.0.0.1:1 拒绝连接），POST /v1/messages
（Anthropic 格式）body model=usr-route-test + master key，观察 LiteLLM 是否按 model 字段路由。

```
POST /v1/messages  Authorization: Bearer <master_key>
body: {"model":"usr-route-test","max_tokens":10,"messages":[{"role":"user","content":"hi"}]}
→ HTTP 500 {"error":{"message":"litellm.InternalServerError: ... Cannot connect to host 127.0.0.1:1 ...
  Received Model Group=usr-route-test\nAvailable Model Group Fallbacks=None"}}
```

- ✅ **LiteLLM 按 body.model 字段路由**：响应含 "Received Model Group=usr-route-test"，证明识别 model 字段并路由到该 deployment
- ✅ LiteLLM 尝试连注册的上游（127.0.0.1:1 拒绝连接 → InternalServerError），证明路由命中后转发上游
- ✅ **task-10/11 核心假设成立**：ANTHROPIC_MODEL=litellm_model_name → Claude Code 发 /v1/messages model=litellm_model_name
  → LiteLLM 按此路由命中 task-09 register 写入的 deployment。无需 virtual key 绑定 / config 静态路由。
- ✅ /v1/messages 端点存在（LiteLLM 支持 Anthropic 格式入口）+ master key 鉴权

## 第 2-3 项：流式转换 / 工具调用转换（✅ 流式实测通过 / ⚠️ 工具调用发现 LiteLLM Responses API 格式点，2026-08-09，opencode.ai 测试 token）

> 安全：opencode.ai token 仅本次人工验收用（NFR-02 / design §8），**不入库不入日志不落提交文件**；注册的
> deployment 验收完已全部 unregister 清理（GET /model/info + delete by model_id，token 不留 LiteLLM DB）。

### 第 2 项：流式转换 ✅ 完整通过

注册 model_name=usr-spike-real2 → litellm_params.model=`openai/kimi-k3`（**必须 openai/<model> 前缀**，见下文
task-09 返工），api_base=`https://opencode.ai/zen/go/v1`（剥 /chat/completions）。POST /v1/messages（Anthropic
格式，Claude Code 入口）stream=true 全英文 content：

```
event: message_start
event: content_block_start   (content_block.type=text)
event: content_block_delta   (delta.type=text_delta, delta.text="4")   ← 实际文本流出
event: message_delta         (stop_reason=end_turn)
event: message_stop
```

- ✅ LiteLLM 完整 Anthropic SSE 事件链（message_start → content_block_start/delta → message_delta → message_stop），
  含 content_block_delta 实际文本。OpenAI 上游流式 → Anthropic 流式转换**完全工作**。
- ⚠️ 坑：Windows git-bash curl 发**中文** content 触发 LiteLLM `UnicodeDecodeError`（CP936 非 UTF-8）→ body 解析
  失败 → model=None。纯测试环境问题（Claude Code 实际请求 UTF-8 不受影响），全英文 content 即可避开。

### 第 3 项：工具调用转换 ⚠️ 转换机制工作，LiteLLM openai provider 带 tools 走 Responses API（task-12 配置解决）

POST /v1/messages 带 tools（Anthropic tool_use 格式）：

- ✅ kimi-k3 正确理解工具并返回 function_call（name=get_weather, arguments=`{"city":"Beijing"}`,
  stop_reason=tool_call）——LiteLLM 把 Anthropic tools 转 OpenAI function 发上游**成功**，模型正确调用。
- ⚠️ opencode 上游经 LiteLLM 返回 **OpenAI Responses API 格式**（`object="response"`, `output[].function_call`,
  `call_id`），非经典 Chat Completions（`choices[].message.tool_calls`）。LiteLLM openai adapter 期望 chat
  completions 格式 → 解析失败 `OpenAIException`（HTTP 200 但 body 是 error）。
- ✅ **opencode 直连** chat/completions 带 tools 返回**标准 chat.completion 格式**（`choices[].message.tool_calls`
  =True，无 `output[]`）——证明格式差异由 **LiteLLM 触发**（`openai/` provider 带 tools 时 LiteLLM 走 Responses
  API 端点），非上游固有。
- **task-12 解决方向**：litellm_params 加 `use_responses_api: false`（或等价配置）强制 chat/completions；属 LiteLLM
  配置层，非转换机制 bug。标准 OpenAI 兼容上游（OpenAI/deepseek/moonshot 官方）工具调用为 LiteLLM 官方核心支持，
  opencode zen 是测试上游特例。

### ⚠️ 重大发现：task-09 register litellm_params.model 格式 bug（P0 必须返工）

spike 第 2 项实测推翻 task-09 register 假设：

- task-09 原实现 `litellm_params={"model": <纯model名>, ..., "provider": "openai"}`。
- LiteLLM **不接受 `provider` 独立字段**，要求 `litellm_params.model` 带 provider 前缀：`openai/<model>`。
- 原格式后果（litellm 日志实测）：POST /model/new 返回 200+model_id（DB 写入成功），但 **LiteLLM Router upsert
  持续失败** `"LLM Provider NOT provided. You passed model=kimi-k3 ... Dropping it"`，deployment 被 drop **不进
  路由表** → GET /model/info 空、GET /v1/models 空、所有 /v1/messages + /v1/chat/completions 路由 not found、
  容器 unhealthy。
- **修复**：register() `litellm_params.model` 改 `f"openai/{provider.model}"`（model 缺失兜底
  `openai/gpt-3.5-turbo`），**删除 `provider` 字段**（LiteLLM 靠 model 前缀路由，不认独立 provider 字段）。
- task-09 单测 `test_register_success_200_body_and_header` + `test_register_model_none_defaults_openai` 同步更新
  （model 断言改 `openai/` 前缀，删 `provider` 断言）。

## 对 task 的影响（返工清单）

| task | 假设 | spike 结论 | 返工 |
|---|---|---|---|
| task-08 docker-compose | litellm + litellm-db + master key + STORE_MODEL_IN_DB + healthcheck | ✅ 全部实测可起，healthcheck /health/liveness 通 | 无 |
| task-09 register | POST /model/new + master key + 200/201/400/409 视成功 + litellm_params={model:纯名, provider:"openai"} | ✅ 鉴权/端点/master key 正确；⚠️ 重复返 200 非 400/409（功能等价）；❌ **model 格式 bug：纯名+provider 字段→router upsert 失败 "LLM Provider NOT provided"，deployment 被 drop 不进路由表** | model 改 `openai/<model>` 前缀 + **删 provider 字段**（spike 第 2 项实测，待返工） |
| task-09 unregister | POST /model/delete {id: model_name} | ❌ id 要 model_id 非 model_name | 重写 GET+逐个 DELETE（dabf73c9） |
| task-10 context | litellm_model_name 下发 provider_config | ✅ model_name LiteLLM 接受 + 第 4 项路由命中验证通过 | 无 |
| task-11 injector | ANTHROPIC_MODEL=litellm_model_name | ✅ 字段映射对 + 第 4 项 LiteLLM 按此路由验证通过 | 无 |

## 结论

- ✅ admin API 模式（POST /model/new 动态注册 + master key 鉴权）**假设成立**——不需回退备选（virtual key / config 静态）
- ✅ task-08 docker / task-10 context / task-11 injector 的**主体实现正确**（spike 实测验证）
- ⚠️ task-09 unregister 已返工（model_id 删除，dabf73c9）——**spike 清理 3 个 deployment 时再次实测确认 GET /model/info + delete by model_id 全链路工作**
- ❌ **task-09 register model 格式 bug 待返工**：`litellm_params.model` 必须带 `openai/` 前缀，删 `provider` 字段（spike 第 2 项实测，P0）
- ✅ **第 4 项（model_name 路由命中）已验证通过**——task-10/11 核心假设成立，关键设计风险解除
- ✅ **第 2 项（流式转换）实测通过**——完整 Anthropic SSE 事件链含 content_block_delta 实际文本
- ⚠️ **第 3 项（工具调用）转换机制工作，但 LiteLLM openai provider 带 tools 走 Responses API**——task-12 配 `use_responses_api: false` 解决（LiteLLM 配置层，非转换 bug）
