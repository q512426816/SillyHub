---
author: qinyi
created_at: 2026-07-03 11:30:00
change: 2026-07-03-daemon-entity-binding
---

# 部署指南 — 守护进程实体化绑定

## 目录

- [1. 变更概述](#1-变更概述)
- [2. Breaking 变更清单](#2-breaking-变更清单)
- [3. 涉及组件与版本要求](#3-涉及组件与版本要求)
- [4. 升级前置准备](#4-升级前置准备)
- [5. 同步升级步骤](#5-同步升级步骤)
  - [5.1 后端升级（backend）](#51-后端升级backend)
  - [5.2 守护进程升级（sillyhub-daemon）](#52-守护进程升级sillyhub-daemon)
  - [5.3 前端升级（frontend）](#53-前端升级frontend)
- [6. Config 自动迁移说明](#6-config-自动迁移说明)
- [7. 数据重置（可选，推荐）](#7-数据重置可选推荐)
- [8. 升级验证清单](#8-升级验证清单)
- [9. 回退路径](#9-回退路径)
  - [9.1 回退前提——升级前备份](#91-回退前提升级前备份)
  - [9.2 逐组件回退](#92-逐组件回退)
  - [9.3 未备份数据的恢复方案](#93-未备份数据的恢复方案)
- [10. 常见问题（FAQ）](#10-常见问题faq)

---

## 1. 变更概述

本变更将守护进程（daemon）从「按智能体（provider）注册的运行时实例」模型，重构为「守护进程实体 + 从属运行时列表」模型。

**核心变化**：后端引入 `daemon_instances` 表，每台物理守护进程在后端有唯一稳定身份（`daemon_local_id`，本地持久化 uuid）。`daemon_runtimes` 退化为该实体的从属清单，`workspace_member_runtimes` 的绑定目标从 `runtime_id` 改为 `daemon_id`。

**部署性质**：Breaking 变更。所有组件必须同步升级，不降级兼容。

---

## 2. Breaking 变更清单

### 2.1 WebSocket 握手参数

| 项目 | 旧版 | 新版 |
|------|------|------|
| WS 握手 query 参数 | `?runtime_id=<uuid>` | `?daemon_local_id=<uuid>` |
| 握手 message 字段 | `runtime_id` | `daemon_local_id` |

旧 daemon 连新 backend → 后端无法识别 `runtime_id` → **4001 拒绝连接**，后端日志输出 `「守护进程需要升级：握手参数缺少 daemon_local_id」`。

### 2.2 注册端点（POST /api/daemon/register）

**旧 body**（per-provider 逐条注册）：
```json
{
  "runtime_id": "<uuid>",
  "provider": "claude",
  "hostname": "my-server",
  "os": "linux",
  "arch": "x64",
  "version": "1.0.0",
  "allowed_roots": ["/data/projects"]
}
```

**新 body**（per-daemon 批量注册）：
```json
{
  "daemon_local_id": "<uuid>",
  "server_url": "http://backend:8000",
  "hostname": "my-server",
  "os": "linux",
  "arch": "x64",
  "allowed_roots": ["/data/projects"],
  "providers": [
    { "provider": "claude", "version": "1.0.0", "status": "online" },
    { "provider": "codex",  "version": "2.1.0", "status": "online" }
  ]
}
```

旧 daemon 以旧 body 调用新端点 → **422 校验失败**，注册中断。

### 2.3 心跳端点（POST /api/daemon/heartbeat）

| 项目 | 旧版 | 新版 |
|------|------|------|
| 请求结构 | `{ runtime_id, status }` 每条并发 | `{ daemon_local_id, providers: [{ provider, status, last_heartbeat_at }] }` 单条聚合 |
| 并发心跳 | 每 provider 独立心跳 | 单守护进程单条心跳，后端同时更新 `daemon_instances.last_heartbeat_at` + 各 `daemon_runtimes.status` |

### 2.4 守护进程与运行时关系

```
旧模型：
  daemon_runtimes (每 provider 一行，身份随 hostname 变化)
      ↑ 绑定
  workspace_member_runtimes (绑定到 runtime_id)

新模型：
  daemon_instances (守护进程实体，稳定身份，daemon_local_id)
      ↑ 1:N
  daemon_runtimes (从属，daemon_instance_id FK CASCADE)
      ↑ 绑定
  workspace_member_runtimes (绑定到 daemon_id)
```

- `daemon_runtimes` 中的 `os`、`arch`、`allowed_roots`、`capabilities`、`display_alias` 列已移除，迁移至 `daemon_instances`。
- `workspace_member_runtimes.runtime_id` 保留列改为 nullable，不再写入。**dispatch 不再读取该列**，绑定了旧 runtime_id 但 daemon_id 为空的工作区会提示「未绑定守护进程，请重绑」。

### 2.5 WS 连接数变化

| 项目 | 旧版 | 新版 |
|------|------|------|
| WS 连接数 | N 条（每 provider 一条） | 1 条（每 daemon 一条） |
| 连接标识 | `runtime_id` | `daemon_instance_id` |
| 消息分发 | 按连接直接推 | 接收后按 `payload.runtime_id` 分发到对应 provider session-manager/task-runner |

### 2.6 配置文件名变化

| 项目 | 旧版 | 新版 |
|------|------|------|
| 配置文件 | `config.json`（固定） | `config-<server_hash>.json`（per-server_url 隔离） |
| `server_hash` | — | `sha256(server_url).slice(0,8)` |

---

## 3. 涉及组件与版本要求

| 组件 | 路径 | 版本要求 |
|------|------|----------|
| backend (FastAPI + PostgreSQL) | `backend/` | 同批升级至同一 commit/tag |
| sillyhub-daemon (Node.js) | `sillyhub-daemon/` | 同批升级至同一 commit/tag |
| frontend (Next.js) | `frontend/` | 同批升级至同一 commit/tag |

> **重要**：所有组件必须同步升级至**同一次提交（commit）或标签（tag）**。混合版本可能导致 WS 握手失败、端点 422/4001、数据不一致。

---

## 4. 升级前置准备

1. **备份数据库**（关键）：
   ```bash
   # PostgreSQL 备份
   pg_dump -h <host> -U <user> -d <database> -f daemon_bindings_backup_$(date +%Y%m%d).sql
   ```

2. **确认当前 git commit**（便于回退）：
   ```bash
   git rev-parse HEAD > pre_upgrade_commit.txt
   ```

3. **检查当前 daemon 运行状态**，记录在线守护进程数：
   ```bash
   # backend 容器内执行
   psql -c "SELECT count(*) FROM daemon_runtimes WHERE status='online';"
   psql -c "SELECT count(*) FROM workspace_member_runtimes WHERE runtime_id IS NOT NULL;"
   ```

4. **通知用户**：升级后需要重绑守护进程（预计操作时间 1-2 分钟/人）。

---

## 5. 同步升级步骤

> **时序要点**：先升级并重启 backend，再升级并重启 daemon。实际操作间隙尽量短（建议 < 5 分钟），避免 daemon 长时间失联。

### 5.1 后端升级（backend）

```bash
# 1. 进入 backend 目录
cd backend

# 2. 拉取最新代码（或切换到目标 tag）
git pull origin main
# 或 git checkout <tag>

# 3. 安装依赖
uv sync

# 4. 运行数据库迁移
uv run alembic upgrade head

# 5. 确认迁移成功，单 head 无分叉
uv run alembic heads
# 应只有一行输出

# 6. 重启 FastAPI 服务
# Docker Compose 环境：
docker compose restart backend
# 或：
docker compose up -d --force-recreate backend

# 7. 确认后端健康
curl -s http://127.0.0.1:8001/healthz
# 预期：{"status": "ok"}
```

### 5.2 守护进程升级（sillyhub-daemon）

```bash
# 1. 进入 daemon 目录
cd sillyhub-daemon

# 2. 拉取最新代码
git pull origin main

# 3. 安装依赖
npm ci

# 4. 编译
npm run build

# 5. 记录旧 daemon_local_id（可选，验证 config 迁移）
cat ~/.sillyhub/config.json 2>/dev/null | grep runtime_id || echo "无旧 config.json"

# 6. 停止旧 daemon 进程
# 方式 A：按 --server 区分停止（推荐）
ps aux | grep sillyhub-daemon
kill <pid>

# 方式 B：Windows
# 见 memory 记录 daemon-usage-submit-chain／multi-daemon-instances
# 不要 taskkill /IM（会自杀），按 PID 精确杀

# 7. 启动新 daemon
# 首次启动自动执行：
#   - 检测旧 config.json → 迁移 daemon_local_id 到 config-<server_hash>.json
#   - 探测可用 provider 列表
#   - POST /api/daemon/register 注册 daemon_instances + daemon_runtimes
#   - 建立单条 WS 连接
node dist/daemon.js --server http://127.0.0.1:8000

# 8. 确认注册成功
# 后端查询：
psql -c "SELECT id, hostname, status, last_heartbeat_at FROM daemon_instances;"
psql -c "SELECT di.hostname, dr.provider, dr.status
         FROM daemon_runtimes dr
         JOIN daemon_instances di ON di.id = dr.daemon_instance_id;"
```

### 5.3 前端升级（frontend）

```bash
# 1. 进入 frontend 目录
cd frontend

# 2. 拉取最新代码
git pull origin main

# 3. 安装依赖
npm ci

# 4. 构建生产版本
npm run build

# 5. 重启前端服务
docker compose restart frontend
# 或：
docker compose up -d --force-recreate frontend

# 6. 确认前端可访问
curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:3001
# 预期：200
```

---

## 6. Config 自动迁移说明

daemon 首次启动新版时，`config.ts` 会自动检测并处理旧配置文件：

### 迁移流程

```
旧版：~/.sillyhub/config.json（一个文件，不区分后端地址）
新版：~/.sillyhub/config-<sha256(server_url).slice(0,8)>.json（按后端地址隔离）
```

1. 新 daemon 启动时，按 `--server` 参数计算 `server_hash`。
2. 如果 `config-<hash>.json` 已存在，直接使用（正常路径）。
3. 如果不存在，但旧 `config.json` 存在：
   - 读取旧 `config.json` 中的 `runtime_id` 字段。
   - 以该 `runtime_id` 作为新 `daemon_local_id`，写入 `config-<hash>.json`。
   - **保留旧 `config.json` 不动**（不删除）。
4. 如果 `config.json` 也不存在，生成新 uuid 作为 `daemon_local_id`。

### 生效结果

- 旧 `runtime_id` (= `daemon_local_id`) 跨升级不变 → `daemon_instances.id` 复用。
- 同一台机器连不同后端地址 → 不同 `config-<hash>.json` → 不同 `daemon_local_id` → 不同 `daemon_instances` 行。

### 注意事项

- 迁移只发生在「旧 `config.json` 存在且新 `config-<hash>.json` 不存在」的首次启动场景。
- 如果之前手动清理过 `config.json`，新 daemon 会生成全新 `daemon_local_id`，表现为「新守护进程实体」，需重新绑定工作区。
- 如果一台机器之前连 `server_a`，现在连 `server_b`，即使旧 `config.json` 有 `runtime_id`，也会生成新的 `config-<hash_b>.json` 和新 daemon_local_id。

---

## 7. 数据重置（可选，推荐）

依据 D-007 决策，倾向重置旧绑定数据。旧 `daemon_runtimes` 行不做历史推导（不进 `daemon_instance_id`），旧 `workspace_member_runtimes.runtime_id` 保留为快照但不参与派发。

### 7.1 使用 cleanup 脚本

变更提供了可选清理脚本 `backend/scripts/cleanup_legacy_daemon_bindings.py`。

```bash
cd backend

# 1. 预览模式（了解将删除哪些数据）
uv run python scripts/cleanup_legacy_daemon_bindings.py --dry-run

# 2. 执行清理（显式确认）
uv run python scripts/cleanup_legacy_daemon_bindings.py --confirm
```

脚本清理范围：
- `daemon_runtimes`：清空所有行（从属运行时数据，daemon 注册后会重建）。
- `workspace_member_runtimes`：清空所有行（绑定关系，用户需重绑）。

脚本不动范围：
- `daemon_task_leases`（保留，runtime_id FK 不变）。
- `daemon_change_writes`（保留，runtime_id FK 不变）。
- `workspaces.default_agent` 与 `default_model`（数据全程不动）。
- `daemon_instances`（脚本不清，但升级后 daemon 注册时会 upsert）。

### 7.2 清理后的用户操作

1. 用户登录 SillyHub 前端。
2. 进入「工作区 → 守护进程绑定」页面。
3. 在下拉列表中看到已重启注册的守护进程（显示 `hostname` + 可用 provider 徽标）。
4. 选择目标守护进程，保存绑定。
5. （可选）在该守护进程的已启用 provider 列表中，选择「默认智能体」（即 `default_agent`）。

---

## 8. 升级验证清单

升级完成后，执行以下验证确认一切正常：

### 8.1 健康检查

```bash
# 后端健康
curl http://127.0.0.1:8001/healthz
# 预期：{"status": "ok"}

# 前端可访问
curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:3001
# 预期：200
```

### 8.2 守护进程注册验证

```bash
# 在 backend 容器或可访问 psql 的节点执行

# 查看 daemon_instances 行数
psql -c "SELECT count(*) FROM daemon_instances;"
# 预期：>= 1（等于在线守护进程数）

# 查看各 daemon 的注册运行时列表
psql -c "
SELECT di.hostname, di.status AS daemon_status,
       dr.provider, dr.status AS runtime_status,
       di.last_heartbeat_at
FROM daemon_instances di
LEFT JOIN daemon_runtimes dr ON dr.daemon_instance_id = di.id
ORDER BY di.hostname, dr.provider;
"
# 预期：每行 status=online，last_heartbeat_at 在最近 45 秒内

# 确认 WS 连接数（按 daemon_id，而非 × provider）
psql -c "SELECT count(*) FROM daemon_instances WHERE status='online';"
# 预期：等于在线 daemon 数（不应远大于此值）
```

### 8.3 工作区绑定验证

```bash
# 查看使用了新绑定（daemon_id 非空）的工作区成员
psql -c "
SELECT wmr.workspace_id, wmr.user_id, wmr.daemon_id, di.hostname
FROM workspace_member_runtimes wmr
JOIN daemon_instances di ON di.id = wmr.daemon_id
WHERE wmr.daemon_id IS NOT NULL
LIMIT 10;
"

# 确认旧 runtime_id 绑定仍有记录（daemon_id 为空）
psql -c "
SELECT count(*) AS legacy_bindings
FROM workspace_member_runtimes
WHERE daemon_id IS NULL AND runtime_id IS NOT NULL;
"
```

### 8.4 派发验证

```bash
# 前端验证
# 1. 打开工作区详情页 → 应显示绑定状态
# 2. 发起 agent run → 应成功派发到目标守护进程

# 后端日志验证
docker compose logs backend | grep "dispatch"
# 应无 "未绑定守护进程" 报错
```

### 8.5 端到端验证

```bash
# 1. 前端刷新 → 守护进程切换器显示在线 daemon
# 2. 选 daemon → 保存 → 确认绑定成功
# 3. 默认智能体独立选择器 → 选 provider → 保存
# 4. 发起 agent run → 任务到达 daemon 并执行
# 5. 查看 WS 连接数（daemon 日志）→ 仅 1 条
```

---

## 9. 回退路径

### 9.1 回退前提——升级前备份

回退的前提条件是**升级前已完整备份 `daemon_runtimes` 与 `workspace_member_runtimes` 两表数据**。

**推荐备份命令（升级前置准备中已列出）**：
```bash
# 全量备份
pg_dump -h <host> -U <user> -d <database> \
  --table=daemon_runtimes \
  --table=workspace_member_runtimes \
  --table=daemon_instances \
  --data-only \
  -f daemon_entity_binding_backup_$(date +%Y%m%d).sql
```

### 9.2 逐组件回退

```bash
# ====== Step 1: 回退 backend ======
cd backend

# 降级 alembic 迁移（撤销建表/加列/删列）
uv run alembic downgrade <pre_upgrade_revision>
# 确认：
uv run alembic heads  # 应回到旧 head

# 恢复到旧代码
git checkout <pre_upgrade_commit>

# 重启
docker compose restart backend

# 验证健康
curl http://127.0.0.1:8001/healthz

# ====== Step 2: 恢复数据 ======
# 如果执行了 cleanup 脚本，需要还原数据
psql -h <host> -U <user> -d <database> -f daemon_entity_binding_backup_<date>.sql

# 确认数据恢复
psql -c "SELECT count(*) FROM daemon_runtimes;"
psql -c "SELECT count(*) FROM workspace_member_runtimes;"

# ====== Step 3: 回退 daemon ======
cd sillyhub-daemon

# 停止新 daemon
kill <new_daemon_pid>

# 恢复到旧版 daemon 二进制
git checkout <pre_upgrade_commit>
npm ci && npm run build

# 如需恢复旧 config.json（新 per-server config 保留不影响旧版）
# 新版 daemon 不会删除旧 config.json，直接可用

# 启动旧 daemon
node dist/daemon.js --server http://127.0.0.1:8000

# ====== Step 4: 回退 frontend ======
cd frontend
git checkout <pre_upgrade_commit>
npm ci && npm run build
docker compose restart frontend
```

> 注意：`workspaces.default_agent` 与 `default_model` 数据全程不动，**不需要恢复**。`daemon_task_leases` 与 `daemon_change_writes` 的 `runtime_id` FK 全程不变，也不影响。

### 9.3 未备份数据的恢复方案

如果升级时未备份 `daemon_runtimes` 和 `workspace_member_runtimes` 表，则无法直接恢复到旧绑定状态。此时：

1. 按 9.2 步骤回退 backend + daemon 代码。
2. **所有工作区绑定需要用户重新手动绑定**。
3. 旧 runtime_id 在旧版代码中仍可用——`workspace_member_runtimes.runtime_id` 列在 alembic 迁移中保留为 nullable，没有物理删除。但如果没有数据，用户需要重新绑定。

---

## 10. 常见问题（FAQ）

### Q1: 升级后 daemon 无法注册，后端返回 422

**原因**：旧 daemon 仍以 `{ runtime_id, provider, ... }` 格式 POST /api/daemon/register，新后端期望 `{ daemon_local_id, providers: [...], ... }`。

**解决**：升级 daemon 二进制到对应 commit 并重启。

### Q2: 升级后 WS 连接被拒绝（4001）

**原因**：旧 daemon WS 握手带 `runtime_id` 参数，新后端期望 `daemon_local_id`。

**解决**：同 Q1，升级 daemon 版本。

### Q3: 工作区页面提示「未绑定守护进程，请重绑」

**原因**：D-007 策略——旧 `workspace_member_runtimes.runtime_id` 保留但不再参与派发。该 member 的 `daemon_id` 为空。

**解决**：用户在工作区详情页重新选择已注册的守护进程并保存绑定。

### Q4: 同一台机器上有多个 daemon 连接不同后端，config 会混吗？

**不会**。per-server config 隔离机制确保不同后端地址使用不同 `config-<server_hash>.json`，各 daemon 拥有独立 `daemon_local_id`，后端 upsert 时 `(user_id, server_url, daemon_local_id)` 唯一约束保证隔离。

### Q5: 升级后 daemon 能启动，但 agent run 派发到错误 provider

**原因**：新派发逻辑按 `daemon_id + workspace.default_agent → 该 daemon 的 daemon_runtimes 找 provider 匹配`。如果 `default_agent` 值与 daemon 实际启用的 provider 名不匹配，会报 `NoOnlineDaemonError`（D-008 不 fallback）。

**解决**：在工作区详情页的「默认智能体」选择器中，从该 daemon 已启用的 provider 列表中选择正确的项。

### Q6: 前端守护进程切换器下拉为空

**原因与排查**：
1. daemon 还未重新注册 → 检查 daemon 日志确认注册成功。
2. 当前用户没有在线 daemon → `psql -c "SELECT * FROM daemon_instances WHERE user_id='<current_user_id>' AND status='online';"`。
3. 后端注册端点返回异常 → 查看 backend 日志。

### Q7: 我可以只升级 backend，不升级 daemon 吗？

**不可以**。这是 Breaking 变更，旧 daemon 无法与新 backend 通信（注册 422、WS 4001、心跳 422）。所有组件必须同步升级。

### Q8: cleanup 脚本会影响正在运行的任务吗？

`cleanup_legacy_daemon_bindings.py` 不涉及 `daemon_task_leases` 与 `daemon_change_writes` 表，不影响正在运行的任务。但 `daemon_runtimes` 清空后，正在运行任务的 `runtime_id` 记录的 FK 保持，只是从属关系断开（不影响任务完成）。

### Q9: 回退时 `daemon_instances` 表需要删除吗？

不需要。alembic downgrade 会自动撤销 `daemon_instances` 表的创建。如果手动建过索引或约束，downgrade 迁移会一并处理。

### Q10: 升级后发现 daemon 频繁 WS 断连

**可能原因**：
1. 两个 daemon 实例使用相同 `daemon_local_id`（同一台机器复用旧 config 且未隔离 server_url）→ 后端驱逐旧连接（code=4000 replaced）。
2. 网络抖动或 backend 容器重启。
3. status 检查：`psql -c "SELECT * FROM daemon_instances WHERE status='offline';"` → 如果 last_heartbeat_at 超过 45 秒，心跳可能未正常发送。

**排查**：查看 daemon 日志是否有 `connection replaced` 或 `heartbeat timeout` 相关输出。
