---
author: qinyi
created_at: 2026-08-29 11:21:52
change: 2026-08-29-change-delete-closure-and-spec-pull
scale: large
status: drafted
---

# 设计文档 — 变更中心删除闭环与文档拉取口子

## 1. 背景与目标

### 1.1 现状问题（三轮子代理调查结论，file:line 均已核实）

1. **变更中心无删除入口**：`modules/change` 全模块 0 个 DELETE 端点，前端 0 个删除按钮；唯一删除路径是「重新扫描」（`POST /changes/reparse`）全量对账的物理删（`change/service.py:1289-1311`）。
2. **sillyspec 触发的删除半同步**：
   - 归档是闭环的：delete/rename 命中 `changes/archive/` → `archive_hit` → 全量 reparse → DB 行自动迁「已归档」（`spec_workspace/service.py:1625-1749`）。
   - **裸删不闭环**：活跃目录 `changes/<name>/` 的 delete op 只进 scoped reparse，而 R-08 红线规定 scoped 零删除（`change/service.py:1293`）→ DB 行永久停在「进行中」。
   - **幽灵空目录堵点（本设计新发现）**：`apply_ops` 逐文件软删不清空目录，parser 对空目录照常解析（产出全 `exists=False` 的 ParsedChange）→ 即使全量 reparse，该 key 仍在 seen_keys，DB 行连全量都删不掉。
   - **progress / quicklog 永久残留**：`platform_change_progress` 无删除路径（`platform_sync/service.py:253` 注释原话）；quicklog 为「PG pushed 行 ∪ QUICKLOG.md 解析」双源合并，本地删条目后 pushed 行永久显示（`quicklog_service.py:285-323`）。
3. **多用户一工作区**：数据按 workspace 隔离不按人；shpsync token 为 workspace 级、多人写同一 `(workspace_id, change_name)` 键；`owner_id` 漂移到最新推送人（`platform_sync/service.py:335-404`）。删除是全组共享数据的终局操作，且存在四条复活通道（见 §5.4）。
4. **拉取口子缺失**：`GET /workspaces/{ws}/spec-workspace/bundle`（`spec_workspace/router.py:77-97`）整树 tar 仅 daemon 消费（任务/会话开始、版本变化才拉）；浏览器用户无任何下载入口；CLI 直跑（shpsync token）只有推送通道无拉取。
5. **进行中感知盲区（D-007 并入）**：CLI→平台的全部信号都是每步 `--done` 时点快照（progress/documents/spec-sync 三连推同拍）；步骤进行中（execute 单步数小时）零信号。纯 CLI 模式无 AgentRun（agent-status 恒空），平台无法区分「长跑中 / CLI 挂死 / 没在跑」；`platform_change_progress.last_pushed_at`（model.py:90-93）与 `updated_at`（:110-117）字段已存在但从未投影到前端。

### 1.2 目标

- G1 本地裸删/quicklog 清理/进度重置后，变更中心**自动收敛**，无需手动重扫描。
- G2 变更中心提供**正式删除入口**（权限受控、审计留痕、镜像联动、多用户下不复活）。
- G3 浏览器用户与 CLI 直跑均有**拉取服务端 spec 文档**的口子，快照语义明确。
- G4 平台侧闭环**不依赖** sillyspec 工具升级（CLI 墓碑上报为增强，见 D-004/D-005）。
- G5 变更中心可感知纯 CLI 变更的「进行中」状态（最后信号时间 + 进行中步骤），消除「每阶段完成平台才知道」的盲区（D-007）。

## 2. 方案选型（摘要）

三方案对比详见 decisions.md D-005@v1：**选定方案 A 镜像驱动收敛 + CLI 墓碑上报增强**。B（墓碑上行驱动）旧版 CLI 残留且仍需 A 的防复活基建；C（全量对账常态化）撞已知坑（Windows bind mount stat 性能断崖、全量 reparse 93s 超时史）。

## 3. 总体架构（波 1-3 删除/拉取线 D-003@v1；revision 1 并入波 4 进行中可见性 D-007）

```
本地 .sillyspec/                服务端                                变更中心
───────────────────      ──────────────────────────────         ─────────────
sillyspec 裸删/归档 ──op──▶ apply_ops（spec_workspace）
                           ├─ 新增①: 空目录清理（仅 ops 涉及目录）
                           ├─ 新增②: platform_deleted 标记拦截
                           │    （add/rename 复活分支 / 全量对齐）
                           ├─ 新增③: quicklog 对账（hidden）
                           ▼
                        reparse（change）
                           ├─ 修订④: scoped 定向删除（R-08 收窄）
                           │    scope∩磁盘消失 → 删行 + 顺手清 progress
                           └─ 保留: 7 天占位保护 / rename 限定 scope
                           ▲
平台删除入口 ──────────────┤ 新增⑤: soft_delete_change_dir
DELETE /changes/{cid}      │   （镜像软删+标记 → 清 progress →
权限: CHANGE_ARCHIVE        │    location='deleted' → 审计事件）
或 owner==当前用户          ▼
                        _ensure_change_row 拦截⑥（防占位重建复活）
                           ▲
CLI 增强⑦（跨仓）: 删除/归档上行 status='deleted' 墓碑 → 即时收敛

拉取口子:
  浏览器 ──新增⑧── 下载按钮（workspace 配置卡）→ 既有 bundle 端点
  CLI ──新增⑨── GET /changes/-/spec-bundle（shpsync token）→ build_bundle
       └⑩ X-Spec-Version 头 + tar 内 PLATFORM-BUNDLE.json
```

## 4. 需求映射

| 需求 | 对应设计节 |
|---|---|
| FR-01 裸删自动收敛 | §5.1 §5.2 |
| FR-02 幽灵目录修复 | §5.1 |
| FR-03 progress/quicklog 残留收敛 | §5.2 §5.3 |
| FR-04 多用户防复活 | §5.4 |
| FR-05 平台删除入口（权限/审计/软删） | §6 |
| FR-06 网页下载 spec 包 | §7.2 |
| FR-07 CLI 可拉取 | §7.1 |
| FR-08 快照元数据 | §7.3 |
| FR-09 最后信号/进行中步骤投影 | §8.1 |
| FR-10 CLI 步骤开始+任务边界上报 | §8.2 |
| FR-11 心跳不做（Non-Goal 性需求） | §8.3 / §15 |

## 5. 波 1：删除自动收敛 + 防复活基建（backend）

### 5.1 空目录清理（修幽灵目录，最前置）

- **位置**：`spec_workspace/service.py` `apply_ops` delete 分支（现 :1472-1490）之后。
- **做法**：对本次 ops 中 delete 涉及的**最长公共祖先目录**做自底向上 `rmdir`（目录空则删，非空停），复用全量路径 `_converge_stale_files` 的清理范式（:1249-1261）。仅触碰 ops 涉及目录，**不做整树扫描**——规避知识库已知坑「Windows Docker bind mount stat 性能断崖」。
- **效果**：目录真消失后，parser 三区枚举不再产出该 key，§5.2 的删除判据生效。

### 5.2 scoped 定向删除（R-08 收窄修订）

- **位置**：`change/service.py` 删除环闸门（现 :1293 `if scope is None:`）。
- **新语义**：scope 非空时也进删除环，但仅删「`change_key ∈ scope 集` 且 `key ∉ seen_keys`」的行；scope 外不动（保住 R-08 原始动机——防部分视图误删范围外变更）。
- **保留守卫**：7 天占位保护（`_progress_reported_active_keys` + 无文档条件，:1294-1309）原样；rename 检测（`_detect_renames` :1416-1467）从「仅全量」改为「scope 集内也跑」，防目录改名被误判成删旧建新丢 workflow 状态。
- **progress 联动**：删除环删 Change 行处（:1310）连带删 `platform_change_progress` 对应 `(workspace_id, change_name)` 行。读方核实：投影 join 全部 miss-fallback（:1526-1531、:1910-1943）、占位保护集、CLI 读侧均安全；审批写回 upsert 会重建最小行，配合 §5.4 拦截。
- **测试改写**：`test_reparse_scoped_zero_delete.py` 红测改为「scope 内确认消失可删、scope 外不删」双断言；R-08 修订记录入本变更 decisions.md。

### 5.3 quicklog pushed 行对账

- **位置**：`apply_ops` 落 `quicklog/QUICKLOG-*.md` 的 add/update/delete op 落盘后（事务内 best-effort）。
- **做法**：重解析镜像 `quicklog/` 目录（复用 `parse_quicklog_directory`），`ql_id` 不在文件集合中的 pushed 行置 `hidden=True`（新列，见 §9）；`merge_entries`（quicklog_service.py:285-323）过滤 hidden 行。apply 时点=文件刚落镜像，无「文件同步滞后误杀刚推送条目」问题（对应调查方案 B，优于合并期过滤方案 A）。
- 隐藏不硬删：保留推送留底可回滚。

### 5.4 防复活标记（migration + 四处拦截）

`spec_file_manifest` 新增列 `platform_deleted BOOLEAN NOT NULL DEFAULT FALSE`（§9）。四条复活通道逐一拦截：

| # | 复活通道 | 拦截点 |
|---|---|---|
| 1 | CLI 直跑：以服务器 manifest 为锚 diff 本地，本地还在的文件发 add → 墓碑原地复活 | `apply_ops` add 分支（:1397-1420）：目标行 `platform_deleted=True` → 拒绝落盘，返回显式 conflict 项 `platform_deleted`（CLI 可感知） |
| 2 | daemon rename 目标命中墓碑 | `apply_ops` rename 分支（:1500-1530）：同上拦截 |
| 3 | daemon 增量失败回退整树 tar / 手动全量同步：`_write_spec_root` 落盘 + 重置 exists | `_write_spec_root` **落盘集计算阶段**排除 `platform_deleted=True` 路径（B-2 加固：文件不落盘）；对齐环（:982-999）继续不重置 exists、维持墓碑 |
| 4 | DB 层：CLI sillyspec.db 仍注册该 change → progress 上行 `_ensure_change_row` 重建占位行 | `_ensure_change_row`（platform_sync/service.py:258-333）：key 命中 `location='deleted'` 的现存 Change 行 → 拒收该次上行（409 语义返回，CLI 可提示「平台已删除，请本地 unregister」） |

**加固项（Design Grill B-1/B-2 修正，D-006@v1）**：

- **删除环豁免（B-1）**：scoped（§5.2 修订版）与全量两处删除环均**跳过 `location='deleted'` 行**（不删）；`_apply_parsed` 更新路径（`change/service.py:2181` 一带）遇 deleted 行**不回翻 location**（parser 即便产出同名 parsed 也不覆盖）。审计因此永不 CASCADE 丢失，墓碑锚点行由平台删除动作保证存活（唯一物理清除通道=未来显式的回收策略，本变更不做）。
- **持久锚点兜底（B-1）**：`_ensure_change_row` 拒收判据双层——① 现存 Change 行 `location='deleted'` 为主判据；② 行缺失时兜底探测 manifest 中 `changes/{name}/` 前缀下是否存在 `platform_deleted=True` 行（前缀查询须转义 LIKE 通配符 `%`/`_`——变更名含下划线常见；或取回 workspace manifest 行后 Python `startswith` 过滤）。
- **落盘级拦截（B-2）**：`_write_spec_root` 的**落盘集计算阶段**（staging→落盘之前）排除已平台删除的路径——判据用 `changes/{name}/` **前缀探测**（manifest 任一该前缀行 `platform_deleted=True` 即整目录排除，优先于逐路径精确匹配，顺带闭合成员本地「新增从未见路径」绕过精确匹配的 P2 边角），文件根本不落盘 ⇒ parser 磁盘驱动复活链断掉；对齐环继续维持墓碑。仅挡 manifest 对齐环（:982-999）不够——tar 落盘在先，文件回磁盘后 reparse 会把行翻回 active。
- **delete op 放行**：`platform_deleted=True` 路径上的 delete op 是愈合方向（幂等 no-op，行已 exists=False），**放行**；仅拦截 add/rename 复活方向。

**取消删除**：不做（Non-Goal）。30 天备份区 + `location='deleted'` 行为兜底，人工恢复走数据库操作（未上线产品允许，CLAUDE.md 规则 11）。

### 5.5 CLI 墓碑上报（跨仓，sillyspec 仓）

CLI 删除（unregisterChange / 目录删除）/归档时，progress 上行 `changes[].status='deleted'`（对齐现有 `'archived'` 状态语义）。**处理位置在写路径**：progress POST 处理器见到 `status='deleted'` → 置 `location='deleted'` + 触发该 key 镜像软删收敛（读时投影层不做写/文件系统副作用，区别于 `'archived'` 的纯 DTO 覆盖范式 :1613-1616）。**平台闭环不依赖此项**（方案 A 兜底），属收敛加速器。

## 6. 波 2：平台删除入口（backend + frontend）

### 6.1 端点

- `DELETE /api/workspaces/{workspace_id}/changes/{change_id}`（`modules/change/router.py` 新增）。
- **权限**：`require_permission(Permission.CHANGE_ARCHIVE)`（workspace_owner 角色已内置、platform_admin 短路，现零端点引用）**OR** `change.owner_id == current_user.id`（D-001；owner 为空时仅前者可删）。实现为组合依赖：先取 Change 行判 owner，非 owner 再要求权限通过。
- **服务层顺序**（新方法 `ChangeService.delete_change`）：
  1. `SpecWorkspaceService.soft_delete_change_dir(workspace_id, change_key)`（新方法）：枚举 `changes/{key}/` 现存文件（manifest `path.like('changes/{key}/%')` 前缀查询 + exists=True），逐文件 `_move_op_file` 移 30 天备份区 + manifest `exists=False, version+1, platform_deleted=True`，最后空目录清理 + `_prune_spec_backups`。base_version 直读 manifest 现值，零冲突。
  2. 删 `platform_change_progress` 对应行。
  3. Change 行置 `location='deleted'`（软删，D-002；不物理删——change_events FK CASCADE 会丢审计）。
  4. 写 `change_events` `event_type='delete'`，detail 含 `{deleted_by, change_key, file_count, backup_dir}`（照 `_sync_change_owner` savepoint 范式）。
- **归档区变更**：`location='archive'` 的行同样可删（软删 `changes/archive/{name}/` 镜像）。

### 6.2 读侧行为

`location='deleted'` 行：现有 active/archive 两 tab 均显式传 location 参数（page.tsx:154、:218-219）天然不显示；`location` 在 schema 是自由 str（schema.py:78、:115）无需改 DTO；投影覆盖 enrich 对 deleted 行不再覆盖（读端 enrich 前置过滤）。reparse 路径对 deleted 行的豁免见 §5.4 加固项：两处删除环跳过 + `_apply_parsed` 不回翻 location（磁盘目录已被 §5.4 拦截不存在，parser 不产出同名 key；`_ensure_change_row` 通道靠 §5.4-4 双层拒收）。

### 6.3 前端

- 列表页：表格加「操作」列（或行 hover 垃圾桶），仅权限可见者渲染（owner 本人 / 工作区所有者 / 平台管理员；前端以 summary.owner_id + 当前用户判断，后端为权威）。
- 详情页：PageHeader 右侧独立危险按钮（不混入审批卡）。
- 确认弹层：照 admin 用户删除受控确认范式（`admin/users/page.tsx:89,:207-220,:589-614`），含「输入变更名末段」防呆（原型已定稿）。
- API：`lib/changes.ts` 加 `deleteChange`；`useMutation` + `queryClient.invalidateQueries(['changes', wsId])`；跑 `pnpm gen:types` 提交 api-types.ts + openapi.json。
- 移动端镜像页（`m/workspaces/[id]/changes`）同步操作入口。
- 原型：`prototype-delete-and-pull.html`（双主题 AI-Native/blue，遵循品牌色 brand-* 语义阶与主题 token 铁律）。

## 7. 波 3：拉取口子（backend + frontend + CLI 跨仓）

### 7.1 CLI 可拉端点

- `platform_sync/router.py` 新增 `GET /changes/-/spec-bundle`：鉴权用现有 `_write_auth`（**仅 shpsync_ token**，对齐 `GET /changes/-/spec-manifest` 先例——避免非同步方探测文件布局；浏览器用户走既有 RBAC bundle 端点），`scope.workspace_id` 为空 403 fail-closed，内部调 `SpecWorkspaceService.build_bundle(scope.workspace_id)` 返回 StreamingResponse。注册在 `/changes/{name}/...` 路由**之前**（字面量 `-` 路由前置于参数路由，知识库 ppm export-excel 同款坑）。
- **权限评估**：shpsync_ 是 workspace 级写 token，持币者本可经 `POST /changes/-/spec-sync` 覆盖任意镜像文件；只读拉 bundle 是既有能力严格子集，无越权扩大。bundle 排除 local.yaml（token 不外泄）。
- **CLI 命令（跨仓）**：sillyspec 现有 `SyncManager.pull(changeName)`（src/sync.js:986）**仅拉进度六表**（多机进度同步），spec 文件仍是只推不拉——X2 为真缺口。形态：`src/sync.js` 新增 `pullSpecBundle()`（GET `/api/changes/-/spec-bundle`，shpsync token，流式下载 tar）+ `src/index.js` 注册顶层命令（如 `sillyspec pull --spec`，命名 plan 定），解压到 specDir 为 `.sillyspec` 内容根；本地已存在时要求空目录或 `--force` 整树覆盖（对齐 daemon `pullSpecBundle` 的 rm+覆盖语义）。

### 7.2 网页下载按钮

- 落点：`workspace-config-card.tsx`「工作区文档存储」组，「同步到服务器」旁成对加「下载文档包」按钮（推送/拉取语义成对）。
- 实现：复用鉴权 blob 下载范式（`lib/file/api.ts:176-215` / `explorer.ts:68-116` 裸 fetch + Bearer + `<a download>`；对齐 D-009 blob 生命周期托管思路），URL `/api/workspaces/${id}/spec-workspace/bundle`，文件名取响应 `Content-Disposition`。不新增 Next.js route handler（rewrite 代理 + proxyTimeout 5 分钟已覆盖）。
- **不推翻 R-07**：配置卡不常态展示 spec_version；版本信息仅在下载 toast 反馈中一次性展示。

### 7.3 快照元数据

- bundle 响应头加 `X-Spec-Version: {spec_ws.spec_version}`（一行）。
- tar 顶层加 `PLATFORM-BUNDLE.json`：`{spec_version, strategy, generated_at, server}`。用户离线可辨快照新旧；daemon pull 侧不受影响（多一个文件，`.runtime` 排除规则不变；daemon 本地 spec-version.json 逻辑不动）。

### 7.4 时机口径（结论）

- **机器拉**：维持现状——daemon 在 lease claim（任务开始/会话开始）时按 `latest_spec_version` 判断是否 pull；init lease 首绑拉取；会话结束只回灌不重拉。本变更不动 daemon。
- **人拉 / CLI 拉**：均为**主动拉快照**语义，无自动同步、无会话中刷新（WS 控制指令词表无 spec refresh，不新增）。UI/CLI 文案明示快照语义（原型 note 区已含）。

## 8. 波 4：进行中可见性（纯 CLI 模式，D-007 并入）

### 8.1 平台侧活动投影（Layer 1，零工具改动）

- **后端**：`ChangeSummary` DTO 加 `last_pushed_at`（ISO 字符串，可空）；`enrich_summaries` / `_project_current_stage`（:1910-1943）在既有 join 里顺带取 progress 行的 `last_pushed_at`（无新查询）；**无新列、无 migration**。`current_step_status` 已在 step_progress 投影中（前端 ChangeStepBadge 已消费 :83-88）。
- **前端**：列表在「待办状态」列基础上加活动徽标。真值表 `f(current_step_status, last_pushed_at 年龄)`（round 3 复核钉死；`current_step_status` 由「第一个非 completed 步 + wait_reason」推导（service.py:2122-2130），只有 active/waiting/null 三值，**不区分 pending 与 in-progress**，故态 1/态 2 实际仅由 30min 阈值区分——这是 Layer 1 启发式的固有边界，由 R-12 受理）：
  - `active` 且最后信号 ≤ 30 分钟 → 「进行中 · x 分钟前」（既有蓝色脉动点从纯动画变为真实信号）；
  - `active` 但最后信号 > 30 分钟 → 灰色「停滞 · 最后信号 x 分钟前」（只陈述事实，不断言挂死）；
  - `waiting` 或 `null` → 空闲态，显示最后活动时间。
  - `last_pushed_at` 为客户端 ISO 原文 String（无服务端校验），前端解析须防御式：复用 `formatStepTime` 的 `ISO_LIKE_RE` 正则白名单 + 回退显示原文（change-step-timeline.tsx:75-102 范式），畸形串不炸组件。
  - 阈值常量 `ACTIVITY_STALE_MS = 30min` 与 `CHANGES_POLL_INTERVAL_MS`（page.tsx:103）同点定义，展示层关注点不进后端 DTO。详情页头部同步「最后信号」。列表 30s 轮询已就绪，无需新增。

### 8.2 CLI 在跑上报（Layer 2，跨仓，sillyspec 仓）

- **步骤开始上报（X3）**：CLI 状态机已维护步骤 in-progress 状态（六表 payload 的 `steps[].status` 已含 in-progress 值），仅推送时机在 `--done`（triggerSync，run/shared.js:420-421）。步骤启动时补推一次 progress（同端点同结构）。**真实效果 = `last_pushed_at` 刷新**（round 3 钉正：投影 `current_step_status` 对「下一个 pending 步」本就推导为 active，X3 不改变它的值，只让「最后信号」时间真实反映步骤起点，使停滞判定可信）。**后端零改动**（upsert 对 in-progress 步骤裸 JSON 透传，已核实）。
- **任务边界上报（X4）**：execute 每完成一个任务（T1..Tn）调一次 triggerSync → `last_pushed_at` 以任务粒度刷新；tasks.md 勾选状态本身走文件同步 + task 模块 reparse（task/parser.py:1-23），无需新端点。
- **写放大与并发**：每步开始/每任务完成一次轻量 JSON POST；CLI 单进程顺序推送，base_ts 进程内单调，无乐观锁冲突。
- **旧版 CLI 兼容**：无 X3/X4 时行为等同现状（仅步骤完成有信号），Layer 1 启发式仍工作——渐进增强，平台侧不硬依赖（对齐 NFR-03 基调）。

### 8.3 心跳（Layer 3）：本期不实现，协议预留

60s 轻量心跳可让「运行中●」实心可信，本期不做（Non-Goal）；将来需要时复用 progress 端点带 heartbeat 字段或专用轻量端点再决策，本期不预加字段。

## 9. 数据模型变更（migration × 2）

| 表 | 变更 | 说明 |
|---|---|---|
| `spec_file_manifest` | + `platform_deleted BOOLEAN NOT NULL DEFAULT FALSE` | 平台删除标记，拦截四复活通道 |
| `quicklog_entries`（QuicklogEntryORM） | + `hidden BOOLEAN NOT NULL DEFAULT FALSE` | quicklog 对账软隐藏 |

无新表、无删列；波 4 无新列（复用 `platform_change_progress.last_pushed_at` 既有字段）。alembic 单 revision（遵守「并行变更撞多 head」已知坑：提交前 `alembic heads` 检查单 head）。

## 10. 生命周期契约表

| 事件 | 发起方 | 接收方 | 必需字段 | 状态变化 |
|---|---|---|---|---|
| spec-sync delete op（裸删/归档移动） | CLI/daemon | backend apply_ops | path, base_version | manifest exists=False version+1；（新增）涉及目录空则 rmdir；platform_deleted 行上 delete op 幂等放行，仅 add/rename 被拒 |
| scoped reparse（ops 后自动） | backend apply_ops | ChangeService.reparse | scope=[change_name] | scope∩磁盘消失 → Change 行删 + progress 行删；占位 7 天保护；**location='deleted' 行豁免**（B-1） |
| 平台删除 | 浏览器用户 | DELETE /changes/{cid} | change_id + 权限/owner 校验 | 镜像软删+platform_deleted → progress 删 → location='deleted' → change_events[delete] |
| CLI 墓碑上行（跨仓增强） | sillyspec CLI | POST progress changes[].status='deleted' | status='deleted' | 写路径处理：location='deleted' + 触发镜像软删 |
| progress 上行（已删 key） | CLI | platform_sync | — | `_ensure_change_row` 拒收（409 + code=change_deleted；行缺失时 manifest platform_deleted 前缀兜底锚点，B-1） |
| quicklog 文件 op | CLI/daemon | apply_ops → 对账 | ql_id 集合 | 文件中缺失的 pushed 行 hidden=True |
| bundle 下载/拉取 | 浏览器/CLI | GET spec-workspace/bundle 或 /changes/-/spec-bundle | 鉴权凭证 | 无状态变化（只读快照；X-Spec-Version + PLATFORM-BUNDLE.json） |
| 步骤开始/任务边界上报（X3/X4，跨仓增强） | sillyspec CLI | POST /changes/{name}/progress | steps[].status=in-progress（既有六表结构） | last_pushed_at 刷新 + 投影 current_step_status=active → 前端「进行中」徽标（后端零改动） |

daemon lease/claim/heartbeat 生命周期：不涉及生命周期契约（本变更不动 daemon 生命周期，仅列出上表 spec-sync 相邻事件）。

## 11. API 契约变更

| 端点 | 方法 | 变更 |
|---|---|---|
| `/api/workspaces/{ws}/changes/{cid}` | DELETE | 新增（权限 CHANGE_ARCHIVE OR owner；返回 `{ok, backup_dir, file_count}`） |
| `/api/changes/-/spec-bundle` | GET | 新增（platform_sync 路由，shpsync 可拉 tar） |
| `/api/workspaces/{ws}/spec-workspace/bundle` | GET | 响应头 + `X-Spec-Version`；tar 顶层 + `PLATFORM-BUNDLE.json` |
| `POST /changes/{name}/progress` | 行为 | 已删 key 拒收：HTTP 409 + 错误体 `code='change_deleted'`（与既有 base_ts 冲突的 409 用 code 字段区分；旧 CLI 兼容：当冲突重试无害，最终报推送失败可接受） |
| `POST /changes/-/spec-sync` | 行为 | add/rename 命中 platform_deleted 墓碑 → conflict 项 `platform_deleted`；delete op 幂等放行 |
| `GET /changes`（ChangeSummary DTO） | 响应 | + `last_pushed_at`（可空 ISO 字符串，来自 progress 行；波 4） |
| OpenAPI | — | 全部进 `backend/openapi.json` + `pnpm gen:types`（frontend 与 daemon 各一份类型再生成） |

## 12. 文件变更清单

### main 仓变更

| 操作 | 文件路径 | 说明 |
|---|---|---|
| 修改 | backend/app/modules/spec_workspace/service.py | apply_ops 空目录清理、platform_deleted 拦截（add/rename 复活拒绝 + delete op 幂等放行）、quicklog 对账、soft_delete_change_dir 新方法、`_write_spec_root` 落盘级前缀排除（B-2 加固）、`build_bundle` 顶层加 PLATFORM-BUNDLE.json（波 3） |
| 修改 | backend/app/modules/spec_workspace/model.py | SpecFileManifest + platform_deleted |
| 修改 | backend/app/modules/spec_workspace/router.py | bundle 响应头 X-Spec-Version |
| 修改 | backend/app/modules/change/service.py | scoped 定向删除闸门、progress 联动删、删除环（scoped+全量）与 `_apply_parsed` 对 deleted 行三点豁免（B-1 加固）、delete_change 新方法、enrich 对 deleted 行处理 + `last_pushed_at` 投影（波 4，§8.1） |
| 修改 | backend/app/modules/change/router.py | DELETE 端点 |
| 修改 | backend/app/modules/change/schema.py | 删除响应 DTO；ChangeSummary + `last_pushed_at`（波 4） |
| 修改 | backend/app/modules/change/quicklog_service.py | merge_entries 过滤 hidden |
| 修改 | backend/app/modules/platform_sync/model.py | QuicklogEntryORM + hidden |
| 修改 | backend/app/modules/platform_sync/service.py | _ensure_change_row 拒收已删 key（双层判据 + manifest 兜底锚点，B-1 加固）、deleted 墓碑写路径处理 |
| 修改 | backend/app/modules/platform_sync/router.py | GET /changes/-/spec-bundle（前置注册） |
| 新增 | backend/migrations/versions/20260829130000_add_platform_deleted_and_quicklog_hidden.py | 单 revision 两列（down_revision 接执行时唯一 head，命名以 task-01 执行为准） |
| 修改 | backend/tests/test_platform_deleted_hidden_migration.py | migration 冒烟（新增，task-01） |
| 修改 | backend/app/modules/spec_workspace/tests/test_platform_deleted_guard.py | 防复活通道 1/2/3 拦截（新增，task-02） |
| 修改 | backend/app/modules/spec_workspace/tests/test_soft_delete_change_dir.py | 镜像目录软删（新增，task-06） |
| 修改 | backend/app/modules/spec_workspace/tests/test_bundle_sync.py | bundle 元数据（新增/扩展，task-08） |
| 修改 | backend/app/modules/change/tests/test_reparse_scoped_zero_delete.py | 红测改写（task-03） |
| 修改 | backend/app/modules/change/tests/test_reparse_delete_closure.py | 定向删除/豁免/联动删（新增，task-03） |
| 修改 | backend/app/modules/change/tests/test_delete_change.py | 删除端点权限矩阵（新增，task-06） |
| 修改 | backend/app/modules/change/tests/test_enrich_projection.py | 活动投影两态（新增/扩展，task-11） |
| 修改 | backend/app/modules/change/tests/test_quicklog_service.py | hidden 过滤（扩展，task-05） |
| 修改 | backend/app/modules/platform_sync/tests/test_change_deleted_guard.py | 通道 4 拒收（新增，task-04） |
| 修改 | backend/app/modules/platform_sync/tests/test_spec_bundle.py | 拉取端点鉴权矩阵（新增，task-08） |
| 修改 | backend/app/modules/platform_sync/tests/test_router.py | progress 409 回归（扩展，task-04） |
| 修改 | frontend/src/app/(dashboard)/workspaces/[id]/changes/page.tsx | 操作列 + DeleteConfirm 接入；活动徽标三态 + ACTIVITY_STALE_MS 常量（波 4） |
| 修改 | frontend/src/app/(dashboard)/workspaces/[id]/changes/[cid]/page.tsx | 详情页危险按钮；头部「最后信号」（波 4） |
| 修改 | frontend/src/app/m/workspaces/[id]/changes/page.tsx | 移动端同步 |
| 新增 | frontend/src/components/delete-change-confirm.tsx | 受控确认弹层 |
| 修改 | frontend/src/components/workspace-config-card.tsx | 下载文档包按钮 |
| 修改 | frontend/src/lib/changes.ts | deleteChange |
| 修改 | frontend/src/lib/spec-workspaces.ts | downloadSpecBundle（blob 范式） |
| 再生成 | frontend/src/lib/api-types.ts + backend/openapi.json | gen:types |
| 修改 | .sillyspec/local.yaml | 跨仓注册表 repos 段（sillyspec 仓路径） |

### sillyspec 仓变更

| 操作 | 文件路径 | 说明 |
|---|---|---|
| 修改 | src/run/shared.js | X1 删除/归档时上报 status='deleted' 墓碑；X3 步骤开始上报（triggerSync 周边，:587） |
| 修改 | src/sync.js | X1 上行载荷支持 deleted；X2 新增 pullSpecBundle()（现有 pull 仅进度六表，:986） |
| 修改 | src/index.js | X2 顶层命令注册（`sillyspec pull --spec`，命名 plan 定） |
| 修改 | src/stages/execute.js | X4 execute 每任务完成触发 triggerSync（per-task 派发处） |

## 13. 测试策略

- backend 单测：scoped 删除双断言（scope 内消失删/scope 外不删）；四复活通道各一条拦截测试；**删除环豁免**（deleted 行在 scoped/全量 reparse 下均不物理删、`_apply_parsed` 不回翻 location）；**daemon 全量回退落盘级拦截**（tar 含 platform_deleted 路径 → 不落盘、行不复活）；**`_ensure_change_row` 行缺失时 manifest 兜底锚点**拒收；7 天占位保护回归；quicklog 对账（文件删条目→hidden；文件滞后不误杀）；DELETE 端点权限矩阵（owner/非 owner+CHANGE_ARCHIVE/非 owner 无权限 403；已删 404/409）；spec-bundle 端点鉴权（shpsync 本 workspace 可拉、他 workspace 403、无 workspace 403）；路由前置于 `/changes/{name}`；LIKE 前缀转义（变更名含 `_`）。
- 集成：裸删→spec-sync→自动收敛全链路（无手动 reparse）；平台删除→另一成员 CLI 推 add→被拒；daemon 全量回退→不复活。
- frontend：删除弹层交互（名称确认防呆）、下载按钮（blob 下载 mock）；活动徽标三态（进行中/停滞/空闲，含 last_pushed_at 为空回退）。
- backend 补充（波 4）：enrich 投影 `last_pushed_at`（有值/无 progress 行两态）单测。
- 遵守 CLAUDE.md 规则 0：只跑模块相关测试，全量留 CI。

## 14. 风险登记

| # | 风险 | 等级 | 缓解 |
|---|---|---|---|
| R-01 | scoped 删除误删范围外变更（R-08 原始 Grill P0） | 高 | 仅 scope∩磁盘确认消失；scope 外零动作；红测改写双断言；30 天备份区兜底 |
| R-02 | 防复活拦截漏网（四通道之一遗漏） | 高 | 通道清单化逐条测试；conflict 显式返回让 CLI 可感知 |
| R-03 | Windows bind mount stat 性能断崖 | 中 | 空目录清理仅 ops 涉及目录；quicklog 对账仅重解析 quicklog/；无整树扫描新增 |
| R-04 | owner 漂移致误删他人变更 | 中 | D-001 接受语义；名称末段输入防呆；change_events 审计 |
| R-05 | alembic 并行多 head | 中 | 单 revision；提交前 heads 检查（知识库已知坑） |
| R-06 | `/changes/-/spec-bundle` 路由被 `/changes/{name}` 吞 | 低 | 字面量路由前置注册 + 测试（ppm export-excel 同款坑） |
| R-07 | CLI 跨仓改动滞后于平台 | 低 | 平台闭环不依赖 CLI（方案 A）；CLI 墓碑/pull 为增强 |
| R-08 | 全量 reparse 重建已删变更 | 低 | platform_deleted 拦截镜像复活⇒磁盘无目录⇒parser 不产出；_ensure_change_row 双保险 |
| R-09 | deleted 墓碑行被删除环物理删（Grill B-1） | 高→已缓解 | 两处删除环 + `_apply_parsed` 三点豁免 deleted 行；锚点另有 manifest platform_deleted 兜底（§5.4 加固） |
| R-10 | daemon 全量回退把文件落回磁盘致 parser 翻回 active（Grill B-2） | 高→已缓解 | `_write_spec_root` 落盘集计算阶段排除 platform_deleted 路径，文件不落盘（§5.4 加固）；带专项测试 |
| R-11 | scoped rename 复用 `_detect_renames` 的 `.sillyspec` 包裹路径空判与 `existing_by_key` 全量拉取 | 低 | plan 阶段细化：scope 集内过滤 + 仅取 scope 相关行（Grill gap 备注） |
| R-12 | 停滞启发式误报（步骤合法长跑 > 30 分钟被标「停滞」） | 低 | 徽标文案只陈述事实（「最后信号 x 分钟前」）不断言挂死；阈值常量前端可调；心跳（Layer 3）留作将来根治 |
| R-13 | X3/X4 增加推送频率 | 低 | 每次一轻量 JSON POST；单进程顺序推送 base_ts 单调无冲突；无差异时 CLI 侧短路（沿 spec-sync 既有优化）。多用户同 key 双 CLI 交错时冲突频率随之上升，但既有 base_ts 409+CLI resolve 机制可消化（round 3 P2-c 备注，plan 落一句说明） |

## 15. Non-Goals（不在范围内）

- 回收站/恢复 UI（D-002）
- 物理删除 Change 行（审计 CASCADE 丢失）
- 推翻 R-07（配置卡常态展示 spec_version / 本地落后提醒）
- daemon 侧任何改动（pull/push 时机维持现状）
- 多工作区批量删除、按时间批量清理
- quicklog pushed 行硬删（仅 hidden）
- 本仓内实现 sillyspec CLI 代码（跨仓任务，仅在 tasks 标注交付物）
- 60s 心跳（Layer 3）实现（§8.3 协议预留，不实现）；「区分挂死 vs 没在跑」的强判定（需心跳，不在本期）

## 16. 自审（Self-Review）

- ✅ 五条需求（删除入口/删除同步/多用户/拉取时机/进行中可见性）各有对应设计节与 FR 映射（第五条 revision 1 并入，D-007）。
- ✅ 所有关键改动点有 file:line 依据（三轮子代理 + 主代理抽查核实）；调用方法均已 grep 确认存在。
- ✅ 与知识库决策不冲突：D-009 blob 范式对齐、四轨鉴权（shpsync 只读子集）、R-08 修订有据（原始动机保留）、R-07 不推翻。
- ⚠️ 已知取舍：owner 漂移删除语义（用户拍板接受）；quicklog 对账选 apply 期（方案 B）而非合并期（方案 A），理由是文件滞后误杀风险。
- ⚠️ 跨仓依赖：波 1/2/3 平台侧自洽；CLI 增强两项（墓碑/pull）在 sillyspec 仓另循其流程，本变更不阻塞。
- ❓ 开放问题（plan 阶段定）：DELETE 端点是否同时清理 quicklog 中该变更关联条目（现设计仅 hidden 对账，不做变更级联动）——倾向不做，YAGNI。
- ✅ Design Grill 独立审查（round 2）：B-1（删除环豁免+持久锚点）、B-2（落盘级拦截）两个 P1 已修入 §5.4/§6.2/§10/§11/§13/§14-R09/R10；gap 5 条（`_write_auth` 口径、LIKE 转义、§5.5 移写路径、delete op 放行、409 结构化区分）已修；R-11（scoped rename 复用细节）留 plan 细化。（revision 1 章节重排：原 §8-§16 → §9-§17，波 4 插入为新 §8）
- ✅ revision 1 增量（波 4）：纯只读调查子代理证据链（推送时机 triggerSync 每步 --done / last_pushed_at 未投影 / agent-status 纯 CLI 恒空 / 30s 轮询已就绪）；Layer 1 零 migration 零工具改动，Layer 2 后端零改动。

## 17. 后续阶段

- scale=large → `sillyspec run plan`（Wave × Task 拆解，含跨仓任务标注）。
- 原型 `prototype-delete-and-pull.html` 供 execute 阶段前端对照复用。
