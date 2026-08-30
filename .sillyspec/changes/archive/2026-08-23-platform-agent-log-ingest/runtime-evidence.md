---
author: qinyi
created_at: 2026-08-23 10:45:00
---

# 运行时实证（Runtime Evidence）— 2026-08-23-platform-agent-log-ingest task-05

> 环境：Windows 主仓 worktree（分支 sillyspec/2026-08-23-platform-agent-log-ingest，base b0d8632c）+ 本机 Docker compose 栈（PG 127.0.0.1:5432，旧镜像 backend 占 8001）。
> 敏感值（shpsync_ token、DB 密码）只经环境变量/临时文件使用，未落入任何提交产物（临时文件已删）。

## 1. 全量回归

| 套件 | 命令 | 结果 |
|---|---|---|
| backend 全量 | `uv run pytest -q --no-cov -n auto`（worktree） | **5024 passed**, 6 skipped, 3 xfailed, 1 xpassed, 3 failed（见下） |
| frontend 全量 | `pnpm vitest run`（worktree） | **178 文件 / 1923 测试全绿** |
| frontend 类型 | `pnpm typecheck` | 0 error |
| frontend lint | `pnpm lint` | exit 0（1 条既有 warning `partial` 未用，非本次 diff 文件） |

### 3 个 backend 失败的处置

| 失败 | 主仓基线（改动前） | 判定 | 处置 |
|---|---|---|---|
| `test_session_agent_session_id_migration.py::test_alembic_single_head_chain` | **本就红**（期望 head=20260821130000，主仓 head 已是 20260822090000） | 既有旧债：断言写死「本迁移必须是 head」，任何后续迁移都打破 | 已按测试意图修复（单 head + 本迁移在链上），worktree 内，见 §3 偏差披露 |
| `app/modules/agent/tests/test_mission_session_id.py::test_migration_is_single_head_after_mount` | 绿（其迁移恰为当时 head） | **本次引发**（同款过严断言，被 20260823090000 合法推进 head 打破） | 同款修复，修复后两文件 29 passed |
| `tests/modules/agent/test_execution.py::test_dispatch_worker_calls_placement_with_role_and_tool_config` | **本就红**（主仓 bb298931 基线复现） | 与本变更无关（agent 派发 placement，不涉 platform_sync/前端） | 不修（越界另一变更域），如实登记遗留 |

## 2. 端到端实证（CLI 真实上报 → 新端点 → 落库 → GET 回读）

1. **迁移打到真实库**：worktree `alembic upgrade head` → compose PG（127.0.0.1:5432）`20260822090000 → 20260823090000`（仅本迁移，纯增量新表）。
2. **新后端起服**：worktree `uvicorn app.main:app --port 8010`（连同一 compose PG）；`/api/health` 200（db ok / redis ok）；`POST /api/agent-logs` 无凭据 → **401**（端点存在且鉴权生效，旧镜像为 404）。
3. **真实 CLI 推送**：`SILLYHUB_PLATFORM_URL=http://127.0.0.1:8010 SILLYHUB_PLATFORM_TOKEN=<本仓 local.yaml platform token> node <sillyspec 本地仓>/src/index.js status`（在本仓根执行）→ CLI 静默成功（best-effort 语义，失败才 warn）。
   - ⚠️ 全局安装的 sillyspec（3.27.1，npm snapshot 2026-08-22 21:49）**不含 agent-log 推送功能**，须用本地仓直跑（`node src/index.js`）；待 CLI 仓发布/重装后全局命令即带功能。
4. **落库核验**：`platform_agent_logs` 出现 **3 行 zcode 条目**（本会话真实 model-io 日志：`~/.zcode/cli/rollout/model-io-sess_*.jsonl`，size 165KB/387KB/6.9MB，invocations=1，last_command=status，detected_via=zcode-env-marker，agent_cwd=本仓根，workspace_id=token 派生 b97f8231-…）。
5. **GET 回读**：`GET /api/agent-logs?limit=2` + Bearer shpsync_ → `{"items":[…]}` 2 条（limit 生效），字段齐全（log_path/format/session_id/size_bytes/mtime_ms/first_seen_at/last_seen_at/invocations/last_command/pushed_at…），workspace 归属 = token 派生值（body 未传也未信）。
6. **幂等心跳**：CLI 每次调用都推，同 log_path 整行覆盖（pytest 已覆盖，端到端由 invocations 语义承载）。

## 3. 偏差披露（out-of-allowed_paths 测试修复）

- `backend/tests/test_session_agent_session_id_migration.py`、`backend/app/modules/agent/tests/test_mission_session_id.py`：两个「迁移单头断言」测试按意图修复（`heads == [REVISION_ID]` → `len(heads)==1 且 REVISION_ID 在 walk_revisions 链上`）。原因：本变更新迁移合法推进 head 触发其一失败，另一为主仓既有红（同缺陷已腐烂）；测试意图（守单头链）完整保留。修复后 29 passed、ruff 干净。

## 4. 遗留与后续

- **Docker 栈（8001/3001）仍是旧镜像**：execute 完成确认合并 worktree → main 后需重建 backend+frontend 镜像并 `up -d`，届时 8001 的 CLI 直推（无 env 覆盖）即 200、面板浏览器可见（本实证已证明端点与数据链路，部署验证为机械步骤）。
- `test_dispatch_worker…` 主仓既有红（bb298931 复现），归属 agent 模块，建议另行处理。
- 主仓 HEAD 在本变更执行期间由并行会话推进至 bb298931（sessions-workspace-hub），与本次 worktree 在 `session-panel.tsx`（+346 行预会话态）与生成物（api-types/openapi）存在重叠——合并时需 3-way 处理 + 合并后前端回归重跑。
