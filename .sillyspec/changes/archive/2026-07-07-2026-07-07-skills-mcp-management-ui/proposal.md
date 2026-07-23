---
author: qinyi
created_at: 2026-07-07 23:15:00
---

# 2026-07-07-skills-mcp-management-ui 提案

## 动机

上一变更 `2026-07-07-daemon-skill-execution` 完成了 skills/MCP 的后端/daemon 管道（bundle 分发 + daemon 同步 + MCP 合并注入），但 design §3 明确 YAGNI 掉了 UI。导致：
- 平台 MCP 默认配置/白名单只能手编 daemon 宿主机文件，admin 无法经平台管理
- 自定义 skills 完全无法经平台新增（只能改代码库重新部署）
- 用户看不到 skills 同步状态

## 范围

补平台管理 UI + 配套后端 admin 端点 + daemon 改造（MCP 配置数据源从本地文件改 backend）：
1. 自定义 skills 完整 CRUD（DB 存储并入 bundle 分发）
2. MCP 平台配置/白名单 CRUD（JSON 编辑器 + 白名单 list）
3. workspace 级 skills/.mcp.json 只读查看（详情页 tab）
4. backend admin 端点 + CustomSkill 表 + Alembic migration
5. daemon mcp-config 改从 backend 拉 + skill-manager 删除同步清理

## 成功标准

- admin 可经 `/settings/skills` 新增/编辑/删除自定义 skill，保存后下次 daemon 启动同步到宿主 `.claude/skills/`，claude 能调用。
- admin 可经 `/settings/mcp` 编辑平台 MCP 配置（JSON）+ 白名单，保存后提示重启 daemon；重启后 daemon 拉取生效，claude spawn 时 MCP server 可用。
- workspace 详情页 skills/mcp tab 能查看该 workspace 的自定义 skills + `.mcp.json`。
- MCP env secret 展示遮蔽（token/key/secret/password 类 key）。
- 零回归：现有 skills bundle 分发、daemon skill-manager/mcp-config 既有链路不破坏。
