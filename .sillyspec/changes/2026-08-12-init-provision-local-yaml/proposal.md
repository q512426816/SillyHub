---
author: qinyi
created_at: 2026-08-12 10:13:52
---
# 提案书（Proposal）

## 动机

工作区「初始化」目前只做文档缓存拉取（daemon 写 `.runtime/spec-version.json` + pullSpecBundle），完成后成员要真正用上平台的两个能力——进度同步（`sillyspec sync`）和工作区 MCP 接入（execute 派 Wave 子代理）——还差一步：本地 `.sillyspec/local.yaml` 的 `platform:` 和 `mcp:` 两段得手动配 token。本变更让 init 顺手把这两段配好，点完初始化即用，消除多余手工步骤并顺带修正最小权限问题。

## 关键问题

1. **体验割裂**：点完「初始化」绿了，进度同步和 MCP 接入却不可用，用户得另开命令行跑 `sillyspec platform connect` 或手填 token，初始化的"完成感"是假的。
2. **最小权限缺失**：用户为省事倾向直接把手里的全权限 `shk_live_` API Key 填进 platform 段（线上 local.yaml 即如此），一旦泄露等于全用户权限暴露。正确凭证应是 workspace-scoped 的 `shpsync_`/`shmcp_`（可独立吊销）。
3. **token 下发通道未被复用**：后端 init dispatch 已经握着"签谁的 token、给哪个 workspace"的全部信息，且 lease payload 下发明文凭证（provider_config.api_key）是成熟模式，但没用来下发这两个 token。

## 变更范围

- 后端：两个 token service 各加 `get_or_issue`（PlatformSyncTokenService 内联吊销、McpTokenService 复用三件套）；`build_claim_payload` 的 init 分支在 claim 时签发两 token 注入 payload（不落 lease.metadata）。
- daemon：`handleInitLease` 第 4 步 `writeLocalYaml`，文本级段替换写 `.sillyspec/local.yaml`（platform 覆盖、mcp 有才留），url 由 daemon 端 server_url 拼。
- 测试：claim 阶段 token 注入 / 不落库 / daemon 段替换 / 失败语义 全覆盖。

## 不在范围内（显式清单）

- 不动 sillyspec 工具仓（connect 保持原样，与 init 并存无冲突）。
- 不做 token 定期 gc 定时任务（get_or_issue 的吊销旧+签新已控制堆积）。
- 不改前端（init 按钮交互不变，后台多干一步）。
- 不覆盖用户已手填的 mcp 段（有才留，尊重手工配置）。

## 成功标准（可验证）

- init 成功后，成员本地 `.sillyspec/local.yaml` 的 platform 段含有效 `shpsync_` token + 正确 url，mcp 段（若原空）含有效 `shmcp_`（scope=dispatch）token + `/mcp` url。
- `sillyspec sync` 在 init 后无需手跑 connect 即可推送进度。
- 明文 token 不进 lease.metadata（DB 持久化字段），不进审计日志。
- 用户已手填的 mcp 段 init 后原样保留；platform 段被权威覆盖。
- 写 local.yaml 失败 → lease 标 failed（init 状态不显示已初始化）。
