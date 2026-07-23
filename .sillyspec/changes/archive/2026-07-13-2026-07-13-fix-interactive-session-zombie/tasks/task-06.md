---
author: qinyi
created_at: 2026-07-13 20:56:24
priority: P0
depends_on: [task-01, task-02, task-03, task-04]
requirement_ids: []
decision_ids: []
allowed_paths:
  - backend/app/modules/daemon/session/service.py
---

# task-06 — 全量回归 + verify DB 实测无僵尸

## goal

验证型 task，**不改源码**。聚合 task-01~04 的实现成果跑全量 backend 回归 + lint + DB 实测，确认零回归 + 历史僵尸清除，落齐 AC-1~5 + NFR-3/4，为 verify / archive 阶段铺路。关键路径终点（task-01 → task-03 → task-06）。

## implementation

### backend 全量回归（含 task-01~04 新增 4 测试文件）

```bash
cd backend && uv run pytest -q --cov=app --cov-fail-under=60
```

含 task-01 `test_apply_session_terminal_status.py` / task-02 `test_session_zombie_migration.py` / task-03 `test_close_interactive_run_session_status.py` / task-04 `test_cancel_lease_session.py`。

### backend lint

```bash
cd backend && uv run ruff check . && uv run ruff format --check . && uv run mypy app
```

### frontend（task-05 做则）

```bash
cd frontend && pnpm test && pnpm typecheck
```

### DB 实测 AC-1（rebuild backend 镜像 + 重启容器后）

```bash
# 计数：应仅含真正 dispatch 中的瞬时 pending（背后 run 为 running/pending），无僵尸
docker exec multi-agent-platform-postgres-1 psql -U platform -d platform -c \
  "SELECT count(*) FROM agent_sessions WHERE status='pending' AND deleted_at IS NULL"

# 交叉验证：pending session 与其背后 run 真实状态
docker exec multi-agent-platform-postgres-1 psql -U platform -d platform -c \
  "SELECT s.status, r.status AS run_status, count(*) FROM agent_sessions s \
   LEFT JOIN agent_runs r ON r.agent_session_id=s.id \
   WHERE s.status='pending' AND s.deleted_at IS NULL GROUP BY 1,2"
```

### 回归守护（AC-5 零回归）

确认现有测试全绿：`test_interactive_lifecycle_patch` / `test_interactive_session_placement` / change-detail-session 相关测试。

### rebuild backend 镜像 + 重启容器（Docker 后端不热重载）

```bash
docker compose -f deploy/docker-compose.yml up -d --build backend
```

## 验收标准

- **AC-1**：DB 实测 `agent_sessions WHERE status='pending' AND deleted_at IS NULL` 仅含真正 dispatch 中瞬时行（背后 run 为 running/pending），重跑场景后无僵尸
- **AC-2**：close_interactive_run 回写 4 case 通过（task-03 测试，单轮 ended / 单轮 failed / 多轮 active / 幂等）
- **AC-3**：cancel_lease interactive 收口 session=ended；stage cancel / scan cancel 回归不破坏现有生命周期（task-04 测试）
- **AC-4**：data migration 映射正确性测试通过（task-02 测试，4 类 run 终态 + 孤儿）
- **AC-5**：零回归——test_interactive_lifecycle_patch / test_interactive_session_placement / change-detail-session 全绿
- backend 覆盖率 ≥60%（NFR-4）
- backend lint（ruff + mypy）全绿
- 旧 daemon 兼容（brownfield，rebuild backend 后实测——session 终态回写在 backend 收 notifyRunResult 后触发，daemon 零改动 D-006）

## verify

```bash
cd backend && uv run pytest -q --cov=app --cov-fail-under=60
cd backend && uv run ruff check . && uv run ruff format --check . && uv run mypy app
docker exec multi-agent-platform-postgres-1 psql -U platform -d platform -c \
  "SELECT s.status, r.status AS run_status, count(*) FROM agent_sessions s \
   LEFT JOIN agent_runs r ON r.agent_session_id=s.id \
   WHERE s.status='pending' AND s.deleted_at IS NULL GROUP BY 1,2"
docker compose -f deploy/docker-compose.yml up -d --build backend
```

## constraints

- 验证型 task，**不改源码**；若发现 bug 回对应 task-01~04 修复，不在本 task 内改
- Docker 后端不热重载，改源码（task-01~04）后必须 rebuild 镜像才能实测（CONVENTIONS 已知陷阱）
- 用 `127.0.0.1` 访问容器端口（localhost 解析 IPv6 ::1 连 0.0.0.0 映射不通）
- 不用 `taskkill /IM` 通杀 claude.exe（会自杀，按 PID 精确杀并排除当前会话）
- 跨平台命令（Windows/Linux/macOS 兼容，CLAUDE.md 规则 13）
