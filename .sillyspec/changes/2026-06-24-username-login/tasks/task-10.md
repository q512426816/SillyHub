---
id: task-10
title: 集成验证 + 部署 — alembic upgrade head 成功；backend ruff/mypy/pytest + frontend tsc/lint/test 全绿；重建前后端 Docker 并部署
priority: P0
depends_on: [task-04, task-07, task-08, task-09]
blocks: []
decision_ids: []
requirement_ids: [SC-6, SC-7]
allowed_paths: []
author: WhaleFall
created_at: 2026-06-25T08:43:50
---

# task-10 — 集成验证 + 部署（alembic upgrade + 全绿 + 重建 Docker）

## 1. 覆盖来源

- `design.md` §3 Phase 5（测试 + 部署，L76-79）、§4 验收标准 6/7（L88-89）、§6 风险与对策、§7 回退（L110-111）。
- `decisions.md`：D-002@v1（存量 username 沿用 → spike-01 空值兜底）、D-003@v1（email nullable → alembic upgrade 验证）、D-005@v1（删 merge → head 单一）。
- `plan.md` Wave 5 / 任务表 task-10 / 关键路径终点 / 依赖关系图（task-04/07/08/09 → task-10）、Spike 前置验证（spike-01 查空 username）。
- `.sillyspec/local.yaml`：`test_backend`、`lint_backend`、`test_frontend`、`lint_frontend`、`build_frontend`、`docker_up`、`docker_down` 命令已确认（见 §3）。
- `deploy/docker-compose.yml`：backend + frontend 各有 `build:` 段，可 `docker compose build backend frontend` 重建。
- 全局验收 SC-6（alembic 单一 head + upgrade head 成功）、SC-7（backend ruff/mypy/pytest + frontend tsc/lint/test 全绿）。
- 本任务为最终集成验证 + 部署节点，**无代码改动**（`allowed_paths: []`），仅验证 + Docker 重建 + 冒烟。

## 2. 修改文件

> 本任务无代码改动（`allowed_paths: []`）。所有源代码改动由 task-01 ~ task-09 完成。本任务只做：验证命令执行 + Docker 镜像重建 + 服务重启 + 冒烟测试。

| 类型 | 说明 |
|---|---|
| 验证目标 | alembic 链（单一 head + upgrade head）、backend 三件套（ruff/mypy/pytest）、frontend 三件套（tsc via build/lint/test） |
| 部署动作 | `docker compose build backend frontend`（重建两个镜像）+ `docker compose up -d`（滚动重启） |
| 冒烟 | 登录页用 `admin` 登录（验证 SC-1/3）；`/admin/users` 新建用户填登录名、邮箱留空（验证 SC-1）；编辑该用户改登录名（验证 SC-2，冲突回显 409） |

## 3. 实现要求（验证清单）

### 3.1 前置 spike（spike-01 — 空值兜底，须在 task-03 上线纯 username 登录前确认）

```bash
# 在后端容器或本地 venv，连 PG 执行
docker compose -f deploy/docker-compose.yml exec postgres \
  psql -U "${POSTGRES_USER:-platform}" -d "${POSTGRES_DB:-platform}" \
  -c "SELECT count(*) AS null_username_users FROM users WHERE username IS NULL;"
```

- 结果 = 0 → spike-01 通过，存量用户均有 username，纯 username 登录不会锁死任何人。继续后续验证。
- 结果 > 0 → spike-01 失败。**禁止继续部署纯 username 登录**。先对这些行补默认登录名（如 `username = split_part(email, '@', 1)` + 去重序号）再上线，否则这些用户登录锁死（design §6 风险对策）。补值动作不在本任务 `allowed_paths`（属 task-03/data fix），记录为阻塞并上报。

### 3.2 alembic 链核实（SC-6 前半 — 单一 head）

```bash
cd backend
# 1) 列出所有 head，确认只有一行（即 task-04 新 revision 的 revision id）
alembic heads
# 期望：单行输出，head = task-04 新增的 revision（down_revision="202606241001"）
# 若出现多行 → task-01 删 merge 未生效或 task-04 down_revision 配错，停止后续步骤

# 2) 核实当前应用版本（本地/容器 DB）
alembic current
# 期望：当前指向 202606241001（task-01 修复后的 head，task-04 revision 尚未应用）
```

### 3.3 alembic upgrade head（SC-6 后半 — email nullable 成功应用）

```bash
cd backend
alembic upgrade head
# 期望：成功应用 task-04 revision（ALTER TABLE users ALTER COLUMN email DROP NOT NULL）

# 验证 column 已改 nullable
docker compose -f deploy/docker-compose.yml exec postgres \
  psql -U "${POSTGRES_USER:-platform}" -d "${POSTGRES_DB:-platform}" \
  -c "\d users" | grep -i "email"
# 期望：email 行无 NOT NULL 标记（nullable = true）；ux_users_email_active 索引仍存在

# 核实新 head
alembic current
# 期望：指向 task-04 新 revision id
```

- **upgrade 失败回退**：执行 `alembic downgrade -1` 回到 202606241001，排查 task-04 migration（down_revision / upgrade 语句），修复后重试。**upgrade 未成功不得进入部署步骤**。

### 3.4 backend 三件套（SC-7 后端）

```bash
cd backend
# 1) ruff（风格 + 静态检查）
ruff check .
# 期望：All checks passed! 无 error

# 2) mypy（类型检查）
mypy app
# 期望：Success: no issues found（task-02/03/05 改的 Optional/Union 类型必须通过）

# 3) pytest（task-08 新增/更新用例 + 全量回归）
pytest
# 期望：全部通过（含 task-08 新增：login 纯 username、create username 必填/缺失 422、
#       update username 冲突 409、email 可选、UserRead email 可空）
```

- 任一环节失败：**停止部署**。修复对应 task 的代码/测试后重跑。非测试本身有误时禁止改测试「凑过」。

### 3.5 frontend 三件套（SC-7 前端）

```bash
cd frontend
# 1) tsc（类型检查，via build；pnpm build 内含 tsc）
pnpm build
# 期望：编译成功（task-06 的 UserRead.username: string、email: string | null 类型对齐）

# 2) lint
pnpm lint
# 期望：无新增 error/warning（task-06/07 改的 drawer/page 无 any、无未用变量）

# 3) test
pnpm test
# 期望：全部通过（含 task-09 更新的 admin-user-drawer.test.tsx：登录名必填、email 可选用例）
```

- 任一环节失败：**停止部署**。修复后重跑。

### 3.6 重建前后端 Docker 镜像 + 部署

```bash
cd deploy

# 1) 重建 backend + frontend 镜像（两个 service 各有 build: 段）
docker compose build backend frontend
# 期望：两镜像构建成功（backend 打包新 schema/service/migration；frontend 打包新 drawer/page）

# 2) 滚动重启（容器用新镜像）
docker compose up -d
# 期望：backend / frontend / postgres / redis 均 Up (healthy)

# 3) 核实容器状态 + backend 应用 alembic 新 head（容器启动钩子若自动 upgrade，核实 current）
docker compose ps
docker compose exec backend alembic current
# 期望：backend 指向 task-04 新 revision；所有容器 healthy
```

- **构建失败**：排查 Dockerfile / 依赖，不强行重启旧镜像。
- **重启后 backend 反复重启**：查日志 `docker compose logs backend --tail 100`，常见为 alembic 链断裂或新 migration 报错 → 回到 §3.2/3.3 排查。

### 3.7 冒烟测试（SC-1/2/3 实地验证）

| 步骤 | 操作 | 期望（SC） |
|---|---|---|
| 1 | 浏览器打开登录页 | 副标题/label/placeholder 均为「登录名」（SC-3）；清缓存后 account 默认回填 `admin` |
| 2 | 用 `admin` / `admin123` 登录 | 登录成功（验证纯 username 登录 SC-1/3、admin seed username=admin 可用） |
| 3 | 进入 `/admin/users` | 列表首列为「登录名」，超管/自己标记在登录名列；email 列空值显 `—` |
| 4 | 新建用户：登录名填 `testuser01`，显示名随意，邮箱**留空**，保存 | 创建成功 toast 显「用户 testuser01 已创建」（SC-1：登录名必填、email 可选） |
| 5 | 退出，用 `testuser01` + 新密码登录 | 登录成功（SC-1：可用登录名登录） |
| 6 | 用 `testuser01@example.com`（带 @）尝试登录 | **登录失败**（验证 SC-3：纯 username 查询，email 无法登录） |
| 7 | admin 账号回到 `/admin/users`，编辑 `testuser01`，登录名改为 `admin`（撞已存在） | 友好报错 409（SC-2：登录名唯一冲突回显） |
| 8 | 编辑 `testuser01`，登录名改为 `testuser02`，保存 | 更新成功（SC-2：可编辑登录名） |
| 9 | 新建第二个用户，邮箱也填 `testuser01@example.com`（撞已用非空 email） | 友好报错（非空 email 全局唯一，SC-5） |
| 10 | 新建第三、四个用户，邮箱均留空 | 均创建成功（多个空 email 共存，SC-5） |

> 步骤 4/10 验证 SC-5（多个空 email 共存）；步骤 6 验证 SC-3（email 无法登录）；步骤 2/5 验证 SC-1/SC-4（存量 username 登录零迁移）。

## 4. 接口定义（验证命令序列）

| 序号 | 命令 / 操作 | 通过判据 | 覆盖 SC |
|---|---|---|---|
| V1 | spike-01：`SELECT count(*) FROM users WHERE username IS NULL` | = 0（>0 则阻塞） | SC-4（spike-01 兜底） |
| V2 | `alembic heads` | 单行（task-04 revision） | SC-6 |
| V3 | `alembic current`（upgrade 前） | = 202606241001 | SC-6 |
| V4 | `alembic upgrade head` | 成功应用，无报错 | SC-6 |
| V5 | `\d users` email 列 | nullable=true；`ux_users_email_active` 在 | SC-6 |
| V6 | `alembic current`（upgrade 后） | = task-04 revision id | SC-6 |
| V7 | `cd backend && ruff check .` | All checks passed | SC-7 |
| V8 | `cd backend && mypy app` | no issues found | SC-7 |
| V9 | `cd backend && pytest` | 全部通过 | SC-7（+SC-1/2/3/5/6 单测） |
| V10 | `cd frontend && pnpm build`（含 tsc） | 编译成功 | SC-7 |
| V11 | `cd frontend && pnpm lint` | 无新增问题 | SC-7 |
| V12 | `cd frontend && pnpm test` | 全部通过 | SC-7（+SC-1 drawer 单测） |
| V13 | `cd deploy && docker compose build backend frontend` | 两镜像构建成功 | 部署 |
| V14 | `cd deploy && docker compose up -d` | 所有容器 Up (healthy) | 部署 |
| V15 | 容器内 `alembic current` | = task-04 revision id | SC-6（容器侧） |
| V16 | 冒烟步骤 1-10 | 全部符合期望 | SC-1/2/3/5 + SC-4（存量登录） |

## 5. 边界处理

1. **spike-01 空值兜底（最高优先级前置）**：execute task-03 前（或本任务最前）查空 username 行数。>0 则**禁止继续**纯 username 登录部署，否则这些用户登录锁死（design §6）。补值动作属 task-03/data fix，不在本任务 `allowed_paths`，记录阻塞并上报。
2. **alembic upgrade 失败回退**：V4 失败立即 `alembic downgrade -1` 回到 202606241001，排查 task-04 migration（down_revision 配置 / upgrade SQL），**upgrade 未成功不得进入 §3.4 之后的步骤**。
3. **任一 lint/test 失败不部署**：V7-V12 任一失败，停止部署，修复对应 task（非测试本身有误时禁止改测试「凑过」，见 CLAUDE.md 规则 8）。修复后从失败处重跑，不跳过已通过项的复验。
4. **Docker 重建必须覆盖前后端两个镜像**：backend（含新 schema/service/migration）+ frontend（含新 drawer/page）都要 `docker compose build`，**不能只重建一个**；否则前后端契约（UserRead.email 可空、username 必填）不一致导致运行时 422 或 UI 显示异常。
5. **重启后 backend 健康检查**：`docker compose up -d` 后必须 `docker compose ps` 核实 backend healthy、`alembic current` 核实容器侧应用了新 head。若 backend 反复重启，查 `docker compose logs backend`，常见为 alembic 链断裂（task-01 回归）或新 migration 报错 → 回到 V2-V4 排查，必要时 `docker compose down` + 修 migration + 重建。
6. **冒烟覆盖 SC-1/3/5 关键路径**：登录页用 admin 登录（SC-1/3 + SC-4 存量）、新建用户填登录名不填邮箱（SC-1）、用 email 尝试登录失败（SC-3）、多个空 email 共存（SC-5）。冒烟任一项不符即视为部署未达验收，需回查对应 task。
7. **admin seed 登录验证**：bootstrap_admin 的 `username=admin` 必须能登录（SC-4 存量沿用）。若 admin 登录失败，查 task-03 bootstrap seed 是否被误改。
8. **回退预案**：若部署后线上严重异常（登录全失败 / 用户列表 500），按 design §7：`docker compose down` + git revert 本次变更提交 + backend 容器内 `alembic downgrade -1`（前提：回退时无空 email 用户，存量都有 email，DROP NOT NULL 的 downgrade SET NOT NULL 安全）+ 重启旧镜像。
9. **本地 vs 容器 alembic 版本一致性**：V2-V6 在本地 venv 跑、V15 在容器内跑，两者 `alembic current` 必须一致指向 task-04 revision。不一致说明容器镜像未真正重建（V13 没执行或用了缓存）→ `docker compose build --no-cache backend` 重来。
10. **frontend build 必须真编译**：V10 用 `pnpm build`（含 tsc），不能只用 `pnpm lint` 替代类型检查（lint 不等于 tsc）。task-06 的 Optional 类型对齐必须由真实 tsc 验证。

## 6. 非目标

- 不写任何代码（本任务 `allowed_paths: []`，纯验证 + 部署）。
- 不改任何 task-01 ~ task-09 的实现（若验证发现 bug，回到对应 task 修，不在本任务直接改）。
- 不做邮箱验证邮件 / 找回密码邮件流程（design §5 非目标）。
- 不改 `LoginRequest.account` 字段名（design §5 非目标，零契约改）。
- 不给 `username` 加 DB CHECK 约束（design §5 非目标，应用层校验）。
- 不改 email 唯一索引为部分唯一索引（依赖 PG NULL 语义，design §5 非目标）。
- 不做后端 `users_service.py` 搜索 `q` 字段对 username 的匹配修复（task-07 边界已注明，不在本期任何 task 范围）。
- 不做存量 username 含去重序号用户的批量通知（design §6，不在本期）。
- 不重置生产数据 / 不要求历史兼容（CLAUDE.md 规则 10，本期未上线）。

## 7. 参考

- `design.md` §3 Phase 5（L76-79）、§4 验收标准 6/7（L88-89）、§6 风险与对策（L100-106）、§7 回退（L110-111）。
- `decisions.md` D-002@v1（存量 username 沿用）、D-003@v1（email nullable）、D-005@v1（删 merge + head 单一）。
- `plan.md` Wave 5 / 任务表 task-10 / Spike 前置验证（spike-01）/ 关键路径终点 / 全局验收 SC-6/7。
- `.sillyspec/local.yaml`：`test_backend`、`lint_backend`、`test_frontend`、`lint_frontend`、`build_frontend`、`docker_up`、`docker_down`。
- `deploy/docker-compose.yml`：backend + frontend 各有 `build:` 段（V13 重建依据）。
- 依赖任务产出：
  - task-01：alembic 链修复，head=202606241001（V2/V3 依据）。
  - task-04：新 migration（down_revision=202606241001，email DROP NOT NULL）（V4/V5/V6 依据）。
  - task-08：backend 测试用例（V9 验证依据）。
  - task-09：frontend drawer 测试用例（V12 验证依据）。
  - task-07：登录页/列表页改造（V16 冒烟步骤 1/3 依据）。

## 8. TDD 步骤（本任务为验证 + 部署节点，此处为验证执行步骤）

> 本任务无 Red（无新代码/新测试），全为 Green/Verify 阶段：跑既有测试 + 部署 + 冒烟。

1. **Spike（前置）**：
   - 执行 V1（spike-01 查空 username）。= 0 继续；> 0 阻塞上报。
2. **Green（alembic）**：
   - V2 `alembic heads`（单一 head）→ V3 `alembic current`（=202606241001）→ V4 `alembic upgrade head`（成功）→ V5 核实 email nullable + 索引在 → V6 `alembic current`（=task-04 revision）。
   - V4 失败：`alembic downgrade -1` 回退，排查 task-04，不继续。
3. **Green（backend 三件套）**：
   - V7 ruff → V8 mypy → V9 pytest，逐项过。任一失败停止部署。
4. **Green（frontend 三件套）**：
   - V10 `pnpm build`（含 tsc）→ V11 lint → V12 test，逐项过。任一失败停止部署。
5. **Deploy（Docker）**：
   - V13 `docker compose build backend frontend`（两镜像）→ V14 `docker compose up -d`（容器 healthy）→ V15 容器内 `alembic current`（=task-04 revision，与本地一致）。
6. **Verify（冒烟）**：
   - V16 冒烟步骤 1-10：登录页文案 + admin 登录 + 新建用户（登录名必填/邮箱可选）+ email 登录失败 + 编辑改登录名（409 冲突 + 成功）+ 多空 email 共存。
   - 任一项不符 → 回查对应 task，必要时回退（§5 边界 8）。
7. **回归检查**：核实未误改 task-01~09 任何文件（本任务 git diff 应为空）；核实容器实际跑的是新镜像（V15 与本地版本一致）。

## 9. 验收标准

| 编号 | 验收点 | 验证方式 | 覆盖 SC |
|---|---|---|---|
| AC-1 | spike-01：`SELECT count(*) FROM users WHERE username IS NULL` = 0 | psql 查询（V1） | SC-4（spike 兜底） |
| AC-2 | `alembic heads` 单行输出（task-04 revision） | 命令执行（V2） | SC-6 |
| AC-3 | `alembic current`（upgrade 前）= 202606241001 | 命令执行（V3） | SC-6 |
| AC-4 | `alembic upgrade head` 成功应用，无报错 | 命令执行（V4） | SC-6 |
| AC-5 | `\d users` email 列 nullable=true，`ux_users_email_active` 索引仍存在 | psql 查询（V5） | SC-5/6 |
| AC-6 | `alembic current`（upgrade 后）= task-04 revision id | 命令执行（V6） | SC-6 |
| AC-7 | `cd backend && ruff check .` All checks passed | 命令执行（V7） | SC-7 |
| AC-8 | `cd backend && mypy app` no issues found | 命令执行（V8） | SC-7 |
| AC-9 | `cd backend && pytest` 全部通过（含 task-08 新增用例） | 命令执行（V9） | SC-7（+SC-1/2/3/5/6） |
| AC-10 | `cd frontend && pnpm build` 编译成功（tsc 无错） | 命令执行（V10） | SC-7 |
| AC-11 | `cd frontend && pnpm lint` 无新增 error/warning | 命令执行（V11） | SC-7 |
| AC-12 | `cd frontend && pnpm test` 全部通过（含 task-09 用例） | 命令执行（V12） | SC-7（+SC-1） |
| AC-13 | `docker compose build backend frontend` 两镜像构建成功 | 命令执行（V13） | 部署 |
| AC-14 | `docker compose up -d` 所有容器 Up (healthy) | `docker compose ps`（V14） | 部署 |
| AC-15 | 容器内 `alembic current` = task-04 revision id（与本地一致） | 命令执行（V15） | SC-6 |
| AC-16 | 登录页副标题/label/placeholder 均为「登录名」；清缓存后 account 回填 `admin` | 浏览器手测（V16 步骤 1） | SC-3 |
| AC-17 | 用 `admin`/`admin123` 登录成功（存量 username 零迁移可用） | 浏览器手测（V16 步骤 2） | SC-1/3/4 |
| AC-18 | `/admin/users` 列表首列为「登录名」，超管/自己标记在登录名列；email 空值显 `—` | 浏览器手测（V16 步骤 3） | SC-1 |
| AC-19 | 新建用户填登录名 `testuser01`、邮箱留空 → 创建成功（toast 显登录名） | 浏览器手测（V16 步骤 4） | SC-1/5 |
| AC-20 | 用 `testuser01` + 密码登录成功；用 `testuser01@example.com`（带@）登录失败 | 浏览器手测（V16 步骤 5/6） | SC-1/3 |
| AC-21 | 编辑 `testuser01` 改登录名为 `admin` → 友好报错 409；改为 `testuser02` → 成功 | 浏览器手测（V16 步骤 7/8） | SC-2 |
| AC-22 | 新建用户填已用非空 email → 报错；多个空 email 用户共存不报错 | 浏览器手测（V16 步骤 9/10） | SC-5 |
| AC-23 | 本任务 git diff 为空（无代码改动，纯验证 + 部署） | `git status` / `git diff` | 流程合规 |
