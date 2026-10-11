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
2026-10-10-all-engines-mcp-injection（task-06，D-006@v1 / D-011@v1）起新增 MCP 面：`mergeCodexMcpToml` + `writeCodexMcpServers` 把平台 MCP 配置表序列化为同文件 `[mcp_servers.*]` 托管段（codex CLI 官方 config.toml schema）；调用方为 codex-app-server-driver start。**codex caps 当前维持 false（D-011@v1 宿主平台二进制受阻未能实测生效）——机制就绪不触达**，复评 SOP 见 providers.ts codex 注释块与 spike-codex-mcp.md。

## 契约摘要
- 导出（MCP 面新增三个 + 既有凭证面/镜像/迁移面）：
  - `writeCodexHome(input: CodexHomeWriteInput): Promise<void>`——凭证面；入参 `{codexHome, provider, daemonApiKey}`（目录由调用方 spawn 前创建，写盘器不自建）。
  - `mergeCodexMcpToml(existing, mcpServers: Record<string, CodexMcpServerConfig>): string`——纯函数无 IO：`[mcp_servers.*]` 段序列化（`command` 标量 + `args` 字符串数组 + `[mcp_servers.<name>.env]` 子表）与差量合并。
  - `writeCodexMcpServers(codexHome, mcpServers): Promise<void>`——读 config.toml → mergeCodexMcpToml → writeFileAtomic；空表跳过不写；IO 失败 throw（调用方捕获降级 warn 不阻断 spawn）。
  - `CodexMcpServerConfig`（结构类型 `{command, args?, env?}`，driver 侧直传）。
- config.toml 托管段分工（两写路径均「读原文→差量合并→原子写」幂等）：provider 托管段（根区 model/model_provider 行 + `[model_providers.sillyhub]` 表）归 writeCodexHome；`[mcp_servers.*]` 命名空间归 writeCodexMcpServers（daemon 独占：现有 mcp_servers 段整段丢弃重写防幽灵 server，其余行原样保留）。
- per-form 映射（两形态，凭证面）：
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

mergeCodexMcpToml(existing, mcpServers):
  空表 → 返回 existing 原文（不动文件）
  逐行扫描：表头路径首段 = mcp_servers 的段（含尾随空行/注释）整段丢弃，
    其余行保留 → 追加新 [mcp_servers.<name>] 块（command/args?/env 子表）
  键名按 TOML 裸键规则（name 由 daemon 白名单控制为安全标识符：
    sillyhub-daemon / sillyhub-file 等连字符形态合法）；值转义复用 tomlString
```

## 注意事项

- **写入一律原子**（2026-09-12-provider-file-tx D-003@v1）：auth.json/config.toml/宿主镜像
  拷贝走 `atomic-write.ts` writeFileAtomic（tmp+fsync+rename）——直接 writeFile 会留半截
  文件，config.toml 截断后保守合并保留残行持续产出非法 TOML。migrate rollout 拷贝例外
  （数据搬运非配置，幂等可重拷）。
- **`.sillyhub-managed` 生效标记**（D-004@v2）：ForReload 分支四镜像**标记先行**（标记
  写失败跳过整个镜像含删除动作）；restore 探测消费该标记（详见 provider-file-settings
  模块）。改写盘/镜像序时保持「删除类动作晚于标记持久化」不变量。
- CLI 版本基线（R-03）：凭证面写盘形状以 **codex 0.147.0** 实测为 golden——`wire_api = "responses"` 是自定义 provider 唯一合法值（0.147.0 已移除 "chat"，配置加载即报错）；CLI 升级若改文件格式，由 tests/provider-injection-smoke.integ.test.ts 真跑冒烟暴露（本机验证基线 codex-cli 0.147.0，mock 全链 exit=0）。MCP 面 `[mcp_servers.*]` 序列化形状按 codex CLI 官方 config.toml schema 落地、7 用例（含 TOML 往返/幂等/幽灵 server 防残留/非托管行保留）锁定，但**未在宿主引擎实测生效**（D-011@v1 受阻——宿主 codex 平台二进制不可用；复评通过即翻 caps 触达）。
- spike golden 证据：凭证面 `.sillyspec/changes/2026-09-10-multi-provider-injection/spike/a2b-config.toml` 与 `a2-auth.json`（产物逐字段同形）；冒烟测试对该 golden 做整文件逐字段断言。MCP 面受阻裁定与复评 SOP：`.sillyspec/changes/2026-10-10-all-engines-mcp-injection/spike-codex-mcp.md`。
- 自定义 provider 不强制 key（spike A3a：无 key 请求照发、Authorization 空）→ key 缺省不写 auth.json 是合法形态而非错误。
- 保守合并是「托管段差量替换」不是全文件重写：codex 运行时会在 CODEX_HOME 落 [projects.*] 信任记录等状态，全量覆盖会丢非托管内容。
- 手写极小 TOML 序列化（daemon 无 TOML 库且不新增依赖），仅覆盖字符串标量 + 最小完备转义；既有文件损坏时按空文件重建（per-session 托管目录，无宿主数据损失面）。
- 安全：api_key / daemonApiKey 明文只进文件不进任何日志（warn/error 载荷仅路径 / 字段名 / 错误 message）。

## 人工备注

<!-- MANUAL_NOTES_START -->

<!-- MANUAL_NOTES_END -->
