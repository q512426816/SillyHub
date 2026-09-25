---
title: spec 推送冲突（SpecPushConflict / HTTP 413）恢复 runbook——c84182bc / b97f8231 实况
date: 2026-09-25
status: 已完成（2026-09-25 全链路收口：部署 + 复活修复 + 双工作区全量重推 + 命中补传，三项对账全过；遗留 4 文件版本竞态见尾注）
source: 2026-09-25 知识命中调查（daemon.log 9-18~9-23 五次 SpecPushConflict + b97 两次 413 实证）
---

# spec 推送冲突恢复 runbook（人工拍板路径）

> 背景：设计上 `SpecPushConflict` 是**人工拍板语义**（`sillyhub-daemon/src/spec-sync.ts:259`
> 注释钉死：不自动回退全量 tar）。当前两工作区都停在这个态，导致**镜像冻结 + 命中遥测一行都上不去**
> （hits 上行钩子挂在 postSpecSync 成功汇聚点）。

## 实况（2026-09-25 诊断）

| 工作区 | 症状 | 证据 |
|---|---|---|
| `c84182bc`（sillyspec CLI 仓） | 增量推送恒 conflict，自 09-18 起 5 次 | daemon.log `SpecPushConflict: incremental push conflict detected ... server_versions={"changes/2026-09-23-watcher-prev…}`；daemon 本地 manifest（30 个 knowledge 文件）与服务器镜像（67 个）互不一致——镜像被**第二写者**（CLI `sillyspec platform sync`，shpsync_ token）写过，daemon manifest 的 base_version 与服务器漂移 |
| `b97f8231`（本平台仓） | 推送载荷超限 | daemon.log 09-19/09-21 `HTTP 413 POST .../spec-workspace/sync`（注意：平台侧 asyncpg 批量分片修复 c72d04c8f 治的是 500，413 是体积上限另一层） |

连带后果：平台知识页/扫描文档页的命中与镜像停在 2026-09-23 之前（c84182bc 最新命中
2026-09-23T19:49Z；b97 停在 09-20T16:05Z）；c84182bc 镜像缺本地 13 个 decisions/fr 文件；
b97 镜像缺整个 `knowledge/generated/`。

## 执行记录（2026-09-25 18:xx，本 runbook 部分执行）

已执行（按「以本地为准」）：
1. ✅ 删除 daemon 陈旧 manifest `~/.sillyhub/daemon/manifests/c84182bc-….json`（备份在本仓
   `.tmp-analysis/manifest-backup-20260925/`）——下一轮 daemon 同步将走全量 tar（无乐观锁）。
2. ✅ CLI 正规通道 `sillyspec platform sync --change 2026-09-25-thin-fr-inject-parity`：变更进度
   同步成功；遗留 4 文件 spec 树冲突（`changes/archive/2026-09-22-thin-fr-distill-sync/*`，
   服务器版本停在 2，`resolve --keep-local` 两次仍冲突——疑与线上旧后端的墓碑守卫相关，部署后重试）。
3. ✅ 手工全量推送 `POST /spec-workspace/sync`（80MB tar，8857 成员，与 daemon packSpecDir 同款
   排除规则）→ 服务器回 `ok:true, reparsed 304, reparsed_changes 367`，但**只落了 6751/8857**：
   13 个知识文件 + 6 proposed + 319 quicklog + 1707 changes（后者是平台墓碑前缀按设计排除）仍未落。
4. ✅ 命中遥测补传：卡住的 11 行新命中经 daemon 同款通道上行成功（ingested 11，dup 0）——
   知识页最新命中时间从 2026-09-23T19:49Z 前进到 **2026-09-25T05:06Z**，覆盖率 17.7% → 18.3%。

**根因判定（本地复现实证）**：用平台 HEAD 代码在本地对同一 tar 跑 `apply_sync` → **落盘
8856/8857（唯一未落=local.yaml，设计排除），knowledge 86/86 全落**。即：全量同步代码没问题，
**生产 crrcdt.ppdmq.top 跑的是旧版后端**，其落盘行为丢成员（13 个知识文件正卡在这里）。

## 剩余步骤（按序，需部署权限）

1. **部署 main 到生产**（含：全量同步修复链、知识锚点容错、scan-docs 口径、asyncpg 分片、
   墓碑 heal 等全部未上线修复）——用本仓 `deploy-to-server` 技能。
2. **重跑一次全量推送**（同款命令）：
   ```bash
   cd C:/Users/qinyi/IdeaProjects/sillyspec && tar 包构建与推送脚本见
   .tmp-analysis/（或等 daemon 下一轮同步自动全量——manifest 已删，daemon 会自己推）
   ```
3. **重试冲突裁决**：`sillyspec platform resolve 2026-09-25-thin-fr-inject-parity --keep-local`
   （新后端的墓碑 heal 上线后应能过；其余 9 个 `.runtime/spec-sync-conflict-*` 同批处理）。
4. **验收（三项逐文件对账）**：`GET /knowledge` 应 86 个文件；条目数 ≈1962；文件级命中数与
   本地 jsonl 一致、最新命中时间随新变更前进。b97f8231 的 413 在部署后用分批/上限处置。

## 原版恢复步骤（存档——1/2 已执行，见上）

1. **先定哪侧为准**（拍板项，无法代办）：c84182bc 的本地树（sillyspec 仓 `.sillyspec/`）是
   「一切以本地文件为准」的源；服务器镜像是 9-24 合并前后的混合快照。**建议以本地为准**。
2. **重建 daemon 侧基线**（以本地为准时）：删除 `~/.sillyhub/daemon/manifests/c84182bc-….json`
   与 `b97f8231-….json`，重启 daemon（或触发一次同步）。pull 落地路径会用落地树**重建本地
   manifest 并回填真实版本**（spec-sync.ts pullSpecBundle 后置逻辑，含
   `readBundleManifestVersions`），之后增量推送不再撞 base_version 乐观锁。
   - 若担心 pull 覆盖本地未上行改动：先 `git -C <repo> status` 确认 `.sillyspec/` 已全部
     commit（pull 的整树交换会覆盖本地 spec 目录）。
3. **b97 的 413**：查 nginx `client_max_body_size`（当前 413 是 HTML 错误页来自 nginx/1.24）
   与平台 spec-sync 单请求体积上限；或等 daemon 分批推送（platform 侧 chunk 修复已进 main，
   **需先部署到 crrcdt.ppdmq.top**）。
4. **恢复后验证（三项逐文件对账，全等才算过）**：
   - 知识页文件清单 = 本地 `knowledge/` 文件清单（c84182bc 应 86 个、b97 应 102 个）；
   - 每文件条目数与本地一致（c84182bc 本地口径 1962 条）；
   - 文件级命中数（页面 🔥 徽标 / `entry_counts`）与本地 jsonl 计数一致，且 stats 的
     最新命中时间随新变更前进。
5. **单写者纪律（防复发）**：同一工作区只保留一个写者——daemon 自动同步或 CLI
   `sillyspec platform sync` 二选一。双写者会让 manifest/版本漂移反复出现（本次根因）。

## 相关面（不在本 runbook 处理）

- daemon hits 上行断点的「替换后长回」洞已修（2026-09-25-daemon-hits-upload-fingerprint，
  需随 daemon 重建/部署生效）；当前 c84182bc 的 3389/9 行卡点在钳位路径内，恢复同步后自愈。
- 知识页锚点归属容错已修（2026-09-25-knowledge-anchor-match-tolerance）；镜像修好后覆盖率
  会显著回升（本地口径 c84182bc ≈ 28.2%、b97 ≈ 18.8%，且 65.9%/12.6% 的不可归属命中已收敛）。

## 收口结果（2026-09-25 21:0x，全链路完成）

1. ✅ **部署 main 到生产**（两次：先全量镜像，随后追加 `2026-09-25-full-sync-resurrect-missing`
   修复后重发；daemon bundle 重打随镜像分发，公网/后端 latest.json 一致）。
2. ✅ **修出第四个变更**：全量同步「同内容跳过」分支加「磁盘在位 + 行在线」前提与复活语义
   （生产实证：行在、哈希同、磁盘缺文件 → 全量推送永远写不回；新用例三态钉死，
   评审 PASS）。
3. ✅ **c84182bc 三项对账全过**：knowledge 文件 86/86（13 个目标全在）；条目全集 1975；
   覆盖 **28.8%**（锚点容错生效，榜 72→95 行）；最新命中 2026-09-25T05:06Z。
4. ✅ **b97f8231 同修**：102/102 文件（generated/ 41 个全回）；命中补传 863 行
   （9-21~9-25 空窗，分批 ≤2000）；覆盖 **19.9%**；最新命中 2026-09-24T23:58Z。
5. ⚠️ 遗留：`resolve --keep-local` 对 4 个旧归档文件（2026-09-22-thin-fr-distill-sync/*）
   仍报「裁决期间又有更新」但 server_versions 停在 2 不动——版本竞态现象与回执不符，
   疑 CLI 与平台增量协议的版本比对缺陷，留待单独排查（不影响页面数据）。
6. 服务器清理：images.tar.gz 已删 + prune；backup tag ×4 留作回滚（确认稳定后可
   `docker rmi` 清理）。daemon 本地旧 hits 状态文件待其下一轮同步自愈（指纹断点已上线）。
