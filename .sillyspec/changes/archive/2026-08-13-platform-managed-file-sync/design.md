---
author: qinyi
created_at: 2026-08-13 14:43:03
scale: large
tier: independent
risk_level: unit-sufficient
---

# 设计文档（Design）— 平台管理 spec 文件增量同步

> change: `2026-08-13-platform-managed-file-sync`
> 模块：`sillyhub-daemon`（spec-sync/hub-client）+ `backend spec_workspace` + `backend scan_docs`
> 决策台账：见 `decisions.md`（D-001@v1 ~ D-011@v1）
> 修订：Design Grill 首轮 fail（BL-1~BL-4）→ 本版已按审查收敛建议修订

## 1. 背景

现状 spec 文件同步（daemon spec-sync）把整个 specDir 打包成 tar 全量覆盖服务器 spec_root（`spec_workspace/router.py:225-230` "no diff/merge, whole tree overwritten"）。问题（Spike 实证 + 用户确认）：

- **量太大**：每次推送全量整树（含 .runtime/，纯负担），多文件/大目录（worktrees 可达 GB）时量大。
- **无并发保护**：多用户/设备同 workspace 各自推，后推整树覆盖前推，静默丢（用户明确场景）。
- **无变化识别**：文件没变也全量重传；路径变化（rename）靠整树+旧文件保留掩盖。
- **删除不传播 + 无备份**：现状删除从不传播（`:586` preserve non-tar），要支持同步删除但**服务器不能真删，要留备份**（用户要求）。

用户明确要**平台管理文件**：服务器权威清单 + 增量推送 + 并发保护 + 软删除备份。

Design Grill 首轮发现并已修订的问题：
- BL-1：复用 `scan_documents` 会被 scan_docs reparse（只认 docs/，`:199-203`）翻转非 docs 行 → **弃用，新建独立 `spec_file_manifest` 表**。
- BL-2：`.trash/` 放 spec_root 内会被 `build_bundle` 拉回 daemon 形成 churn → **备份区移出 spec_root**。
- BL-3：软删 move-vs-copy 措辞矛盾 + change reparse 硬删 Change 行丢状态 → **软删明确为 move，apply_ops 定义 exists 语义**。
- BL-4：本地清单缓存放 `.runtime/` 被 pull 的 rm -rf 清掉 → **缓存移出 specDir**。

## 2. 设计目标

- **G1**：文件同步从"整树 tar 全量"改为"文件级增量"——只推变化（新增/修改/删除/rename）。
- **G2**：多写者并发保护——base_version 乐观锁，过期推 409 拒 + 人工拍板。
- **G3**：删除留备份（软删除）——服务器不物理删 spec_root 有效文件，移备份区可找回。
- **G4**：rename 显式 op——路径变化识别为 rename，旧 hash 相同不重传内容。
- **G5**：兼容——旧 tar 端点保留（首同步/回退），旧客户端仍可用。

## 3. 非目标

- **NG-01**：不做自动合并（只 409 拒绝 + 人工拍板，D-001）。
- **NG-02**：不做逐文件内容 diff 合并。
- **NG-03**：不做 `.runtime/` / `sillyspec.db` 增量同步（D-006，纯负担，移出范围）。
- **NG-04**：不改 pull 侧（服务器→daemon 仍整树 tar，`build_bundle` 不动）。
- **NG-05**：不改首同步（`get_spec_bundle` import 仍整树）。
- **NG-06**：不做文件历史版本查询 UI（本次只做存储侧软删除备份，查询/恢复 UI 另立）。
- **NG-07**：不改 `change-center-rework` 的列表/进度投影（独立 change，已归档）。

## 4. 拆分判断

单一 change，不拆分、不走批量。理由：所有改动围绕"spec 文件增量同步协议"这一内聚主题（后端端点 + daemon 客户端 + 独立清单 schema），虽跨 daemon/backend 两子项目但范围明确、无 3+ 独立可交付模块、无多角色权限视图。

## 5. 总体方案

分 4 个 Phase（execute 阶段映射为 Wave）：

### Phase 1 · 后端：独立清单表 + 增量端点（方案 A 修订）
- **新建 `spec_file_manifest` 表**（非 scan_documents，避 BL-1）：`path`（ux workspace_id+path）+ `content_hash`(SHA-256) + `version`(int) + `exists`(bool) + `updated_at`。**这是增量清单唯一权威**，独立于 scan_docs 的 docs 扫描。
- 新端点 `POST /spec-workspace/sync-incremental`：JSON ops（add/update/delete/rename + 每文件 path/hash/base_version/content），**比对 base_version，过期返 conflict=true + 服务器当前版本**（HTTP 200 body 带 conflict，daemon 侧据字段提示人工拍板；D-001）。
- **delete = 软删除（move）**：文件移出 spec_root（备份区，见下），`spec_file_manifest.exists=false` + 更新 version（D-002/D-008）。**apply_ops 定义 exists=false 语义**：仅增量端点写 spec_file_manifest，scan_docs reparse 不碰此表 → 无"真删 vs 陈旧"歧义（BL-1 解）。
- **rename op**：移动文件 + 更新清单 path（D-005）。
- `.runtime/` 过滤：增量 ops 不接受 `.runtime/*`（D-006）。
- **旧 tar 端点保留**（首同步/回退）。**旧 tar 全量 push 后：失效/重置 spec_file_manifest 全表 version + 强制下一次增量全量重算**（审查建议 5，解决旧 tar 版本漂移 Q7）。
- **软删备份区移出 spec_root**（BL-2 解）：备份到 `spec_root` 之外的独立目录（如 `<workspace 数据根>/spec-backups/<timestamp>/<path>`），避免 build_bundle 拉回。

### Phase 2 · daemon：diff 客户端
- `postSpecSync` 内部改增量 diff（本地逐文件 hash → 与服务器清单 diff → 只发变化 ops）。
- **本地清单缓存移出 specDir**（BL-4 解）：如 `~/.sillyhub/daemon/manifests/<ws>.json`，避免被 pull 的 rm -rf specDir 清掉。
- 首同步仍走旧 tar 端点（全量），之后走增量；增量不可用回退旧 tar。
- `hub-client.ts` 加 `postSpecSyncIncremental`（JSON payload）。各调用点走薄封装，接口签名不变则调用点零改动。

### Phase 3 · 兼容与回退
- 旧 tar 端点保留，旧客户端/旧 daemon 仍可用。
- 旧 tar push 后失效文件级 version（见 Phase 1）。
- 单成员快速路径。

### Phase 4 · 验收
- 后端 pytest：增量端点（各 op/base_version 409/软删 move/.runtime 拒/旧 tar 失效 version）。
- daemon 测试：diff 客户端（本地 hash → 变化 ops；缓存位置）。
- migration：spec_file_manifest 建表。

## 6. 文件变更清单

| 操作 | 文件路径 | 说明 |
|---|---|---|
| 新增 | `backend/app/modules/spec_workspace/model.py`（新增 `SpecFileManifest` 表） | `path` + `content_hash`(SHA-256) + `version`(int) + `exists`(bool)。**数据流**：producer=增量端点 apply_ops 写 → spec_file_manifest 存储 → consumer=同步端点读作 base_version 基准；scan_docs reparse 不碰此表（独立，避 BL-1）。**模型文件锁定 spec_workspace/model.py**（D-011 独立表，spec_workspace 是增量同步唯一写者；scan_docs 模块职责=docs 扫描，零改动） |
| 新增 | migration：`spec_file_manifest` 建表 | ux(workspace_id+path)、index(version) |
| 修改 | `backend/app/modules/spec_workspace/router.py` | 新增 `POST /spec-workspace/sync-incremental`（JSON ops + base_version，过期返 conflict=true + server_versions，HTTP 200）。**数据流**：producer=daemon 增量 payload → router 解析 ops → service.apply_ops → 写 spec_root + spec_file_manifest → 返回 new_versions |
| 修改 | `backend/app/modules/spec_workspace/service.py` | 新增 `apply_ops`（add/update/delete/rename + 软删 move 出 spec_root + base_version 校验 + .runtime 拒）；软删备份到 spec_root 外目录；旧 tar push 后失效 spec_file_manifest 全表 version |
| 修改 | `backend/app/modules/spec_workspace/schema.py` | 增量请求/响应 DTO（ops + base_version + new_versions + conflict） |
| 新增 | `backend/app/modules/spec_workspace/tests/test_sync_incremental.py` | 增量端点测试 |
| 修改 | `sillyhub-daemon/src/spec-sync.ts` | `postSpecSync` 内部改增量 diff；本地清单缓存移出 specDir（`~/.sillyhub/daemon/manifests/`） |
| 修改 | `sillyhub-daemon/src/hub-client.ts` | 新增 `postSpecSyncIncremental`（JSON payload） |
| 新增/修改 | `sillyhub-daemon/tests/` | diff 客户端测试 |

## 7. 接口定义

### 后端：增量同步端点

```python
# router.py
@router.post("/spec-workspace/sync-incremental", response_model=SpecIncrementalSyncResponse)
async def sync_spec_workspace_incremental(
    workspace_id: uuid.UUID,
    session: SessionDep,
    _user: Annotated[User, Depends(require_permission(Permission.WORKSPACE_WRITE))],
    payload: SpecIncrementalSyncRequest,
) -> SpecIncrementalSyncResponse:
    """接收 daemon 增量 ops，apply 到 spec_root。base_version 过期返 conflict=true + server_versions（HTTP 200，daemon 侧提示人工拍板）。
    返回 {ok, new_versions, conflict}。"""

# schema.py
class FileOp(BaseModel):
    op: Literal["add", "update", "delete", "rename"]
    path: str
    new_path: str | None = None   # rename 用
    hash: str | None = None        # SHA-256
    content: str | None = None     # base64，add/update 用；rename 且 hash 相同可不传
    base_version: int              # 该文件本地基于的版本

class SpecIncrementalSyncRequest(BaseModel):
    ops: list[FileOp]

class SpecIncrementalSyncResponse(BaseModel):
    ok: bool
    new_versions: dict[str, int]       # path -> 新版本号
    conflict: bool = False
    server_versions: dict[str, int] | None = None  # 冲突时返回服务器当前版本
```

### 后端：SpecFileManifest 表

```python
# spec_workspace/model.py（或 scan_docs/model.py）
class SpecFileManifest(BaseModel, table=True):
    __tablename__ = "spec_file_manifest"
    id: uuid.UUID
    workspace_id: uuid.UUID
    path: str                       # 相对 spec_root
    content_hash: str               # SHA-256
    version: int                    # 文件级版本号（乐观锁基准）
    exists: bool = True             # 软删语义：增量端点唯一写者
    updated_at: datetime
    __table_args__ = (Index("ux_spec_manifest_ws_path", "workspace_id", "path", unique=True),)
```

### 路径安全校验（安全，对齐旧 tar 端点）

`apply_ops` 写盘前对每个 `path` / `new_path` 做 **containment 校验**（对齐旧 tar 端点 `service.py:542-556`）：解析后必须落在 `spec_root` 内，拒绝 `..` / 绝对路径 / symlink 逃逸。软删备份目标路径同理必须落在备份区（`spec-backups/`）内。防止恶意增量 payload 越界写服务器文件。

### 软删除备份语义（BL-2/BL-3 解）

- `delete op`：文件**移出 spec_root** 到备份区（如 `<workspace 数据根>/spec-backups/<timestamp>/<path>`，不在 spec_root 内 → build_bundle 拉不到），`spec_file_manifest.exists=false` + version+1。
- **move（不是 copy）**：磁盘 spec_root 下原路径文件真正移除 → change reparse 磁盘解析自然看不到 → 变更中心停止显示（符合同步删除预期）。
- **取舍（写明）**：软删后 `.trash`/备份区仅恢复**文件内容**，不恢复 Change 行的工作流状态（current_stage/gates）——因为 change reparse 对磁盘消失行硬删（`change/service.py:1140`）。这是"可找回"的边界：恢复文件需重新创建变更或手动补状态。
- base_version 过期 → conflict=true 拒绝该 op（HTTP 200），不执行软删。

### 兼容（审查建议 5，Q7 解）

- 旧 tar 端点保留，做首同步/回退。
- **旧 tar 全量 push 后：`spec_file_manifest` 全表 version 失效**（重置/标记 stale），下一次增量 daemon 强制全量重算清单——避免旧 tar 覆盖后版本漂移。
- daemon 首同步走旧 tar，之后走增量；增量不可用回退旧 tar。

## 7.5 生命周期契约表

**不涉及生命周期契约。** 本变更只改文件同步协议（spec-sync tar → 增量 ops），不新增/修改 session / lease / agent_run / daemon / lifecycle / state_transition / claim / heartbeat 任何事件。`postSpecSync` 仍是薄封装（接口签名不变，调用点零改动），不改变 daemon 会话/租约/agent run 的状态机。软删除（移备份区）不涉及任何运行时生命周期状态。

## 8. 数据模型

- **新增 `spec_file_manifest` 表**：`path`（ux workspace_id+path）+ `content_hash`(SHA-256) + `version`(int) + `exists`(bool) + `updated_at`。**这是增量清单唯一权威**，独立于 scan_docs 的 docs 扫描（scan_docs reparse 不碰此表，避 BL-1）。**不复用 scan_documents**（原 D-009 废弃，见 D-011）。
- **软删备份区**：`spec_root` **之外**的独立目录（`<workspace 数据根>/spec-backups/<timestamp>/<path>`），build_bundle 拉不到（避 BL-2）。
- **`.runtime/`**：移出增量范围（D-006），不做清单、不推送。
- **不改**：`changes` 表、`platform_change_progress`、`scan_documents`、`spec_workspaces`。

## 9. 兼容策略（brownfield）

- **旧客户端/旧 daemon**：旧 tar 端点保留，仍可用整树覆盖（现状行为不变）。
- **新客户端 + 旧端点**：增量端点不存在时（旧后端），daemon 回退旧 tar 端点。
- **旧客户端 + 新端点**：新端点只响应增量 payload，旧 tar 走旧端点，无冲突。
- **旧 tar push 后版本失效**：旧 tar 全量 push → `spec_file_manifest` 全表 version 失效 → 下一次增量强制全量重算（审查建议 5，Q7 解）。
- **单成员快速路径**：同 workspace 仅一个成员时，乐观锁不冲突（base_version 恒匹配），行为透明。

## 10. 风险登记

| 编号 | 风险 | 等级 | 应对策略 |
|---|---|---|---|
| R-01 | **方向反转**（daemon 本地权威回灌覆盖 → 服务器权威清单 + 乐观锁）是最大契约语义变更 | P0 | design 明确方向反转；新端点与旧端点共存；旧 tar push 后失效 version（避免两路径版本漂移） |
| R-02 | rename 的 Windows 大小写不敏感坑（tar POSIX vs NTFS） | P1 | rename op 用路径字符串比对；Windows 大小写差异特殊处理；测试覆盖 |
| R-03 | 本地清单缓存位置（不能混入 `.runtime/` 被误推/被 pull 清掉） | P1 | 缓存移出 specDir（`~/.sillyhub/daemon/manifests/`），增量 payload 明确排除 `.runtime/*`（双保险） |
| R-04 | 软删后 Change 行被 reparse 硬删，工作流状态丢失 | P2 | §7 写明取舍：备份区仅恢复文件，不恢复状态；如需状态恢复另立 |
| R-05 | 增量 diff 性能（万级文件每次全算 hash 成本） | P1 | 本地清单缓存（上次 hash），只重算变化文件 mtime/hash；缓存移出 specDir 不被清 |
| R-06 | 软删备份空间无限增长 | P2 | 备份区默认保留策略（N 天），P2 细节 execute 定 |
| R-07 | base_version 初始为 0 的历史行与"服务器已变"的歧义 | P2 | 首增量推 base_version=0；服务器比对 hash 兜底（hash 同 → 接受，version+1） |
| R-08 | spec_file_manifest 与 scan_documents 数据重复（两清单） | P2 | 职责明确：scan_documents=docs 扫描产物，spec_file_manifest=增量同步清单；二者不互写 |
| R-09 | 增量端点 path 越界（traversal）写服务器文件 | P1 | apply_ops 写盘前 containment 校验（对齐旧 tar `service.py:542-556`），拒绝 `..`/绝对路径/symlink 逃逸；软删备份目标同样校验 |

## 11. 决策追踪

| 决策 | 被覆盖处 | 状态 |
|---|---|---|
| D-001@v1 多写者+乐观锁 | §2 G2、§7（base_version 409）、§9 单成员路径 | accepted |
| D-002@v1 同步删除软删备份 | §2 G3、§5 Phase1、§7 软删语义、§8 | accepted |
| D-003@v1 SHA-256 | §6（content_hash）、§7 FileOp.hash | accepted |
| D-004@v1 文件级版本 | §6（spec_file_manifest.version）、§8 | accepted |
| D-005@v1 rename 显式 op | §2 G4、§5 Phase1、§7 FileOp.rename | accepted |
| D-006@v1 .runtime 移出 | §3 NG-03、§6、§8、R-03 | accepted |
| D-007@v1 方案A 复用清单 | §5（修订后不复用 scan_documents，见 D-011） | 修订 |
| D-008@v1 软删备份位置 | §5 Phase1、§7 软删语义、§8（移出 spec_root，BL-2 解） | accepted（修订） |
| D-009@v1 清单复用 scan_documents | ~~§6、§8~~ → **废弃，被 D-011 取代**（BL-1） | superseded |
| D-010@v1 软删明确为 move | §7 软删语义、R-04（BL-3 解） | accepted |
| D-011@v1 清单用独立 spec_file_manifest 表 | §6、§8、R-08（BL-1 解） | accepted |

无未解决决策。

## 12. 自审

- **章节齐全**：背景/设计目标/非目标/拆分判断/总体方案/文件变更清单/接口定义/数据模型/兼容策略/风险登记/决策追踪/自审——全 ✓。
- **Design Grill 首轮 BL-1~BL-4 全部闭环**：BL-1 弃 scan_documents 建 spec_file_manifest（D-011）；BL-2 .trash 移出 spec_root（D-008 修订）；BL-3 软删明确 move + exists 语义（D-010）；BL-4 本地缓存移出 specDir（R-03 修订）✓。
- **文件变更清单数据流**：version 列 producer（增量端点写）→ spec_file_manifest → consumer（base_version 基准）；增量端点 producer（daemon payload）→ router → apply_ops → spec_root+清单 → new_versions ✓。无 dormant。
- **生命周期契约**：只改文件同步协议，不涉及 session/lease/agent_run/daemon 状态机，已用豁免短语「不涉及生命周期契约」声明（§7.5）✓。
- **migration**：spec_file_manifest 建表有 migration 任务 ✓。
- **兼容**：旧 tar 端点保留、旧 tar push 失效 version、单成员快速路径、`.runtime` 跳过 ✓。
- **风险**：R-01~R-08 覆盖方向反转/Windows rename/缓存/软删状态/性能/备份膨胀/base_version/清单双表 ✓。
- ⚠️ **自审存疑**：①`spec_file_manifest` 放哪个 model 文件（scan_docs vs spec_workspace）execute 定。②软删后 change reparse 硬删 Change 行的"状态不恢复"取舍（R-04）execute 确认符合预期。③备份区具体路径（`<workspace 数据根>/spec-backups/`）execute 确认不落入 build_bundle/pull 范围。
- **测试覆盖**：增量端点各 op/base_version 409/软删 move/.runtime 拒/旧 tar 失效 version + daemon diff + migration ✓。

自审通过（已纳入 Design Grill 首轮 BL 修订），进入 Design Grill 续审。
