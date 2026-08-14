# 决策台账（decisions）— platform-sync-docs-approval

## D-001@v1: approval 完整闭环（落库生效）
- type: architecture
- status: accepted
- source: user
- question: POST /api/changes/{name}/approval 的实现深度——审批决定要不要真正落库生效？
- answer: 用户拍板完整闭环：POST 落库审批状态，GET approval 改读库返回真实状态；无记录默认 approved 放行（保持 ql-20260812-001-6eb8 兼容语义）。
- normalized_requirement: POST approval 写 platform_change_progress.approval 列；GET approval 读该列，NULL → `{status:"approved", reason:"no approval record; default-approved"}`；rejected 记录 → CLI execute checkApproval 硬阻断（command.js rejected → exit(1)）。
- impacts: [FR-02, FR-03, 接口地图 §2 撤除 405 标注]
- evidence: 用户 AskUserQuestion 回答（2026-08-14）；sync.js:960-996 _submitApproval；router.py:120-137 get_approval 现状
- priority: P0

## D-002@v1: documents 存 platform_change_progress 新加 JSON 列
- type: architecture
- status: accepted
- source: user
- question: 四件套文档全文存哪？
- answer: 用户拍板 progress 行加列（不建独立表）：platform_change_progress 加 documents JSON 列，与 latest_progress 同行，复用 (workspace_id, change_name) 复合键 upsert。
- normalized_requirement: POST documents 按复合键 upsert 该行的 documents 列；行不存在则 INSERT 占位（latest_progress NULL）；migration 一个 batch_alter_table 加列。
- impacts: [FR-01, migration, model.py]
- evidence: 用户 AskUserQuestion 回答（2026-08-14）；model.py 现有结构
- priority: P0

## D-003@v1: 单写者纪律——三个写入方定向列，互不覆盖
- type: architecture
- status: accepted
- source: user
- question: CLI push progress（整行替换 latest_progress）与平台写 approval/documents 如何不互相冲掉？
- answer: 方案A（用户选定）：approval 与 documents 都是独立 JSON 列，独立于 latest_progress。upsert_progress 改定向列 UPDATE（只动 latest_progress/last_pushed_at/last_pusher/updated_at），INSERT 不带 approval/documents；POST documents 只 UPDATE documents 列；POST approval 只 UPDATE approval 列。
- normalized_requirement: 三个写入路径任何一条都不能覆盖其他两条的字段；service 层实现定向 UPDATE 而非整行替换。
- impacts: [FR-01, FR-02, FR-04, service.py upsert_progress 重构]
- evidence: 用户 AskUserQuestion 选择方案A（2026-08-14）
- priority: P0

## D-004@v1: body 契约以 CLI sync.js 字面为准（含过去式 decision）
- type: compatibility
- status: accepted
- source: code
- question: 请求 body schema 以什么为准——CLI 实际发送的格式还是重设计的新格式？
- answer: 以 CLI 现状字面为准，不改 sillyspec 仓：documents body 是扁平 map {"proposal.md": "全文", ...}（sync.js:460-488）；approval body 是 {decision: "approved"|"rejected"（过去式）, reason?}（sync.js:961-963）。后端 schema 照此定义。
- normalized_requirement: DocumentsSyncRequest = dict[str, str] 键限白名单；ApprovalSubmitRequest = {decision: Literal["approved","rejected"], reason: str|None}。
- impacts: [FR-01, FR-02, schema.py]
- evidence: sillyspec/src/sync.js:460-488, 961-963 实测读码
- priority: P0
