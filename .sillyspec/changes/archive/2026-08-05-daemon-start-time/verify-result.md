---
author: WhaleFall
created_at: 2026-08-05 13:31:37
---

# 验证报告（Verify Result）— daemon 启动时间字段

## 结论 / Conclusion
**PASS WITH NOTES**

单测全过（daemon 模块 601 passed）+ cli.ts 入口真实启动（deployment-critical）+ backend Docker 全栈健康 + PG migration apply（started_at 列真实落 PG）+ HTTP 集成测试覆盖 machines 返回 started_at。真 daemon register→machines HTTP 端到端因本机环境（runtime lock 另一本地 daemon pid 13656 + admin 密码 .env vs DB 旧 bootstrap）受限未完整跑，但 HTTP 层 started_at 流转由 task-06 test_machines_router 真实端点集成测试覆盖。

## 测试套件
- **backend daemon 模块 pytest -n auto（app/modules/daemon/tests/）：601 passed / 0 failed**（86s）
  - task-06 新增 10 用例：test_register_heartbeat_daemon.py TestDaemonStartedAt（register new/else 落值 + heartbeat 幂等 + 旧 daemon None，6 用例）+ test_machines_router.py（_create_instance 加 started_at + machines 返回非 null / 旧 daemon None，2 用例）+ test_daemon_started_at.py（migration up/down/re-add 可逆 + revision chain guardrail，2 用例）
  - 现有 daemon 测试（session/lease/ws/allowed_roots 等）零回归
- **前端 task-07**：tsc --noEmit + vitest machine-card 9/9 + pnpm build 通过
- **daemon（sillyhub-daemon）task-01/02**：tsc 0 新增错误（3 个 baseline build-id pre-existing）
- warnings 全 pre-existing（HTTP_422 DeprecationWarning、resource warning），非本次

## 技术债务
- 探针 1（变更文件 TODO/FIXME/HACK/XXX 扫描）：**无匹配**（变更文件干净）

## 变更风险等级
**integration-critical + deployment-critical**
- design/plan 命中 cli.ts（daemon 启动入口 → deployment-critical：须真实启动入口）
- 命中 daemon/backend/heartbeat（→ integration-critical：须真实 daemon↔backend 集成）
- design frontmatter scale=large（跨 daemon/backend/前端 3 端 + DB schema 变更）

## Runtime Evidence（integration-critical / deployment-critical 必填）

### daemon 启动命令（deployment-critical：真实启动 cli.ts 入口一次）
```
node sillyhub-daemon/build/bundle/sillyhub-daemon.js start --server http://127.0.0.1:8000 --token dummy --log-level debug
```
cli.ts 入口 startAction（:426）取 `processStartTime = Date.now()` → 注入 `new Daemon({ startedAt: processStartTime })` → register/heartbeat 上报 started_at（本次 task-01 改动，已 build 进 bundle）。

### backend 地址 + 状态
- http://127.0.0.1:8000（Docker Compose 全栈，sillyhub-docker-deploy 本机部署，端口 8000/3000）
- `GET /api/health` = `{"status":"ok","db":"ok","redis":"ok","version":"0.1.0","commit_sha":"c147874d41c0","environment":"dev"}`
- 容器 multi-agent-platform-backend-1 / frontend-1 Up healthy（--build --force-recreate 后用含 started_at 新代码镜像）
- 容器内新代码确认：`grep -c started_at app/modules/daemon/model.py`=1, `runtime/service.py`=10

### daemon 日志关键片段（cli.ts 启动，无禁用失败模式）
```
Starting SillyHub daemon (server=http://127.0.0.1:8000)...
[daemon.starting] runtime_id=ed061168-a7ff-4a6d-b567-191fba8ed219
[daemon.agents_detected] agents=["claude"]
[daemon.runtime_lock_acquire_failed] error=runtime lock held: another daemon is running (pid 13656, provider=claude, host=DESKTOP-2BN7FDC); stop it first
```
- 日志无 `session_control_no_manager` / `fallback to task_runner` / `submitMessages agent_run_id empty` / 422（失败模式排除 ✓）
- register 未达 backend：本机另一本地 daemon（pid 13656）持有 claude runtime lock（CONCERNS.md「本机多 daemon 实例」已知坑），阻止本次 daemon 注册

### migration / DB 状态（started_at 真实落 PG）
- 容器内 `/opt/venv/bin/alembic current` = **20260805110000 (head)**（task-03 migration apply 成功）
- PG `daemon_instances.started_at` 列：`timestamp with time zone, is_nullable=YES`（真实 PG schema，timestamp with timezone 与 model.py `DateTime(timezone=True)` 一致）

### started_at 链路 HTTP 集成证据（integration test，非 mock 单测）
- `test_machines_router.py::test_machines_started_at_returned_when_reported`：daemon 上报 started_at 后 `GET /api/daemon/machines` 返回非 null 等于上报值（**真实 HTTP 端点集成测试**，验证 machines 端点 `_build_machine_read` 填 started_at）
- `test_machines_started_at_null_for_legacy_daemon`：旧 daemon（不上报）machines 返回 None（兼容）
- `test_register_heartbeat_daemon.py::TestDaemonStartedAt`：service register 写 `instance.started_at`（new + else 两分支）+ heartbeat 幂等覆盖（恒定值无副作用）
- `test_daemon_started_at.py`：migration upgrade→started_at 列出现 / downgrade→列消失 / re-add→恢复（可逆，importlib+MigrationContext 在 SQLite 验证）
- **端到端链路完整**：schema.DaemonRegisterRequest.started_at → router endpoint 透传 → facade DaemonService → runtime RuntimeService 写 instance.started_at → `_build_machine_read` → DaemonMachineRead.started_at（HTTP 返回）

### 失败模式排除
- ✅ 无 session_control_no_manager / fallback to task_runner / submitMessages agent_run_id empty / 422
- ⚠️ 真 daemon register→machines HTTP 端到端（带 started_at curl）因本机 runtime lock（pid 13656 占 claude lock）+ admin 密码（.env PLATFORM_BOOTSTRAP_ADMIN_PASSWORD 与 DB 旧 bootstrap password_hash 不一致，login 401）环境受限未完整跑；但 HTTP 层 machines 返回 started_at 由 task-06 `test_machines_router` 真实端点集成测试覆盖，service 写 started_at 由 `test_register_heartbeat` 覆盖，migration PG apply 由 alembic head + psql schema 确认

## 代码审查
- execute 阶段 8 task 逐个 review.json（base..head 真实 commit + diff 对照），task-01~07 pass / task-08 cannot_verify（本端到端验证补 evidence）
- 关键修正（execute 符号影响面检查 + 子代理发现）：
  1. **task-05 补 facade service.py**（router→facade DaemonService→runtime RuntimeService 三层透传链，符号影响面检查抓到 plan 漏的中间层）
  2. **task-01 同步 daemon.ts ClientLike 鸭子接口**（task-02 改 hub-client 签名的下游影响面，task-02 漏标）
  3. **task-07 frontend/src/lib/daemon.ts 超 allowed_paths**（machine-card import 手写聚合 DTO，CLAUDE.md 规则 20 类型同步强制）
- 对照 design.md 一致（5 探针全过：无 TODO / 关键词覆盖 / 测试覆盖 / decisions D-001@v1+D-002@v1 闭环 / API 契约 parity 无 missing endpoint）

## 验证命令（可复现）
- backend 测试：`cd backend && .venv/Scripts/python.exe -m pytest app/modules/daemon/tests/ -n auto -q`（601 passed）
- migration：`docker compose --env-file deploy/.env -f deploy/docker-compose.yml exec -T backend /opt/venv/bin/alembic current`（=20260805110000 head）
- PG schema：`docker compose ... exec -T postgres psql -U <user> -d <db> -c "\d daemon_instances" | grep started_at`
- daemon 启动：`node sillyhub-daemon/build/bundle/sillyhub-daemon.js start --server http://127.0.0.1:8000 --token <token> --force`（--force reclaim lock）

## 备注
- 主仓库 backend/.venv 用阿里云镜像装 dev 依赖（pypi.org 网络超时，`UV_INDEX_URL=https://mirrors.aliyun.com/pypi/simple/ uv pip install -e '.[dev]'`）
- worktree backend/.venv junction 指向主仓库 .venv（Windows `mklink /J` via PowerShell 共享依赖，绕过 SillySpec worktree 全新 checkout 无 node_modules/.venv 坑）
