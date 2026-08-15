---
author: qinyi
created_at: 2026-08-15T15:07:51
change: 2026-08-15-init-trigger-sillyspec-init
stage: brainstorm
status: draft
---

# Requirements — init lease 触发 sillyspec init

## FR-01 init lease 执行 sillyspec init

daemon 收到 mode=init lease 后，在 pullSpecBundle 成功之后、postSpecSync 之前，以平台模式参数 spawn `sillyspec init`：

- `--dir <rootPath>`（成员本地项目根）
- `--spec-dir <specCacheRoot>`（~/.sillyhub/daemon/specs/<wsId>，外部规范目录）
- `--workspace-id <wsId>`
- `--no-skills`
- `--tool <逗号分隔工具列表>`

验收：执行成功后 rootPath 出现 `.sillyspec-platform.json`（含 specRoot/workspaceId，status active）与工具指令文件；specCacheRoot 出现 spec 骨架目录（knowledge/workflows/.runtime 等）。

## FR-02 失败语义 = lease 硬失败

init 子进程退出码非 0 / 超时（60s）/ spawn 失败 / 版本门控不过 → handleInitLease 返回 ok:false，error 前缀 `sillyspec_init_failed:` 或 `sillyspec_init_cli_too_old`，lease 终态 failed，stats.init_error 携带该前缀。失败后不执行后续步骤（postSpecSync/writeLocalYaml）。

## FR-03 spawn 前版本门控

runSillyspecInit 先执行 `sillyspec --version`（3s 超时），低于 `MIN_SILLYSPEC_VERSION_FOR_INIT` 常量（含 --no-skills/--tool 多值的首个 CLI 版本）即 fail-fast，错误信息含中文升级指引（重启 daemon 或 npm install -g sillyspec@latest）。不依赖 daemon 重启（preflight 只在启动跑一次）。

## FR-04 工具列表来源与透传

cli.ts 构造 TaskRunner 前（或等效时机）用 agent-detector 检测本机已装 agent，映射 sillyspec VALID_TOOLS（同名交集），构造注入；`_runInitLease` 透传给 runSillyspecInit。映射为空或未注入 → 兜底 `['claude']`。

## FR-05 backend 增量同步同 hash no-op

`apply_ops` 冲突分支（row.version != op.base_version）增加豁免：op.hash 非空且 == row.content_hash → 跳过落盘、不置 conflict，new_versions[path] 回 row.version（daemon manifest 对齐）。不传 hash（旧 daemon）行为不变；hash 不匹配仍 conflict。

## FR-06 daemon 排除 projects/ 目录

`computeIncrementalOps` / `buildFullManifest` / `packSpecDir` 三处排除清单统一加 `projects`（含成员机器绝对路径的 projects/<name>.yaml 不上传服务器，防跨成员互异冲突与 delete op 误删）。

## FR-07 CLI 侧前置改动（sillyspec 仓，先发版）

(a) `--no-skills` 开关：跳过 doInstall 的 skills 复制段；(b) `--tool` 逗号分隔多值（兼容重复）；(c) 平台模式（platformOpts 非空）整体跳过项目内 `.sillyspec/` 清理段（防 re-init 删 local.yaml 丢手调 mcp 段）。

## NFR-01 跨平台

spawn 用 shell:true + 超时杀树范式（对齐 preflight runWithTreeKill），Windows/Linux/macOS 一致；超时杀树不留孤儿进程。

## NFR-02 契约零变更

lease metadata、claim payload、complete_lease stats 结构不变（stats.init_error 是既有 free-form 字段的新取值）；apply_ops 请求 schema 不变。

## NFR-03 幂等

重复 init lease 无害：pull 整删重建 → init 幂等重建（existsSync 跳过/版本感知注入）→ postSync 同 hash no-op。

## 边界与约束

- 发版顺序：CLI 先发（含 FR-07 三项），daemon 后部署；版本门控把错配变成显式失败。
- 不放开 daemon 通用命令执行（仅此一处 spawn sillyspec init，不走 gate verify 白名单机制）。
