---
author: qinyi
created_at: 2026-08-18 02:50:00
source_commit: 744e3de4
updated_at: 2026-08-17T17:06:26Z
---

# Daemon 代写任务队列流程（change-write claim）

## 目标
daemon-client 唯一模式下 backend 无可达文件系统，平台把「远端写盘」任务（创建变更目录、编辑变更文档、spec 整树回灌）经 lease-polling 代写队列下发 daemon 执行并收回执——不启动 agent，与 DaemonTaskLease 的 agent-run 语义分离（独立表 daemon_change_writes）。

## 参与模块
- daemon：backend 侧 change_write_router（GET /runtimes/{rid}/pending-change-writes、claim / complete / progress 回执端点 + 超时 GC）；Node 侧 lease 轮询消费与宿主写盘
- change_writer：proxy 代写路径（proxy_create_change——占坑 Change+ChangeDocument 行、轮询回执、失败回滚）；markdown 模板构造能力保留（HTTP 入口已下线）
- change：占坑行与 reparse 的并发对账；`_enqueue_edit_write` 变更文件在线编辑下发（写后 `_resync_change_docs` 回灌文档矩阵）
- spec_workspace：sync-manual「同步到服务器」建 kind=spec-sync 的 DaemonChangeWrite outbox 行 + pending 轮询端点
- workspace：member_runtimes.resolver 现算目标 runtime（成员 binding + online + 心跳新鲜；失败抛 DaemonClientNoActiveSession）

## 流程摘要

```text
(平台侧触发) 三类生产者：
     ├─ 会话/流程需远端建变更目录（change_writer.proxy.proxy_create_change）
     ├─ 变更文档在线编辑（change._enqueue_edit_write）
     └─ 「同步到服务器」手动按钮（spec_workspace.sync-manual，kind=spec-sync 整树回灌）
     ▼
(backend)   resolve_runtime_for_writeback 现算 runtime
     │      失败 → DaemonClientNoActiveSession（结构化 code 供前端 toast）
     ▼
(backend)   占坑：Change + 全部 ChangeDocument 行先 commit
     │      （钉住 changes/change_documents 双表唯一键，防与 reparse 并发撞键 500；
     │        占坑-回滚顺序是并发正确性关键，勿改单事务——daemon 回执是异步跨请求的）
     ▼
(backend)   建 DaemonChangeWrite(pending) 行
     │      files 用扁平 changes/<key>/ 相对路径（无 .sillyspec 包裹层）
     ▼
(daemon)    lease-polling 消费：
     GET /runtimes/{rid}/pending-change-writes
     → claim（claim_token 轮转；并发互斥 PG 走 SELECT ... FOR UPDATE SKIP LOCKED，
       SQLite 退化事务内状态校验）
     → 宿主写盘（create/edit 覆盖写幂等；spec-sync content-hash 合并）
     → 期间 report_change_write_progress 刷新 claimed_at（活跃任务不超时）
     → complete 回执 {ok} → done / failed
     ▼
(backend)   生产者轮询回执（周期 ≤1s）：
     ├─ done → 占坑行已就绪，直接返回
     └─ failed / 60s 超时 → 独立 session 回滚占坑行
         （显式删 docs 兼容 SQLite FK 关闭场景）→ 抛 ChangeWriteError
     ▼
(GC)        pending 端点顺带触发（不新增后台调度）：
     claimed 超时（create/edit 60s；spec-sync 600s 独立长窗）
     → 回灌 pending 自动重试（ql-20260816-004：超时回收语义从置 failed 改回灌——
       daemon 中断/失联才回收，进度上报中断的极端窗口；幂等覆盖写无死循环）
```

## 失败回滚

| 失败点 | 处理 |
|--------|------|
| 无可用 runtime | DaemonClientNoActiveSession 400，前端 toast 引导检查 daemon |
| claim 时行非 pending | 409（已被抢占/完成） |
| complete 时 token 不符 | 409 校验拒绝 |
| daemon 中断未回执 | GC 回灌 pending，下轮轮询自动重 claim 重做（写幂等） |
| 宿主写盘失败 | complete(ok=false) → failed；生产者回滚占坑行 |
| 回执超时（60s） | 生产者回滚占坑行并抛 ChangeWriteError（行本身留待 GC 处置） |
| 占坑与 reparse 并发 | 占坑行先 commit 钉唯一键，避免撞键 500 |
