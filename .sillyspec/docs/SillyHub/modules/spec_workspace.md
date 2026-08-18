---
schema_version: 1
doc_type: module-card
module_id: spec_workspace
author: qinyi
created_at: 2026-08-18 01:45:00
---

# 规范空间挂载层（spec_workspace）

## 定位
workspace 与 SillySpec 规范空间的 1:1 挂载层：
决定 spec 文件落在哪（spec_root）、以什么策略同步（三策略）、
如何增量落盘（per-file manifest 乐观锁）、如何用 agent 初始化骨架（bootstrap）。
是 daemon↔平台 spec 文件双向流动的**服务端权威端**，
也是 scan_docs / change / task 解析的文件源。

## 契约摘要
- 路由 `tag=spec-workspace`（prefix=/workspaces/{workspace_id}）：
  - `GET /spec-workspace` 信息、`PATCH /spec-workspace` 更新配置
  - `GET /spec-workspace/bundle` 流式 tar 下载（generator 打包，大目录不占内存）
  - `POST /spec-workspace/import` 从 repo 导入
    （SSE 流式：packing→applying→reparsing；daemon-client 经
    `_fetch_spec_bundle_via_rpc` RPC 让 daemon 打包容主 `.sillyspec`）
  - `POST /spec-workspace/sync` daemon tar **全量**落盘
    （Body 为 application/x-tar；`X-Change-Write-Id` 头供逐文件进度回写）
  - `POST /spec-workspace/sync-incremental` daemon **增量** ops 落盘
    （`FileOp.op ∈ add/update/delete/rename` + base_version 乐观锁；
    返回 new_versions / conflict / server_versions，冲突 HTTP 仍 200，
    由 daemon 侧据字段提示人工拍板）
  - `POST /spec-workspace/sync-manual`「同步到服务器」手动按钮：
    解析成员 binding → 建 `DaemonChangeWrite(kind="spec-sync")` outbox 行交 daemon 执行；
    `GET .../sync-manual/pending` 供前端轮询（pending/claimed/done/failed）
  - `POST /spec-bootstrap` 初始化（返回 agent_run_id / mission_id + stream_url）
  - `GET /spec-conflicts`、`POST /spec-conflicts/{id}/resolve` 冲突列表与解决
- 数据：
  - `SpecWorkspace`（workspace_id 1:1 唯一）：spec_root、
    strategy（platform-managed 默认 / repo-mirrored / repo-native）、
    sync_status（**pending** / clean / dirty / conflicted 四值）

  - `SpecFileManifest`（spec_file_manifest 表，workspace+path 唯一）：
    content_hash（sha256）、version（乐观锁基线，每次应用 +1）、
    exists（软删标志）。**唯一写者是 apply_ops**（D-011 单写者语义），
    scan_docs reparse 不读写此表
- bootstrap（`SpecBootstrapService.bootstrap`，mode 参数）：
  - single（默认）：建 AgentRun 走交互执行（agent_type 尊重 workspace
    default_agent/default_model，缺省回退 claude），fire-and-forget 后台跑
  - team / auto：Coordinator 拆并行只读 Worker（arch/style/test/integration/risk）
    + Finalizer 合并 Artifacts
  - 全程 audit `spec_bootstrap.start`；`preflight_workspace_code_root` 预检代码根
- validator：`SpecValidator.validate` 三级检查
  （`_check_directory_structure` → `_check_yaml_schema` → `_check_references`），
  返回 ValidationReport（errors/warnings 分级）

## 关键逻辑
apply_ops（增量落盘核心，design §7）：
```
预校验全部 op 路径 containment + .runtime → 越界 422 整体不落盘
过滤 local.yaml 写 op（静默丢弃；delete 放行清存量行）
逐 op（循环前 IN 预取清单行消 N+1，镜像 dict 维护同请求可见性）：
  有行且 version != base_version
    → 同 hash 豁免（no-op 对齐）否则记 conflict、收集 server_versions、跳过
  无行 → R-07 hash 兜底（add/update=新建 v1；delete=no-op 幂等；rename 按 add）
delete = move 到 spec-backups/{ws}/{ts}/{path} + exists=False（30 天机会式修剪）
落盘 commit 后（事务外 best-effort）触发 change reparse：
  change_dirs 标注 → scoped；无标注扫 changes/ 前缀兜底；
  含 archive 路径 → 全量；零 changes 路径零触发（R-01 防空转）
```
- 全量路径 `_write_spec_root` / `apply_sync`：tar 解包 staging →
  逐文件 read+sha256 校验落盘 → 两阶段 reparse（scan_docs + change）
- **事务纪律（ql-20260817-005）**：FS 段（解包 / 逐文件读写，spec_root 为
  Windows bind mount，大工作区可达分钟级）必须在事务外执行——后端连接自设 PG
  `idle_in_transaction_session_timeout=120s`，FS 期间零 SQL 的连接会被杀，
  最终 commit 撞死连接报 500。循环内禁 `session.add/delete`
  （SQLAlchemy 2.0 autobegin 即开事务），新行/冲突行/待删行收集 pending 列表，
  循环后统一入 session 单事务提交（原子性不变）
- `get_manifest`：读权威 per-file 清单，**含 exists=False 软删行**——
  CLI/daemon diff 据此识别服务器侧已删文件并下发 delete 对齐；按 path 排序，纯读
- `ensure_spec_workspace`：并发 init-dispatch 同时 create 撞唯一约束时
  rollback 重查拿对方建好的行（R10 幂等收口）

## 注意事项
- 冲突语义：base_version 过期且 hash 不同 → 该 op 跳过不落盘、
  整体返回 conflict=True + server_versions；同 hash no-op 豁免（D-008@v2）让
  第二成员 init 骨架文件静默对齐，旧 daemon 不传 hash 行为不变（仍 conflict）
- 预校验先验后解：任一 op 越界整体 422，不留半落盘状态
- local.yaml 属服务器排除项：写 op 静默丢弃且不进 new_versions / 不置 conflict，
  生产者幂等重推无副作用（ql-20260818-002）
- bootstrap 异步调 agent 耗时长，前端走 SSE/log 事件（_publish_log_event /
  _publish_done_event），失败经 `_write_run_log` 落盘日志排查
- validator 是纯同步 FS 检查，可脱离 DB 独立测试；验证失败不阻断流程，
  记 SpecConflict + sync_status=dirty 待手动 resolve，resolve 后不自动重验
- strategy 决定 spec 物理位置与同步方向；platform-managed 下 daemon 本地缓存是
  旧 pull 快照，推不出新 change——sync-manual 透传宿主 root_path 让 daemon 改打
  宿主 `.sillyspec`（与 get_spec_bundle RPC 同源）
- workspace 创建时经 `_ensure_spec_workspace(_from_platform)` 自动连带建 1:1
  spec 空间，无需显式建
- bundle 下载是流式响应，前端按 blob 接收

## 人工备注

<!-- MANUAL_NOTES_START -->

<!-- MANUAL_NOTES_END -->
