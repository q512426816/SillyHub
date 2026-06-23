---
author: qinyi
created_at: 2026-06-23 10:35:00
change: 2026-06-23-spec-transport-tar-sync
---

# Design: spec 文档回传 backend 独占（transport 双模式）

## 1. 背景

当前 scan（及所有写 `.sillyspec/` 的 stage：propose/plan/execute）生成的 spec 文档
落盘机制，完全建立在「daemon 与 backend 跑在同一台物理机 + Docker bind mount 共享
物理盘」这个隐含假设之上（详见前置变更 `2026-06-22-a1-backend-host-path`，方案 B，
commit `fcbf3fa7`）：

- `build_scan_bundle`（`backend/app/modules/agent/context_builder.py:467-487`）在 prompt
  里直接写宿主路径 `--spec-root {settings.spec_data_host_dir}/{ws_id}`（生产
  `C:/data/spec-workspaces/<uuid>`）。
- daemon 在自己机器上跑 `sillyspec run scan`，把文档写到该宿主路径。
- 同机时 backend 经 Docker bind mount（宿主 `SPEC_DATA_HOST_DIR` ↔ 容器
  `/data/spec-workspaces`）看到同一物理目录，`reparse` 入库。

**问题**：当 daemon 与 backend 部署在**两台独立物理设备、无共享磁盘**时：
- 文件只存在于 daemon 设备（`SPEC_DATA_HOST_DIR/{ws}` 是 daemon 机器的本地路径）。
- backend 设备读 `/data/spec-workspaces/{ws}` 是空的——文件「存到了用户（daemon）本地」。
- 这不是偶发 bug，而是 prompt 用宿主路径在异机拓扑下的必然结果。

## 2. 设计目标

- **G1**：daemon 与 backend 两台独立设备无共享盘时，scan（及全 spec 写盘链路）生成的
  spec 文档能正确到达 backend 服务器，backend 为唯一真理源。
- **G2**：backend 独占真理源语义——`spec_root`（容器 `/data/{ws}`）是权威副本；daemon
  本地保留缓存副本供 agent 后续步骤直接读，但以 backend 为准。
- **G3**：同机开发拓扑（shared）零影响，向后兼容现有 bind-mount 部署。
- **G4**：最大化复用现有 `_pullSpecBundle` / `postSpecSync` / `apply_sync` 通道，不新建机制。
- **G5**：transport 决策全局统一（一个开关），不在每个 workspace 创建流程里加选择。

## 3. 非目标

- **N1**：不做 per-workspace / per-daemon transport 选择（D-002 已定全局环境变量；同一
  backend 不能同时服务同机+异机 daemon——已知约束，见风险 R-04）。
- **N2**：不引入每步增量回传（D-004 已定 lease complete 一次性回传）。
- **N3**：不碰 `sillyspec init` 语义（platform 模式刻意跳过 init，避免源码保护冲突，
  `context_builder.py:476-479`）。
- **N4**：不做切换 transport 时的历史 spec 数据迁移（CLAUDE.md 规则7，数据可清）。
- **N5**：不引入 backend→daemon RPC 反向拉取通道（方案 C 已否决，过度设计）。

## 4. 拆分判断

单一内聚变更，不拆分、不走批量模式（step5 已评估）：
- 4 个环节（config / prompt 生成 / daemon 回传 / backend 接收）紧耦合，不可独立交付。
- 任务数预估 8-10，单一逻辑，非「模板×数据」批量。
- 一个变更内用 Wave 分组覆盖全 spec 写盘链路（Wave1 scan 打通 → Wave2 stage 全链路 → Wave3 验证）。

## 5. 总体方案

### 5.0 核心机制（X-001 + task-11 双重修正后）

> ⚠️ **勘误链**：初稿假设 scan 复用 task-runner（X-001 纠正：scan 走 interactive）；
> X-001 又误判「stage 也走 interactive」（task-11 在 plan step7 核实 `placement.py` 纠正：
> **stage 走 batch**）。以下为最终机制。

**真实路径**（plan step7 核实 `placement.py` + `test_interactive_session_placement.py:223-259`）：
- **scan**（`prepare_scan_interactive_dispatch`，`placement.py:429`）→ `kind='interactive'`
  lease（`placement.py:513` 显式 `'interactive'`）→ daemon `_startInteractiveSession`
  （`daemon.ts:1711`），**不经 TaskRunner.runLease**。interactive 路径当前**无** spec pull/sync
  （grep `daemon.ts` + `interactive/*.ts` 零命中）→ tar 模式 scan 回传**需 task-06 新增接入**。
- **stage（propose/plan/execute）**（`start_stage_dispatch`→`dispatch_to_daemon`，
  `placement.py:163/272`）→ `kind='batch'` lease（INSERT 无 kind 列，DB 默认 batch）→ daemon
  `TaskRunner.runLease` → **现有 `_pullSpecBundle`（步骤1.5）+ `postSpecSync`（步骤8.5）已覆盖**
  （stage lease batch claim payload 不 set specRoot → daemon `existingSpecRoot` 空 → pull 触发）。
  tar 模式 stage 回传靠 task-04/05 utility 抽离（行为等价）+ task-10 prompt 本地路径，
  **无需新 daemon 接入**。

**修正后机制**：
- **scan（interactive）**：tar 模式在 `_startInteractiveSession`（pull，session 开始）+
  `onSessionEnd`（postSpecSync，session 终态）新增 spec 同步（task-06）。
- **stage（batch）**：tar 模式复用现有 `runLease` 步骤1.5/8.5（task-04 抽 utility + task-05
  改调，行为等价）+ task-10 prompt 本地路径。
- 共享 `sillyhub-daemon/src/spec-sync.ts`：`_pullSpecBundle`/`_packSpecDir`/`_resolveSpecDir`
  抽为模块级函数，batch（stage）与 interactive（scan）共用。

transport 开关点（backend 侧）：
1. `build_claim_payload`：**scan 走 interactive 分支**（`lease/context.py:61-117`），tar 模式
   **不透传** spec_root + 透传 `workspace_id`+`transport`（task-03）；**stage 走 batch 分支**
   本就不 set specRoot（现有行为，tar 模式天然触发 daemon pull，无需 task-03 改 batch）。
2. prompt `--spec-root`（`context_builder.py:483` scan / `service.py:1012-1023` stage）：tar
   模式用 daemon 本地路径（task-02 scan / task-10 stage）。

```
              lease kind    daemon 路径              tar 回传依赖
scan      interactive   _startInteractiveSession  task-06 新增 pull+sync
stage     batch         TaskRunner.runLease       task-04/05 现有步骤1.5/8.5（utility 抽离）
shared    (两者)        (各自路径)                无（bind mount 共享）
```

### 5.1 transport=shared（同机，默认，D-004 现状不变）

零改动：interactive 路径现有行为——backend prompt 用宿主路径，daemon `translateSpecRoot`
（SPEC_ROOT_MAP，`daemon.ts:1741-1773`）按需翻译，bind mount 共享，不 pull 不 sync，
backend 读容器路径 reparse。

### 5.2 transport=tar（异机，新增）

```
① interactive claim        backend build_claim_payload: 不透传 spec_root，透传 workspace_id + transport
② _startInteractiveSession daemon 收 transport=tar → spec pull（spec-sync utility）:
                           getSpecBundle(workspace_id) → 解到 ~/.sillyhub/daemon/specs/{ws}（缓存）
                           （首次 scan backend 无 spec → 404 容错 mkdir 空目录，§7.2 E-01）
③ prompt                   --spec-root ~/.sillyhub/daemon/specs/{ws}（daemon 本地约定）
                           SessionManager→ClaudeSdkDriver 跑 scan/stage，文档写本地缓存
④ onSessionEnd             session 终态（scan 所有 step 完成）→ postSpecSync（spec-sync utility）:
                           _packSpecDir 打 tar → POST /spec-workspace/sync
                           daemon ──tar──▶ backend
⑤ backend apply_sync       解 tar → /data/{ws}（权威源）→ reparse 入库
⑥ daemon                   本地缓存保留（D-003），下次 lease 覆盖
```

### 5.3 Wave 分组（daemon 改动因 X-001 扩大）

- **Wave 1（scan 链路打通）**：Layer 1 config + Layer 2 scan prompt 分支 + **Layer 3 抽
  spec-sync 共享 utility + interactive 路径接入（_startInteractiveSession pull + onSessionEnd
  sync）** + Layer 4 apply_sync 复用 + Layer 5 lease 透传 workspace_id/transport + Layer 6
  测试 → scan 端到端。
- **Wave 2（全 spec 写盘链路）**：Layer 2 stage prompt 分支（`start_stage_dispatch` 同走
  interactive，自动复用 Wave1 的 interactive spec 同步）+ 测试。
- **Wave 3（验证 + 文档）**：异机拓扑端到端 + scan 文档同步。

## 6. 文件变更清单

| 操作 | 文件路径 | 说明 |
|---|---|---|
| 修改 | `backend/app/core/config.py` | Settings 加 `spec_transport` 字段（读 `SPEC_DATA_HOST_DIR` 同级 env `SPEC_TRANSPORT`，默认 `shared`，枚举校验，field_validator 规范化） |
| 修改 | `backend/app/modules/agent/context_builder.py` | 新增 helper `resolve_prompt_spec_root(transport, ws_id, settings)`；`build_scan_bundle` 行 467-487 改用 helper（tar 模式返回 daemon 本地路径） |
| 修改 | `backend/app/modules/agent/service.py` | `start_stage_dispatch` 行 1006-1023 的 `platform_args` 同理改用 helper（Wave 2） |
| 修改 | `backend/app/modules/daemon/lease/context.py` | `build_claim_payload` interactive 分支（行 89-116）：tar 模式下**不透传** spec_root/runtime_root（让 daemon `_pullSpecBundle` 触发），但新增透传 `transport`（camelCase + snake_case 双写） |
| 确认/微调 | `backend/app/modules/spec_workspace/router.py` | 确认 `/spec-workspace/sync` 端点（行 117）对 platform-managed + tar workspace 放行（当前主要为 daemon-client 服务） |
| 确认 | `backend/app/modules/spec_workspace/service.py` | `apply_sync`（行 288）**无改动复用**（whole-tree overwrite + reparse，已满足 scan 回传） |
| 新增 | `sillyhub-daemon/src/spec-sync.ts` | 抽出共享 spec 同步 utility：`pullSpecBundle(client, wsId)`、`packSpecDir(specRoot)`、`resolveSpecDir(wsId)`、`postSpecSync(client, wsId, specRoot)`；batch（runLease）与 interactive 复用；内含首次 pull 404 容错（mkdir 空本地目录） |
| 修改 | `sillyhub-daemon/src/task-runner.ts` | `runLease` 改调 spec-sync utility（batch 行为不变，纯重构） |
| 修改 | `sillyhub-daemon/src/daemon.ts` | **`_startInteractiveSession`（:1711）：tar 模式 session 创建后调 `pullSpecBundle`（拉缓存）；`onSessionEnd`（:1164）：tar 模式调 `postSpecSync`（整树回传）；从 claim payload 读 `transport`/`workspace_id`**（X-001 核心改动点） |
| 修改 | `backend/tests/modules/agent/test_context_builder.py` | 修正行 142/162 过时断言（D-006），重写为按 transport 分支断言 |
| 新增 | `backend/tests/modules/agent/test_context_builder.py` | tar 模式 prompt 含 `~/.sillyhub/daemon/specs/{ws}`、shared 模式含宿主路径 |
| 新增 | `backend/tests/modules/daemon/lease/test_context.py`（或现有） | `build_claim_payload` tar 模式不透传 spec_root、透传 transport |
| 新增 | `sillyhub-daemon/tests/` | `postSpecSync` tar 模式触发 + 首次 pull 404 容错测试 |

## 7. 接口定义

### 7.1 backend helper

```python
# backend/app/modules/agent/context_builder.py（新增）
def resolve_prompt_spec_root(
    transport: str, ws_id: str, settings: Settings
) -> str:
    """按 transport 决定塞进 prompt 的 --spec-root 路径。

    - shared: 宿主路径 spec_data_host_dir/{ws}（同机 bind mount，现状）
    - tar:    daemon 本地约定路径 ~/.sillyhub/daemon/specs/{ws}
              （与 daemon _resolveSpecDir 输出一致，tilde 展开）
    """
    if transport == "tar":
        return f"~/.sillyhub/daemon/specs/{ws_id}"
    return f"{settings.spec_data_host_dir}/{ws_id}"
```

### 7.2 build_claim_payload（lease/context.py）interactive 分支改动

interactive 分支（scan/stage 走此分支，行 61-117）：
- **shared 模式**：维持现状（透传 spec_root/runtime_root 容器路径，行 110-116；daemon 走 `translateSpecRoot`）。
- **tar 模式**：
  - **不透传** spec_root/runtime_root（使 daemon 走 pull 分支）。
  - **新增透传 `workspace_id`**（当前 interactive 分支未透传，pull 需 wsId；来源 `lease_meta.workspace_id` 或查 `SpecWorkspace`）。
  - 新增透传 `transport`（camelCase `transportMode` + snake_case `transport`，双写惯例）：
  ```python
  transport = get_settings().spec_transport
  payload["transport"] = transport
  payload["transportMode"] = transport
  if transport == "tar" and ws_id:
      payload["workspaceId"] = str(ws_id)   # pull 需 wsId
      payload["workspace_id"] = str(ws_id)
      # 不 set specRoot/spec_root → daemon 走 pullSpecBundle
  ```
  > E-01（首次 scan pull 404）：tar 模式 backend 尚无 spec bundle 时，daemon
  > `pullSpecBundle` 的 `getSpecBundle` 返回 404 → daemon 容错为「空 spec」，
  > `mkdir -p ~/.sillyhub/daemon/specs/{ws}` 后返回本地路径，保证后续 `postSpecSync` 触发。

### 7.3 daemon 侧改动（spec-sync utility + interactive 接入，X-001 核心）

**新增 `sillyhub-daemon/src/spec-sync.ts`**（模块级 utility，batch + interactive 共用）：
- `resolveSpecDir(wsId)`：`join(homedir(), '.sillyhub', 'daemon', 'specs', wsId)`（迁自 `task-runner.ts:1444`）。
- `pullSpecBundle(client, wsId)`：`getSpecBundle(wsId)` → 404 容错（mkdir 空本地目录）→ 解 tar 到 `resolveSpecDir`；返回本地路径（迁自 `task-runner.ts:1417`）。
- `packSpecDir(specRoot)` + `postSpecSync(client, wsId, specRoot)`：迁自 `_packSpecDir` + `client.postSpecSync`。

**`task-runner.ts` `runLease`**：纯重构改调 utility，batch 行为不变（步骤 1.5/8.5 逻辑等价）。

**`daemon.ts` interactive 接入**（X-001 核心改动点）：
- `_startInteractiveSession`（`:1711`）：读 `execPayload.transport === 'tar'` → session 创建
  后、driver 启动前调 `pullSpecBundle(client, wsId)` 缓存到本地；`wsId` 从 `execPayload.workspaceId` 取。
- `onSessionEnd`（`:1164`）：tar 模式 → 调 `postSpecSync(client, wsId, resolveSpecDir(wsId))`
  整树回传；失败仅 warn 不阻塞 session 终态上报（对齐 batch 步骤 8.5 容错语义，R-03）。

### 7.4 生命周期契约表

本变更涉及 lease / daemon / claim / lifecycle 关键词，契约表如下：

| 事件 | 发起方 | 接收方 | 必需字段 | 状态变化 |
|---|---|---|---|---|
| claim lease | daemon | backend | leaseId, claimToken, agentRunId | pending → running |
| build_claim_payload（tar 模式） | backend | daemon（claim response） | + transport/transportMode + workspaceId（不带 specRoot） | — |
| pull spec bundle（tar 模式 session 开始） | daemon | backend | workspaceId | spec bundle 下发到 daemon 本地缓存（空则 404 容错） |
| run sillyspec scan/stage | daemon | (本地) | --spec-root(本地路径), --workspace-id | 文档写本地缓存 |
| post spec sync（tar 模式 session end） | daemon | backend | workspaceId, tar_bytes | daemon→backend 整树回传（一次性 D-004） |
| apply_sync | backend | (本地) | workspace_id, tar_bytes | spec_root 覆盖 + reparse → ScanDocument 入库 |
| complete lease | daemon | backend | leaseId, output, status | running → completed/failed |

## 8. 数据模型

- **无表结构变更**：transport 走全局 config（`Settings.spec_transport`），不入库（D-002）。
- 复用现有：`SpecWorkspace`（`spec_root` 容器路径权威源、`sync_status` clean/dirty、
  `last_synced_at`）、`ScanDocument`（reparse 产物）。
- `apply_sync` 复用现有字段流转：`sync_status` → clean，`last_synced_at` → now。

## 9. 兼容策略（brownfield）

- **未配置 `SPEC_TRANSPORT` 时**：默认 `shared`，全部走现有逻辑，现有同机部署零影响（D-004）。
- **回退路径**：异机部署出问题时，清空 `SPEC_TRANSPORT`（回退 shared）+ 重新 scan 即可
  （数据可清，N4）。
- **不改变的 API/表**：`/spec-workspace/sync` 端点契约、`apply_sync` 签名、
  `SpecWorkspace`/`ScanDocument` 表结构均不变。
- **shared 模式行为完全不变**：prompt 宿主路径、bind mount 共享、不 pull 不回传。

## 10. 风险登记

| 编号 | 风险 | 等级 | 应对策略 |
|---|---|---|---|
| R-01 | daemon spawn（SessionManager→ClaudeSdkDriver）环境 HOME 不正确 → `~/.sillyhub/...` tilde 展开失败 → sillyspec 写错位置 | P1 | plan 阶段在 `spawn-env.ts` 确认 HOME 设置；若不可靠，daemon 在注入 sillyspec 命令前用 `homedir()` 展开占位符（与 `resolveSpecDir` 一致） |
| R-02 | tar 模式首次 scan backend 无 spec bundle → `getSpecBundle` 404 | P1 | spec-sync `pullSpecBundle` 404 容错：mkdir 空本地目录，返回本地路径，保证回传触发（§7.2 E-01） |
| R-03 | `postSpecSync` 回传失败导致 backend 缺文件 | P1 | interactive 路径 `onSessionEnd` 调 sync 失败仅 warn 不阻塞 session 终态上报（对齐 batch `task-runner.ts:488-490` 容错语义）；backend `sync_status=dirty` 标记，UI 提示重试 |
| R-04 | 全局 transport 不能混部同机+异机 daemon | P2 | 已知约束（D-002），非目标 N1；未来需 per-daemon transport 才能混部 |
| R-05 | `/spec-workspace/sync` 端点当前可能限制为 daemon-client，platform-managed + tar 需放行 | P1 | Layer 4 确认端点放行；plan 阶段核实 router.py:117 权限/策略 |
| R-06 | tilde 路径在 prompt 里对 LLM 的可读性/可复制性 | P2 | prompt 注释「daemon 本地路径，tilde 由 daemon 展开」；与现有命令模板风格一致 |
| R-07 | interactive 路径 pull/sync 与 SessionManager 生命周期时序：pull 须在 driver 启动前完成、sync 须在 session 真正结束后 | P1 | pull 在 `_startInteractiveSession` session 创建后同步 `await`；sync 在 `onSessionEnd` 终态回调内执行；plan 阶段写时序测试 |

## 11. 决策追踪

当前版本决策（详见 `decisions.md`）：

| 决策 ID | 标题 | 覆盖章节 | 状态 |
|---|---|---|---|
| D-001@v1 | transport 正交于 strategy，走全局 config 不入库 | §5.0, §8, §9 | accepted |
| D-002@v1 | transport 全局环境变量 `SPEC_TRANSPORT=shared\|tar` | §5.0, §6(config), §9 | accepted |
| D-003@v1 | tar 模式双向同步（回传 + 按需拉取） | §5.2, §7.4 | accepted |
| D-004@v1 | shared 模式保持现状（向后兼容） | §5.1, §9 | accepted |
| D-005@v1 | 数据可清不做迁移 | §3 N4, §9 | accepted |
| D-006@v1 | test_context_builder 行 142/162 过时断言随重写 | §6, R/tech-debt | accepted |
| D-007@v1 | scan/stage 走 interactive，spec 同步在 interactive 路径 + 抽 spec-sync utility（Design Grill X-001 修正初稿 task-runner 假设） | §5.0, §7.3, §13 | accepted（stage 表述被 D-008 精细化） |
| D-008@v1 | stage 走 batch lease（非 interactive），scan/stage 分流；task-06=scan only，stage 走 task-04/05 batch（plan step7 task-11 修正 X-001 的 stage 表述） | §5.0, §13 | accepted |

未解决剩余风险：R-04（混部约束）为已知非目标，不阻塞本次。

## 12. 自审

- ✅ **需求覆盖**：G1（异机回传）、G2（backend 独占）、G3（shared 零影响）、G4（复用通道）、G5（全局开关）均被 §5/§7 覆盖。
- ✅ **Grill 覆盖**：D-001~D-006 全部在 §11 引用并映射到章节。
- ✅ **约束一致性**：与 ARCHITECTURE.md（方案 B bind mount 描述）、CONVENTIONS.md 一致；shared 模式不破坏现有约定。
- ✅ **真实性**：所有文件名/类名/方法名/行号来自真实代码核实（context_builder.py、service.py、lease/context.py、spec_workspace/service.py、task-runner.ts）。
- ✅ **YAGNI**：无非目标外功能；不引入增量回传（N2）、不引入 RPC（N5）、不做迁移（N4）。
- ✅ **验收标准**：§7.4 契约表每个事件可测；端到端 `SPEC_TRANSPORT=tar` scan 文件落 backend `/data/{ws}` 可验证。
- ✅ **非目标清晰**：§3 明确 N1-N5。
- ✅ **兼容策略**：§9 给出 shared 默认、回退路径、不变 API。
- ✅ **风险识别**：§10 识别 R-01~R-06 含对策。
- ✅ **生命周期契约表**：§7.4 完整，每个事件有必需字段，字段出现在接口定义（§7.1-7.3）。

**自审结论：通过**（自审未发现 X-001，由 step 12 Design Grill 交叉审查发现并修正，见 §13）。

## 13. Design Grill 交叉审查记录（step 12）

### Cross-Check Matrix

| ID | 层级 | 交叉点 | 证据 A | 证据 B | 结论 | 决策 |
|---|---|---|---|---|---|---|
| X-001 | feasibility | design 初稿 §5.0「scan 复用 task-runner 双通道」vs 真实 lease 分流 | design 初稿 §5.0 | `placement.py:341/504`（scan/stage `kind=interactive`）+ `daemon.ts:1701-1702`（interactive 不调 runLease）+ grep interactive 路径零命中 pull/sync | **conflict**（初稿机制不成立） | 已修正 §5.0/5.2/5.3/§6/§7.3/7.4/§10，新增 D-007@v1 |
| X-002 | feasibility | R-02 首次 scan pull 404 容错 | §7.2 E-01 | `task-runner.ts:1428` @throws HubHttpError | 一致，迁入 spec-sync utility | R-02 保留 |
| X-003 | feasibility | tilde/HOME 展开（R-01） | §5.0/§7.1 prompt tilde | `daemon.ts:1775` cwd=rootPath + spawn-env | 一致，需确认 SessionManager spawn HOME | R-01 保留 |
| X-004 | consistency | build_claim_payload interactive 分支未透传 workspace_id | §7.2 新增透传 | `lease/context.py:61-117`（interactive 分支无 workspace_id） | **gap**（pull 需 wsId） | §7.2 已补 workspace_id 透传 |
| X-005 | feasibility | design §5.0（X-001 后）「stage 走 interactive」vs 真实 lease 分流 | design §5.0 | `placement.py:272`（stage INSERT 无 kind→DB 默认 batch）+ `test_interactive_session_placement.py:223-259`（TestBatchDispatchUnchanged） | **conflict**（stage 实际 batch） | 已修正 §5.0（scan interactive / stage batch），新增 D-008@v1，task-06 收窄 scan only、stage 走 task-04/05 batch |

### Question Distribution

| 分类 | 数量 | 含义 |
|---|---|---|
| immediately_answered | 5（X-001~X-005） | 代码可确定，已直接修正 design |
| needs_thinking | 0 | 无需业务判断 |
| unresolved | 0 | 无未决 blocker |

### Unresolved Blockers

无 P0/P1 unresolved blocker。X-001 已修正（§5.0/§7.3 重写），X-002~X-004 已在 design 内解决，X-005（plan step7 task-11 发现 stage 走 batch）已修正 §5.0 + D-008@v1。

**Design Grill 结论：passed（X-001/X-005 两轮事实修正，0 unresolved）**。
