---
author: qinyi
created_at: 2026-10-16T16:46:00
---

# 冲突对比文件名口径不一致——跨多变更的全量冲突恒 `conflict_record_missing`，且「刷新冲突列表」无效

> **状态**：部分修复（2026-10-16-conflict-full-tree-compare 已上线：daemon 读取侧 full-tree 兜底重取 + 四臂失败文案 + 行级「标记已处理」UI）。**结构性根因未修**：文件名口径由「猜名」改为「按变更路径段裁剪」绕过，记录生命周期断层（行开记录亡）仍在——详见文末「2026-10-17 补充实测」。

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

## 2026-10-17 补充实测（00:03~00:12，修复上线后生产复验）

已上线修复（main 994656fdd，发布记录 009）：

- daemon 读取侧兜底：主取 `conflict_record_missing` 时以 `full-tree` 重取并按变更路径段裁剪（daemon `sillyspec-manager.ts` 不动，兜底在 backend `sillyspec_compare.py`）；
- 失败卡四臂文案：`conflict_record_missing` → 「该冲突在本机已无快照（可能已随同步清理或已裁决），请重新同步后再试。」（生产实测生效，替换旧误导文案）；504 族保留重试；
- 行级「标记已处理」按钮（处置 2 有了 UI 消费方，上文「无 UI」表述已过时）。

**新实测事实（修复的边界）**：

1. **记录生命周期断层**：目标机器（centos8）`.sillyspec/.runtime/` 下 `spec-sync-conflict-<变更名>.json` 与 `spec-sync-conflict-full-tree.json` **双缺**（探针 daemon_message 点名证实）——兜底无米下锅，compare 对该行仍 502（新文案）。行 open 而记录亡的状态可持续存在。
2. **树冲突记录只在机器侧再生**：落盘点 = 会话结束 / 扫描收尾的树级推送（`syncSpecTreeIfNeeded`）。产品内「刷新」触发的定向同步（`platform sync --change`）**不触发树冲突**（实测 ok:true 且记录仍缺失）——新文案「请重新同步」对这类冲突**不可完全行动**，可行动的是处置 1（机器侧推送）与处置 2（平台裁决）。
3. **定向同步全绿也会关 open 行**：00:08 一次 per-change 同步 ok:true 后，工作区 open 行即被自动置 resolved（「下一次推送全绿」语义的实测复现，扩大了「全绿」的触发面——原理解只覆盖树推送）。
4. 复验证据与补验路径：`.sillyspec/changes/2026-10-16-conflict-full-tree-compare/verify-deploy-evidence.md`（200 场景留待机器下次树冲突时补验）。

## 处置收口（2026-10-20 关闭：结构性根因已修）

- **「行开记录亡」断层已修**（multi-agent-platform 仓 2026-10-20-conflict-platform-archive，归档 e96e07aef）：冲突推送时被拒 op 本身携带机器侧内容（add/update 的 base64 content 与 mtime、rename 的 new_path）——apply_ops 七处被拒点收集蒸馏进 open 行 `details_json.local_archive`（三重帽 32000 字符/文件、512KB 总量、300 条目；单条 fail-soft），对比端点在 daemon 记录双缺（change + full-tree 均 conflict_record_missing）时以留档自足回退（record_label=platform-archive、covered_changes/path_total 与 full-tree 兜底同口径段边界裁剪），平台侧仍实时读 spec_root——记录亡后对比不再恒 502，新文案「请重新同步」的可行动性缺口（事实 2）同时消除（回退不依赖机器再生记录）。前端弹窗补留档来源横幅（机器侧=冲突时点留档、平台侧=当前内容）。独立评审 PASS（1×P3 蒸馏器 mtime fail-soft 当场清偿）；后端 59/59 + 前端 modal 20/20 绿。
- **遗留注记**：200 场景补验（事实 4）仍未执行——修复上线后新冲突即走留档链路，补验的原始动机（兜底边界取证）已被留档回退覆盖，若需要历史场景取证另起。存量「行开记录亡」旧 open 行在新冲突推送时自动换新留档（整体替换语义）。
- 处置结论：结构性根因（记录生命周期断层）已闭环，本文件移入 finished/。
