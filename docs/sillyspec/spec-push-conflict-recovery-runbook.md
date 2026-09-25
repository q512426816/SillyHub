---
title: spec 推送冲突（SpecPushConflict / HTTP 413）恢复 runbook——c84182bc / b97f8231 实况
date: 2026-09-25
status: 活跃（待人工拍板执行；本文是操作手册，不是已执行记录）
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

## 恢复步骤（按序执行，每步可验证）

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
