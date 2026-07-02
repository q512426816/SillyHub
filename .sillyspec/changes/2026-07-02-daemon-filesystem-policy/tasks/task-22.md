---
id: task-22
title: 端到端验证（design §13 全 14 条 + 兼容）
author: WhaleFall
created_at: 2026-07-02T15:12:00
priority: P0
depends_on: [task-08, task-10, task-13, task-14, task-16, task-17, task-18, task-21]
blocks: []
allowed_paths:
  - sillyhub-daemon/tests/e2e/
  - backend/tests/e2e/
change: 2026-07-02-daemon-filesystem-policy
goal: "(见 body)"
implementation: "(见 body)"
acceptance: "(见 body)"
verify: "(见 body)"
constraints: "(见 body)"
---

# task-22

> goal: 对照 design §13 全 14 条验收 + 兼容性端到端验证。

## implementation
- runtime 隔离：claude 配 D:\Projects、codex 配 E:\Workspace，互写被拒
- 热更新：前端改 allowed_roots → interactive 立即生效 / 在跑 batch 跑完 / 新起 batch 用新配置
- Tool 拦截：Write/Bash(>)/PowerShell(Set-Content)/CMD(mkdir)/Copy-Item/Move-Item/Remove-Item 未授权拒绝
- Codex batch 带内审批 decline
- 路径规范化：symlink/junction/UNC/`..` 被拒
- 审计页查询 + 筛选 + 分页
- 兼容：旧 daemon 连新 backend 靠心跳 / 新 daemon 连旧 backend 无 POLICY_UPDATE
- Python open() 降级：不硬拦，prompt + audit 可追溯（文档明确）

## 验收标准
- design §13 14 条验收全过
- 兼容性 #14 #15 过

## 验证
- 启动 daemon（上轮已停用，需重启）+ backend + frontend
- `cd sillyhub-daemon && pnpm test`
- `cd backend && uv run pytest`
- `cd frontend && pnpm test`
- 手动跑验收 case

## constraints
- daemon 上轮已停用，execute 前需重启（`node ~/.sillyhub/daemon/bin/sillyhub-daemon.js start`）
- R-01 Python open 不硬拦是 D-001 接受的约束，非失败项
- R-06 Codex 审批格式在 task-17 已验证
