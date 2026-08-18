---
schema_version: 1
doc_type: module-card
module_id: change_writer
author: qinyi
created_at: 2026-08-18 01:45:00
---

# 变更文档代写（change_writer）

## 定位
变更文档骨架生成 + daemon-client 变更代写。两条能力线：①`ChangeWriterService`/`markdown_builder` 在本地路径（workspace 根或 worktree lease）生成 MASTER/proposal/requirements/design/plan 模板并落库 Change；②`proxy_create_change`（proxy.py）走 daemon change-write claim 通道在客户端工作区代写变更——下发 `daemon_change_writes` 任务、轮询回执、失败回滚占坑行。2026-08-14 会话驱动化起 5 个 HTTP 端点全部下线，router 仅留空壳（prefix=/workspaces/{workspace_id}，无路由）供 main.py include_router 挂载，对外无 HTTP 面。

## 契约摘要
- `router.py`：空壳（无路由）——create / proxy-create / documents/generate / documents/batch-generate / execute 端点已随前端「新建变更」表单下线删除（无调用方）。
- `proxy_create_change(session, workspace_id, user_id, title, description, change_type?) -> Change`（proxy.py）：被内部流程（会话建变更等）调用。
- `DaemonClientNoActiveSession`（AppError 400，code `DAEMON_CLIENT_NO_SESSION`）：runtime 解析失败（未绑定 / daemon 离线 / default_agent 无匹配）统一抛出。
- `ChangeWriterService`（service.py）：`create_change` / `generate_document` / `batch_generate_templates`。
- `markdown_builder`：`build_master_md` / `build_proposal_md` / `build_requirements_md` / `build_design_md` / `build_plan_md` 纯文本模板。
- `classify_change_type(description) -> str`（classifier.py）：按描述关键词自动推导 change_type（用户未传时）。
- 常量：`PROXY_CHANGE_WRITE_TIMEOUT_SECONDS = 60`、`PROXY_POLL_INTERVAL_SECONDS = 0.5`。

## 关键逻辑
```
proxy_create_change:
  resolve_runtime_for_writeback(binding+default_agent 现算 runtime, 失败抛
  DaemonClientNoActiveSession) → 心跳新鲜度二次校验(掉线即标 offline+抛)
  classify_change_type → initial_stage = quick?quick:brainstorm
  占坑: Change + 全部 ChangeDocument 先 commit(占唯一键, 防与 reparse 并发撞键)
  下发 DaemonChangeWrite(status=pending) → 轮询回执(60s 超时翻 failed)
  回执 done → 返回; failed/超时 → _rollback_preempted_change(回滚占坑行, 无孤儿)
```

## 注意事项
- 占坑语义（D-001@v2）：Change/ChangeDocument 先于任务下发 commit，占住 `ux_changes_workspace_key`/`ux_change_docs_type_path`；daemon postSpecSync 的 reparse 因此走 update 而非 created，消除双表并发撞键 500；回执 done 后 proxy 路不再 INSERT docs（docs 仅 reparse 单路串行写）。
- `change_type == "quick"` 时 `current_stage=quick`（独立阶段，自己跑三步结束不进主线），其余 `brainstorm`（draft 非 VALID_STAGES，前端无映射）。
- `change_key` = 日期 + 标题 slug（非字母数字转 `-`，截 40）+ 6 位随机 hex 防重名。
- `_ensure_frontmatter` 保证 md 带 `author` + `created_at` frontmatter，已有 `---` 开头不覆盖。
- 服务层写本地路径两条分支（lease worktree / workspace 根容器内路径）不可混用；`ChangeWriterService.create_change` 供 server-local 语义，daemon-client 工作区一律走 proxy 通道。
- 与 workspace（resolver）、daemon（DaemonChangeWrite 表 + claim 端点）、change（落库）三方耦合；GC 回收语义见 daemon 卡片（超时回灌 pending 可重做，幂等）。
- 用户可见错误文案中文（error-message-l10n）。

## 人工备注

<!-- MANUAL_NOTES_START -->

<!-- MANUAL_NOTES_END -->
