---
author: qinyi
created_at: 2026-07-22 22:05:00
---

# 决策记录（Decisions）

## D-001@v1: file_urls 存文件 id（继承 file-center D-006）
- type: architecture
- priority: P1
- status: accepted
- supersedes:
- source: docs
- question: TaskExecute 附件怎么存？
- answer: 复用 `file_urls` JSON 列存文件 id，与 `PlanTask`/`PpmProblemList` 完全一致。
- normalized_requirement: `TaskExecute.file_urls: list[str]`，值=文件 id。
- impacts: [FR-01]
- evidence: file-center design.md D-006, task/model.py PlanTask L115-118

## D-002@v1: 附件按记录级归属（用户确认）
- type: boundary
- priority: P1
- status: accepted
- supersedes:
- source: user
- question: 跨天填报时附件归哪条记录？
- answer: 每条 `TaskExecute` 记录（=一天的执行）各自一组附件。
- normalized_requirement: 填报区每天 `DetailDay` 各自 `FileUpload`；执行记录表每行回显当天附件。
- impacts: [FR-02, FR-03, FR-05]
- evidence: 用户 AskUserQuestion 确认「每条记录各自附件」

## D-003@v1: 首天 in-flight 已有 file_urls 回填预填（Design Grill B3）
- type: consistency
- priority: P2
- status: accepted
- supersedes:
- source: code
- question: 重开填报弹窗时首天已传附件丢失？
- answer: 首天预填 `file_urls`（与 `time_spent`/`execute_info` 一致）；problem 侧 `InflightLike` 加 `file_urls` 字段。
- normalized_requirement: `buildDetailDays`（problem）/ task 内联首天预填 `file_urls`。
- impacts: [FR-02, FR-03]
- evidence: task-detail-modal L94-101, problem-detail-modal buildDetailDays L74-97

## D-004@v1: 执行记录表附件列行内 FileViewer
- type: definition
- priority: P2
- status: accepted
- supersedes:
- source: code
- question: 执行记录表怎么展示附件？
- answer: 新增「附件」列，行内 `FileViewer`（图片缩略图 + 文件图标，点击预览/下载）。
- normalized_requirement: 执行记录表加附件列，`<FileViewer fileIds={e.file_urls ?? []}/>`。
- impacts: [FR-04]
- evidence: 复用 file-viewer.tsx

## D-005@v1: owner_id 策略（继承 file-center D-008）
- type: compatibility
- priority: P2
- status: accepted
- supersedes:
- source: docs
- question: 后续天上传时记录尚未创建，owner_id 怎么办？
- answer: 首天 `owner_id=inflightId`（已存在记录）；后续天 `owner_id=null`（D-008 可空），提交 execute 时 file_urls 存入新记录。
- normalized_requirement: FileUpload 后续天 `owner_id=null`；file 表 owner_id `nullable=True`。
- impacts: [FR-02, FR-03]
- evidence: file/model.py L47-51 owner_id nullable, file-center design.md D-008

## D-006@v1: 后端 task/problem 两侧结构差异 + router 链路（Design Grill B1，P0）
- type: consistency
- priority: P0
- status: accepted
- supersedes:
- source: code
- question: problem 侧 file_urls 怎么经 router 到 service？（task 侧直传 body，problem 侧拆包）
- answer: task 侧 `execute_plan(req: ExecutePlanReq)` 取整对象 + router L203 直传 body（2 处改，**router 不用改**）；problem 侧 `execute_problem(*, ...)` 取独立 kwargs + router L313-322 逐字段拆包（**3 处改，router 必补 `file_urls=body.file_urls`**）。
- normalized_requirement: problem/router.py 拆包处补 `file_urls=body.file_urls`；`execute_problem` signature 加 `file_urls: list[str] | None = None`；problem 单测断言 router→service 透传 file_urls。
- impacts: [FR-03]
- evidence: Design Grill review.json B1, problem/router.py L313-322, problem/service.py L522-632/L585-594

## D-007@v1: file_urls 守卫语义（Design Grill B2）
- type: definition
- priority: P2
- status: accepted
- supersedes:
- source: code
- question: `ExecutePlanReq`/`ProblemExecuteReq` 的 file_urls 默认值用什么？
- answer: `list[str] | None = None`（非 `default_factory=list`），service 用 `is not None` 守卫；前端传了才更新，不传保留原值（跨天补登不清空）。
- normalized_requirement: 执行请求 `file_urls: list[str] | None = None`；service `if file_urls is not None: exc.file_urls = file_urls`。
- impacts: [FR-02, FR-03]
- evidence: Design Grill review.json B2, ExecutePlanReq 现有 Optional 字段风格（execute_info/time_spent 均 Optional+None+is not None）
