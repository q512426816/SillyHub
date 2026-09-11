---
author: qinyi
created_at: 2026-09-09T13:35:00
---

# init lease 静默不下发 platform 凭据——三层断链全部零提示

> **修复状态（2026-09-09 当日，commit ef5b3c76a + sillyspec 仓 6eea47b）**：
> - ✅ daemon 跳过写盘 warn（`task_runner: init_lease_local_yaml_skipped` + 原因枚举）已实施；
> - ✅ backend 防御降级 warning（`init_claim_local_yaml_skipped` + reason）已实施；
> - ✅ sillyspec 三处「daemon 注入通道」注释已纠偏为「预留通道，daemon 未实现注入」（仓内
>   quick ql-20260909-009-bb26）；
> - ⏳ daemon 发版部署后本条移 finished/（warn 要随 daemon-dist 上架 + 存量 daemon 自更新
>   拉新才在生产可见）。

## 现象（2026-09-09 实证）

`.sillyspec/local.yaml` 的 `platform` 段整体缺失（284-292 行只剩说明注释），CLI 内置 sync 静默跳过（合法降级），本地 quicklog / 四件套 / 模块文档长期不上平台。用户以为「平台初始化会配好」，实际从未配上。

## 根因（三层断链，任一命中即静默失败）

1. **daemon 写盘闸门**（`sillyhub-daemon/src/task-runner.ts:906-919`）：claim payload 的
   `platform_config.local_yaml` 缺失 / 非对象 / 任一 token 为空 → `local_yaml = undefined`
   → `handleInitLease` 第 5 步跳过 `writeLocalYaml`，**零日志零提示**（注释自称「向后兼容旧
   lease / mock」，真实场景无法区分）。
2. **backend 注入闸门**（`backend/app/modules/daemon/lease/context.py:716`）：lease metadata
   缺 `actor_user_id` 或 `workspace_id`（非法值同）→ 防御降级：不签 token、不注入
   local_yaml、不抛错——claim 照常返回，lease 照常成功。
3. **sillyspec 注释与实现不一致**（`sillyspec/src/sync.js:1077` / `run/shared.js:706` /
   `agent-session-log.js:561`）：注释宣称凭据可经「daemon 注入通道」env
   `SILLYHUB_PLATFORM_URL` + `SILLYHUB_PLATFORM_TOKEN` 提供——但 daemon 仓（含 git 全历史）
   **从未实现过该注入**。env 通道只是 CLI 侧预留的门，三处注释让人误以为平台模式下凭据
   有 daemon 兜底，排障方向被带偏。

叠加后果：本仓 2026-06-27 建工作区以来的 init lease（`spec_version: 0`，服务器当时无
bundle）大概率在第 1/2 层静默跳过；即使早年限写过，`sillyspec platform disconnect` 三清
会连 platform 段一起删（唯一删除路径）。两头叠加 = 永久断链且无人知晓。

## 排障特征（复用）

- `sillyspec platform status` → `未连接`，但 local.yaml 有【platform 段】注释块。
- daemon.log `init_lease_sillyspec_init ok` 但平台 `platform_sync_tokens` 表无
  `sync-<root_path>` 或 init-provisioned 记录。
- 本地 quicklog 条目持续增长，服务器 `GET /api/changes/-/spec-manifest`（shpsync token）
  版本号不动。

## 建议工具修复方向

- daemon：跳过 writeLocalYaml 时至少 `console.warn` 一行（含原因枚举：
  local_yaml_missing / token_empty），lease 结果里带 `local_yaml_written: false`。
- backend：防御降级路径打 `log.warning("init_claim_local_yaml_skipped", reason=...)`。
- sillyspec：sync.js / shared.js / agent-session-log.js 三处注释补「env 通道需外部进程
  显式注入（当前无内置注入方）」，或 daemon 实现注入后再移除该括注。

## 手动补凭据路径（2026-09-09 实操，供复用）

无用户级 token 时的替代通道：SSH 上平台服务器 → backend 容器内
`PlatformSyncTokenService.create(workspace_id, name="sync-<root_path>", created_by=<真实用户
uuid>)`（参数对齐 connect 换发端点 `resolve-by-root-path`，该端点只认 shk_live_/JWT，
daemon 的 api_key 不是用户级凭证会被 401）→ 明文写回 local.yaml platform 段（文本级，
保留注释）→ `sillyspec platform sync --change <名>` 实推验证 200。

注意：容器内直跑脚本需 `from app.modules.workspace.model import Workspace` 注册模型，
否则 `platform_sync_tokens.workspace_id` FK 解析抛 NoReferencedTableError。

## 关联

- docs/sillyspec/finished/init-revokes-persistent-local-yaml-tokens.md（init 吊销坑，已修）
- docs/sillyspec/finished/坑8-repo-native平台指针锁死CLI上行断链.md（断链同族，指针侧已修）
- 2026-09-10 定时复核：双层修复已验证在 main（平台 ef5b3c76a + sillyspec 6eea47b）；待 daemon 发版部署后归档。

## 处置记录（2026-09-11 定时收口，部署实证，归档）

- 双层修复已随 daemon 构建分发并落地本机：部署 bundle（2026-09-10 23:47）实证含 `init_lease_local_yaml_skipped` 标记（daemon 跳过写盘 warn + 原因枚举，commit ef5b3c76a）；backend 防御降级 warning 同 commit 在 main；sillyspec 三处注释纠偏 6eea47b 已发版。
- 三层断链现在两层有声（daemon warn + backend warning），第三层（env 通道注释）已纠偏为「预留通道」——静默断链的排障特征（platform status 未连接 / manifest 版本不动）配合 warn 可定位。手动补凭据路径（容器内 create sync token）保留备查。归档。
