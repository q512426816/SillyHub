---
id: task-12
title: 端到端验证 SPEC_TRANSPORT=tar 异机拓扑 scan 文件落 backend（覆盖：SC-2, SC-3, SC-4）
priority: P0
estimated_hours: 2
depends_on: [task-09, task-11]
blocks: [task-13]
requirement_ids: []
decision_ids: [D-003@v1]
allowed_paths: []
author: qinyi
created_at: 2026-06-23 11:20:01
---

# task-12：端到端验证 `SPEC_TRANSPORT=tar` 异机拓扑 scan 全流程文件落 backend

> 本任务为**验证任务**（手动 / integration），**无产品代码改动**。依据 design §5.2
> tar 流程、§7.4 契约表、plan 全局验收 SC-2/3/4、decisions D-003@v1 双向同步语义，
> 在真实异机拓扑（或可信等价模拟）下跑通 scan-generate，逐条核验 tar 模式的文件落
> backend、daemon 缓存、回传容错三个成功标准，并产出验收记录。前置依赖 task-09
> （daemon/claim 单测守护 spec-sync 链路）、task-11（stage 全链路单测）保证编码侧已
> 就绪；本任务在它们之上做端到端联通验证。

## 1. 覆盖来源

| 来源 | 编号 | 内容 | 本任务如何验证 |
|---|---|---|---|
| plan 全局验收 | SC-2 | `SPEC_TRANSPORT=tar` scan 跑完后，spec 文档物理存在于 backend `/data/spec-workspaces/{ws}/.sillyspec/docs/`，ScanDocument 表有记录 | §4 验证步骤 ④⑤ + §6 验收 AC-SC2 |
| plan 全局验收 | SC-3 | tar 模式 daemon 本地保留 `~/.sillyhub/daemon/specs/{ws}` 缓存，agent 后续 stage 可读 | §4 验证步骤 ⑥ + §6 验收 AC-SC3 |
| plan 全局验收 | SC-4 | tar 模式回传失败不阻塞 scan 完成（warn + `sync_status=dirty`） | §4 验证步骤 ⑦（故障注入）+ §6 验收 AC-SC4 |
| decisions | D-003@v1 | tar 模式双向同步：daemon→backend 回传（postSpecSync + apply_sync）+ backend→daemon 拉取（pullSpecBundle 缓存） | §4 步骤 ③（pull 触发）+ ④（sync 触发）+ ⑥（缓存残留）双向各证一次 |
| design | §5.2 / §7.4 | tar 流程 6 步契约 | §4 步骤 ①~⑥ 逐一对应契约表事件 |

## 2. 实现要求（部署 checklist）

本任务不写产品代码，但需准备下列部署/环境。**所有 checklist 项均为验证前置，不属于
本任务 deliverable**：

1. **两台独立物理/逻辑设备 或 等价异机模拟**：
   - 真实异机：backend 设备 A（跑 docker-compose：backend + postgres + redis +
     frontend 容器）、daemon 设备 B（跑 `sillyhub-daemon`，连设备 A 的 backend）。
   - **等价异机模拟（推荐，成本低）**：同一台物理机，但让 daemon 与 backend **不共享
     `SPEC_DATA_HOST_DIR`**——daemon 的 `~/.sillyhub/daemon/specs/{ws}` 与 backend 的
     `SPEC_DATA_HOST_DIR` 指向**不同物理目录**，等效「无共享盘」。具体方式见 §5 边界
     E-01。
2. **backend 侧启用 tar 模式**：`deploy/.env` 增加并生效
   `SPEC_TRANSPORT=tar`（task-01 交付的 config 字段读此 env；默认 shared）。重启
   backend 容器使配置生效（`docker compose restart backend` 或重建）。
3. **workspace 就绪**：一个 `daemon-client` 模式的 workspace（绑定到设备 B 的 daemon
   runtime），其 `SpecWorkspace.strategy=platform-managed`、`spec_root` 为容器路径
   `/data/spec-workspaces/{ws}`（apply_sync 的权威源）。
4. **scan-generate 触发通道**：`POST /api/workspaces/scan-generate`（
   `backend/app/modules/workspace/router.py:93`），body 含 `daemon_runtime_id`（走
   daemon-client 分支 `service.scan_generate_daemon_client`，router.py:104-117），由
   daemon 执行 scan。
5. **观测通道**：
   - backend 日志：`docker compose logs -f backend`（关注 `apply_sync` / `reparse` /
     `sync_status` 日志）。
   - daemon 日志：daemon 进程 stdout/stderr（关注 `pullSpecBundle` / `postSpecSync`
     warn 日志）。
   - DB：psql 连 backend postgres，查 `spec_workspaces`（`sync_status`/
     `last_synced_at`）、`scan_documents` 表。

## 3. 接口定义（验证脚本 / SQL / 命令清单）

> 全部命令以**绝对路径**或显式 host 给出；`{ws}` = workspace 的 uuid；`{ws_short}` =
> workspace 的短展示 id（按 UI/响应字段取）。

### 3.1 触发 scan

```bash
# 登录拿 token（按部署的 bootstrap admin）
TOKEN=$(curl -s -X POST http://<backend-host>:8000/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"admin@example.com","password":"Admin123!@#"}' | jq -r .access_token)

# 触发 scan-generate（daemon-client 分支）
curl -s -X POST http://<backend-host>:8000/api/workspaces/scan-generate \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"root_path":"<项目根>","daemon_runtime_id":"<daemon-runtime-uuid>","provider":"...","model":"..."}' \
  | jq .
# 响应含 workspace_id（= {ws}）+ agent_run_id；轮询 agent_run 直到 status=completed
```

### 3.2 backend 文件落盘核验（SC-2）

```bash
# 容器内（权威源 = /data/spec-workspaces/{ws}）
docker compose exec backend ls -la /data/spec-workspaces/{ws}/.sillyspec/docs/
# 期望：scan 产出的 7 份扫描文档（ARCHITECTURE/CONVENTIONS/... 等）物理存在

# 宿主侧（SPEC_DATA_HOST_DIR/{ws}，bind mount 同一物理目录）
ls -la "${SPEC_DATA_HOST_DIR}/{ws}/.sillyspec/docs/"
```

### 3.3 ScanDocument 表核验（SC-2）

```sql
-- psql 连 backend postgres
\c platform
SELECT id, workspace_id, kind, path, created_at
FROM scan_documents
WHERE workspace_id = '{ws}'
ORDER BY created_at DESC;
-- 期望：>=1 行（reparse 入库产物），kind/path 对应 scan 文档
```

### 3.4 daemon 本地缓存核验（SC-3）

```bash
# 在 daemon 设备 B 执行（daemon 进程的 HOME 下）
ls -la ~/.sillyhub/daemon/specs/{ws}/.sillyspec/docs/
# 期望：与 §3.2 同名文档存在（pull 来的 bundle + 本地 scan 写入）；D-003 缓存语义
```

### 3.5 sync_status 核验（SC-2 / SC-4）

```sql
SELECT id, strategy, spec_root, sync_status, last_synced_at
FROM spec_workspaces
WHERE id = '{ws}';
-- 正常路径期望：sync_status='clean'，last_synced_at 近期
-- 故障注入路径期望（SC-4）：sync_status='dirty'
```

### 3.6 回传失败注入（SC-4）

```bash
# 方式 A（推荐，非破坏性）：临时阻断 daemon→backend 的 sync 端点
#   在 daemon 设备的 hosts 或反向代理上，把 backend 的 POST /api/spec-workspace/sync
#   指向一个返回 5xx 的桩；或在 backend router 上临时挂个 503 中间件仅对 /sync 路径生效。
# 方式 B：断开 daemon 与 backend 的网络（拔网线/防火墙 drop POST /spec-workspace/sync）
# 然后重跑 §3.1 scan-generate，观察 daemon 日志出现 postSpecSync warn、scan 仍 completed。
```

## 4. 验证方式（手动 / integration 步骤）

> 步骤自包含可执行；每步给出「操作 → 预期」，对应 design §5.2 tar 流程 ①~⑥ 与
> §7.4 契约表。

| 步 | 操作 | 对应契约事件 | 预期（对照 design） |
|---|---|---|---|
| ① | 触发 `POST /workspaces/scan-generate`（daemon-client 分支） | claim lease + build_claim_payload（tar） | backend 下发 claim payload 含 `transport=tar` + `workspaceId`，**不含** `specRoot`（design §7.2）。可在 backend 日志或 daemon 收到的 payload dump 验证。 |
| ② | daemon 收到 lease，进入 `_startInteractiveSession` | pull spec bundle（tar session 开始） | daemon 调 `pullSpecBundle(client, wsId)`；**首次 scan backend 无 bundle → 404 容错**（design §7.2 E-01 / R-02）：daemon 日志见 404 但不报错，`mkdir -p ~/.sillyhub/daemon/specs/{ws}` 后继续。 |
| ③ | session 内跑 sillyspec scan，文档写 `--spec-root` 指向的 daemon 本地路径 | run sillyspec scan（写本地缓存） | daemon 本地 `~/.sillyhub/daemon/specs/{ws}/.sillyspec/docs/` 出现 7 份扫描文档；prompt 的 `--spec-root` = `~/.sillyhub/daemon/specs/{ws}`（design §5.2 ③ / §7.1）。 |
| ④ | scan 所有 step 完成 → `onSessionEnd` 触发 `postSpecSync` | post spec sync（tar session end） | daemon 打 tar 整树 POST `/api/spec-workspace/sync`；backend 日志见 `apply_sync` 解 tar 到 `/data/spec-workspaces/{ws}` + reparse（design §5.2 ④⑤）。 |
| ⑤ | backend apply_sync + reparse 完成 | apply_sync | §3.2 backend 文件落盘 + §3.3 `scan_documents` 表有记录（**SC-2**）；§3.5 `sync_status='clean'`、`last_synced_at` 刷新。 |
| ⑥ | 验证 daemon 缓存残留 |（D-003 backend→daemon 拉取 + 缓存语义） | §3.4 daemon 本地缓存仍存在同名文档（**SC-3**，D-003 缓存不清理）。 |
| ⑦ | **故障注入重跑**（§3.6 阻断 sync 端点）→ 再触发一次 scan | post spec sync 失败 | scan 仍达到 `completed`（不阻塞，design §7.3 R-03 / 对齐 batch 容错）；daemon 日志见 `postSpecSync` warn；backend `sync_status='dirty'`（§3.5）（**SC-4**）。 |

## 5. 边界处理

| # | 边界 | 处理 / 验证方式 |
|---|---|---|
| E-01 | **异机模拟方式**（无第二台真机时） | 等价异机模拟：同机部署但让 daemon 的 `~/.sillyhub/daemon/specs/{ws}`（daemon HOME 下）与 backend 的 `SPEC_DATA_HOST_DIR`（如 `C:/data/spec-workspaces`）指向**不同物理目录**，且 daemon 不经 bind mount 看到后者——即 daemon 写本地、backend 看自己挂载点，二者初始不共享。此条件下 tar 回传是文件到达 backend 的**唯一**路径，等效真异机。验收记录注明「等价异机模拟」或「真异机（A/B 设备）」。 |
| E-02 | **首次 scan 无 bundle 404 容错**（design §7.2 E-01 / R-02） | 新 workspace 首次 scan 时 backend 尚无 spec bundle，daemon `pullSpecBundle` 的 `getSpecBundle` 返回 404。验证：daemon 日志见 404 但**不**抛错、`mkdir -p` 空本地目录后继续 scan，最终 §3.2/3.3 仍有文件（证明 404 容错不破坏链路）。这是步骤 ② 的重点观测项。 |
| E-03 | **回传失败注入验证 SC-4**（design §7.3 R-03） | §3.6 注入失败后，验证三件事同时成立：(a) scan agent_run 终态 = completed（不阻塞）；(b) daemon 日志有 postSpecSync warn（非 fatal）；(c) backend `sync_status='dirty'`（§3.5）。三者缺一即 SC-4 不通过。注入须**可逆**，验证后恢复 sync 端点。 |
| E-04 | **daemon 缓存验证**（SC-3 / D-003 backend→daemon） | scan 完成后 §3.4 检查 daemon 本地缓存；进一步可触发**第二次** scan 或一个 stage（如 propose）验证 daemon pull 拉到的是 backend 已 apply 的 bundle（即 backend→daemon 方向真实工作，D-003 双向的另一向）。第二次 pull 不应再 404（E-02 仅首次）。 |
| E-05 | **ScanDocument 入库验证**（SC-2 后半） | §3.3 SQL 查 `scan_documents` 表；若 reparse 未入库（表空）即使文件落盘也不算 SC-2 通过——SC-2 明确要求「物理存在 **且** 表有记录」两条都成立。同时核对 `kind`/`path` 字段与 `.sillyspec/docs/` 实际文件名一致。 |
| E-06 | **transport 透传字段验证**（契约完整性） | 步骤 ① dump daemon 收到的 claim payload，确认 tar 模式下含 `transport`/`transportMode`/`workspaceId` 且**不含** `specRoot`/`specRoot`；shared 模式（对照）含 `specRoot` 不含 transport 透传。防止 task-03 漏字段导致 pull 不触发。 |

## 6. 验收（逐条对应 SC-2/3/4 + D-003）

| AC ID | 对应 | 验证命令（§3） | 通过判据 |
|---|---|---|---|
| AC-SC2-a | SC-2 文件落 backend | §3.2 | backend `/data/spec-workspaces/{ws}/.sillyspec/docs/` 下 7 份 scan 文档物理存在（容器内 + 宿主 bind mount 双验） |
| AC-SC2-b | SC-2 ScanDocument 表 | §3.3 | `scan_documents` 表 `workspace_id='{ws}'` 有 >=1 行，`kind`/`path` 与落盘文件一致 |
| AC-SC2-c | SC-2 sync 正常态 | §3.5 | 正常路径 `sync_status='clean'`、`last_synced_at` 为本次 scan 时间 |
| AC-SC3 | SC-3 daemon 缓存 | §3.4（+ E-04 二次验证） | daemon `~/.sillyhub/daemon/specs/{ws}/.sillyspec/docs/` 存在同名文档；二次 scan/stage pull 不再 404，证 D-003 backend→daemon 方向 |
| AC-SC4-a | SC-4 不阻塞完成 | §3.6 + §4 ⑦ | 故障注入下 scan agent_run 终态 = completed |
| AC-SC4-b | SC-4 warn 不 fatal | §3.6 | daemon 日志含 postSpecSync warn，无 unhandled rejection / 进程退出 |
| AC-SC4-c | SC-4 dirty 标记 | §3.5 | 故障路径 `sync_status='dirty'` |
| AC-D003-fwd | D-003 daemon→backend | §4 ④⑤ | postSpecSync → apply_sync → reparse 链路日志可见，文件到 backend |
| AC-D003-rev | D-003 backend→daemon | §4 ③ + E-04 | pullSpecBundle 拉取成功（二次 scan 非 404），daemon 缓存可被后续 stage 读 |
| AC-payload | 契约字段 | §4 ① + E-06 | claim payload tar 含 transport/workspaceId 不含 specRoot；shared 对照相反 |
| AC-no-regress | 无 P0/P1 回归 | 全程观察 | 全程 shared 模式相关代码路径未被触发（tar 模式专属分支）；无异常栈 |

**验收产出**：一份验收记录（可写在本任务评论或 `verify.md` 对应小节），记录：拓扑类型
（真异机/等价模拟）、每条 AC 的实测结果（pass/fail + 证据：日志片段/SQL 结果/ls 输出）、
故障注入方式与恢复确认。

## 7. 非目标

- **不改任何产品代码**：本任务 deliverable 是验证步骤 + 验收记录，`allowed_paths=[]`。
  若验证中发现 bug，另开 quick/excavate 任务修复，不在本任务内改代码。
- **不做 shared 模式回归**：SC-1（shared 零影响）由 task-08/09 单测覆盖，本任务专注
  tar 异机拓扑，不重复 shared 回归。
- **不自动化进 CI**：异机拓扑/故障注入无法在 CI 容器内可信复现，本任务为手动 /
  integration，不写 CI workflow。
- **不做性能/并发压测**：仅功能正确性验证，不测 tar 打包/传输耗时、多 workspace 并发
  回传等非功能指标（超出 SC-2/3/4 范围）。
- **不覆盖 stage 链路文件落盘**：stage（propose/plan/execute）端到端属 task-11 测试范围
  + 后续 stage 手动验证，本任务只验 scan 全流程。

## 8. 参考

- design `§5.2` transport=tar 流程（①~⑥ 六步契约）—— 本任务 §4 步骤一一对应。
- design `§7.4` 生命周期契约表 —— 本任务 AC-D003-fwd/rev/payload 的字段依据。
- design `§7.2` E-01 + `§10` R-02（首次 pull 404 容错）—— 本任务 E-02。
- design `§7.3` R-03（postSpecSync 失败 warn 不阻塞）—— 本任务 E-03 / SC-4。
- plan 全局验收 SC-2/3/4 —— 本任务 §6 验收逐条映射。
- decisions `D-003@v1`（tar 双向同步）—— 本任务 AC-D003-fwd/rev 双向各证一次。
- 触发端点：`backend/app/modules/workspace/router.py:93` `POST /workspaces/scan-generate`
  （daemon-client 分支 `:104-117`）。
- 回传端点：`backend/app/modules/spec_workspace/router.py:118` `POST /spec-workspace/sync`
  → `service.apply_sync`（`service.py:288`）。
- 部署变量：`deploy/.env.example`（task-01 交付后增 `SPEC_TRANSPORT=tar` 一行生效）。

## 9. TDD（验证非编码 → 给步骤 + 预期）

本任务为验证任务，不写产品测试代码（task-08/09/11 已覆盖单测）。TDD 体现为「先定义
预期、再执行验证、对照判据」：

1. **先写预期**：§4 步骤表「预期」列 + §6 AC 表「通过判据」列，在执行前定稿。
2. **执行验证**：按 §4 步骤 ①~⑦ 顺序跑，每步对照预期。
3. **对照判据**：§6 每条 AC 给出 pass/fail + 证据。
4. **失败处理**：任一 AC fail → 不在本任务改代码，开 quick 任务修复后回到 §4 重跑
   该步骤（验证可重入）。

> 与编码任务 TDD 区别：无 `it(...)/test(...)` 新增；`allowed_paths=[]` 保证不碰代码。
