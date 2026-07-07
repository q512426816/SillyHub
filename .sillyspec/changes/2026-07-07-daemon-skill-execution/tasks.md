---
author: qinyi
created_at: 2026-07-07 13:24:00
---

# Tasks: daemon-skill-execution

> 细节在 plan 阶段展开。本表只列名称 / 文件 / 覆盖 FR / 决策。

## Wave 1（单 Wave 一次性全做，方案 C）

- **task-01** backend stage 元数据结构：`AgentSpecBundle` 加 `stage_meta` 字段（base.py）+ `_build_stage_bundle` 改构造元数据（service.py，不拼完整 prompt）— FR-01 / D-001 D-006
- **task-02** daemon task-runner 改：删 line 457-463 写 CLAUDE.md + claude 启动 prompt 内嵌 skill 指令 + env STAGE_META 注入 — FR-01 FR-02 / D-001 D-005
- **task-03** daemon skill-manager 新建：平台 sillyspec skills 同步（启动查 manifest + 拉 bundle 解压，仿 self-update）— FR-03 / D-002
- **task-04** daemon workspace 自定义 skills 同步：workspace 绑定/lease 时从 specDir 拉（仿 spec sync）— FR-04 / D-002 D-004
- **task-05** daemon mcp-config 新建：合并平台默认 + workspace `.mcp.json`，spawn claude 注入 `--mcp-config` + 白名单校验 — FR-05 / D-003
- **task-06** backend skills bundle 打包分发：`/api/daemon/skills/latest/manifest` + bundle 打包（多目录 tar）— FR-03 / D-002
- **task-07** server-local skills：容器 Dockerfile `COPY .claude/skills/` + server-local stage 投递对齐（prompt+env）— FR-06
- **task-08** claude 调 skill 强制保障：prompt 明确指令 + 不限 skill（--allowedTools）+ 兜底检测（未调 skill 报错）— NFR-01 / D-001
- **task-09** 废弃 stage prompt 模板 + 文档同步：归档 verify.md 等模板 + 模块文档注意事项 — 清理
- **task-10** e2e 集成验证：daemon-client verify dispatch → claude 调 skill → complete_lease patch 无冲突 — 全 FR + NFR-04

总计 10 task（单 Wave）。
