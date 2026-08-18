---
schema_version: 1
doc_type: module-card
module_id: spec-sync
author: qinyi
created_at: 2026-08-18 01:45:00
---

# 规格树同步（spec-sync）

## 定位
workspace spec 树双向同步 + init lease 编排 + 版本保鲜（`src/spec-sync.ts`，
~1850 行）。三层结构：bundle 拉取（pullSpecBundle）、全量 tar 同步（packSpecDir +
postSpecSync 首同步/回退）、文件级增量同步（manifest 缓存 + diff ops +
base_version 乐观锁）。外加 init lease 完整编排（handleInitLease 拉起 sillyspec
init 子进程）与 spec_version 保鲜比对。设计原则 D-007@v1：纯模块级函数 + client
参数注入，不读 TaskRunner 实例状态，batch 与 interactive 路径共用。

## 契约摘要
- **拉取层**：`resolveSpecDir(wsId)` = `~/.sillyhub/daemon/specs/{wsId}`（wsId 含
  路径分隔符抛错）；`pullSpecBundle(client, wsId, opts)` 按三策略分支——
  platform-managed（拉平台 tar，404 容错 mkdir 空目录）/ repo-mirrored（缓存空时
  首次 fs.cp 源项目 `.sillyspec`）/ repo-native（junction 指向源项目，不 rm 不
  覆盖防顺链删源）；D-008 pull 前回灌：`hasUnsyncedLocalChanges`（pending_push
  标记 + 本地 mtime 新于 platform.json.synced_at 双信号）为真先 postSpecSync
  回灌，失败抛 `SpecPushBeforePullError` abort pull（不强行覆盖本地）。
- **全量层**：`packSpecDir(specRoot, opts?)` 手写 ustar 512B tar（name >100B 写
  GNU LongLink 'L' 头）；tar 解包 extractTar 带 Tar Slip 三重防护。
- **增量层**：清单缓存 `~/.sillyhub/daemon/manifests/{ws}.json`（`resolveManifestCachePath`，
  刻意移出 specDir 防 pull 的 rm -rf 清掉，BL-4）；条目 `{ hash(sha256), version,
  mtime }`；`postSpecSync(client, wsId, specRoot, changeWriteId?, onProgress?)` 返回
  `{ ok, reparsed, filesTotal? } | null`（mock client 未实现返 null）。
- **冲突**：`SpecPushConflict(workspaceId, serverVersions)`——服务器判 base_version
  过期返 conflict=true 时抛，调用方仅 warn 不自动重试（人工拍板，NFR-02）。
- **init lease**：`handleInitLease(client, params)` / `runSillyspecInit` /
  `MIN_SILLYSPEC_VERSION_FOR_INIT = '3.26.8'`；`SpawnFn` 依赖注入供测试。
- **保鲜**：`DAEMON_STATE_FILENAME = '.runtime/spec-version.json'`；
  `readLocalSpecVersion` / `shouldRefreshSpec(localVersion, leaseVersion)` /
  `bumpLocalSpecVersion`。
- 辅助：`extractChangeDirs(ops)`（changes/ 与 changes/archive/ 前缀 → change_dirs
  透传 backend scoped reparse）；`syncSpecTreeIfNeeded(ctx, client)`（interactive
  ctx-guarded 薄封装，ctx null 即 no-op，失败仅 warn）。
- 依赖 hub-client、local-yaml-writer（writeLocalYaml）；被 daemon / task-runner 使用。

## 关键逻辑
```
postSpecSyncImpl:
  cached = readLocalManifest(wsId)
  无缓存（首同步）→ packSpecDir tar → client.postSpecSync → 写全量快照(version=0)
  有缓存 → walk（mtime 未变复用缓存 hash, R-05）→ diff 生成 ops:
    add(新)/update(hash 变)/delete(缓存有本地无)/rename(同 hash 异路径不重传, R-02)
    每 op 带 per-file base_version
  → client.postSpecSyncIncremental(wsId, ops, changeWriteId, changeDirs)
    conflict=true → 抛 SpecPushConflict；404/网络错 → 回退全量 tar
  成功 → 按 new_versions 回写缓存
handleInitLease 6 步（顺序严格）:
  1 writeDaemonState(硬失败) → 2 pullSpecBundle(硬失败) → 3 runSillyspecInit(硬失败)
  → 4 postSpecSync(软失败仅 warn, R-03) → 5 writeLocalYaml(硬失败, D-003)
  → 6 返回 { ok, specVersion, daemonState, specDir }
runSillyspecInit: 版本门控 sillyspec --version ≥ 3.26.8（3s 超时）
  → spawn sillyspec init --dir --spec-dir --workspace-id --no-skills --tool
  （60s 超时杀树；Windows taskkill /T /F，POSIX 进程组 kill）
```

## 注意事项
- 上传排除三处统一（task-07 / D-008@v2）：顶层 `.runtime`（有点）/ `runtime`
  （无点）/ `projects` + 任意段 `worktrees`，computeIncrementalOps /
  buildFullManifest / packSpecDir 共用常量；缓存残留的排除路径行不参与 diff
  （否则生成 delete op 误删服务器行）；pull 路径不排除（历史行落地无妨）。
- `projects/` 排除原因：含成员机器绝对路径等本地环境信息，不上传。
- pending_push 标记（ql-20260816-003）：push 失败（非 conflict）写
  `specDir/.runtime/pending_push`，成功清除，conflict 不动（人工拍板非传输失败）；
  写/清均 best-effort。
- init 时序 D-002@v2：init 必须后置于 pull——pull 是整删重建（rm -rf），先 init
  会被物理删除。
- 版本门控每次 init 前独立跑（老 CLI 静默忽略 --no-skills/--tool 多值且 exit 0；
  preflight 仅启动跑一次不自愈，用户升级 CLI 后无需重启 daemon）。
- 保鲜决策表：lease 未带 latest_spec_version → 不强制刷新（旧 backend 零回归）；
  本地无版本记录 → 刷新；相等 → 跳过 pull；不等 → pull + bump 回写。
- onProgress 回调只报过程起点（total+processed=0），终态上报由 task-runner 在
  complete 前做；filesTotal 增量=ops 数、全量=快照文件数。

## 人工备注

<!-- MANUAL_NOTES_START -->
- ql-20260816-003 | `postSpecSync` 包装器实装 `pending_push` 标记（`hasUnsyncedLocalChanges` 信号 1，曾只读不写=死代码）：push 失败（网络/服务端终止/5xx）写 `specDir/.runtime/pending_push`，成功清除，`SpecPushConflict` 不动（人工拍板非传输失败）。作用：mtime 信号（信号 2）依赖 fs 时间戳比对（时钟偏移/粗粒度 fs 可能漏判），标记是显式「本地有未回灌改动」声明，pull-before-push（D-008）据其保证 daemon 中断/服务端终止时本地改动不被 pull 覆盖且下次同步自动重推。写/清均 best-effort（失败仅 warn，对齐 R-03）。impl 改名 `postSpecSyncImpl`（模块私有），公开签名不变。
- ql-20260816-003（测试基建）| ① 19 个 daemon 测试文件 `server_url` 从 `http://test:8000` 改 `http://127.0.0.1:8000`——"test" 主机 DNS 解析 2.3s/次 × daemon.start 2 次版本/技能清单 fetch ≈ 4.6s/测试，满载 hook 超时致全量 flaky（2276 passed 1~3 failed）；IP 字面量 3ms 连接拒绝，全量 2377 passed 0 failed、时长 226s→73s。② B 组 B1 + borrow-sandbox 3 处固定 `sleep()` 改轮询 `waitFor`（满载异步链 >sleep 误判未调），B1 另加 try/finally 兜底 resolve pull 防 daemon.stop 挂死。
<!-- MANUAL_NOTES_END -->
