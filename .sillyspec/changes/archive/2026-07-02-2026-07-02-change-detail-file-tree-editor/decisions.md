---
author: qinyi
created_at: 2026-07-02 10:26:32
change: 2026-07-02-change-detail-file-tree-editor
---

# decisions — 变更详情文件树 + 手动编辑

## D-001@v1: 编辑保存走 outbox 队列，不阻塞 await，离线续传
- type: architecture
- status: accepted
- source: user
- question: daemon-client 工作区手动修改文档，写回如何持久化并支持离线续传？
- answer: 复用 DaemonChangeWrite outbox 队列。POST files/content 创建 `kind="edit"` 的 pending 行后**立即返回**（不调用 `proxy._await_change_write_receipt` 的 60s 阻塞 await），daemon 轮询 claim→写本机→complete。超时不翻 failed（无 await，pending 天然留存），daemon 重连后继续回写。
- normalized_requirement: 编辑保存端点对 daemon-client 必须立即返回 `{status:"pending", task_id}`，不得阻塞等待 daemon 回执；pending 行在 daemon 离线期间保持 pending。
- impacts: [Phase2, §7.5 生命周期契约表, task-后端write端点, task-前端轮询]
- evidence: backend/app/modules/change_writer/proxy.py:128-165（_await_change_write_receipt 60s，仅 proxy_create_change 用）；backend/app/modules/daemon/change_write_router.py:120-159（pending 轮询）
- priority: P0
- note: 修正 brainstorm 草稿——**不改 `_await_change_write_receipt` 的 60s 超时**。该函数只服务创建新变更；编辑保存走独立路径根本不 await，避免动正在工作的创建流程。

## D-002@v1: 同 change_key+path 的 pending 行合并（last-write-wins）
- type: boundary
- status: accepted
- source: design
- question: daemon 离线时用户对同一文件多次保存，队列如何处理？
- answer: 写回前查同 `(change_key, path)` 且 status=pending 的行，存在则更新其 `files[0].content` 与 `created_at`，不新建行。daemon 回写时自然是最后一次内容（last-write-wins）。
- normalized_requirement: POST files/content 对 daemon-client 必须先 SELECT 同 change_key+path 的 pending 行，命中则 UPDATE content，未命中才 INSERT。
- impacts: [Phase2, R-04, task-后端write端点]
- evidence: backend/app/modules/daemon/model.py DaemonChangeWrite（change_key + files JSON）
- priority: P1

## D-003@v1: 读前一致性——展示 last_synced_at，离线警告但不硬阻
- type: boundary
- status: accepted
- source: user
- question: 编辑前如何保证 UI 看到的是本机最新内容？
- answer: 顶部展示 `spec_workspaces.last_synced_at`；daemon 离线或镜像陈旧（超过阈值）时显示警告条提示「内容可能非最新」，但不阻止用户编辑（硬阻会卡住离线场景）。不强触发同步（YAGNI）。
- normalized_requirement: 文件树区域必须展示 last_synced_at；daemon 离线时显示警告条；不得因镜像陈旧禁用编辑。
- impacts: [Phase4, task-前端组件]
- evidence: spec_workspaces 表 last_synced_at 列；frontend/src/lib/daemon.ts（runtime status）
- priority: P1

## D-004@v1: 路径穿越守卫
- type: risk
- status: accepted
- source: design
- question: 用户提交的 path 如何防止写穿出变更目录？
- answer: 读/写端点对 path 做 `resolve()` 后校验 `str(resolved).startswith(str(change_dir.resolve()))`，不满足抛 ChangeDocNotFound/400。覆盖 `../`、绝对路径、符号链接。
- normalized_requirement: GET files/content 与 POST files/content 的 path 必须在 resolve 后落在变更目录内，否则 4xx；pytest 覆盖三类攻击 path。
- impacts: [Phase1, Phase2, R-02, task-安全测试]
- evidence: backend/app/modules/change/service.py:248-251（现有 root 守卫范式）；parser.py:151-168 _is_safe_path
- priority: P0

## D-005@v1: daemon 回执 done 触发 per-change resync（非全量 reparse）
- type: architecture
- status: accepted
- source: user
- question: 保存成功后 DB 文档矩阵如何刷新？
- answer: server-local 写成功 / daemon-client `complete_change_write`（kind=edit, ok=True）→ 调用 `_resync_change_docs`：只解析该变更目录（复用 `ChangeParser._parse_change`）+ `_sync_docs` 刷 ChangeDocument 行 + 重提取 title。不做全工作区 reparse（重）。
- normalized_requirement: 写回成功必须触发 per-change 文档 resync；resync 失败 best-effort（log，不影响 complete 落 done）。
- impacts: [Phase3, §7.5, R-05, task-resync, task-集成测试]
- evidence: backend/app/modules/change/service.py:840-877（_sync_docs）；service.py:446-563（_parse_change）
- priority: P1

## D-006@v1: path_source 分流（server-local 直写 / daemon-client outbox）
- type: architecture
- status: accepted
- source: user
- question: 写回如何同时支持 server-local 与 daemon-client？
- answer: 按 `is_daemon_client_path_source(workspace.path_source)` 分流。server-local：`write_text` 到 `{root_path}/.sillyspec/changes/{key}/{path}` 同步返 done。daemon-client：走 D-001 outbox。对齐 `reparse`/`create_change` 的分流模式。
- normalized_requirement: POST files/content 必须按 path_source 分流，两分支各有单测；server-local 同步返 done，daemon-client 返 pending。
- impacts: [Phase1, Phase2, task-两分支测试]
- evidence: backend/app/modules/change/service.py:714（reparse platform_managed 分流）；backend/app/modules/workspace/service.py is_daemon_client_path_source
- priority: P0

## D-008@v1: 文件树替换 A+B（文档完整性面板 + DOC_TABS 只读查看器）
- type: boundary
- status: accepted
- source: user (Design Grill)
- question: 新文件树与现有 DOC_TABS 只读内容查看器（[cid]/page.tsx:916-993）职责重叠，保留还是替换？
- answer: 文件树替换 A（文档完整性面板 828-914）+ B（DOC_TABS 查看器 916-993），变更详情只留一个统一的文件树 UI（看全部文件 + 可编辑）。连带删除死代码：前端 DOC_TABS/DOC_LABELS/REQUIRED_DOCS/OPTIONAL_DOCS/handleDocSelect/docContent 等状态与常量、`getChangeDocumentContent` wrapper；后端 `get_document_content` service + `GET /documents/{doc_type}` endpoint（B 唯一消费方）。保留 `get_documents`/ChangeDocMatrix（archive gate 内部用）。
- normalized_requirement: [cid]/page.tsx 移除 A+B 两块 UI 及关联死代码；后端删除 get_document_content 及其 router；不得保留冗余只读查看器。
- impacts: [Phase4, §6 文件清单, §9 兼容, task-前端删除, task-后端清理]
- evidence: frontend/src/app/(dashboard)/workspaces/[id]/changes/[cid]/page.tsx:828-993；backend/app/modules/change/router.py:130-151；backend/app/modules/change/service.py:211-265,675
- priority: P1

## D-007@v1: 编辑范围限现有文件内容
- type: boundary
- status: accepted
- source: user
- question: 手动修改支持哪些操作？
- answer: 仅编辑现有文件内容（覆盖写）。不支持新建文件、重命名、删除。二进制文件（is_text=false）只读。
- normalized_requirement: 文件树仅展示变更目录现有文件；编辑器对二进制文件禁用编辑；无新建/删除入口。
- impacts: [N1, N6, Phase4, task-前端组件]
- evidence: 用户确认（对话式探索 round1）
- priority: P1
