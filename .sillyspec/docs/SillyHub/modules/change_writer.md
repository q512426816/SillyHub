---
schema_version: 1
doc_type: module-card
module_id: change_writer
author: qinyi
created_at: 2026-08-18 01:45:00
---

# 变更文档生成器（change_writer）

## 定位
后端「变更文档生成器」功能域：按 SillySpec 模板构造变更目录与 markdown 文档（MASTER/proposal/request 及标准模板），并提供经 daemon 代写队列的远端写盘（proxy）。
**当前状态：HTTP 入口已下线**——变更中心会话驱动化（2026-08-14）后 create / proxy-create / documents generate / batch-generate / execute 五端点随前端新建表单删除，router 保留空壳供 main.py 挂载（避免 dangling import）。本模块现为纯库代码，生产代码暂无调用方（used_by 为空），能力保留供后续流程复用。

## 契约摘要
- **模板构造**（markdown_builder）：
  - `build_master_md / build_proposal_md / build_requirements_md / build_design_md / build_plan_md` 等 builder + `DOCUMENT_BUILDERS` 注册表。
  - `ChangeWriterService._ensure_frontmatter` 统一补 author/created_at frontmatter——change 解析依赖这些元数据，缺失会破坏下游。
- **类型自动分类**（classifier）：按需求描述关键词推导 change_type——quick（文案/样式/typo/hotfix 类）优先 > prototype（原型/实验/调研类）> 默认 feature；quick 类型建变更时走独立 quick 阶段（不进主线），其余进 brainstorm。
- **直写路径**（ChangeWriterService.create_change，lease_id 分支）：
  - 持有 worktree lease 时在 lease 工作树内 `.sillyspec/changes/<key>/` 建目录并落 MASTER.md + proposal.md + request.md + DB 行。
  - change_key = `日期-slug-uuid6`（slug 取标题小写归一截 40 字符）。
  - 门禁：workspace 必须已扫描（last_scanned_at 非空，未扫描拒绝并引导先扫描）；lease 归属与 workspace 匹配校验。
- **代写路径**（proxy.proxy_create_change，无 lease 分支）：
  - daemon-client 架构下 backend 无可达文件系统，经 lease-polling 代写队列下发：校验 runtime（binding + workspace 默认 agent 现算、online + 心跳新鲜）→ 占坑 Change + 全部 ChangeDocument 行先 commit（钉住 changes/change_documents 双表唯一键，防与 reparse 并发撞键 500）→ 建 DaemonChangeWrite(pending) 行（files 用扁平 `changes/<key>/` 相对路径，无 .sillyspec 包裹层）→ 轮询回执（周期 ≤1s）。
  - 回执 done → 占坑行已就绪直接返回；failed / 60s 超时 → 独立 session 回滚占坑行（显式删 docs 兼容 SQLite FK 关闭场景）并抛 ChangeWriteError。
  - runtime 解析失败抛 `DaemonClientNoActiveSession`（结构化 code 供前端 toast）。

## 关键逻辑
```
# 直写（lease 分支）
门禁(已扫描) → _get_active_lease(归属校验) → change_key 生成 → classify_change_type(缺省)
→ build_*_md + _ensure_frontmatter 落盘 MASTER/proposal/request → DB 行(current_stage 按类型)

# 代写（proxy 分支）
runtime 现算(online+心跳新鲜) → 占坑 Change+Documents 先 commit → DaemonChangeWrite pending
→ daemon 领取代写 → 宿主写盘 → complete 回执(done/failed) → failed/超时回滚占坑行
```

## 注意事项
- router 是空壳（无端点）；若恢复 HTTP 入口需重新评估与会话驱动变更流程的一致性，勿直接复活旧表单端点。
- 生产代码当前不调用本模块（仅测试引用）；重构/删除前先 grep 确认是否有新流程悄悄接线。
- 占坑-回滚顺序是并发正确性的关键：占坑行先 commit 钉唯一键，失败回滚须删 docs——勿改为单事务（daemon 回执是异步跨请求的）。
- 文档文件名严格遵循 SpecPathResolver 约定（proposal.md/design.md/plan.md/tasks.md 等），勿自创文件名。
- quick 类型 initial_stage=quick 是独立阶段语义，与 change 模块的 gate/面板判定耦合。
- 代写等待超时（60s）与轮询周期（0.5s）是模块常量，调整需评估 daemon claim 窗口。

## 人工备注

<!-- MANUAL_NOTES_START -->

<!-- MANUAL_NOTES_END -->
