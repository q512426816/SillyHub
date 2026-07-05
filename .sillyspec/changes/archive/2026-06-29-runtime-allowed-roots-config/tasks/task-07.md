---
id: task-07
title: 端到端验证（list_dir + CC 写入/读取 + 默认 + 兼容）
author: WhaleFall
created_at: 2026-06-29T10:25:55
priority: P0
depends_on: [task-02, task-03, task-04, task-05, task-06]
blocks: []
allowed_paths: []
change: 2026-06-29-runtime-allowed-roots-config
---

# task-07

> goal: 端到端验证 allowed_roots 配置全链路（design §9 验收 7 条）。

## implementation
- admin 在 /runtimes 编辑 runtime allowed_roots 加项目路径（如 F:/WorkNew/SillyHub）→ 保存
- 等心跳（~15s）daemon 同步本地 config
- list_dir 浏览项目路径 → 放行（不再 "outside allowed_roots"）
- 触发 CC run：CC 写项目内文件成功；CC 写白名单外 CC permission 拒绝（日志）；CC 读任意路径成功
- 新 runtime 注册默认 ["~/.sillyhub"]
- 旧 daemon（不读心跳 allowed_roots）兼容不崩

## acceptance
- design §9 验收 7 条全过

## verify
- 手动 /runtimes 编辑 + list_dir + CC run（batch + interactive）
- `cd backend && uv run pytest`（含 task-01~03 测试）
- `cd sillyhub-daemon && pnpm test`（含 task-04/05 单测）
- `cd frontend && pnpm test`（含 task-06）

## constraints
- 不改代码（验证 task）
- rebuild backend + 重启 daemon（用新 bundle）后端到端
- 旧 daemon 兼容性（心跳响应新字段不破坏旧 daemon）
