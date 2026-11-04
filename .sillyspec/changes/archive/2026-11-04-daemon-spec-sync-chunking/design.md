---
author: flow-machine-draft
created_at: 2026-11-04T14:20:16.936Z
---
# 设计记录（Design Record）— 2026-11-04-daemon-spec-sync-chunking

## 做法概述

本变更怎么解决问题？改哪里、为什么选这个方案（一两段）。

只改 daemon 客户端推送腿（`sillyhub-daemon/src/spec-sync.ts`）：`postSpecSyncImpl` 增量路径的 `client.postSpecSyncIncremental(wsId, ops, …)` 单批整推改为经新增 `postSpecSyncIncrementalChunked` 分批执行——纯函数 `chunkOpsForPush` 按「块内 op 数（缺省 128）+ base64 字节粗估和（缺省 2MiB）」双约束切块顺序提交，块响应合并成单批等价形状（conflict 任一块真、server_versions/new_versions 逐块累积）后走既有 conflict re-base 重试与缓存回写路径（该两段零改动）。中途块失败（已有块落地）抛 `ChunkedPushPartialError`，外层 catch **禁 tar 回退**（部分落地后整包覆盖有覆盖他端写入风险且大积压必超时），上抛原始错误由下轮同步以服务器清单为锚断点续传；首块失败（零落地）维持既有 tar 回退不变（旧后端兼容）。change_dirs 改为按块提取随块透传（scoped reparse 更精确）。env 键名与 CLI 侧一致（`SILLYSPEC_SPEC_SYNC_CHUNK_OPS` / `SILLYSPEC_SPEC_SYNC_CHUNK_BYTES`，缺省零回归）。

为什么是这个方案：生产实证（multi-agent-platform 工作区，2026-11-04）spec 文件树 15 天积压 2436 ops/45.7MB 单批推送在单请求预算内上传+服务端 apply 双超（服务器 8h 37 连败），CLI 侧已修（sillyspec 仓 2026-11-04-sync-push-chunking，1997 ops 23 块全部落地、spec_version 6469→6492 实证收敛）；daemon 侧同构缺陷更糟——增量超时后 catch 回退整包 tar（更大必超时）恶性循环，且 daemon 推送预算 300s 也不保底。分批后每块独立提交在预算内，断点续传靠清单锚刷新免费获得，服务器端零改动零部署（仅 daemon bundle 分发面）。

## 接口契约

动了哪些函数/端点/命令/文件格式？对外可见的签名或行为变化是什么（含「无」的说明）？

- 新增导出（`sillyhub-daemon/src/spec-sync.ts`）：`chunkOpsForPush(ops: FileOp[], opts?: { maxOps?; maxBytes? }): FileOp[][]`（纯函数，顺序保序、单 op 超限独占一块、空数组返回 []）；`class ChunkedPushPartialError extends Error`（`landedChunks`/`totalChunks`/`cause0` 只读字段）。
- 模块内新增（不导出）：`postSpecSyncIncrementalChunked(client, wsId, ops, changeWriteId, onProgress)`——分批执行 + 响应合并 + 按块进度上报。
- `postSpecSync` 对外签名与返回值不变；行为变化仅两处：①ops 超块上限时逐块多次调用 `postSpecSyncIncremental`（每次 ≤块上限，change_dirs 为该块涉及目录）；②增量推送中途失败且已有块落地时**不再回退整包 tar**（原「404/网络失败 → 回退旧 tar」仅保留首块失败场景）。
- env 新增（缺省零行为变化）：`SILLYSPEC_SPEC_SYNC_CHUNK_OPS`（整数 ≥1，缺省 128）、`SILLYSPEC_SPEC_SYNC_CHUNK_BYTES`（≥1024，缺省 2MiB）——键名与 CLI 侧 sillyspec 仓同日修复一致。
- onProgress：起点 `files_total=ops.length` 不变；新增块级 `files_processed` 累计上报（5/10/12…，终态仍由 task-runner 收口）。
- 服务器端点/协议零改动（块=独立 POST，`/api/workspaces/{wsId}/spec-workspace/sync-incremental` 无感知）。

## 边界与并发（盲维四问——每问必答，答不了即设计缺口）

1. 乱序/迟到到达：输入或事件乱序时，本设计的假设还成立吗？

**作答**：块间严格顺序提交（for-await 不并发）；`computeIncrementalOps` 每 path 至多一 op，块间路径互斥——server_versions/new_versions 合并无同 path 覆盖歧义。他端在块间插入变更：下一块 op 的 base_version 乐观锁照常判 conflict（服务器逐块校验），合并后走既有 re-base 恰好一次重试语义与单批等价。

2. 并发写：两个执行体同时操作同一数据/文件会发生什么？

**作答**：daemon 与 CLI 双写者并发推送——服务器侧既有 per-path 乐观锁不变；分批是 daemon 本地纯函数无共享状态。块中途失败上抛后 CLI/daemon 下轮各自以服务器清单为锚重算 diff，已落地路径自动出 diff（既有单写者让位开关 spec-sync-off 不受影响）。

3. 切换/生命周期：会话、请求或变更中途切换/中断时状态是否安全？

**作答**：中途块失败已落地块不回滚（服务器单块=单事务已 commit）；daemon 无新记账面（无块进度文件）——续传完全靠下轮 diff 以服务器清单锚收敛。rebase 重试段抛 ChunkedPushPartialError 时透传外层断点续传分支（不升级 SpecPushConflict 人工裁决——rebase 已对齐 version，下轮天然收敛；tar 回退禁止）。onProgress 缺省 undefined 时零调用（向后兼容）。

4. 作用域：跨工作区/跨仓/多实例时数据会不会串台？

**作答**：分批只作用于单次 postSpecSync 调用内的 ops（wsId 作用域），manifest 缓存按 `~/.sillyhub/daemon/manifests/{wsId}.json` 既有隔离不变；env 键为进程级调优（与 CLI 侧同名同语义，两进程各自读各自 env），无串台。

## 风险与死路

本方案最大的风险是什么？试过但放弃的方案及放弃理由？

最大风险：块尺寸缺省（2MiB）在「慢上行 + 服务端慢 apply」下仍可能贴预算——daemon 单请求预算 300s 远宽于 CLI 30s，且块尺寸 env 可调（沿用 CLI 同名键）；分批已把失败面从「整批/tar 全量永不落地」缩到「单块重试」。次风险：中途失败禁 tar 回退后，若下轮同步长期不触发（daemon 空闲），积压停留——既有 daemon 周期性同步（batch/interactive 各自触发面）覆盖，非新引入面。

放弃的方案：①失败后仍回退 tar（维持旧行为）——部分落地后 tar 全量覆盖有覆盖他端写入风险（NFR-02 同族语义），且大积压 tar 更大必超时，是恶性循环本体；②daemon 侧记块进度文件支持块级重试——下轮 diff 天然只含未落地路径，记账是多余真相源；③改服务器 apply_ops 性能——CLI 侧已实证分批可收敛，服务器零改动零部署面最小。
