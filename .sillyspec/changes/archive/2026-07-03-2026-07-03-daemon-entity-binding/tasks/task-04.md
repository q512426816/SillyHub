---
id: task-04
title: daemon config 按 server_url 隔离文件（config-<server_hash>.json + 旧 config 迁移）
author: qinyi
created_at: 2026-07-03 11:30:00
priority: P1
depends_on: []
blocks: [task-05]
allowed_paths:
  - sillyhub-daemon/src/config.ts
  - sillyhub-daemon/src/cli.ts
  - sillyhub-daemon/tests/
---
## goal
> daemon 配置文件按连接的后端地址隔离，每个 server_url 独立 daemon_local_id（design §5.1 / D-001）。
## implementation
- `src/config.ts` 的 `DEFAULT_CONFIG_PATH` 从固定 `config.json` 改为 `config-<server_hash>.json`，`server_hash = sha256(server_url).slice(0,8)`。
- `loadConfig(server_url)` 接收 server_url，计算 hash 定位 per-server 文件；缺失则生成 daemon_local_id 并落盘。
- 首次升级兼容：若旧 `config.json` 存在且 per-server 文件不存在，迁移其 daemon_local_id 到新 per-server 文件（保留身份，design §5.1 / §10 风险对策）。
- `cli.ts:331,666` 的 `loadConfigFn(configPath)` 改为 `loadConfigFn(server_url)`（loadConfig 签名加 server_url 的连锁适配）。
- 新增单测覆盖：per-server 文件命名、不同 server_url 隔离、旧 config.json 迁移路径。
## acceptance
- 连 server A 与 server B 的两 daemon → 两份独立 config 文件 + 不同 daemon_local_id。
- 同一 server 重启 → 复用同一 config 文件与 daemon_local_id（身份稳定）。
- 首次升级（旧 config.json 存在）→ daemon_local_id 迁移到 per-server 文件不丢失。
- 缺失 config 时自动生成 daemon_local_id 并落盘。
## verify
- cd sillyhub-daemon && pnpm test
## constraints
- brownfield 兼容：旧 config.json 迁移逻辑必须幂等（迁移后不再重复迁移），且仅当 per-server 文件缺失时触发。
- server_hash 用 sha256 前 8 位（碰撞概率可接受，后端最终以 daemon_local_id 主键去重）。
- 不改 agent-detector 探测逻辑（design 非目标）。
- 与 task-01/W1 可并行（无 backend 依赖）。
- covers D-001。
