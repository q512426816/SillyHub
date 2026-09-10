---
schema_version: 1
doc_type: module-card
module_id: codex-settings
author: qinyi
created_at: 2026-09-11 01:06:00
---

# codex 供应商配置写盘器（codex-settings）

## 定位
把 lease 下发的 codex 形态 provider_config 凭证写进 per-session 隔离目录 `CODEX_HOME/{auth.json, config.toml}`（change 2026-09-10-multi-provider-injection FR-01）。背景（spike 实测硬发现）：codex CLI 0.147.0 无 base_url 环境变量注入面（二进制仅 OPENAI_API_KEY / CODEX_API_KEY 等 key 入口），端点重定向唯一载体是 config.toml `[model_providers.<id>]` 表。本模块与 pi-settings 同属「配置写盘层」，由 task-runner.applyProviderFileSettings 按 agent_kind='codex' 分派调用（interactive / batch 两接线点 + 热切换重写共用同一函数）。

## 契约摘要
- 唯一导出：`writeCodexHome(input: CodexHomeWriteInput): Promise<void>`；入参 `{codexHome, provider, daemonApiKey}`（目录由调用方 spawn 前创建，写盘器不自建）。
- per-form 映射（两形态）：
  - anthropic 直连（api_format 缺省 / 'anthropic'）：auth key = provider.api_key；base_url = provider.base_url；model = default_fallback_model ?? model（裸 id）。
  - openai_chat（api_format = 'openai_chat'，经 litellm_proxy 通道 D-006）：auth key = daemonApiKey（进程级 master key 不出 backend，payload 刻意不含 api_key）；base_url = provider.litellm_base_url（hub 代理地址）；model = provider.litellm_model_name（usr-<uid>-<pid> LiteLLM 路由键）。
- 产物：auth.json `{"OPENAI_API_KEY": key}`（先读后写保留未知兄弟键；key 缺省整文件不写——keyless 自定义 provider 合法）；config.toml 顶层 `model`（缺省不写该行）+ `model_provider = "sillyhub"` + `[model_providers.sillyhub]` 表（name / base_url / wire_api）。

## 关键逻辑
```text
writeCodexHome({codexHome, provider, daemonApiKey}):
  provider 整体缺省 → return（D-012 absent 边界，不写不抛）
  resolveCodexForm 按 api_format 分支解析 key/baseUrl/model
  per-form 必需字段全缺（anthropic: api_key/base_url；openai_chat: litellm_base_url/litellm_model_name）
    → console.warn 后 return（零写入，可诊断不静默）
  key 有值 → 写 auth.json（保留未知兄弟键）
  保守合并写 config.toml：托管段（根区 model/model_provider/model_providers 行 +
    [model_providers.sillyhub] 表含子表）丢弃重写；非托管内容（[projects.*] 信任
    记录、兄弟 provider 表、未知键、注释）逐行保留；根键重排到首个表头前保证
    产出恒为合法 TOML
  任一 IO 失败 → console.error 后 throw（reject）→ 调用方跳过 CODEX_HOME env
    注入仍 spawn（失败语义唯一化：半写目录被 CLI 读到 ≠ 按宿主现状运行）
```

## 注意事项
- CLI 版本基线（R-03）：写盘形状以 **codex 0.147.0** 实测为 golden——`wire_api = "responses"` 是自定义 provider 唯一合法值（0.147.0 已移除 "chat"，配置加载即报错）；CLI 升级若改文件格式，由 tests/provider-injection-smoke.integ.test.ts 真跑冒烟暴露（本机验证基线 codex-cli 0.147.0，mock 全链 exit=0）。
- spike golden 证据：`.sillyspec/changes/2026-09-10-multi-provider-injection/spike/a2b-config.toml` 与 `a2-auth.json`（产物逐字段同形）；冒烟测试对该 golden 做整文件逐字段断言。
- 自定义 provider 不强制 key（spike A3a：无 key 请求照发、Authorization 空）→ key 缺省不写 auth.json 是合法形态而非错误。
- 保守合并是「托管段差量替换」不是全文件重写：codex 运行时会在 CODEX_HOME 落 [projects.*] 信任记录等状态，全量覆盖会丢非托管内容。
- 手写极小 TOML 序列化（daemon 无 TOML 库且不新增依赖），仅覆盖字符串标量 + 最小完备转义；既有文件损坏时按空文件重建（per-session 托管目录，无宿主数据损失面）。
- 安全：api_key / daemonApiKey 明文只进文件不进任何日志（warn/error 载荷仅路径 / 字段名 / 错误 message）。

## 人工备注

<!-- MANUAL_NOTES_START -->

<!-- MANUAL_NOTES_END -->
