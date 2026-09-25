# 归档墓碑致面板「已归档」变更被软删不可见（CLI archived 语义与平台 deleted 墓碑载荷分歧）

> 状态：已解决（CLI 侧 e4667729 + 平台侧 2026-09-24 修复，冤案行自愈通道就位）。发现于 2026-09-23-change-events-channel 部署后验收。
> author: qinyi ｜ created_at: 2026-09-23 09:05:00

## 现象

变更走 `sillyspec run archive --done --confirm` 正常归档后，平台面板变更中心的
「已归档」tab 里**看不到该变更**——列表搜索无结果，只能直达详情页 URL 访问。
平台行 `ux_changes.location='deleted'`（软删），且 spec 文件镜像被同步软删收敛。

实证样本（multi-agent-platform 工作区，2026-09-23 查）：

- `2026-09-23-change-events-channel` → deleted / stage=archive
- 同期同样 deleted 的归档变更：2026-09-20-knowledge-effect-panel、
  2026-09-16-platform-progress-ingest-persist、2026-09-14-workspace-drag-sort、
  2026-09-16-logs-cursor-tiebreaker
- 对照组：「已归档」tab 存量 210 条 location='archive' 的行——均为墓碑机制上线
  （2026-08-29）前归档、或归档后该机器再无 sillyspec 命令活动（无上行即无墓碑）

## 根因

**CLI 与平台对「归档终态」的语义分歧，墓碑载荷丢失了终态区分**：

1. CLI 本地库两种终态显式分离（`progress/change-registry.js:560-632`）：
   - `unregisterChange`（`run archive --confirm` / quick 收尾 / 自愈）→ `status='archived'`
   - `deleteChange`（`sillyspec change-delete` 显式废弃）→ `status='deleted'`
2. 但 CLI 的 **X1 墓碑机制**（`sync.js:676-712`，2026-08-29-change-delete-closure-
   and-spec-pull task-13 引入）在**归档后的下一次进度上行**时，对
   `status ∈ {'archived','deleted'}` 一律追加一次 `changes[].status='deleted'` 的
   墓碑 POST（源码注释："把墓碑状态写进载荷——changes[0].status='deleted'（对齐
   既有 'archived' 状态语义）"）——**archived 链的墓碑载荷与显式删除不可区分**。
3. 平台 `_apply_cli_tombstone`（backend/app/modules/platform_sync/service.py:712-766）
   见 `status='deleted'` 即置 `location='deleted'` 并触发 spec 镜像软删收敛——
   平台无从知晓这是「归档」还是「删除」。
4. 触发条件：归档收尾 `_touchLocalModified` 标脏 → 归档后该机器**任何**后续
   sillyspec 命令触发 bg-sync 上行 → 墓碑落地。归档后机器静默的变更则永远不发
   墓碑——这解释了存量 210 条 archive 行与新增 deleted 行的分布差异。

数据链证据（2026-09-23-change-events-channel）：

- 本地真库 `.sillyspec/.runtime/sillyspec.db`：`status='archived'`（本地语义正确，无数据丢失）
- 平台行：`location='deleted'`、`current_stage='archive'`
- 平台 progress 快照（GET /api/changes/{name}/progress）：`changes[].status='deleted'`
  （墓碑 POST 本身是一次 progress 上行，快照即墓碑载荷）
- 时间线：归档 22:19:00Z → 墓碑上行 22:19:04Z（本地库 last_active / 平台 last_synced）

## 影响

- 面板「已归档」tab 与 CLI 归档语义打架：归档变更在归档后只要机器上还有
  sillyspec 活动，就会从面板「已归档」tab 消失（被 deleted 过滤），面板侧
  「归档可回溯」价值减损；spec 文件镜像也被收敛（变更中心文件树不可见）。
- `run archive` 说明书宣称的「DB 注销（unregisterChange）」本地侧正确，但平台侧
  实际效果是**删除**而非**归档**——用户预期错位（本实证即用户验收时发现「看不到」）。

## 护栏 / 修复方向（供拍板）

- **根治（CLI 侧）**：墓碑载荷区分终态——archived 链发 `status='archived'` 墓碑、
  仅 change-delete 发 `'deleted'`；平台 `_apply_cli_tombstone` 同步认 `'archived'`
  墓碑并置 `location='archive'`（不再镜像软删）。两仓需协同发版（老 CLI + 新平台
  兼容窗口内平台可同时认两种载荷）。
- **治标（平台侧，可先行）**：「已归档」tab 列表过滤放宽为
  `location IN ('archive','deleted') AND current_stage='archive'`——已删但阶段
  未收 archive 的行（真删除，如 2026-09-03-group-list-n1-batch）仍不可见，
  归档链的行恢复可回溯。
- **用户侧规避（现状）**：归档变更详情页直达 URL 仍可访问（行未物理删）；
  想让某个归档变更留在「已归档」tab，归档后避免在同机跑 sillyspec 命令不现实
  ——仅作理解行为用，非真护栏。

## 证据锚点

- CLI：`node_modules/sillyspec/src/sync.js:676-712`（tombstoneDue 判定 + 墓碑追加）、
  `:974-976`（_pushTombstone 载荷注释）；`src/progress/change-registry.js:560-632`
  （deleteChange/unregisterChange 终态分离）
- 平台：`backend/app/modules/platform_sync/service.py:712-766`（_apply_cli_tombstone
  仅认 'deleted'）；`backend/app/modules/change/service.py:322-395`（面板手动删除路径，
  另一 deleted 写入方，与本坑无关）
- 排查记录：2026-09-23-change-events-channel 部署后验收会话（平台行/本地库/
  progress 快照三方对照，本文件「根因」节引全）

## 处置记录（2026-09-24）

**根治方向落地（两仓协同，按「修复方向·根治」一条）**：

1. **CLI 侧（并行会话已完成，sillyspec 仓 commit `e4667729`）**：墓碑载荷按链
   区分终态——`unregisterChange` 链（run archive / quick 收尾 / 自愈）墓碑
   `status='archived'`，仅 `deleteChange` 链发 `'deleted'`。已实证在仓。
2. **平台侧（本日修复，multi-agent-platform 工作树，未提交）**：
   - `_apply_cli_tombstone`（service.py）：`'archived'` 载荷 **no-op 早退**——
     不置 `location='deleted'`、不触发镜像软删收敛（归档可回溯，镜像保留）。
     刻意**不**翻 `location='archive'`：P1 ingest 不变量（2026-09-16，
     `test_archived_terminal_persists` 回归锚）规定 location 收敛归文件移动 +
     reparse，进度上行通道不开第二条 location 写路径。
   - 冤案行自愈：`upsert_progress` 拒收分支新增 `_heal_deleted_row_to_archive`
     ——旧 CLI 误标 `location='deleted'` 的行，收到新 CLI `status='archived'`
     载荷时翻回 `location='archive'` 后走正常接受（真删除载荷仍 409 拒收）。
     上述 5 条冤案行（change-events-channel 等）将由该机器新 CLI 版本后的
     下一次墓碑上行自动恢复「已归档」tab 可见。
   - 兜底判据（行缺失、仅 manifest platform_deleted 锚点）不猜恢复——真删除
     走平台删除入口的恢复流程。

**测试证据**（backend venv，pytest）：

- 新增 3 例（test_change_deleted_guard.py）：deleted 冤案行经 'archived' 载荷
  恢复 archive / 'archived' 载荷不软删 spec 镜像且不动 active 行 location /
  重复 'archived' 载荷幂等 no-op。
- 修复测试助手 `_get_change` 身份映射缓存缺陷（client 与 db_session 双
  session + expire_on_commit=False，多 push 场景需 `populate_existing` 强读
  DB 真值）。
- `app/modules/platform_sync/tests` 全量 **266 passed**（含 P1 ingest 回归锚）；
  ruff format/check、mypy（service.py）全绿。

**治标项不采纳**：「已归档」tab 过滤放宽（location IN ('archive','deleted')）
不再需要——根治 + 自愈通道已覆盖；放宽会把真删除行混进归档 tab。

**遗留**：镜像文件曾被软删收敛的冤案行，location 恢复后镜像由 reparse /
镜像驱动收敛自行对齐（软删不逆向恢复，位置恢复已满足归档 tab 可见主诉求）；
两仓发版节奏由用户掌握（旧 CLI + 新平台兼容窗口内 'deleted' 载荷行为不变）。
