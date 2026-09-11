---
schema_version: 1
doc_type: module-card
module_id: pi-settings
author: qinyi
created_at: 2026-09-11 01:06:00
---

# pi 供应商配置写盘器（pi-settings）

## 定位
把 lease 下发的 pi 形态 provider_config 凭证写进 per-session 隔离目录 `PI_CODING_AGENT_DIR/{auth.json, models.json, settings.json}`（change 2026-09-10-multi-provider-injection FR-02）。背景（spike B 实测）：`PI_CODING_AGENT_DIR` 整体重定向 pi root（模型解析 / auth / settings 全从该目录读），自定义端点注入走该目录三文件。本模块与 codex-settings 同属「配置写盘层」，由 task-runner.applyProviderFileSettings 按 agent_kind='pi' 分派调用（interactive / batch 两接线点 + 热切换重写共用同一函数）。

## 契约摘要
- 唯一导出：`writePiDir(input: PiDirWriteInput): Promise<void>`；入参 `{piDir, provider}`（目录由调用方 spawn 前创建，写盘器不自建）。
- 仅消费「自定义端点」形态（provider.base_url 非空 + api_key + 裸 model id 齐）；api_format='openai_chat' 为 pi × openai_chat 禁配组合（后端 422 归 Create/Update 校验、前端禁选归表单，此处防御性双保险 warn 跳过）。
- 产物三文件（托管键差量替换，未知键 / 兄弟 provider 保留）：
  - auth.json：`{"sillyhub": {"type": "api_key", "key": api_key}}`（官方形状）；
  - models.json：`providers.sillyhub = {name: "SillyHub", api: <按 api_format 映射>, baseUrl, models: [{id: 裸 model id}]}`——anthropic/缺省 → `"anthropic-messages"`（Anthropic SDK 打 `{baseUrl}/v1/messages`，鉴权 `x-api-key` 头；baseUrl 不得带 `/v1` 后缀，客户端自拼。ql-20260911-029：原写死 openai-completions 导致智谱 anthropic 端点协议错配全断流）；未知 api_format → warn 跳过零写入；
  - settings.json：`defaultProvider = "sillyhub"`、`defaultModel = 裸 model id`。
- 裸 model id = `default_fallback_model ?? model`（与 codex-settings 同取值序，D-010）。

## 关键逻辑
```text
writePiDir({piDir, provider}):
  api_format='openai_chat' → console.warn 后 return（禁配防御，零写入）
  base_url 为空（官方端点形态）→ 静默 return（零写入——凭证注入归 env 层，D-008 分层）
  api_format 未知值（词表外）→ console.warn 后 return（ql-20260911-029：写错协议
    的 models.json 会让 pi 全断流，宁可不写）
  api_key / 裸 model id 缺失 → console.warn 后 return（宁可不写空 key：空串会被
    pi 当字面量 key 打给上游；无 model 的三文件是 CLI 不可用配置）
  api = 映射（anthropic/缺省 → 'anthropic-messages'）
  auth.json → models.json(api) → settings.json 依序先读后写（preserve unknown）
  任一 IO 失败 → console.error 后 throw（reject）→ 调用方跳过 PI_CODING_AGENT_DIR
    env 注入仍 spawn（失败语义唯一化）
```

## 注意事项
- CLI 版本基线（R-03）：写盘形状以 **pi 0.81.1** 实测为 golden——`providers.<key>.api` 按 api_format 映射（ql-20260911-029 起 anthropic 形态 = `"anthropic-messages"`，Anthropic SDK 打 `{baseUrl}/v1/messages` + `x-api-key` 头，智谱真实端点实测 exit=0；spike B1 的 openai-completions 形态仅适用于 OpenAI 兼容端点，当前词表无该形态合法入口）；auth.json 官方形状是 `{"type": "api_key", "key": ...}`（`{"apiKey": ...}` 投影形状实测被拒：`No API key found for the selected model.`，不采用）；CLI 升级漂移由 tests/provider-injection-smoke.integ.test.ts 真跑冒烟暴露（本机验证基线 0.81.1，mock 全链 exit=0）。
- spike golden 证据：`.sillyspec/changes/2026-09-10-multi-provider-injection/spike/b1-models.json`、`b1b-auth.json`、`b1-settings.json`；冒烟测试对 b1 系 golden 做逐字段断言。
- 与 env 层共存（R-04）：pi key 解析优先级 CLI `--api-key` > auth.json > env > models.json 内联 apiKey——文件层与 env 层并存时 auth.json 文件值压制 env 同键值，两层叠加无歧义路由；官方端点（base_url 空）本模块零写入，对 env 层零干扰。
- 安全：api_key 明文只进文件不进任何日志。

## 人工备注

<!-- MANUAL_NOTES_START -->

<!-- MANUAL_NOTES_END -->
