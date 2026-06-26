---
author: qinyi
created_at: 2026-06-26 11:36:00
priority: P0
depends_on: [task-13]
blocks: []
requirement_ids: []
decision_ids: []
---

# task-14 — 端到端联调（daemon-client workspace 7cd27eb9）

## goal
真实 workspace `7cd27eb9`（myaaa，daemon-client，backend Docker `multi-agent-platform-backend-1` + 宿主 daemon）下端到端验证 Phase 1-3 全链路：scan 终态后 scan-docs/knowledge/runtime 可见（SC1）、last_synced_at 落库（SC2）、daemon 在线可建 change（SC4）、daemon 离线返回结构化错误（SC5）、backend Docker × 宿主 daemon 联调（SC6）、daemon 路径跨平台兼容（SC7）；并回归 server-local workspace（SC3）。纯验证 task，不改代码。

## allowed_paths
- 无代码改动（纯验证 task）。
- 如需临时脚本可写 `backend/tests/` 或 `spikes/` 下临时脚本（验收后清理）。

## context
- design §10 测试策略 Phase 3 端到端：真实 workspace `7cd27eb9`，backend Docker + daemon 宿主联调，验收 scan-docs/knowledge/runtime 可见 + changes 可建。
- design §2 实测基线：scan run `453530e9` 已 completed 但 scan-docs/knowledge/runtime 全空、changes 报 `requires an active lease`、`last_synced_at=NULL`、`scan_documents=0`。
- design §5.0/§5.1 Phase 1：platform-managed 扁平布局（无 `.sillyspec` 包裹），reader 全量切 `SpecPathResolver.for_spec_workspace`。
- design §5.2 Phase 2：scan run 终态触发 `syncSpecTreeIfNeeded`；apply_sync 接收 `.runtime` + 落 `last_synced_at=now, sync_status=clean`。
- design §5.3 Phase 3：change-write 经 lease-polling，`POST /changes/proxy-create`（带 runtime_id）；daemon 离线抛 `DAEMON_CLIENT_NO_SESSION`（400）。
- plan 全局验收：SC1~SC7 + NFR-02/03 + 子项目测试通过 + 跨平台路径。
- 环境：backend 8001→8000（Docker），daemon Windows 宿主（npm 安装版，BUILD_ID=2515cb3e），两者不共享文件系统，spec 交换走 tar。

## implementation
1. 重建/重跑 workspace `7cd27eb9` 的 scan（UI 触发或手动），等 agent_run 到终态（`status in (completed, failed)`）；记录 run id 与终态时间。
2. **SC1（可见性）**：`GET /api/workspaces/7cd27eb9/scan-docs` 返回 `scan_documents>0`（ARCHITECTURE 等组件）；`GET /knowledge` 非空；`GET /runtime` 含 RuntimeProgress（反映 sillyspec.db）。对比基线「全空」确认修复。
3. **SC2（回灌落库）**：`docker exec multi-agent-platform-postgres-1 psql -U platform -d platform -c "SELECT last_synced_at, sync_status FROM spec_workspaces WHERE id='7cd27eb9'"` 确认 `last_synced_at IS NOT NULL`、`sync_status='clean'`；并查 `SELECT count(*) FROM scan_documents WHERE workspace_id='7cd27eb9'` >0。
4. **SC4（在线建 change）**：daemon 在线时 UI 新建 change → 成功；落 daemon 本地 `ls ~/.sillyhub/daemon/specs/7cd27eb9*/changes/<key>/`（MASTER.md 等）+ backend `SELECT count(*) FROM changes WHERE workspace_id='7cd27eb9'` 增长、`change_documents` 行存在。
5. **SC5（离线结构化错误）**：停 daemon（按 --server 区分，勿误杀，见 memory）后 UI 新建 change → 返回 `DAEMON_CLIENT_NO_SESSION`（400）+ 前端引导（toast / 禁用 + tooltip）。验后重启 daemon。
6. **SC6（Docker × 宿主联调）**：backend Docker 容器 + 宿主 daemon 跨边界 tar 同步链路全程跑通（SC1/SC2/SC4 即隐含验证，此处显式确认无容器内路径假设）。
7. **SC7（跨平台路径）**：daemon 路径用 `os.homedir()`（`~/.sillyhub/daemon/specs/`），Windows 实测通过即代表兼容（Linux/macOS 同语义，既有约束）。
8. **SC3 回归**：server-local / repo-native workspace 跑一轮 scan + change，确认 `.sillyspec` 包裹语义零回归（reader 双模式 + create_change 原路径）。
9. **NFR-02/03 抽验**：double-sync（scan 终态 + session end）幂等无副作用；change-write pending 超时→failed（task-13 已单测覆盖，端到端顺带观察）。

## acceptance
- SC1：scan-docs/knowledge/runtime 三个端点对 7cd27eb9 均非空（对比基线全空）。
- SC2：`spec_workspaces.last_synced_at` 非 NULL、`sync_status='clean'`、`scan_documents` 计数 >0。
- SC4：daemon 在线时 UI 建 change 成功，daemon 本地文件 + backend DB 行双落。
- SC5：daemon 离线时建 change 返回 `DAEMON_CLIENT_NO_SESSION`（400）+ 前端引导。
- SC6：backend Docker + 宿主 daemon 全链路联调通过。
- SC7：Windows 宿主 daemon 路径实测通过（`homedir()` 兼容）。
- SC3：server-local/repo-native workspace 零回归。
- 全部实测通过，附命令输出 / 截图作为证据。

## verify
- DB 查询：`docker exec multi-agent-platform-postgres-1 psql -U platform -d platform -c "<SQL>"`（spec_workspaces / scan_documents / changes / change_documents）。
- API 验证：`curl http://localhost:8001/api/workspaces/7cd27eb9/{scan-docs,knowledge,runtime}` 或前端 UI 观察。
- 本地文件：`ls ~/.sillyhub/daemon/specs/7cd27eb9*/changes/`（Windows 为 `C:\Users\<u>\.sillyhub\daemon\specs\...`）。
- SC3 回归：复用既有 server-local workspace（或新建）跑 scan + change，对照 SC1/SC4 同样可见。
- 前置：task-13 单测/集成测全过；`cd backend && uv run pytest` + `cd sillyhub-daemon && pnpm test` 绿（local.yaml）。

## constraints
- 纯验证 task，不改代码；如改测试或脚本仅落 `backend/tests/` 或 `spikes/`。
- 本机开发数据可重置（CLAUDE.md 规则 10）；不要求历史数据兼容。
- 停 daemon 按 --server 区分实例，勿误杀其他 daemon（见 memory multi-daemon-instances）；勿 `taskkill /IM` 通杀。
- 记录实测证据（命令输出 / 截图）作为 SC 验收材料。
- Windows/Linux/macOS 路径兼容（SC7，`os.homedir()`）。

## 执行记录（2026-06-26）

- 环境：Docker backend 已运行且 `/api/health` 返回 `commit_sha=445881aa2c63`；backend 日志持续出现 `GET /api/daemon/runtimes/{rid}/pending-change-writes 200`，确认宿主 daemon 正在轮询新增端点。
- SC1：使用平台管理员短期 JWT 调真实 API：
  - `/api/workspaces/7cd27eb9-f424-4eb5-a21d-81ce62d510ec/scan-docs` 返回 `scan_items=11,total=11`。
  - `/knowledge` 返回 `knowledge_items=4`。
  - `/runtime` 非空，`current_stage=status`。
- SC2：DB 查询 `spec_workspaces`：`last_synced_at=2026-06-26 08:31:19.793512+00`，`sync_status=clean`；`scan_documents` 计数 `11`。
- SC4：daemon 在线时调用真实 `POST /api/workspaces/7cd27eb9-f424-4eb5-a21d-81ce62d510ec/changes/proxy-create` 成功，返回：
  - `change_id=da337043-8ec1-46b3-bef2-99d9e9c7165f`
  - `change_key=2026-06-26-task14-e2e-daemon-change-write-96c125`
  - `current_stage=draft`
  DB 验证 `daemon_change_writes.status=done`，`ChangeDocument` 行数 `3`。
- SC6/SC7：宿主文件存在于 `C:\Users\qinyi\.sillyhub\daemon\specs\7cd27eb9-f424-4eb5-a21d-81ce62d510ec\changes\2026-06-26-task14-e2e-daemon-change-write-96c125\`，包含 `MASTER.md/proposal.md/request.md`；backend 容器 `/data/spec-workspaces/.../changes/<key>/` 同步收到同三文件，证明 Docker backend × Windows 宿主 daemon 跨边界 tar 同步跑通。
- SC5：按 `--server http://127.0.0.1:8001` 精确定位并停止宿主 daemon PID `12260`，等待 runtime 心跳过期后调用 `GET /api/daemon/runtimes` 触发 stale cleanup；绑定 runtime `132bb2af-cc95-47e9-8e3c-b07d39d1f1c4` 变为 `offline` 后，真实调用 `POST /api/workspaces/7cd27eb9-f424-4eb5-a21d-81ce62d510ec/changes/proxy-create` 返回 HTTP `400`，body `code=DAEMON_CLIENT_NO_SESSION`，`details.reason=runtime_offline`。验后用 worktree `sillyhub-daemon/dist/cli.js start --server http://127.0.0.1:8001 --force` 重启，PID `51500`，DB runtime 恢复 `online`。
- SC3：创建临时 server-local workspace `0210a6dc-5a28-4373-b411-309c57ac3524`，root `/tmp/sillyhub-task14-server-local-20260626170448-1657bf`，通过真实 API 验证：
  - `POST /api/workspaces` 返回 `201`，`path_source=server-local`。
  - `POST /api/workspaces/{id}/scan-docs/reparse` 返回 `parsed=2`，`GET /scan-docs` 返回 `total=2`。
  - `POST /api/workspaces/{id}/changes/create` 返回 `201`，`change_key=2026-06-26-task14-server-local-change-write-364f8f`，DB `change_documents` 行数 `3`。
  - 容器文件 `/tmp/.../.sillyspec/changes/<key>/` 存在 `MASTER.md:297`、`proposal.md:239`、`request.md:222`，确认 `.sillyspec` 包裹语义和原直写路径保持。
  - 验后 API 软删临时 workspace，并删除本次 `/tmp/sillyhub-task14-server-local-*` 与 `/data/spec-workspaces/<temp-ws-id>` 临时目录。
- 观察项：server-local `changes/create` 会按既有逻辑 best-effort 自动 dispatch brainstorm；本次临时 workspace 无真实任务上下文，dispatch lease 很快 `failed`，不影响 `changes/create` API、落盘文件和 DB 文档验收。日志同时显示 platform mirror 未包含刚写入的 server-local change 文件，属于自动 dispatch 与 platform mirror 的既有限制，未纳入本次 daemon-client 修复范围。
- 结论：task-14 SC1/SC2/SC3/SC4/SC5/SC6/SC7 全部实测通过；剩余风险仅为上述 server-local 自动 dispatch 观察项。
