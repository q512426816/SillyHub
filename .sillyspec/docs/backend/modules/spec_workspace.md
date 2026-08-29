---
schema_version: 1
doc_type: module-card
module_id: spec_workspace
author: qinyi
created_at: 2026-08-18 01:45:00
---

# Spec 树托管中枢（spec_workspace）

## 定位

spec 树平台托管中枢：每个 workspace 1:1 的 SpecWorkspace（spec_root 目录 + 同步状态 +
整树版本），负责 spec 树的导入（RPC+SSE）/整树同步（tar）/增量同步（FileOp +
乐观锁清单）/手动同步派发（outbox）/bundle 下发/bootstrap 异步任务/结构校验/冲突读
取。daemon 与 CLI 直跑两条上行链路都落在本模块。

## 契约摘要

（prefix=/workspaces/{wid}，以下省略）
- `GET /spec-workspace`（读配置）/ `PATCH /spec-workspace`（改 strategy 等）
- `GET /spec-workspace/bundle` —— spec 树打 tar 流式下发（daemon 对比 spec_version 决定拉取）
- `POST /spec-workspace/import` —— 从仓库导入（daemon_id + root_path，SSE 进度；
  RPC 向 daemon 取 bundle → staging → `_write_spec_root` 落盘）
- `POST /spec-workspace/sync` —— daemon 上传整树 tar 覆盖 spec_root
- `POST /spec-workspace/sync-incremental` —— daemon 增量 FileOp 上行
- `POST /spec-workspace/sync-manual` + `GET /spec-workspace/sync-manual/pending` ——
  「同步到服务器」按钮：解析 per-member binding → resolve_runtime_for_writeback →
  建 `kind="spec-sync"` DaemonChangeWrite outbox 行（files 携带 workspace_id +
  root_path），前端轮询 pending（含 files_total/files_processed/error 进度）
- `POST /spec-workspace/bootstrap` —— SpecBootstrapService 建 AgentRun（pending）+
  审计 + AgentRunWorkspace 关联后立即返回；实际执行经 daemon_task_leases 后台派发
- `GET /spec-conflicts` —— 读 spec_profile.SpecConflict 列表

表：
- `spec_workspaces`：workspace_id 唯一 FK、spec_root、strategy（platform-managed /
  repo-mirrored / repo-native）、**spec_version**（整树重写计数，scan_generate 成功 /
  apply_sync 落地时递增；daemon 对比 lease payload latest_spec_version 决定重拉，
  与 profile_version 语义不同）、sync_status（pending/clean/dirty/conflicted）、
  last_synced_at
- `spec_file_manifest`：服务器权威文件清单（D-011，独立于 scan_documents）：
  (workspace_id, path) 唯一、content_hash（SHA-256）、version（每个 op +1，乐观锁
  基线）、exists（软删标记）；**只由 apply_ops 写**，scan_docs reparse 不碰

## 关键逻辑

```
apply_ops(workspace_id, ops, change_write_id, change_dirs):
  预校验全部 path（containment + .runtime，越界 422 整体不落盘）
  过滤 local.yaml 写 op（ql-20260818-002，静默丢弃不置冲突）
  IN 预取清单行消 N+1 → 逐 op:
    base_version 不匹配 → 同内容豁免(hash 相同 no-op) 否则记冲突跳过
    无清单行 → add 起 version=1 / delete 幂等 no-op / rename 按 add
  delete = 软删 move 到 spec-backups/{ws}/{ts}/（机会式修剪 30 天前）
  FS 段（mkdir/write_bytes/utime/move）抽 _write_op_file/_move_op_file 整体入
    asyncio.to_thread（ql-20260818-009：bind mount 连写卡事件循环 93s/82s 根因①）
  commit 成功后事务外 best-effort 触发 change reparse
    （change_dirs 标注→scoped；无标注→changes/ 前缀兜底；
     仅 delete/rename 命中 archive 路径→全量，纯 add/update archive→scoped name，
     ql-20260818-009 收窄，daemon 陈旧缓存重推归档文件不再全量重扫）
```

## 关键逻辑补充

- `_write_spec_root`：tar/全量落地，spec_version 递增；skip `.runtime/`（任意深度）+
  decode 后剥 `\x00`（ql-20260813-007，防 NUL 字节炸 asyncpg）；per-file merge 容缺
  （ql-20260813-004）
- `_BatchProgressWriter`：files_processed 进度批量回写；flush 时同步
  `claimed_at=func.now()` 给 claim 续期（ql-20260816-002：全量 apply 90s+ 不再被
  backend GC 60s 中途回收）
- `get_manifest`：读全量清单行，被 platform_sync 的 `GET /changes/-/spec-manifest`
  透调（CLI 直跑增量同步的权威基线）；CLI 的 spec-sync 端点也走本模块 apply_ops
  （路径越界 422 透传对齐 daemon 端点）
- SpecValidator：`.sillyspec` 目录结构/内容校验（projects 扁平 `root/projects` 与
  包裹 `root/.sillyspec/projects` 双布局，D-005@v1；YAML schema/引用完整性）
- import 的 SSE 经 `_evt` 逐事件推送；`_fetch_spec_bundle_via_rpc` 走 daemon RPC

## 注意事项

- **增量协议核心不变量**：清单行 version 是乐观锁，daemon 带 base_version 上行，
  不匹配走同内容豁免/冲突收集，**冲突 op 跳过其余照常落盘**（部分成功语义，返回
  conflict=True + server_versions）
- local.yaml 过滤是**服务端排除写**（ql-20260818-002）：只拦内容落盘，delete 放行清
  存量；生产者幂等重推无副作用
- sync_manual 不再回退 legacy workspace 级 runtime（D-005）；解析失败统一
  DaemonClientNoActiveSession(400)
- SpecConflict 模型在 spec_profile，本模块只挂读取端点
- bootstrap 后台任务持强引用防 asyncio GC（`_BACKGROUND_BOOTSTRAP_TASKS`）；
  AgentRunLog 分段写（4000 字符/段）
- 错误文案已中文化（error-message-l10n），守护测试强制
- apply_ops 防复活拦截覆盖 add **与 update**（ql-20260830-002 R5）：A1 前缀
  与精确墓碑行两道守卫原只判 add——update 会把墓碑行翻 exists=True 落僵尸文件；
  归档区前缀派生四段起步（R6：三段行不是变更目录墓碑，切段产出伪前缀）。
- **_BundleTarStream 收尾顺序铁律**（ql-20260830-001 审计⑦）：`_run` finally 必须
  先 `put(outcome)` 再 `_done.set()`——反序在「队列恰满 + close() 置 cancelled 晚于
  检查」窗口 put 永久阻塞且 close 排空被 `not done` 挡住 → 写线程泄漏。路由层消费
  必须经 `iter_bundle_stream`（async 包装：断连/结束显式 close，阻塞段 to_thread
  不卡事件循环——starlette 1.1.0 不调同步迭代器 close）

## 人工备注

<!-- MANUAL_NOTES_START -->
- **2026-08-14-change-center-conversation-driven**（D-005 / task-02）：`apply_ops` 加 `change_dirs: list[str] | None` 参数（daemon 增量同步标注本次涉及变更目录名）；落盘 commit 后事务外 `_trigger_change_reparse`（独立 session，对齐 `_bump_files_processed` 范式）→ `_compute_reparse_scope`（标注 / ops 路径兜底 / archive_hit 三态）→ `ChangeService.reparse(scope)`。`SpecIncrementalSyncRequest`（schema.py）加 `change_dirs: list[str] = []`（旧 daemon 缺省兼容）。
- **ql-20260818-009**（spec-sync 超时修复）：① `apply_ops` 全部阻塞 FS 段（mkdir/write_bytes/os.utime/shutil.move）抽 `_write_op_file`/`_move_op_file` 同步 helper 整体入 `asyncio.to_thread`——Windows bind mount 上 N 文件连写把事件循环卡死数十秒（2026-08-18 03:01Z spec-sync 93s/82s 超 CLI 30s 超时根因①，同窗 5 次 idle-in-transaction FATAL 即被卡死的连接撞 120s 超时）；② `_compute_reparse_scope` 收窄 archive_hit——仅 delete/rename op 命中 `changes/archive/` 才全量（真归档=目录跨根移动，hash 不变恒发 rename），纯 add/update archive 文件走 scoped name（parser 三区按 name 统一匹配），daemon 陈旧缓存重推归档文件不再触发 parsed 225 全量重扫（根因②）；③ reparse 移出请求路径评估结论 defer：scoped <1s、全量 ~2s（scandir 修复后）且罕见，后台化/去抖的排序与错误面复杂度不抵收益。残余：归档同时改内容 → rename 退化 delete+add 的陈旧行残留，留待下次全量/手动重扫收敛（与 scoped 零删除红线同哲学）。
<!-- MANUAL_NOTES_END -->
