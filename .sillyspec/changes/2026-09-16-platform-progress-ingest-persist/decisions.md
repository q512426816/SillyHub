---
author: qinyi
created_at: 2026-09-16 07:54:16
---

# 决策记录 — 2026-09-16-platform-progress-ingest-persist

## D-001@v1：progress ingest 权威落库的实现位置（方案选择）

- **模块域**: platform_sync, change

- **type**: architecture
- **source**: user（任务简报预先指定修复项 P1/P2/P3 + 本会话调研细化）
- **question**: 进度通道与文档通道行为分叉（changes 表 current_stage/status/title 不随全流程推进更新）在平台侧怎么修——写路径 ingest 落库、还是修响应耗时/枚举映射、还是读侧投影兜底？
- **answer**: 采方案 A（任务简报指定）。备选与取舍：

  | 方案 | 核心思路 | 结论 |
  |---|---|---|
  | **A. ingest 权威落库（选定）** | `upsert_progress` 接受分支（分支 1/3）新增 `_sync_change_stage_status`：`changes[0].current_stage` 覆盖 ux_changes 行；status 走显式映射表落库，未知值告警不写 | 生产实证 POST 已到达且被接受（收件箱行新鲜、latest_progress 含 verify/active），分叉纯在「ingest 不写 ux_changes」——修写路径是对症的根因修复 |
  | B. 修 daemon 响应耗时（CLI 熔断让路嫌疑） | 排查 progress ingest 慢查询/阻塞，让 CLI 总预算熔断不触发 | **排除为主因**：生产收件箱行 `last_pushed_at=15:39Z` 新鲜且携带终态（verify/active），请求到了且成功。`event_loop.blocked 557ms`（reparse 阻塞）确实存在、会加剧 CLI 丢推，但修它不修 ingest，表字段仍永不更新。已另行登记观察 |
  | C. 只靠读侧投影（现状 enrich join 已覆盖 current_stage） | 不写表，UI 全走 latest_progress join | **不采**：契约 §14.5 权威值应落表；join 只覆盖 current_stage 与 archived 终态，title/status 仍陈旧；收件箱行丢失/清理时表值兜底错误；DB 级消费方（通知/统计）读不到 |

- **evidence**: 生产 PG 直查（47.113.145.252）：`platform_change_progress` 行 `lp_stage=verify, lp_status=active, last_pushed_at=2026-09-15T15:39:05.765Z`；`changes` 行 `current_stage=NULL, status='draft', title='提案书（Proposal）', updated_at=15:39:02`；join 键 workspace_id 匹配（join_hit=t）。代码：`_ensure_change_row` 行存在即 return（platform_sync/service.py:622-623）；`_apply_parsed` 仅 owner_id=None 更新 current_stage（change/service.py:2688）而 `_sync_change_owner` 必设 owner；dispatch 读 sillyspec.db 仅 agent 派发触发（change/dispatch.py:1721）。

## D-002@v1：status 枚举映射表（CLI 值域 → 平台 changes.status）

- **模块域**: platform_sync, change

- **type**: architecture
- **source**: user（任务简报 P1「status 按显式映射表落（未知值告警不静默丢）」+ 调研定值域）
- **question**: CLI 上行 `changes[0].status` 的值族（active/in_progress/archived/deleted）映射到平台 `changes.status` 什么值？
- **answer**: 显式映射表 `{"active": "in_progress", "in_progress": "in_progress", "archived": "archived"}`：

  - `in_progress` 是平台自写先例值（`_upsert_projection_progress` 构造 changes[0].status='in_progress'），语义区分「从未开始 draft」与「CLI 已注册推进中」；前端只特判 `blocked`/`archived`，非 archived 值均按常态渲染，无 UI 破坏。
  - `archived` → `archived` + `current_stage='archived'`（对齐读侧终态投影同形）+ `archived_at` 仅首填；**不动 location**——归档文件移动由 CLI `run archive` + 镜像同步 + reparse 收敛（`_apply_parsed` 设 parsed.location），ingest 抢先置 archive 会被 reparse 回翻产生抖动。
  - `deleted` 不进映射表：已有独立通道 `_apply_cli_tombstone`（置 location='deleted' + 镜像软删），status 列不参与。
  - 未知值（未来 CLI 新枚举/拼错）：`log.warning` + 只写 current_stage 不写 status 列——不静默丢（有告警）也不写脏值（列无 CHECK 约束，脏值会直透 UI 筛选）。
- **evidence**: Change.status 无枚举约束（model.py:154-156，String(30) default 'draft'）；前端消费点仅 `status === "archived"`（终态过滤）与 `status === "blocked"`（changes/page.tsx:427）；`_extract_change_status` docstring 记录 CLI 值域 active/archived（service.py:2479-2482）。

## D-003@v1：title 刷新策略（P2 三选一 → 方案 a 的具体化）

- **模块域**: platform_sync, change

- **type**: architecture
- **source**: user（任务简报「建议 a（最小面、无跨仓依赖）」+ 本会话调研发现模板 H1 无语义）
- **question**: title 停在首文档派生值（提案书（Proposal））怎么刷新？a) 文档推送时按最新阶段文档重派生；b) 双边契约加 title 字段（跨仓，登记不做）；c) 维持现状 UI 标注。
- **answer**: 采 **a**，并具体化「重派生」算法（关键发现：CLI 模板 H1 是无语义的固定文案，语义名只在 change_key）：

  1. 从推送 documents map（四件套白名单）按阶段深度取最深文档（proposal < requirements < design < tasks）的 H1；
  2. H1 为模板标题（`提案书（Proposal）` 等固定文案，含 `— <key>` 后缀变体）→ 归一化回退 `change_key` 去日期前缀（`2026-09-15-ehs-reward-punishment` → `ehs-reward-punishment`，复用 `_DISPLAY_KEY_RE` 先例）；
  3. H1 为作者自定义文案 → 原样采用。
  - parser `_extract_title` 同步接同一归一化 helper（仍读 proposal.md）：防 reparse 把归一化后的 title 回翻成模板 H1，两写路径不打架。
  - b 登记给 sillyspec 仓（issue 备忘：`serializeForSync` 投影加 title 字段半小时工作量，双边契约成熟后可替换本派生）；c 不采（标注解决不了信息缺失）。
- **evidence**: 生产推送 proposal.md H1 = `# 提案书（Proposal）`（纯模板，老 CLI）；本仓新 CLI 变体 H1 = `# 提案书（Proposal）— 2026-09-15-xxx`；`_extract_title` 只读 proposal.md 首 H1（parser.py:232-244）；`_broadcast_pending_approval` 已有「title 等于 key/空 → 去日期前缀」先例（platform_sync/service.py:428-431）；documents 白名单四件套（schema.py:111-114）。

## D-004@v1：MASTER doc_type 占位行处理（P3）

- **模块域**: change

- **type**: architecture
- **source**: user（任务简报 P3「化妆品级」）
- **question**: change_documents 的 MASTER 行对单变更交付恒 exists=f——标 conditional/optional 还是不再发占位行？
- **answer**: **不再发占位行**：parser 对 MASTER.md 缺席时不追加 exists=False 的 ParsedDoc（其余标准文档保持现状——四件套缺席行是归档门禁 documents_complete 的可见性来源，有意义）。MASTER.md 是 brainstorm 拆分场景产物（本仓 291 变更仅 6 个存在），其缺席不构成「缺失」信号，占位行纯噪音。存量脏行由 `_sync_docs` 的 seen_keys 删除环在下次 reparse 自然清理，无需迁移。
- **evidence**: `grep doc_type='MASTER'` 无任何消费方；`check_archive_gate` REQUIRED_DOC_TYPES 不含 MASTER（service.py:1264）；本仓 find 实测 6/291。
