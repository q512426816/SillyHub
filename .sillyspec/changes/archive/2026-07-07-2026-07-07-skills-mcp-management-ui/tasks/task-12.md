---
author: qinyi
created_at: 2026-07-07 23:24:00
goal: e2e 集成验证（全 FR + NFR-04 零回归）
implementation: 全链路验证：admin 经 UI 增自定义 skill → bundle 含之 → daemon 同步 → claude 可调；admin 改 MCP 配置 → 重启 daemon → claude spawn MCP server 可用；workspace tab 查看；脱敏 + 权限 + 校验；零回归（backend + daemon + frontend 全量测试）
acceptance: 全 FR/NFR 验证通过；backend pytest + daemon pnpm test + frontend pnpm test 全绿；既有 skills bundle/daemon mcp-config/settings 链路零回归
verify: cd backend && uv run pytest -q；cd sillyhub-daemon && pnpm test；cd frontend && pnpm test && pnpm typecheck
constraints: 覆盖 design §10 验证策略；零回归条款；本 task 是验收门，依赖 task-01~11 全部
depends_on: [task-01, task-02, task-03, task-04, task-05, task-06, task-07, task-08, task-09, task-10, task-11]
covers: [全 FR, NFR-04]
---

# task-12: e2e 集成验证

## 验收标准
A. admin 经 `/settings/skills` 新增自定义 skill → `GET /api/daemon/skills/latest/manifest` 含之 → daemon 重启同步 → `.claude/skills/<name>/SKILL.md` 存在 → claude 可调。
B. admin 经 `/settings/mcp` 改平台 MCP 配置 + 白名单 → 重启 daemon → daemon 拉 `/api/daemon/mcp/config` → claude spawn 时 MCP server 可用。
C. workspace 详情 skills/mcp tab 展示（daemon-client 经 HostFsDelegate 读 specDir）。
D. MCP env secret 脱敏（admin GET 遮蔽，daemon GET 原值）；CRUD 非 admin 403。
E. 零回归：backend `uv run pytest -q` + daemon `pnpm test` + frontend `pnpm test`/`typecheck` 全绿；既有 skills bundle/daemon mcp-config/settings 链路不受影响。
