---
author: qinyi
created_at: 2026-07-07 23:23:00
goal: daemon mcp-config 改从 backend 拉 + skill-manager 删除同步清理
implementation: 改 sillyhub-daemon/src/mcp-config.ts 的 loadPlatformMcpConfig：调 GET /api/daemon/mcp/config（serverUrl+daemon token）替代读本地 ~/.sillyhub/daemon/mcp.json；网络失败回落本地文件 fallback；改 skill-manager.ts extractSkillsBundle：解压前清空目标 tmp dir（已用 tmp-extract + rename，确保删除自定义 skill 后 daemon 不残留）
acceptance: daemon 启动 mcp 平台配置从 backend 拉（log: mcp_config_fetched_from_backend）；网络失败回落本地文件（fallback warn）；skill-manager 删除 DB 自定义 skill 后下次同步清理（.tmp-extract 清空 + 解压 + rename）
verify: cd sillyhub-daemon && pnpm test tests/mcp-config.test.ts tests/skill-manager.test.ts
constraints: ESM import .js 后缀；本地文件 fallback 保留（offline）；extractSkillsBundle 原子性（tmp 解压成功才 rename）
depends_on: [task-05]
covers: [FR-05, FR-06, D-004]
---

# task-07: daemon mcp-config 改 backend 拉 + skill-manager 清理

## 验收标准
A. `loadPlatformMcpConfig` 改调 `GET /api/daemon/mcp/config`，返回平台配置 + 白名单；网络失败回落本地 `~/.sillyhub/daemon/mcp.json`（warn）。
B. `extractSkillsBundle` 解压前清空 tmp 目录（删除自定义 skill 后 daemon 下次同步不残留）；tmp 解压成功后原子 rename 到目标。
C. 既有 mcp-config 合并/白名单逻辑 + skill-manager 版本比对/拉取链路零回归。
