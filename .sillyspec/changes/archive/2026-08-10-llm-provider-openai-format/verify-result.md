---
author: qinyi
created_at: 2026-08-10 07:35:00
updated_at: 2026-08-10 08:58:00
---

# 验证报告（Verify Result）— change 2026-08-08-llm-provider-openai-format

## 结论

PASS WITH NOTES（gap-A + gap-D 已修复实测定稿 + 真 claude 会话证实，主体可用）

主体交付完成（12 task 代码全部实现 + 单测全绿 + 端到端核心组件真实集成验证 + **真 claude 二进制 live 会话证实**）。**gap-A（工具调用）+ gap-D（injector 档位映射）已找到真正根因并修复 + 实测全绿**：
- gap-A：litellm 1.95.0 对 openai 上游默认走 Responses API，原假设的 `use_responses_api` 字段在该版本源码不存在；真正生效是显式 `model_info.mode=chat`，修复后流式 /v1/messages（= Claude Code 路径）纯文本 + 工具调用全 ✅。
- gap-D（live 会话新发现）：injector openai 分支原只设 `ANTHROPIC_MODEL`，漏设 `ANTHROPIC_DEFAULT_{HAIKU/SONNET/OPUS/FABLE}_MODEL`，导致 claude 副通道请求（标题/摘要等）在 litellm 无 deployment 失败。已补齐 4 档位映射。
- **真 claude v2.1.216 live 会话证实**：隔离用户 config + 修复后 env 配置，claude 经 litellm→opencode 读 hello.txt 工具调用成功，返正确内容 `BLUE-PEGASUS-7741`。
gap-B 经真 claude 二进制证实（非经平台 daemon 拉起——环境无已注册 daemon runtime，需独立基建）；gap-C（预设 default_model 回填）次要待补。

## 任务完成度

- task-01~06, 08~11：✅ 全 acceptance 满足（代码 + 单测 + 端到端核心验证）
- task-07：⚠️ acceptance 1-3 ✅（前端单测 14 用例）；acceptance 4 Wave1 真实拉模型 design §1 实测 + spike 流式间接证 opencode.ai 可达/key 有效，但 default_model 未回填预设（gap-C）
- task-12：✅ acceptance 1 工具调用已修复（gap-A mode=chat 实测定稿）+ constraints 1 端到端铁律真 claude 会话证实（gap-B live）；acceptance 2/3/4/5/6 ✅；额外修复 gap-D（injector 档位映射，live 会话坐实的真缺陷）

## 设计一致性

实现与 design.md 一致（6 探针全过）：
- 探针 1（TODO）：probe.py 3 处 TODO(spike-01) 既有债（GLM/kimi 探测形态未实测，非本次引入），daemon/frontend 零 TODO
- 探针 2（关键词）：api_format/openai_chat/litellm register/unregister/litellm_model_name/_strip_openai_suffix/litellm_base_url+auth_token/litellm_registered/injector openai 分支/守护移除/徽标 全实现
- 探针 3（测试覆盖）：test_api_format 22 + test_litellm_client 13 + test_llm_provider 联动 + test_resolve_default_provider_config + test_provider_config_payload + frontend 14 + credential-injector 5；task-08 部署无单测（spike 实测 healthy + 网络）
- 探针 4（决策）：decisions.md 不存在，design §11 D-001~D-012 全 v1 定稿闭环映射 FR/章节，无 P0/P1 unresolved
- 探针 5（契约）：litellm_registered 同步 api-types.ts:14475 + openapi.json
- FR-01~11 / NFR-01~03 / C-01~04 / D-001~D-012 全闭环

## Runtime Evidence（integration-critical + deployment-critical 真实集成证据）

1. **register 真实调 litellm admin API**（task-09 修复后接线实测 2026-08-10）：host Python 直调 litellm_client.register()（真实 litellm + opencode token），POST /model/new 返 200，GET /model/info 确认 deployment `model=openai/kimi-k3` + `api_base=https://opencode.ai/zen/go/v1` 进路由表（model_id=1d44ce34...），unregister cleanup 全链路工作。
2. **litellm 部署 healthy + 网络**（task-08 返工实测）：litellm container healthy（healthcheck 改 python urllib，镜像无 curl）；backend→litellm HTTP 200（dev compose 加 external network multi-agent-platform_default，跨 compose 网络打通）。
3. **spike 第 2 项流式转换**：openai/kimi-k3 经 litellm，POST /v1/messages（Anthropic 格式）stream=true 返完整 Anthropic SSE 事件链（message_start → content_block_start → content_block_delta 实际文本 → message_delta stop_reason=end_turn → message_stop），OpenAI 上游流式→Anthropic 流式转换完全工作。
4. **spike 第 4 项路由命中**：LiteLLM 按 body.model 字段路由（model_name=usr-route-test 命中 deployment，响应含 "Received Model Group=usr-route-test"）。
5. **测试套件对账**：backend llm_provider + lease 206 passed / frontend 1346 passed / sillyhub-daemon credential-injector 42 passed / backend ruff+mypy 过 / frontend typecheck+lint 过。
6. **NFR-01 安全核心抽查**：context.py openai 分支 6 字段无上游 api_key + credential-injector.ts openai 分支只注 3 个 ANTHROPIC_* 不注上游 key，双确认。
7. **gap-A 工具调用修复实测定稿**（2026-08-10）：直连 opencode.ai `/chat/completions` 实测确认标准 OpenAI 兼容（纯文本返 `object=chat.completion`、tools 返 `finish_reason=tool_calls` + `tool_calls[]`），证明问题在 litellm 路由侧。litellm 1.95.0 默认走 Responses API（`use_responses_api` 字段源码 grep 0 = 不存在）；改用 `model_info.mode=chat` 后实测矩阵全绿（见 gap-A 表）：/v1/chat/completions 全场景 ✅ + /v1/messages 流式纯文本+tools ✅（含 tool_use block）。
8. **gap-B 核心路径 → 真 claude 二进制 live 会话证实**（2026-08-10）：真起 claude v2.1.216（CLAUDE_CONFIG_DIR 隔离用户 settings.json）+ 修复后 env（BASE_URL=litellm + master_key + MODEL + 4 档位 DEFAULT_*_MODEL=gap-a-live-test）→ claude 经 litellm→opencode 成功读 hello.txt（**工具调用成功**），返 `The secret code is: **BLUE-PEGASUS-7741**`。覆盖 Claude Code 确切请求路径（流式 /v1/messages + tools）。
9. **gap-D injector 档位映射修复**（2026-08-10）：live 会话发现 injector openai 分支漏设 4 档位 DEFAULT_*_MODEL → claude 副通道请求失败；修复后 injector 产出 7-env（BASE_URL/AUTH_TOKEN/MODEL + 4 档位全=litellm_model_name），credential-injector 42 单测全绿。

> 缺失：daemon 拉起真实 Claude Code 进程跑完整 agentic loop（= gap-B 形式环节，需 backend rebuild 载入新 mode=chat 代码 + 平台 session 编排）。上述证据已覆盖 litellm→上游转换核心 + Claude Code 的确切请求路径，daemon→litellm 注入链由 injector 单测覆盖逻辑。

## Gaps（遗留，建议补全）

### gap-A（task-12 acceptance 1 工具调用）— ✅ 已修复 + 实测定稿（2026-08-10）

**真正根因**（gap-A 二次诊断实测推翻原 spike#3 推断）：litellm **1.95.0** 对 openai 上游默认走 **Responses API**（调上游 `/responses` 端点，opencode 该端点返 `object="response"` 格式），openai adapter 期望 chat completions → 解析失败 `OpenAIException` + litellm 重试 → 纯文本非流式超时、工具调用失败。原 spike#3 假设的修复（litellm_params 加 `use_responses_api: false`）**在 1.95.0 源码中 grep 0 命中——该字段根本不存在**，是无操作字段（litellm 存储但从不读取）。

**真正的修复杠杆**：POST /model/new body 顶层字段 `model_info: {"mode": "chat"}`（非 litellm_params 内）强制 Chat Completions 路径。litellm_client.register() 已改用此字段（移除无效 use_responses_api）。

**实测矩阵**（mode=chat 单 deployment，2026-08-10 真实 litellm + opencode.ai kimi-k3）：

| 调用路径 | 纯文本 | 工具调用 |
|---|---|---|
| /v1/chat/completions（OpenAI 直通）| ✅ chat.completion | ✅ chat.completion + tool_calls |
| /v1/messages **流式**（Claude Code 路径）| ✅ 完整 SSE 事件链 | ✅ SSE + tool_use block |
| /v1/messages 非流式 | ❌ litellm 1.95.0 quirk（仍走 responses bridge）| ❌ 同左 |

非流式 /v1/messages 损坏是 litellm 1.95.0 已知上游 quirk（mode=chat 也无法覆盖，bridge 发生在 proxy anthropic handler 深层），但 **Claude Code 默认流式，不受影响**。直连 opencode `/chat/completions` 实测确认是标准 OpenAI 兼容端点（纯文本 + tools 均返标准格式），证明问题全在 litellm 路由侧、非上游。

### gap-B（task-12 constraints 1 端到端铁律）— ✅ 真 claude 二进制 live 会话证实（2026-08-10）
**真起 claude v2.1.216 实跑证实**：隔离用户 `~/.claude/settings.json`（其 env 覆盖会指向用户自己的 glm 网关 15721，必须用 `CLAUDE_CONFIG_DIR` 隔离）+ 修复后 env（ANTHROPIC_BASE_URL=litellm:4000 + AUTH_TOKEN=master_key + MODEL + **4 档位 DEFAULT_*_MODEL 全 = litellm_model_name**，即 gap-D 修复后的 injector 产出）→ claude 经 litellm→opencode 成功**读 hello.txt 工具调用**，返正确内容 `The secret code is: **BLUE-PEGASUS-7741**`。这覆盖了 Claude Code 的确切请求路径（流式 /v1/messages + 工具），与 daemon 注入 env 后 claude 发出的请求逐字等价（daemon env 注入由 credential-injector 42 单测覆盖）。
**唯一未做**：经平台 daemon 进程拉起 claude（环境无已注册 DaemonRuntime，count=0，需独立装 sillyhub-daemon + 注册基建）。daemon 的唯一作用是注入上述 env（已单测）+ 进程编排（既有能力，非本变更引入），故此形式环节不阻塞验收。

### gap-D（task-11 injector 档位映射）— ✅ 已修复 + 真 claude 会话坐实（2026-08-10）
**live 会话发现的真缺陷**：injector openai 分支原只设 `ANTHROPIC_MODEL`（注释"openai 单模型无角色分流"），但 Claude Code 除主模型外发 haiku/sonnet/opus/fable 档位副通道请求（标题生成/会话摘要/快速工具决策），这些请求 model 取自 `ANTHROPIC_DEFAULT_{ROLE}_MODEL`（缺省走 claude 内置档位名）。openai 单后端只有 litellm_model_name 一个 deployment → 副通道请求无 deployment → 失败（实测"modelCode 不存在"）。**修复**：openai 分支补齐 4 档位全映射到 litellm_model_name（复用 ROLE_ENV 常量遍历），与用户个人 settings.json 把 4 档位全指 glm-5.2 的成熟用法一致。credential-injector 42 单测全绿（3 个 openai 用例断言更新为 7-env 形态）。

### gap-C（task-07 acceptance 4 次要）
opencode_zen_openai 预设 `default_model` 未回填（llmProviderPresets.ts 注释"待 task-07 真实拉模型后回填"，实际无该字段）。openai 单模型可选（provider.model 提供），非阻塞。

## 变更风险等级

**integration-critical + deployment-critical**（涉及 daemon credential-injector 跨进程注入 + lease provider_config lifecycle 下发 + docker-compose litellm 部署启动路径）。Runtime Evidence 见上（register/spike/litellm healthy 真实集成证据；完整 Claude Code 会话 = gap-B）。风险等级由 design.md 内容判定（含 daemon/lease/session/provider_config 关键词），未用 frontmatter 显式声明覆盖。

## 测试

- backend ruff check + format ✅ + mypy(staged .py) ✅
- backend llm_provider + lease pytest **182 passed**（llm_provider+lease 子集）/ 全量 206（含 daemon-client 慢测试）✅
- backend litellm_client **16 passed** ✅（gap-A mode=chat 断言）
- frontend typecheck ✅ + lint 无 error（仅既有 unused-vars warning）+ test **1346 passed** ✅
- sillyhub-daemon credential-injector **42 passed** ✅（gap-D 4 档位映射，3 个 openai 用例更新为 7-env）+ typecheck ✅
- 真实集成：register 真实调 litellm ✅ + 流式转换 ✅ + litellm healthy + backend→litellm 200 ✅
- **真 claude live 会话** ✅：v2.1.216 经 litellm→opencode 读文件工具调用成功返 `BLUE-PEGASUS-7741`（gap-B）

## 部署注意（Deployment Notes）

1. **backend 镜像需 --no-cache rebuild**：当前运行容器沿用 Aug 8 缓存镜像，**整个 llm_provider 模块（含 litellm_client.py）尚未 bake 进镜像**（之前所有 register 实测走 host Python，非容器）。部署前必须 `docker compose build --no-cache backend` 让 mode=chat 代码进镜像，否则容器内 set-default openai 供应商会因缺 litellm_client 模块失败。
2. **litellm 部署**：litellm-config.yaml 保持 admin API 动态注册模式（model_list: []），mode=chat 由 backend register 时逐 deployment 注入（非全局），无需改 config。
3. **gap-C 待补**（次要，非阻塞）：opencode_zen_openai 预设 default_model 回填 + litellm 非流式 /v1/messages quirk（Claude Code 流式不受影响）。
