---
author: qinyi
created_at: 2026-10-16T16:46:00
---

# 冲突对比文件名口径不一致——跨多变更的全量冲突恒 `conflict_record_missing`，且「刷新冲突列表」无效

> **状态**：活跃坑，未修。平台侧对比入口对这种冲突结构性失效；文案误导为「机器离线/504」。

## 现象（2026-10-16 生产实证）

工作区 `4e9eb05b-de2b-44fa-88e6-84098d164492`（机器 `16fef8b5…` centos8）变更页冲突行
`2026-10-13-fire-unitadd-form-import` 点「查看对比」恒 502：

```json
{"code": "HTTP_502_DAEMON_RPC_REMOTE", "message": "冲突记录已失效，请刷新冲突列表。",
 "details": {"method": "sillyspec_conflict_snapshot", "daemon_code": "conflict_record_missing",
             "daemon_message": "冲突记录不存在：spec-sync-conflict-2026-10-13-fire-unitadd-form-import.json"}}
```

**刷新列表 / 重试均无效（行不消失）**——用户实证「刷新了问题还在」。
页面失败卡文案误导：写死「机器可能离线或对比读取超时（504）」，真实状态是 502/记录缺失，
机器在线（centos8 last_hb 与查询同刻）。

## 根因（两层，互相独立）

### 1. 列表行是平台注册表 open 行，关闭条件只有「下一次推送全绿」

- 行来源：`spec_conflicts`（stage=spec-sync）的 **open 行**，前端 `platform-sync-section.tsx`
  的 `registryVersionRows` 按 `details_json.conflicting_paths` 逐路径归因单个变更名成行
  （backend 写入点 `spec_workspace/service.py:1313` `_upsert_sync_conflict`）。
- 关闭条件：`_close_open_sync_conflicts`（`spec_workspace/service.py:1366-1390`），只在
  该工作区一次**全绿**推送的收尾被调用（调用点 `:2753`）。刷新/轮询/时间都不会关；
  前端无手动关闭入口（`POST /spec-conflicts/{id}/resolve` 有接口、无 UI 消费方）。

### 2. 对比文件名口径不一致（结构性 100% 失败）

- CLI 落盘（`sillyspec` CLI `src/spec-sync.js:815` + `:659-666`）：
  `conflictLabel = changeName || attributeChangeLabel(realPaths)`，而
  `attributeChangeLabel` **只在恰好一个变更名时返回该名，跨 ≥2 变更名返回 `'full-tree'`**
  → 记录文件名 `spec-sync-conflict-full-tree.json`（记录内 `change: 'full-tree'`）。
- daemon 对比读取（`sillyhub-daemon/src/sillyspec-manager.ts:2376-2392`）：
  固定按平台传来的 change 拼 `spec-sync-conflict-<change>.json`，**无 full-tree 兜底**。
- 平台行归因：按**单个**路径的变更名出行（`registryVersionRows` 逐名）。
- ⇒ 冲突一旦跨两个及以上变更（或含非 `changes/` 路径的全量冲突），平台行名与机器实际
  文件名必然不同 → 对比恒 `conflict_record_missing`。

## 实测证据（2026-10-16 16:4x，生产库只读查询）

- open 行 `971af5b3-240d-409f-b0c3-af3f14c11b7b`：created `2026-10-16T08:01:28Z`
  （北京 16:01），last_seen `08:01:56Z`，`platform_deleted: []`。
- `conflicting_paths` 共 7 个、跨 **2 个变更名** → 按 CLI 口径落盘名必为 `full-tree`：
  `changes/archive/2026-10-13-fire-unitadd-form-import/{design,proposal,requirements,tasks}.md`、
  `changes/archive/2026-10-13-fire-unitadd-relayout/{proposal,visual-evidence}.md`、
  `knowledge/fr/sillyspec.md`。
- 机器 `16fef8b5`（centos8，online，last_hb 同刻）`sillyspec_status_map[4e9eb05b]`：
  `pending_conflicts: []`、`conflict_count: 0` —— 机器侧看不到该冲突，也就没有「按变更名」
  命名的本地文件可读。
- backend 访问日志：该 compare 被反复请求，恒 502。

## 处置 / 规避（按当下可执行度）

1. **收集端闭环（推荐）**：在目标机器该仓库跑一次全量推送（`sillyspec platform sync`）→
   本地记录以 `spec-sync-conflict-full-tree.json` 重新落盘（suppress 分支读到文件缺失不会
   跳过重写）→ `sillyspec platform resolve full-tree --take-platform|--keep-local` 裁决后重推
   → 全绿时 backend 自动把 open 行置 resolved。
2. **平台侧应急**：`POST /api/workspaces/{ws}/spec-conflicts/{id}/resolve`（WORKSPACE_WRITE；
   目前无 UI，只能接口/运维操作）。
3. 机器侧无本地记录时，`sillyspec platform resolve <单个变更名>` 也必然失败
   （CLI 报「无可解决冲突：无 sync-conflict / spec-sync-conflict 文件」）——不要按行名去裁决。

## 建议修复方向（需开 change）

- daemon compare：`spec-sync-conflict-<change>.json` 缺失时回退查
  `spec-sync-conflict-full-tree.json`，并校验该变更路径在其中（最小改动的兼容修）；
- 或平台行携带记录 label（`details_json` 里读记录文件名）驱动对比，取代「按路径猜名字」；
- 失败文案按 `daemon_code` 分支：`conflict_record_missing` 显示「该冲突在机器上已无本地记录，
  请重新同步」而不是「机器可能离线/超时（504）」；
- 跨变更行要么禁用「查看对比」，要么提供平台侧差异视图（不依赖机器本地记录）。

## 关联与排查提示

- 同类先例（根因不同）：`docs/sillyspec/finished/conflict-compare-wrong-status-root.md`
  （2026-09「列表对、对比错」是 daemon 读错根；本次是文件名口径不一致）。
- 引入注册表行的变更：`2026-10-11-sync-conflict-tri-fix`（FR-01，专为「机器看不到的
  daemon 通道冲突」补渲染行，但未处理「本地无记录」时对比/裁决不可用）。
- **排查注意**：`crrcdt.ppdmq.top` 的实际后端在**腾讯云 124.222.127.242**
  （`/opt/sillyhub/deploy/deploy`）；阿里云 47.113.145.252 只是 nginx 边车，且残留一份
  **无流量的旧栈副本（独立数据库）**——连错机器会得到与线上不一致的结论（本次排查先
  误查阿里云副本库，其 `spec_conflicts` 行状态与线上不同，已更正）。
