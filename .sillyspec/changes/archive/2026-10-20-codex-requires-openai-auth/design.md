---
author: flow-machine-draft
created_at: 2026-10-20T03:44:58.848Z
---
# 设计记录（Design Record）— 2026-10-20-codex-requires-openai-auth

## 做法概述

本变更怎么解决问题？改哪里、为什么选这个方案（一两段）。

改 `sillyhub-daemon/src/codex-settings.ts` 单点：`CodexFormValues` 增 `requireOpenAiAuth` 布尔（anthropic 分支 = api_key 非空；openai_chat 分支恒 false），`mergeConfigToml` 在 `wire_api` 行后按该布尔追加 `requires_openai_auth = true`。机理：codex CLI 对自定义 `[model_providers.*]` provider 默认不发 Authorization——auth.json 的 OPENAI_API_KEY 只有在 provider 表声明 `requires_openai_auth = true` 时才作为 Bearer 头发出（cc-switch 生产配置带此键 + 本机 A/B 实验 2026-10-20 双重证实：同 key 同端点 `/api/v1`，带键成功、缺键稳定断流）。平台 daemon 写盘器漏写该键，导致所有直连 codex 供应商的 key 从未随请求发出、上游掐流。

选 daemon 写盘器单点修复而非替代方案（openai_chat/litellm 代理通道或要求用户逐会话手改 CODEX_HOME）：前者模型选择退化为路由键且多两跳、后者无配置面且每会话被重写覆盖；单点一行 + 显式形态布尔是最小且语义准确的治本面。

## 接口契约

动了哪些函数/端点/命令/文件格式？对外可见的签名或行为变化是什么（含「无」的说明）？

- `resolveCodexForm`（内部纯函数）：返回值增 `requireOpenAiAuth: boolean` 字段——anthropic 分支 `key !== undefined`、openai_chat 分支恒 `false`。模块内私有类型，无外部 import 面。
- `mergeConfigToml`（内部纯函数，导出仅为单测）：产物 config.toml 的 `[model_providers.sillyhub]` 段在 `wire_api = "responses"` 行后可能多一行 `requires_openai_auth = true`（仅当 `v.requireOpenAiAuth`）。
- `writeCodexHome` / `writeCodexMcpServers` / `mirrorCodexHostAuth` / `isCodexFormSufficient` 对外签名与行为：无变化（除上述 config.toml 产物行）。
- HTTP 端点 / CLI 命令 / DB schema：无变化。

## 边界与并发（盲维四问——每问必答，答不了即设计缺口）

1. 乱序/迟到到达：输入或事件乱序时，本设计的假设还成立吗？
   本变更无事件序面——写盘器是同步纯函数 + 原子写（writeFileAtomic），输入只有 lease 下发的 provider_config 快照，快照内字段自洽无乱序概念。假设成立。

2. 并发写：两个执行体同时操作同一数据/文件会发生什么？
   per-session CODEX_HOME 目录会话级独占（既有设计，D-003/D-005），同目录无第二写者；writeFileAtomic 原子顶替既有保证不变。新增行不引入新并发面。

3. 切换/生命周期：会话、请求或变更中途切换/中断时状态是否安全？
   保守合并语义不变：托管段差量替换、非托管行保留。中途断电/崩溃至多留下旧版（无新行）或新版（有新行）config.toml，两者均为合法 TOML，codex 可正常加载；无半截行风险（单行追加由整文件原子写承载）。

4. 作用域：跨工作区/跨仓/多实例时数据会不会串台？
   新行由 per-form 值派生（api_key 有无），不读任何全局/宿主状态；per-session 目录隔离既有语义不变，无串台面。

## 风险与死路

本方案最大的风险是什么？试过但放弃的方案及放弃理由？

最大风险：`requires_openai_auth` 是 codex CLI 的非 stability-guaranteed 配置键（cc-switch 生产配置与官方智谱接入文档均在用，当前 CLI 0.162.0 实测有效），未来 codex 大版本若更名/移除该键，症状回归为「不发认证 → 断流」——与 wire_api="chat" 被移除的先例同类。缓解：daemon 已有版本基线注记惯例（R-03），本变更在常量注释处注明 CLI 基线与实测依据；升级 codex 基线时冒烟面覆盖。

试过但放弃的方案：
- 改走 openai_chat/litellm 代理通道（零代码）：模型选择退化为 usr-<uid>-<pid> 路由键、链路多 hub+LiteLLM 两跳，且该通道对 codex 从未被真实验证过（30 天零成功 run）；放弃。
- base_url 层面绕过（如要求用户把 key 拼进 URL）：bigmodel 不支持 URL 内嵌 key，且 key 进 URL 有日志泄漏面；放弃。
- 供应商配置面透传任意 provider 表键（settings_config 加 codex 专属段）：配置面扩大、需要 backend+daemon 双端改动，超出本次最小修复面；如未来需要 per-provider 差异键再立变更。

## 文件变更清单

| 操作 | 路径 | 说明 |
|---|---|---|
| 修改 | sillyhub-daemon/src/codex-settings.ts | CodexFormValues 增 requireOpenAiAuth；resolveCodexForm 两分支赋值；mergeConfigToml 按 bool 追加行；常量/注释注明 CLI 基线依据 |
| 修改 | sillyhub-daemon/tests/codex-settings.test.ts | golden 用例同步新行 + 新增 3 用例（有 key 写出 / keyless 不写 / openai_chat 零回归） |
