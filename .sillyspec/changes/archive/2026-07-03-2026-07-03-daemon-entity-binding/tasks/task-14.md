---
id: task-14
title: 部署文档：WS breaking 同步升级 + config 迁移 + 回退路径
author: qinyi
created_at: 2026-07-03 11:30:00
priority: P2
depends_on: [task-06]
blocks: []
allowed_paths:
  - docs/sillyspec/daemon-entity-binding-deploy.md
covers: [D-007, NFR-05]
---

## goal
> 输出本次 breaking 变更的部署/回退文档，覆盖同步升级时序、config 文件迁移、回退路径，运维可照做。

## implementation
- 新建 `docs/sillyspec/daemon-entity-binding-deploy.md`，章节：升级前置说明、同步升级步骤、config 迁移、数据重置、回退路径、验证清单。
- 同步升级时序（D-007）：daemon 与 backend 必须同批升级；旧 daemon（握手 runtime_id）连新 backend（期望 daemon_local_id）→ 握手失败，backend 日志提示「守护进程需升级」。
- config 迁移：首次升级 daemon 时若旧 `config.json` 存在，迁移其 daemon_local_id 到 `config-<server_hash>.json`（task-04 实现）；说明 per-server 隔离语义。
- 数据重置：引用 task-13 cleanup 脚本，说明重置后用户需重绑守护进程（D-007）。
- 回退路径：backend+daemon 同时回旧版 + 恢复升级前 daemon_runtimes 备份；default_agent 数据全程不动可免恢复。
- 附升级验证命令（健康检查、daemon 注册行数、WS 连接数）。

## acceptance
- 文档含同步升级、config 迁移、数据重置、回退四节，命令可复制执行。
- 标注 breaking 性质与「不升级 daemon 则握手失败」的明确信号。
- 回退步骤含备份恢复点（daemon_runtimes 备份 + default_agent 不动说明）。
- 引用 task-13 cleanup 脚本路径与 task-04 config 迁移行为。

## verify
- `cat docs/sillyspec/daemon-entity-binding-deploy.md`（人工 review 章节完整性）
- 升级验证：`docker compose ps` + backend `/healthz` + 查 `daemon_instances` 行数
- 回退演练：备份 daemon_runtimes → 升级 → 回旧版 → 恢复备份（文档可复现）

## constraints
- brownfield 兼容（D-007）：强调同步升级，无灰度握手兼容层（YAGNI）。
- 中文文档（CLAUDE.md 规则11），命令与字段名保留英文。
- 不实现自动 config 迁移脚本（task-04 已在 daemon 内部处理，文档只描述行为）。
- 回退前提 = 升级前已备份 daemon_runtimes；未备份则只能全量重绑。
