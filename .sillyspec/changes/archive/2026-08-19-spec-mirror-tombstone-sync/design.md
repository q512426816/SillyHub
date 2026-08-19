---
change: 2026-08-19-spec-mirror-tombstone-sync
title: 平台 spec 镜像全量同步删除对账收敛（墓碑语义补全）
scale: large
tier: independent
status: design
author: qinyi
created_at: 2026-08-19 22:10:00
risk_level: unit-sufficient
---

# 设计：平台 spec 镜像全量同步删除对账收敛

## 1. 背景与问题

### 1.1 实证缺陷（2026-08-19 生产实例）

变更中心「进行中」计数 39，真实仓库 active 变更 24，差 15 条。逐层定位：

1. **镜像只增不删**：`spec_workspace/service.py` 的 `_write_spec_root`（全量 tar 落盘，
   `import_from_repo` / `import_from_repo_sse` / `apply_sync` 三入口共用）采用
   "Files in spec_root but NOT in staging are kept"（D-006@v2，2026-08-13 决策）的
   保留策略——真实仓库归档 / 删除 / 改名的变更目录，在平台镜像
   `/data/spec-workspaces/{ws}/changes/` 里永久残留。实测镜像 active 目录 41 个 vs
   真实仓库 24 个。
2. **「重新扫描」无法收敛**：reparse 忠实重扫过期镜像，`deleted=0`；镜像里有什么
   DB 就有什么。
3. **占位行保护无时效**：`change/service.py` reparse 删除环的
   `_progress_reported_active_keys`（ql-20260815-002）——`platform_change_progress`
   最近一次上行报 `status=active` 且无文档的占位行不删。6 条测试残留行
   （`default` / `perf-remediation` / `security-audit-remediation` / `test-change-creation`
   / `workspace-file-browser` / `2026-08-19-runtime-read-direct-from-daemon`）因
   progress 上行过一次且再无人推，永久滞留「进行中」。
4. 本次已手工收敛（24=24），但**机制性缺口未修**——下次归档 / 改名 / 删除后必然复发。

### 1.2 既有语义自相矛盾（根因）

- `_write_spec_root` 末尾**全表清空** `SpecFileManifest`（2026-08-13-platform-managed-
  file-sync Q7/R-01：整树覆盖后旧 per-file version 无意义）——即全量同步早已宣告
  「tar 是整树权威快照」；
- 但同函数的 per-file merge 又**保留**镜像独有文件（「保护其他成员独有文档」）——
  保留策略无法区分「他人独有文档」与「改名 / 删除产生的幽灵残留」，因为改名归档
  （`2026-08-18-workspace-role-type` → `2026-08-19-workspace-role-type`）后旧目录对
  保留策略而言就是「镜像独有」，被无限保留。
- 增量路径 `apply_ops`（D-011）反而有完整删除语义：delete 软删 move 到
  `spec-backups/{ws}/{ts}/`、清单 `exists=False` 墓碑、30 天机会式修剪。**全量路径
  是唯一缺口。**

## 2. 目标与非目标

### 目标
- FR-01：全量同步（tar 落盘）后，镜像与 tar 快照对账——镜像里 staging 未包含的
  文件软删（move 到既有备份区），改名 / 删除 / 归档产生的幽灵目录自动消失。
- FR-02：`spec_file_manifest` 与对账结果一致——被删文件行置 `exists=False` 墓碑
  （保留乐观锁谱系），不再全表 wipe。
- FR-03：占位行保护加时效——progress 上行超过 7 天的占位行不再被保护，全量
  reparse 正常删除其 changes 行。
- FR-04：坏包护栏——staging 文件数异常偏小时中止对账（防坏 tar / 空包清空镜像）。

### 非目标 / Non-Goals
- 不动增量协议 `apply_ops`（已完备）。
- 不动 daemon tar 打包方、CLI spec-sync、前端（零改动面）。
- 不做后台对账任务 / 定时清理调度。
- 不做 UI 手动清理入口。
- 不要求历史兼容（未上线，允许重置数据）。

## 3. 方案对比（选定 A）

| 方案 | 思路 | 结论 |
|---|---|---|
| **A. 全量同步对账收敛** | `_write_spec_root` 补 staging 对账删除 + manifest 墓碑对齐 + 占位保护时效化 | **选定** |
| B. 后台对账任务 | 定时任务对账镜像 vs manifest | 拒绝：不修语义缺口，收敛有延迟，新增调度面 |
| C. 手动清理端点 | UI/API 手动清幽灵 | 拒绝：治标；用户已抱怨手工负担 |

选 A 理由：直接修语义缺口；删除语义与增量路径 `apply_ops` 收敛为同一套（备份区 +
墓碑）；DB 收敛复用既有 reparse 链路，零新面。

## 4. 详细设计

### 4.1 删除对账算法（`_write_spec_root` 内，循环后新增阶段）

时序：tar 解包 staging → per-file merge（现有）→ **对账删除（新增）** → manifest
对齐（改造现有 wipe）→ spec_version bump + commit。

```
对账删除（全部 FS 段入 asyncio.to_thread，对齐 ql-20260818-009 范式）：
1. 对账基准集 = merge 阶段实际落盘集（merge 循环内收集 rel_path，含跳过 .runtime
   与 local.yaml 过滤后的真实落盘清单）。注意因果准确性：tar 解包层
   （_extract_spec_tar_to_staging）只过滤 local.yaml（SERVER_EXCLUDED_FILENAMES）；
   .runtime 无 tar 路径过滤（靠打包方排除 + merge 循环跳过）——异构/历史 tar 可能把
   .runtime 解进 staging 但不落盘，用「实际落盘集」作基准即天然排除（Grill P1 修正）。
2. 护栏：落盘集为空 → 跳过对账（空 tar 异常，维持现状不删任何东西）；
   磁盘现有文件数 > 2 × max(落盘集大小, 200) → 中止对账 + warn 日志
   （坏包 / 半截包保护：本仓实测 3714 文件镜像 vs staging 正常比例 ≈1.005，阈值 2
   足够宽松；200 起步防小树误伤）
3. walk spec_root 收集现有文件（rglob，排除 .runtime/ 任意深度）
4. 对每个 现有文件 ∉ 落盘集：
   move 到 spec-backups/{ws}/{收敛批时间戳}/<rel_path>（同一批共用一个 ts 目录）
5. 自底向上清理空目录：os.walk(topdown=False)，目录为空且非 spec_root 本身 → rmdir
   （changes/ 幽灵变更目录收敛后整目录消失；archive/ 非空不受影响）
6. 机会式修剪备份区（复用 _prune_spec_backups，同批执行）
7. 对账统计（converged_files / converged_dirs）写入日志 + SSE done 事件扩展字段
```

### 4.2 manifest 对齐（替代现有全表 wipe）

现有：`DELETE FROM SpecFileManifest WHERE workspace_id = ?`（922-930 行）。

改为逐行对账（在对账删除之后、最终 commit 之前）：
- IN 预取该 workspace 全部 manifest 行。
- tar 命中文件（staging_files）：upsert——有行则更新 hash/version+1/exists=True；
  无行插入 version=1（谱系重启，daemon 下次 spec-manifest 拉到新基线走 R-07 对齐）。
- 镜像被删文件：有行则 `exists=False` + version+1（墓碑，保留乐观锁语义——daemon
  缓存若仍持有该路径旧 version，上行时命中墓碑行不再判 conflict 死锁，对齐
  ql-20260819-004 的软删行复活语义）；无行不动。
- **不再全表 DELETE**。

### 4.3 占位行保护时效（`change/service.py`）

`_progress_reported_active_keys` 现返回全部 `status=active` 的 name；改为加时间窗：

```python
cutoff = datetime.now(UTC) - timedelta(days=7)
# 时效字段用 platform_change_progress.updated_at（服务端 timezone-aware 审计列，
# 非 last_pushed_at——后者是 String(64) 存客户端 ISO 原值，解析需容错且契约语义是
# 乐观锁基准非时效源，Grill P2-1 修正）；updated_at < cutoff 的行不计入保护集
```

7 天 = CLI 一个 change 完整周期（brainstorm→archive 跨多日）的裕量：活跃变更必然
在 7 天内有 progress 上行；>7 天无上行且无文档的行是死占位。CLI 长期空闲暂停后
恢复时，若 change 行已被删，`_ensure_change_row` 会重建占位行（upsert 语义），
不丢数据。

### 4.4 reparse 触达（零新增）

`apply_sync` / SSE import 链路在 `_write_spec_root` 后已有 `_reparse_phase` 全量
change reparse（含 delete 环）。对账删除发生在 reparse 之前 → 幽灵目录消失后
reparse 的删除环自然清掉对应 changes 行。「重新扫描」按钮（手工 reparse）也因
镜像已收敛而能正确对账。scan_docs 同理：对账删文件后 scan_docs reparse 的软删环
（exists=False + content=None）自动收敛 ScanDocument，机制已有零新增（Grill P2-2）。
**本变更不改 reparse 触发面。**

### 4.5 生命周期契约

不涉及生命周期契约（本变更不新增 / 修改 agent_run / lease / session 状态机；
仅 FS 对账 + manifest 行级状态 + changes 行删除收敛）。

## 5. 数据流与影响面

```
daemon get_spec_bundle RPC → tar → staging 解包
  → per-file merge（不变）
  → [新] 对账删除：镜像独有文件 → spec-backups/{ws}/{ts}/
  → [改] manifest 逐行对齐（墓碑替代 wipe）
  → spec_version += 1, commit
  → （既有）reparse docs / changes → DB 收敛
```

- 影响模块：`spec_workspace`（主）、`change`（次，占位保护时效）。
- 零改动：daemon、CLI、frontend、api-types（无 API 契约变化——SSE 事件加字段是
  加法，前端不消费新字段也不破坏）。

## 6. 文件变更清单 / File Changes

| 文件 | 动作 | 内容 |
|---|---|---|
| `backend/app/modules/spec_workspace/service.py` | 修改 | `_write_spec_root` 对账删除阶段 + manifest 逐行对齐（替代 wipe）；新 helper `_converge_stale_files`（入线程）；SSE 事件加 `converged_files` 字段 |
| `backend/app/modules/change/service.py` | 修改 | `_progress_reported_active_keys` 加 7 天时效窗 |
| `backend/app/modules/spec_workspace/tests/test_full_sync_convergence.py` | 新增 | 对账删除 / 护栏 / manifest 墓碑 / local.yaml 覆盖删除 用例 |
| `backend/app/modules/change/tests/test_reparse_guard.py` | 修改 | 占位保护时效用例（新旧行为边界） |

## 7. 测试策略

- 单测（unit-sufficient，risk_level 已标）：
  - 对账删除：镜像多 3 文件 → 全部 move 备份区 + 空目录清理；staging 与镜像一致 → 零删除。
  - 护栏：空 tar 跳过；磁盘文件数超 2×max(staging,200) 中止 + 不动任何文件。
  - manifest：命中文件 version 递增；被删文件 exists=False 墓碑；无全表 DELETE。
  - local.yaml：镜像存量 local.yaml 在整包覆盖时被对账删除（SERVER_EXCLUDED 语义）。
  - 占位保护：updated_at 距今 6 天 → 保护；8 天 → 不保护（changes 行可删）。
- 回归：既有 spec_workspace / change 测试全绿。

## 8. 风险与缓解

| 风险 | 缓解 |
|---|---|
| 误删他人独有文档（原保留策略的保护意图） | 备份区 30 天可恢复 + 护栏中止条件 + warn 日志可审计；语义矛盾已论证（§1.2） |
| 坏 tar / 半截包清空镜像 | 双护栏：空 tar 跳过 + 数量比例中止 |
| manifest 墓碑与 daemon 缓存错位 | 墓碑保留 version 谱系 + ql-20260819-004 复活语义已闭合；R-07 兜底 |
| 大树对账 FS 慢 | 全部 FS 段入 to_thread（既有范式）；对账只 walk 不 stat 内容，量级 = 文件数 |
| 7 天窗误删长变更占位行 | upsert 重建语义不丢数据；7 天 > 单 change 周期裕量 |

## 9. 验收标准

1. 造镜像幽灵目录 + 跑 import → 幽灵目录消失、changes 行删除、备份区有残留副本。
2. manifest 无全表 wipe，被删文件行 exists=False。
3. 占位行 >7 天不再保护。
4. 既有测试全绿 + 新增用例全绿。

## 自审（Self-Review）

- ✅ 对账算法与 apply_ops 删除语义同构（备份区 / 墓碑 / 修剪复用同一套）。
- ✅ 时序明确：对账在 manifest 对齐前、reparse 前。
- ✅ Grill 审查（独立子代理，2026-08-19）三 gap 已修正入正文：P1 对账基准改用
  merge 实际落盘集（.runtime 无 tar 层过滤的因果纠正）；P2-1 时效字段改用
  updated_at（last_pushed_at 是 String(64) 字典序契约字段）；P2-2/P2-3（scan_docs
  收敛说明 + SSE 字段挂 done 事件）已补。
- ⚠️ 自审存疑①：护栏阈值 `2 × max(落盘集, 200)` 是拍的——大树（>200 文件）正常
  情况镜像与落盘集同量级（本仓实测比例 ≈1.005），比例 2 足够宽松；小树起步 200
  防误伤。执行时若发现真实树形态不同再调。
- ⚠️ 自审存疑②：manifest 逐行对齐后 daemon 拉新 bundle（spec_version bump）走全量
  重拉，per-file version 基线重置——与现状（wipe）效果等价，谱系保留只是锦上添花，
  风险可控。
- ✅ 占位时效 7 天窗的选择依据已给出；upsert 重建兜底已确认（`_ensure_change_row`
  在每次 progress 上行时执行）。
