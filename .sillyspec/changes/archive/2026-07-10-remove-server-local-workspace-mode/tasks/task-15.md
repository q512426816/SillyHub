---
id: task-15
title: Docker deploy migration upgrade + daemon-client e2e + grep cleanup verification
title_zh: Docker 部署迁移 upgrade 验证 + daemon-client 端到端 + grep 生产代码清零
author: qinyi
created_at: 2026-07-10 23:45:39
priority: P0
depends_on: [task-02, task-13, task-14]
blocks: []
requirement_ids: [AC-1, AC-2, AC-3, AC-4, AC-5, AC-6, AC-7]
decision_ids: [D-002, D-004, D-006, D-007]
allowed_paths:
  - backend/tests/**
  - deploy/docker-compose.yml
---

## goal

在真实 Docker 部署上完成最终验收：①task-02 alembic 迁移 apply 到 PG 无 FK 违约（特别 incident RESTRICT，R-02）；②daemon-client 工作区端到端链路（scan→dispatch→lease→spec-sync）可用；③grep 生产代码 `server-local`/`path_source`/`daemon_runtime_id` 清零；④daemon 离线降级（D-002）不崩。本任务是 Wave 6 部署验收，覆盖全部 AC-1~7 + R-02 + R-08。

## implementation

### ①apply task-02 迁移（R-02 incident 守护）

- 先 `docker compose -f deploy/docker-compose.yml down`（保留 volume），`docker compose build backend`（同步 task-02 迁移文件进镜像）。
- `docker compose up -d postgres redis`，等 postgres healthy 后 `docker compose up backend`。
- 后端启动 command 是 `alembic upgrade head && exec uvicorn ...`（compose line 105），观察 backend 容器日志：
  - 确认迁移 revision 应用成功（日志含 `Running upgrade 7c77e09b84e1 -> <task-02 revision>`）。
  - 确认 `DELETE FROM incidents WHERE workspace_id IN (SELECT id FROM workspaces WHERE path_source='server-local')` 先于 DELETE workspace 执行，无 PG FK RESTRICT 报错（R-02 关键守卫）。
  - 确认 `DROP COLUMN path_source` / `DROP COLUMN daemon_runtime_id` + 索引 `ix_workspaces_daemon_runtime_id` 自动级联删除。
- 进 PG 容器核验：`docker compose exec postgres psql -U platform -d platform -c "\d workspaces"` 确认 path_source / daemon_runtime_id 两列已不存在；`SELECT count(*) FROM incidents` 不因迁移丢全表（仅删 server-local 工作区关联行）；`SELECT alembic_version` 指向 task-02 revision。
- 若迁移失败回滚：不动 alembic_version（不 stamp），按记忆 worktree-migration-pollutes-deploy 处置（`down -v` 重置 PG 后重 up），禁止手工改 DB 掩盖。

### ②daemon-client 端到端（AC-5, AC-6, R-08）

- 前置：本机 daemon 在线（daemon-start.bat 起的本地 daemon，记忆 multi-daemon-instances 按 --server 区分）。
- 访问 `http://127.0.0.1:3000`（前端，记忆 docker-localhost-ipv6-use-127.0.0.1，禁用 localhost）。
- 新建工作区：绑定 daemon 实例 + root_path，确认 UI 无「路径来源」/「本机路径」选项（task-10/11 已删）；提交后 backend 不再写 path_source 列。
- 触发 scan：scan → scan-generate 全链路经 daemon-client RPC（task-03 scan_generate 单一入口），daemon 侧能看到 lease 创建 + 文件操作走 WS RPC。
- 触发 dispatch：在工作区发起一个 brainstorm/scan 类 agent_run，确认 dispatch 路由走 daemon 绑定（无 server-local 兜底，task-06 placement.py + task-08 change dispatch）。
- lease 生命周期：claim → start → complete 链路无 500；complete_lease 收尾的 run_command 走 `_via_rpc`（task-05，不再因 server-local 拒绝分支抛错）。
- spec-sync：在工作区跑一次 brainstorm→plan 或 scan 后，确认 spec_workspace sync-manual 走 daemon outbox 回灌，daemon 侧 spec 目录可见（D-007 P1-5 + R-08 spec-root 解析正确，task-07 core/spec_paths.py 重构后 prompt --spec-root 指向 daemon 工作区根）。

### ③grep 生产代码清零（AC-1）

```bash
grep -rn "server-local\|path_source\|daemon_runtime_id" backend/app frontend/src sillyhub-daemon/src \
  --exclude-dir=node_modules --exclude-dir=__pycache__ --exclude-dir=.next \
  --exclude-dir=archive --exclude="*.test.*" --exclude="*.spec.*"
```

- 排除 tests（backend/tests, frontend **/*.test.*, *.spec.*）与 archive 目录。
- 预期零命中。残留命中逐条评估：
  - 注释/docstring 引用 → 清理或改为历史说明。
  - 实际代码分支 → 回退对应 task（task-03~09）补删。
- 单独跑一次不含排除的 grep 确认残留在 tests/archive，作为证据记录。

### ④daemon 离线降级（D-002）

- 停掉本机 daemon（精确 PID，记忆 claude-exe-orphan-cleanup 禁 taskkill /IM 通杀）。
- 在工作区触发文件操作（skills list_dir / read_package_json 等 HostFsDelegate public 方法）。
- 确认走 `_via_rpc_or_degrade` 降级返回（不崩、不 500）；`run_command` 走 `_via_rpc` 抛明确异常（D-002 现有行为）。
- 重启 daemon 后恢复正常 RPC 路径。

## 验收标准

- AC-1: grep 生产代码 `server-local`/`path_source`/`daemon_runtime_id` 零命中（tests/archive 除外）。
- AC-2: backend `alembic upgrade head` 在 PG 成功应用 task-02 迁移，日志可见 upgrade + DELETE + DROP。
- AC-3: PG `\d workspaces` 无 path_source / daemon_runtime_id 列，索引 ix_workspaces_daemon_runtime_id 已删。
- AC-4: `alembic_version` 表指向 task-02 revision；迁移链单 head 无分叉。
- AC-5: 新建工作区只能 daemon-client，UI 无 server-local 选项，DB 写入无 path_source。
- AC-6: daemon 在线时 scan→dispatch→lease→spec-sync 全链路可用，无 500/422。
- AC-7: 迁移过程 incident 表 FK 无违约（迁移步骤①显式 DELETE 先于 DELETE workspace；PG 日志无 `violates foreign key constraint`）。

## verify

- `docker compose -f deploy/docker-compose.yml logs backend | grep -i "alembic\|upgrade\|ERROR"` 确认迁移成功 + 无 FK 违约报错。
- `docker compose exec postgres psql -U platform -d platform -c "\d workspaces"` + `-c "SELECT version_num FROM alembic_version"`。
- 上述 grep 命令输出（清零证据）。
- `curl -s http://127.0.0.1:8000/health`（或 `/docs`）确认 backend 健康；`curl` 新建工作区端点确认 200 非 422。
- daemon 在线/离线两次端到端操作截图或日志（D-002 降级证据）。

## constraints

- 本机访问 Docker 映射端口一律用 `127.0.0.1`，禁用 `localhost`（IPv6 ::1 连不通 0.0.0.0 映射，记忆 docker-localhost-ipv6-use-127.0.0.1）。
- 端到端链路需真实 daemon 在线（本地 daemon-start.bat 实例）；离线降级测试需精确 PID 停 daemon（记忆 multi-daemon-instances 按 --server 区分，勿误杀远程实例；记忆 claude-exe-orphan-cleanup 禁 taskkill /IM 通杀）。
- 迁移失败禁止 `alembic stamp` 掩盖根因，按 worktree-migration-pollutes-deploy 模式 `down -v` 重置后重 up（项目未上线允许重置数据）。
- 本任务不改功能代码，仅在 deploy/docker-compose.yml 或 backend/tests/** 有调整需求时落改动（绝大多数情况无需改动，纯验收任务）。
- daemon-client 端到端若因本变更以外原因失败（如 daemon 版本不一致），记录证据但本任务判定为非阻断遗留，不强行修 daemon 侧非相关代码。
