---
author: qinyi
created_at: 2026-07-07 23:20:00
plan_level: full
---

# 实现计划

> 来源：proposal.md / requirements.md（FR-01~11, NFR-01~05）/ design.md（§5 方案 A 4 块 §6 文件清单 §8 D-001~D-010）/ tasks.md。

## Wave 1 — 全量（方案 A 一次性）

单 Wave 12 task，按依赖排序（blockedBy 标注）：

- [x] task-01: backend CustomSkill 数据模型 + Alembic migration（FR-01, D-001 D-002）
- [x] task-02: backend CustomSkill admin CRUD 端点 + service（FR-01, NFR-01）
- [x] task-03: backend skills_bundle_service 合并 DB 自定义 skills（FR-02, D-001）
- [x] task-04: backend MCP 平台配置/白名单 CRUD（扩 settings/router，PlatformSetting）（FR-03 FR-04, D-003 NFR-02 NFR-03）
- [x] task-05: backend daemon MCP config 端点 GET /api/daemon/mcp/config（FR-05, D-004）
- [x] task-06: backend workspace skills/.mcp.json 查看端点（FR-07 FR-08, D-006 NFR-05）
- [x] task-07: daemon mcp-config 改从 backend 拉 + skill-manager 删除同步清理（FR-05 FR-06）
- [x] task-08: frontend /settings/skills 页（FR-09, D-007）
- [x] task-09: frontend /settings/mcp 页（FR-10, NFR-02）
- [x] task-10: frontend workspace 详情 skills/mcp tab（FR-11）
- [x] task-11: secret 脱敏 + 权限门控 + 双校验贯通（NFR-01 NFR-02 NFR-03）
- [x] task-12: e2e 集成验证（全 FR + NFR-04 零回归）

## 任务总表

| 编号 | 任务 | 优先级 | 依赖 | 覆盖 FR/D |
|---|---|---|---|---|
| task-01 | backend CustomSkill 模型 + migration | P0 | — | FR-01 D-001 D-002 |
| task-04 | backend MCP 配置/白名单 CRUD | P0 | — | FR-03 FR-04 D-003 NFR-02 NFR-03 |
| task-06 | backend workspace 查看 端点 | P1 | — | FR-07 FR-08 D-006 NFR-05 |
| task-02 | backend CustomSkill CRUD 端点 | P0 | task-01 | FR-01 NFR-01 |
| task-03 | backend bundle 合并 DB 自定义 | P0 | task-01 | FR-02 D-001 |
| task-05 | backend daemon MCP config 端点 | P0 | task-04 | FR-05 D-004 |
| task-07 | daemon mcp-config 改 backend 拉 + skill-manager 清理 | P0 | task-05 | FR-05 FR-06 |
| task-08 | frontend /settings/skills 页 | P0 | task-02 task-03 | FR-09 D-007 |
| task-09 | frontend /settings/mcp 页 | P0 | task-04 | FR-10 NFR-02 |
| task-10 | frontend workspace tab | P1 | task-06 | FR-11 |
| task-11 | 脱敏 + 权限 + 校验贯通 | P0 | task-02 task-04 | NFR-01 NFR-02 NFR-03 |
| task-12 | e2e 集成验证 | P0 | task-01~11 | 全 FR NFR-04 |

## 关键路径

`task-01（CustomSkill 模型）→ task-02（CRUD）→ task-08（skills 页）→ task-12（e2e）`
`task-04（MCP 存储）→ task-05（daemon 端点）→ task-07（daemon 拉）→ task-09（MCP 页）→ task-12`

- task-01/04/06 独立可并行（backend foundation）。
- task-03 依赖 task-01（模型就绪才能合并 bundle）。
- task-07 依赖 task-05（daemon 端点就绪）。
- task-08/09/10 依赖对应 backend 端点。
- task-11 横切（脱敏/权限/校验），依赖 task-02/04 就绪后贯通。
- task-12 最后。

## 跨任务契约（provider → consumer）

| 契约 | provider | consumer | 关键字段 |
|---|---|---|---|
| CustomSkill 模型 | task-01 | task-02, task-03 | `{id, name, description, content, created_by, created_at, updated_at}` |
| bundle 含自定义 skills | task-03 | task-07（daemon 同步）, task-08（前端读 manifest） | manifest files 追加 `<name>/SKILL.md` |
| MCP 平台配置/白名单存储 | task-04 | task-05, task-09 | PlatformSetting key=`mcp.platform_default`/`mcp.whitelist` |
| daemon MCP config 端点 | task-05 | task-07 | `GET /api/daemon/mcp/config` → `{platform_default, whitelist}` |
| workspace skills/mcp 查看 | task-06 | task-10 | `GET /api/workspaces/{id}/skills` + `/mcp-config` |
| 脱敏 + 权限 | task-11 | task-08/09/10 | admin GET 遮蔽 env secret；CRUD `MANAGE_PLATFORM` |

## 全局验收标准

- [ ] backend：`uv run pytest -q` 全绿（CustomSkill CRUD + bundle 合并 + MCP 配置/白名单 + workspace 查看 + 脱敏单测）
- [ ] sillyhub-daemon：`pnpm test` 全绿（mcp-config 拉 backend + skill-manager 清空解压）
- [ ] frontend：`pnpm test` + `pnpm lint` + `pnpm typecheck` 全绿（skills/mcp 页 + workspace tab）
- [ ] admin 可经 UI CRUD 自定义 skill，daemon 重启后同步到 `.claude/skills/`，claude 可调
- [ ] admin 可经 UI 编辑 MCP 配置/白名单，重启 daemon 后 claude spawn 时 MCP server 可用
- [ ] MCP env secret 展示遮蔽（admin GET 遮蔽，daemon GET 原值）
- [ ] workspace tab 能查看 skills/.mcp.json（daemon-client 经 HostFsDelegate 读 specDir）
- [ ] **零回归**：现有 skills bundle 分发、daemon skill-manager/mcp-config 既有链路、settings 既有端点不破坏
- [ ] Alembic migration 链无冲突（唯一 revision + down 接当前 head）

## 覆盖矩阵

| ID | 覆盖任务 | 验收证据 |
|---|---|---|
| D-001（DB 单文件自定义） | task-01, task-03 | CustomSkill 表 + bundle 合并 |
| D-002（同名冲突 name unique） | task-01, task-02 | name unique 约束 + 字符集校验 |
| D-003（MCP 存 PlatformSetting） | task-04 | key-value JSON 存储 |
| D-004（daemon 拉 MCP） | task-05, task-07 | GET /api/daemon/mcp/config + mcp-config 改源 |
| D-005（权限 admin only） | task-02, task-04, task-11 | require_permission(MANAGE_PLATFORM) |
| D-006（workspace 只读经 SpecPathResolver） | task-06 | 经 HostFsDelegate 读 specDir |
| D-007（markdown 编辑器） | task-08 | 编辑弹窗带预览 |
| D-008（secret 脱敏） | task-04, task-09, task-11 | env token 类遮蔽 |
| D-009（双校验） | task-04, task-11 | pydantic + zod |
| D-010（平台级全共享） | task-01 | 无 workspace_id 字段 |
| FR-01~11 / NFR-01~05 | task-01~12 | 见任务总表覆盖列 |

## 自检结果（full）

- [x] 每个 task 编号（task-01~12）
- [x] 任务总表（优先级 + 依赖列）
- [x] 关键路径标注
- [x] 全局验收标准（含零回归 + migration 链条款）
- [x] D-001~D-010 全在覆盖矩阵
- [x] 跨任务契约自检：provider/consumer 关键字段已列
- [x] 入口文件检查：main.py（注册 skills router）+ settings/router.py（MCP 端点）in allowed_paths
- [x] 无 Mermaid（关键路径 + 任务总表依赖列已表达）
