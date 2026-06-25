---
id: task-11
title: 集成验证 + 部署 — 全绿后 rebuild Docker（前后端）+ 浏览器验收 AC-01~06
phase: V1
priority: P0
status: draft
owner: WhaleFall
author: WhaleFall
created_at: 2026-06-25T16:10:00
depends_on:
  - task-01
  - task-02
  - task-03
  - task-04
  - task-05
  - task-06
  - task-07
  - task-08
  - task-09
  - task-10
blocks: []
requirement_ids:
  - FR-06
decision_ids: []
allowed_paths: []
---

## 1. 目标

在 task-01~10 全部落地后，跑**全量静态检查 + 测试**确认零回归，全绿后 rebuild Docker（**前后端都 rebuild**——后端 API 变了 + 前端 page/组件变了）并部署，最后浏览器人工验收 AC-01~06 的端到端组织树筛选行为。

本 task 是**纯验证任务**，`allowed_paths: []` —— 不写任何代码，只跑命令 + 浏览器操作。任何检查失败都必须回退到对应 task 修实现，**禁止改测试迁就**（CLAUDE.md 规则 8）、**禁止跳过 hook**（CLAUDE.md 规则 9）。

## 2. 覆盖来源（依据）

| 来源 | 章节 | 关键结论 |
|---|---|---|
| `.sillyspec/changes/2026-06-25-admin-users-org-tree/design.md` | §5 Phase 7 | 后端 list_users 测试 + 前端 vitest；ruff+mypy+tsc+lint 全绿；rebuild Docker 部署 |
| `.sillyspec/changes/2026-06-25-admin-users-org-tree/plan.md` | Wave 5 task-11 | dep 全部；P0；覆盖 FR-06 |
| `.sillyspec/changes/2026-06-25-admin-users-org-tree/plan.md` | 全局验收 AC-01~AC-09 | AC-01~06 浏览器验收；AC-08 全绿；AC-09 brownfield 零变化 |
| 项目约定 | `CLAUDE.md` 规则 5/7/9 | 执行顺序 文档→读码→测试→实现→跑测试→验收→更新文档；hook 拦截禁止跳过 |
| 用户记忆 | `feedback_deploy_after_quick.md` | 每次 quick fix 完成后 commit + push + rebuild Docker 并部署（本 task 为完整变更，同样适用） |

## 3. 修改文件清单

| 文件 | 改动 | allowed_paths |
|---|---|---|
| （无） | 纯验证任务，不改任何源码 / 测试 / 配置 | — |

> 若验收中发现 bug，**不在本 task 内修**——新建后续 task 或回退到对应 task，本 task allowed_paths 为空。

## 4. 实现要求

1. **顺序**：后端检查 → 前端检查 → 全绿 → rebuild Docker → 部署 → 浏览器验收。任一环节红即停，回退修实现。
2. **后端检查三件套**：`ruff check`（含自动 `ruff format` 校验）+ `mypy app` + `pytest`，全绿才算过。
3. **前端检查三件套**：`tsc --noEmit`（类型）+ `next lint`（eslint）+ `vitest run`（单测），全绿才算过。
4. **rebuild 范围**：本变更后端 router/service/schema 变了（API 契约增 organization_id/include_children + OrganizationRead 增字段）、前端 page/组件/lib 变了，**前后端都要 rebuild**——用 `up --build --force-recreate` 重建全部服务，不区分单端。
5. **部署后健康检查**：容器起来后确认后端 `/api/admin/organizations` 返回含 `subtree_member_count` 字段、`/api/admin/users` 接受 `organization_id`/`include_children` query 参数。
6. **浏览器验收**：以平台超管登录，进 `/admin/users`，按 AC-01~06 逐条手测。
7. **brownfield 兼容验证（AC-09）**：确认 organization_id 未传时 list_users 行为与改造前完全一致（全部用户、无重复行、total 正确）。
8. **不跳过任何 hook**：若 pre-commit / CI hook 拦截，修问题后重跑，禁止 `--no-verify`。

## 5. 接口定义

### 5.1 验证命令（按 local.yaml 约定）

**后端**

```bash
# lint_backend
cd backend && ruff check . && mypy app

# 自动格式化（ruff check 不改格式，需单独跑 format 确认无 diff）
cd backend && ruff format --check .

# test_backend
cd backend && pytest
```

**前端**

```bash
# lint_frontend（next lint）
cd frontend && pnpm lint

# 类型检查
cd frontend && pnpm exec tsc --noEmit

# test_frontend（vitest run）
cd frontend && pnpm test
```

**部署（rebuild 前后端）**

```bash
docker compose --env-file deploy/.env -f deploy/docker-compose.yml up --build --force-recreate -d
```

### 5.2 浏览器验收用例（AC-01~AC-06）

| AC | 操作 | 预期 |
|---|---|---|
| AC-01 | 进 `/admin/users`，点左侧「全部组织」 | 右侧表格显全部用户，行为与改造前一致（organization_id 不传） |
| AC-02 | 点一个叶子组织节点 | 表格只显该组织直属用户 |
| AC-03 | 点一个有下级的父组织节点 | 表格显父+所有下级用户（include_children=true） |
| AC-04 | 观察树节点 | 每个节点 title 含人数（subtree_member_count，缺省时 member_count）；disabled 组织不显 |
| AC-05 | 设关键词 + 状态 + 点组织 | 三条件叠加过滤，表格显三者交集 |
| AC-06 | 翻页 / 编辑用户 / 删除 / 会话 / 审计 / 重置密码 | 全部正常，不受组织筛选改造影响 |

附加：AC-07（新建带入）选中组织时点「+ 新建用户」，drawer 内该组织默认勾选；AC-09（brownfield）organization_id 未传时零变化。

### 5.3 部署后健康检查（curl 示例）

```bash
# 确认 OrganizationRead 含 subtree_member_count
curl -s -H "Cookie: <session>" http://localhost:8000/api/admin/organizations | jq '.[0] | keys'

# 确认 /api/admin/users 接受 organization_id + include_children（返回该子树用户）
curl -s -H "Cookie: <session>" "http://localhost:8000/api/admin/users?organization_id=<orgId>&include_children=true" | jq '.total'
```

## 6. 边界处理

| # | 场景 | 行为 | 责任层 |
|---|---|---|---|
| B-01 | ruff check 报告格式问题 | 跑 `ruff format .` 自动修复后重跑 check，不手改 | 验证（本 task） |
| B-02 | mypy 报类型错误 | 回退到对应 task 修实现（多为 task-03 list_users 签名 / task-02 _subtree_member_count），禁止 `# type: ignore` 迁就 | 对应后端 task |
| B-03 | pytest 失败 | 回退 task-05（后端测试）或 task-03（实现）修；区分是测试错还是实现错 | 对应后端 task |
| B-04 | tsc --noEmit 失败 | 多为 task-06 类型 / task-07 props / task-08 prop / task-09 接线对不上，回退修 | 对应前端 task |
| B-05 | vitest 失败 | 回退 task-10（测试）或 task-07/08（实现）；禁止改测试迁就实现 bug | 对应前端 task |
| B-06 | Docker rebuild 失败 | 查 build 日志（多为依赖 / 构建步骤），修后重跑 up --build | 验证（本 task） |
| B-07 | 容器起来但 API 500 | 查后端日志，多为 migration / 配置问题，回退后端 task | 对应后端 task |
| B-08 | 浏览器验收 AC 不通过 | 记录不通过的 AC + 复现步骤，回退对应 task 修，不在本 task 内打补丁 | 对应 task |
| B-09 | pre-commit hook 拦截 | 修问题后重提交，禁止 `--no-verify`（CLAUDE.md 规则 9） | 验证（本 task） |
| B-10 | brownfield 回归（organization_id 未传行为变了） | 回退 task-03 list_users，确认 organization_id=None 短路无影响 | task-03 |

## 7. 非目标

- 不写任何代码 / 测试 / 配置（纯验证）。
- 不优化性能（design §3 非目标：不缓存 subtree_member_count、不优化 N+1）。
- 不做负载 / 压测（数据量小未上线）。
- 不清理旧 Docker 镜像 / 卷（除非 rebuild 失败因磁盘空间）。
- 不改 deployment 配置文件（docker-compose.yml / .env）——仅用现有配置 rebuild。
- 不验收与组织树无关的功能（仅 AC-01~06 + 07/09）。

## 8. 参考源码 / 配置

- `deploy/docker-compose.yml`（rebuild 目标）
- `deploy/.env`（env-file）
- `backend/pyproject.toml`（ruff / mypy 配置基线）
- `frontend/package.json`（pnpm scripts：lint / test / build）
- `frontend/tsconfig.json`（tsc --noEmit 基线）
- design.md §5 Phase 7（验收范围）
- plan.md 全局验收 AC-01~AC-09（逐条对照）

## 9. TDD 步骤

> 本 task 无 TDD（纯验证）。执行步骤如下：

1. **后端 lint**：`cd backend && ruff check . && ruff format --check . && mypy app` → 全绿。红则回退后端 task。
2. **后端测试**：`cd backend && pytest` → 全绿（含 task-05 新增组织过滤用例）。红则回退 task-05/03。
3. **前端 lint**：`cd frontend && pnpm lint` → 全绿。红则回退前端 task。
4. **前端类型**：`cd frontend && pnpm exec tsc --noEmit` → 全绿。红则回退 task-06/07/08/09。
5. **前端测试**：`cd frontend && pnpm test` → 全绿（含 task-10 新增 admin-org-tree / drawer 用例）。红则回退 task-10/07/08。
6. **rebuild Docker**：`docker compose --env-file deploy/.env -f deploy/docker-compose.yml up --build --force-recreate -d` → 全部容器 healthy。
7. **健康检查**：按 §5.3 curl 确认 API 契约（subtree_member_count / organization_id 参数）生效。
8. **浏览器验收**：按 §5.2 AC-01~AC-06（+ AC-07/09）逐条手测，全部通过。
9. **commit + push**：全绿 + 验收通过后，提交并推送（用户记忆 `feedback_deploy_after_quick.md` 要求）。

## 10. 验收标准

| # | 验证步骤 | 通过标准 |
|---|---|---|
| AC-01 | `cd backend && ruff check . && ruff format --check . && mypy app` | 无告警 / 无类型错误 / format 无 diff |
| AC-02 | `cd backend && pytest` | 全绿（含 task-05 组织过滤用例） |
| AC-03 | `cd frontend && pnpm lint` | 无 eslint 告警 |
| AC-04 | `cd frontend && pnpm exec tsc --noEmit` | 无类型错误 |
| AC-05 | `cd frontend && pnpm test` | 全绿（含 task-10 新增用例，未破坏既有） |
| AC-06 | `docker compose --env-file deploy/.env -f deploy/docker-compose.yml up --build --force-recreate -d` | 前后端容器全部重建并 healthy |
| AC-07 | 浏览器点「全部组织」 | 显全部用户，行为与改造前一致（plan AC-01） |
| AC-08 | 浏览器点叶子组织 | 只显该组织用户（plan AC-02） |
| AC-09 | 浏览器点父组织 | 显父+所有下级用户（plan AC-03） |
| AC-10 | 浏览器观察树节点 | title 含 subtree_member_count（fallback member_count）；disabled 不显（plan AC-04） |
| AC-11 | 浏览器叠加 search+status+组织 | 三条件交集过滤（plan AC-05） |
| AC-12 | 浏览器翻页/编辑/删除/会话/审计/重置密码 | 全部正常（plan AC-06） |
| AC-13 | 浏览器选中组织时新建用户 | drawer 预填该组织勾选（plan AC-07） |
| AC-14 | brownfield：organization_id 未传 | list_users 行为零变化（plan AC-09） |
| AC-15 | `git diff --stat`（本 task） | 无文件改动（纯验证任务） |

## 11. 完成定义

- [ ] 后端 ruff check + ruff format --check + mypy app 全绿
- [ ] 后端 pytest 全绿
- [ ] 前端 pnpm lint + tsc --noEmit 全绿
- [ ] 前端 pnpm test 全绿
- [ ] Docker rebuild（前后端）成功，容器 healthy
- [ ] API 健康检查通过（subtree_member_count / organization_id 生效）
- [ ] 浏览器验收 AC-07~AC-14（对应 plan AC-01~07/09）全部通过
- [ ] commit + push 完成
- [ ] §10 AC-01~AC-15 全部通过
