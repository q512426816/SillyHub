---
author: qinyi
created_at: 2026-07-02 09:52:30
---

# Design — 2026-07-02-workspace-config-flow（工作区配置流程重设计）

## 1. 背景与动机

用户（项目 owner）提出工作区配置流程的整套重设计逻辑链：
1. 客户端路径（每人本地代码检出路径）要能改，不是首次填完就冻结。
2. 一个工作区只要有人扫过，结果大家共用，后来的人不重复扫。
3. 「初始化」按钮只干一件事：把平台配置写进新用户自己的项目目录（`.sillyspec-platform.json`），告诉客户端 daemon「这项目归哪个工作区、文档去哪拉」。
4. 流程：初始化（领配置）→ 扫描（第一个人）→ 文档自动同步到服务器 → 工作区就绪。新成员加入只需「初始化」即可拉到现成文档。
5. 文档：服务器=权威版，客户端=缓存（agent 跑在客户端，本地必须有文档）。双向同步，文档可能大，策略要想清楚。

当前实现存在 6 处缺口（详见 §4），且有两份已落地变更打了底子（per-member 表、tar 整树同步通道 + strategy 三值），但「持续双向同步」与「per-member 接线」被显式留作后续。本变更即接这个茬。

## 2. 目标

- 建立清晰的「初始化 → 扫描 → 文档同步」流程，每个状态对用户有明确引导。
- 接线已落地的 `WorkspaceMemberRuntime` 表，让 scan/dispatch 按 actor 路由，真正实现 per-member 协作。
- 初始化按钮语义统一为「下发平台配置 + 拉文档缓存」。
- 扫描结果工作区共享，已有扫描时对后来者引导而非重复扫。
- 文档以服务器为权威、客户端为缓存，双向同步，整包策略先落地（YAGNI）。

## 3. 非目标（显式边界）

- **不做增量 manifest 同步**（D-001）：整包够用再说，留 spec_version 扩展点。
- **不改 tar transport 整树覆写语义**（D-008）：build_bundle/apply_sync/postSpecSync 的 whole-tree overwrite 保留。
- **不做 server-local 的 strategy 选项**：沿用 daemon-client-spec-sync-strategy 的 D-003 边界。
- **init 重定义仅针对 daemon-client workspace**：server-local workspace 的「初始化」保持现有 `bootstrapSpecWorkspace` 行为（文档直接落服务器路径，无需 daemon pull）。本次 init lease / `.sillyspec-platform.json` 下发流程只对 daemon-client 生效。
- **不做扫描过期**（D-004）：count>0 即视为已扫，不按时间失效。
- **不改 sillyspec CLI 的 `--spec-root` 语义 / daemon 缓存路径**。
- **不做 strategy 运行时切换**：创建时定死（沿用既有约束）。

## 4. 现状（已有底子 + 缺口）

**已有底子：**
- `WorkspaceMemberRuntime`（per-member runtime+root_path+path_source，复合主键 workspace_id+user_id）+ `MemberBindingResolver` + REST `GET|PUT /api/workspaces/{id}/my-binding` 已落地（commit e2f65d9a）。
- 文档同步通道：tar 整树 HTTP 双向——`GET /spec-workspace/bundle`（pull，排除 .runtime）/ `POST /spec-workspace/sync`（push，含 .runtime，apply_sync 整树覆盖）。push 落盘有文件级 sha256+mtime 去重 + `ScanDocConflictService` 冲突归档。
- `spec_workspaces.strategy` 三值（platform-managed / repo-mirrored / repo-native）已实现（daemon-client-spec-sync-strategy，commit f11e1770）。
- daemon 端 `spec-sync.ts`：`pullSpecBundle` / `postSpecSync` / `packSpecDir`（支持剪枝）。
- 扫描产物（scan-docs + spec_root）本就是 workspace 级共享一份。

**缺口（本变更补）：**
1. 客户端路径首次填完无前端编辑入口（WorkspaceAccessGuide 仅 unbound 渲染；WorkspacePathFields 纯只读）。
2. 无「工作区已扫过」门禁，谁都能点扫描。
3. 现有「初始化」按钮（page.tsx:479-491）干的是服务器端建 spec 容器，不是往客户端写配置文件；`.sillyspec-platform.json` 运行时代码完全不存在。
4. per-member 表未接线 scan/dispatch（`start_scan_dispatch` 仍按 user_id + workspace 全局 daemon_runtime_id）。
5. 新成员「初始化 → 自动 pull 服务器文档到本地缓存」路径不存在。
6. 扫描 placement 不支持 workspace 维度路由（按 user_id）。

## 5. 整体架构（方案 A：任务驱动）

```
新成员加入 ──▶ [未初始化]
                  │ 点「初始化」（详情页）
                  ▼
          backend: 建容器(自动) + 派 init lease（带 platform_config + latest_spec_version）
                  │ daemon poll 拉到 init lease
                  ▼
          daemon: 写 .sillyspec-platform.json → pullSpecBundle（拉文档缓存）→ postSpecSync（回灌本地改动）
                  │ init lease complete
                  ▼
          [已初始化] ── 服务器无文档？ ──▶ 提示「请先扫描」
                  │                         │
                  │ 有文档（已扫过）         │ 任一成员点「扫描」
                  ▼                         ▼
          [就绪] ◀── 拉文档缓存 ◀── scan_generate → 文档落服务器（权威）
                  │
          日常保鲜：每次 agent/scan 任务前比对 latest_spec_version，旧了 pull
```

驱动机制：**全部走 lease**（init lease + scan lease + agent lease），daemon poll 拉取执行。复用现有 lease 全链路，不引入心跳契约变更。

## 6. 数据模型

**复用（无新表）：**
- `WorkspaceMemberRuntime`（workspace_id, user_id, runtime_id, root_path, path_source, synced_at, last_scan_at）。
- `SpecWorkspace`（workspace_id, strategy, spec_root, sync_status, last_synced_at）。
- `ScanDocument`（workspace_id, content_hash, source_mtime, source_synced_at, source_member_id, source_runtime_id）。

**新增字段（需 Alembic migration，唯一一处 schema 变更）：**
- `SpecWorkspace.spec_version: int NOT NULL DEFAULT 0` —— 每次 scan_generate 成功 / postSpecSync 落盘后 +1。作为客户端缓存保鲜比对值（D-010）。⚠️ plan 阶段核实是否复用现有 `profile_version` 字段（若语义重合则复用，避免双字段）。
- `WorkspaceMemberRuntime.init_synced_at: datetime NULL` + `init_synced_spec_version: int NULL` —— 记录该成员上次初始化时间与拉到的文档版本，供前端状态判断（已初始化/未初始化/版本落后）。⚠️ 标注新增字段。

**废弃（保留只读，不删）：**
- `Workspace.daemon_runtime_id` / `Workspace.root_path` / `Workspace.path_source` 全局列（member_runtimes/model.py:1-8 已声明 deprecated read-only）。dispatch 不再读，仅作向后兼容展示。

## 7. `.sillyspec-platform.json` 定义

写到成员本地 `rootPath/.sillyspec-platform.json`（daemon 写，gitignore 已有该条目）。schema：

```json
{
  "workspace_id": "uuid",
  "server_origin": "https://platform.example.com",
  "strategy": "platform-managed",
  "spec_version": 3,
  "cache_root": "/Users/you/.sillyhub/daemon/specs/<workspace_id>",
  "synced_at": "2026-07-02T09:52:30Z"
}
```

字段说明：
- `workspace_id`：该本地项目归属的工作区。
- `server_origin`：平台地址（daemon pull/push 用）。
- `strategy`：spec 同步策略三值之一（D-001/沿用）。
- `spec_version`：本地缓存对应的文档版本（D-010 保鲜比对）。
- `cache_root`：daemon 本地 spec 缓存路径（`~/.sillyhub/daemon/specs/<ws>`）。
- `synced_at`：上次同步时间。

## 8. Phase 分解（W1-W4）

### W1｜per-member 接线 + 客户端路径可编辑（低风险）
- **backend**：`RunPlacementService._resolve_dispatch_runtime` / `_resolve_decide_runtime`（agent/placement.py:602-804）+ `AgentService.start_scan_dispatch`（agent/service.py:1246）改用 `MemberBindingResolver.resolve_member_binding(workspace_id, actor_user_id)` 取 runtime_id + root_path，废弃读 `Workspace.daemon_runtime_id`。
- **frontend**：详情页加「编辑我的接入配置」入口（`WorkspaceAccessGuide` 形态改为同时支持首次绑定 + 已绑定编辑，回填当前 binding 值）；`WorkspaceBindingGuard` 不再只 unbound 渲染，已绑定时在详情页规范管理区提供编辑入口。`WorkspaceDaemonSwitcher`（现改 workspace 全局 daemon_runtime_id）改为改 per-member runtime_id（D-011），与编辑入口统一，避免改废弃全局列。
- 数据：无 migration（复用表）。

### W2｜初始化重定义 + 扫描门禁
- **backend**：
  - 新增 `start_init_dispatch(workspace_id, actor_user_id)`（仿 `start_scan_dispatch`），建 init-mode interactive lease，payload 带 `platform_config`（含 server_origin/strategy）+ `latest_spec_version`（SpecWorkspace.spec_version）。
  - `bootstrapSpecWorkspace` 建容器逻辑作为 init dispatch 前置自动步骤（`_ensure_spec_workspace`），不再单占按钮。
  - `scan_generate` 入口加门禁（D-003@V2）：校验 actor 是否该 workspace owner，非 owner → 403 + 「仅 owner 可扫描」提示；owner 扫描时查 `scan_documents` count（按 workspace_id），>0 且无 `force=true` → 返回 409 + 重扫确认。
- **daemon**：task-runner/interactive 路径处理 init lease → 写 `.sillyspec-platform.json` 到 rootPath → `pullSpecBundle`（复用）→ `postSpecSync`（若本地有改动）→ lease complete 上报 `init_synced_at`/`init_synced_spec_version`。
- **frontend**：「初始化」按钮改调 init dispatch + 轮询结果；扫描按钮对非 owner 禁用/隐藏并提示「仅 owner 可扫描，你只需初始化拉文档」；owner 点击遇 409 弹「已扫过，是否重扫」确认。

### W3｜文档持续双向缓存同步（最高风险，独立 Wave）
- **backend**：所有 lease payload 增加 `latest_spec_version` 字段（scan/agent/init lease 统一）；SpecWorkspace.spec_version 在 scan_generate 成功 / apply_sync 落盘后递增。
- **daemon**：
  - 保鲜（D-010）：每次执行 agent/scan 任务前，比对 lease 的 `latest_spec_version` 与本地 `.sillyspec-platform.json.spec_version`；不一致触发 `pullSpecBundle`。
  - 冲突保护（D-008）：`pullSpecBundle` 前检查本地是否有未回灌改动（postSpecSync 失败标记 `.runtime/pending_push` 或本地 mtime 新于 `synced_at`）→ 先 `postSpecSync` 再 pull。
  - 手动同步（D-012）：复用 DaemonChangeWrite outbox（kind=spec-sync，与 change-detail-file-tree-editor 共享基础设施），daemon 拉到后调 `postSpecSync`（整树 push）回灌本地手改到服务器；覆盖 agent 任务之外的主动修改。path_source 分流（server-local 直接收 / daemon-client outbox）。
- 传输层不动（整包 tar）。

### W4｜前端流程整合 + 三端测试
- 详情页流程引导：未初始化→「初始化」按钮；已初始化·未扫描→提示「请先扫描」；已扫描→就绪态。
- 扫描按钮已有文档时弹确认（W2）。
- 客户端路径/daemon per-member 可编辑（W1）。
- 就绪态加「同步到服务器」手动按钮（D-012，触发 sync lease → daemon postSpecSync 回灌本地手改）。
- 测试：backend（placement 用 member binding、init dispatch、扫描门禁 409、spec_version 递增）+ daemon（init lease 处理、platform.json 写入、版本检查保鲜、pull 前 push）+ frontend（三态引导、编辑入口、门禁弹窗）。

## 9. 生命周期契约表（init lease）

涉及 lease/claim/heartbeat 关键词，定义 init lease 完整生命周期：

| 事件 | 触发 | 必需字段 | 处理方 | 备注 |
|---|---|---|---|---|
| `init_lease_created` | 用户点「初始化」 | lease_id, workspace_id, actor_user_id, runtime_id, root_path, mode="init", platform_config{server_origin,strategy}, latest_spec_version | backend | 建容器(_ensure_spec_workspace) 后派发；root_path 取自该成员 WorkspaceMemberRuntime 行，daemon 据此定位用户项目目录写 .sillyspec-platform.json |
| `daemon_pulled` | daemon poll 拉到 | lease_id, claim_token | daemon→backend heartbeat | 复用现有 lease claim |
| `init_started` | daemon 开始处理 | lease_id, started_at | daemon | 写 .sillyspec-platform.json 前 |
| `config_written` | platform.json 落盘 | lease_id, root_path, written_at | daemon | 写入 rootPath/.sillyspec-platform.json |
| `bundle_pulled` | pullSpecBundle 完成 | lease_id, spec_version, file_count | daemon | 复用现有 pull |
| `local_pushed` | postSpecSync 完成（若有本地改动）| lease_id, push_result | daemon | 可选，无本地改动则跳过 |
| `init_completed` | 全部完成 | lease_id, completed_at, init_synced_spec_version | daemon→backend | backend 更新 WorkspaceMemberRuntime.init_synced_at/init_synced_spec_version |
| `init_failed` | 任一步失败 | lease_id, failed_at, error_code, error_step | daemon→backend | lease 终态 failed，前端展示错误 |

DTO/interface 落点：lease payload schema（backend `daemon/lease/` 或 `agent/service.start_init_dispatch`）；daemon 处理（`task-runner.ts` / `interactive/` + `spec-sync.ts`）；状态回写（`WorkspaceMemberRuntime` 字段更新）。

## 10. 验收标准（可测试）

- **W1**：
  - 两个成员各自绑定不同 daemon + 路径，A 发起 scan，dispatch 用 A 的 binding 路由（不读 workspace 全局 daemon_runtime_id）——集成测试覆盖。
  - 已绑定成员在详情页能改自己的 root_path/runtime_id，保存后 `PUT /my-binding` 写入，后续 dispatch 用新值。
- **W2**：
  - 点「初始化」→ init lease 创建 → daemon 写 `.sillyspec-platform.json`（内容含 workspace_id/server_origin/strategy/spec_version）→ pullSpecBundle → complete；`WorkspaceMemberRuntime.init_synced_at` 被更新。
  - 非 owner 点「扫描」→ 403 + 「仅 owner 可扫描」提示；owner 点扫描且工作区已有 scan_documents → 409 + 提示，确认后 force=true 重扫成功。
  - 服务器无文档时初始化完成 → 前端提示「请先扫描」（不自动扫）。
- **W3**：
  - A 重扫后 SpecWorkspace.spec_version 递增；B 下次任务前比对到版本落后 → 自动 pullSpecBundle。
  - daemon 本地有未回灌改动时 pull 前 postSpecSync 回灌（单测 mock 未回灌标记）。
- **W4**：三端测试全绿；详情页三态引导正确渲染。

## 11. 风险与对策

| 风险 | 对策 |
|---|---|
| init lease 沿用 scan lease 通道，但 scan lease 当前按 user_id 路由（D-006 接线前提） | W1 先完成 per-member 接线，W2 init dispatch 建立在 W1 之上 |
| 整包同步大文档时内存/带宽（build_bundle 全量 buffer） | 短期接受（D-001 YAGNI）；spec_version 扩展点为后续增量预留 |
| pull 前回灌失败导致本地改动丢 | D-008 回灌失败则 abort pull + lease failed，不强行覆盖 |
| `Workspace.daemon_runtime_id` 废弃后旧代码路径残留读 | W1 grep 全部 dispatch 路径改完；保留列只读不删避免迁移风险 |
| daemon-client lease-polling 延迟（初始化非即时） | 接受（daemon poll 间隔秒级）；前端轮询 init lease 状态展示进度 |
| 交叉依赖 change-detail-file-tree-editor（kind 字段 migration） | D-012 复用 DaemonChangeWrite outbox 依赖该变更 `kind` 字段先合；两变更并行执行，plan 排 migration 依赖顺序（本变更 down_revision 接合入后的真实 head），避免双 head crash-loop |

## 12. 兼容策略 / 回退（brownfield）

- 默认零回归：不传 force、未初始化的成员，行为与现状一致（platform-managed 空 spec_root 等 scan）。
- `Workspace.daemon_runtime_id`/`root_path`/`path_source` 全局列保留只读，旧 binding（无 WorkspaceMemberRuntime 行）回退读全局列，直到该成员首次初始化/编辑后写 per-member 行。
- SpecWorkspace.spec_version 缺失（旧数据）默认 0，首次 scan 后递增，不影响现有工作区。
- 回退路径：W1-W4 按 Wave 独立上线；任一 Wave 出问题可单独 revert（W1 改 dispatch 是核心，回退后恢复读全局列）。

## 13. 引用决策

本 design 覆盖 decisions.md 当前版本全部决策：D-001@V1 ~ D-011@V1。

## 14. 文件变更清单

### backend
- `app/modules/agent/placement.py` — `_resolve_dispatch_runtime` / `_resolve_decide_runtime` 改用 `MemberBindingResolver`（D-006）
- `app/modules/agent/service.py` — `start_scan_dispatch` 接线 member binding + 新增 `start_init_dispatch`（D-006/D-009）
- `app/modules/workspace/service.py` — `scan_generate` owner 校验（D-003@V2）+ count 门禁（D-004）
- `app/modules/workspace/member_runtimes/{model,service}.py` — 新增 `init_synced_at` / `init_synced_spec_version` 字段 + 更新逻辑
- `app/modules/spec_workspace/service.py` — `spec_version` 递增（scan 成功 / apply_sync 落盘）+ `bootstrapSpecWorkspace` 作为 init dispatch 前置自动化
- `app/modules/spec_workspace/model.py` — `spec_version` 字段（plan 核实复用 `profile_version`）
- `app/modules/scan_docs/service.py` — count 查询（已有，门禁复用）
- `migrations/versions/` — 新增 Alembic migration（spec_version + init_synced 字段）

### sillyhub-daemon
- `src/spec-sync.ts` — `pullSpecBundle` 前检查未回灌改动 + 版本比对保鲜（D-008/D-010）
- `src/task-runner.ts` / `src/interactive/` — init lease 处理：写 `.sillyspec-platform.json` + pull + postSpecSync（D-009）
- 新增 `.sillyspec-platform.json` schema 读写工具

### frontend
- `src/app/(dashboard)/workspaces/[id]/page.tsx` — 初始化按钮改 init dispatch + 扫描门禁 409 弹窗 + 三态引导
- `src/components/workspace-access-guide.tsx` — 支持已绑定编辑（回填当前值）
- `src/components/workspace-binding-guard.tsx` — 已绑定时提供编辑入口
- `src/components/workspace-daemon-switcher.tsx` — `handleSwitch` 改 `upsertMyBinding({runtime_id})`（D-011）
- `src/lib/workspace-binding.ts` — 新增 init dispatch + 轮询 API
- `src/lib/spec-workspace.ts`（或新文件）— init lease 状态查询

## 15. 自审

| 自审项 | 结果 |
|---|---|
| 需求覆盖 | ✓ 用户逻辑链 5 点全覆盖 |
| Grill 覆盖 | ✓ D-001~D-011 当前版本（D-003@V2 已 supersede V1）全部引用 |
| 约束一致性 | ✓ 与 CONVENTIONS.md（中文 UI / Alembic / tar 同步）一致 |
| 真实性 | ✓ 表名/字段名/方法名（WorkspaceMemberRuntime / SpecWorkspace / scan_documents / build_bundle / apply_sync / pullSpecBundle / start_scan_dispatch / MemberBindingResolver）调研确认；新增字段标注"新增 + plan 待核实" |
| YAGNI | ✓ 整包同步不做增量（D-001）；非目标 §3 列 6 条 |
| 验收标准 | ✓ §10 每 Wave 可测试条件 |
| 非目标清晰 | ✓ §3 |
| 兼容策略 | ✓ §12 回退路径（默认零回归、旧 binding 回退读全局列） |
| 风险识别 | ✓ §11 |
| 生命周期契约 | ✓ §9 init lease 8 事件 + 必需字段 + DTO 落点 |
