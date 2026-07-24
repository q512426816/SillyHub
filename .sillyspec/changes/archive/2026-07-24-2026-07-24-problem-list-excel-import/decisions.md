---
author: qinyi
created_at: 2026-07-24 09:16:11
change: 2026-07-24-problem-list-excel-import
---

# 决策台账 · 问题清单 Excel 批量导入

本变更的决策台账（非长期术语表）。仅记录有实现/验收影响的决策。

> D-008~D-014 由 Design Grill 交叉审查（review.json pass/pass）发现的 P1/P2 gap 补强。

## D-001@v1: 导入范式 = 后端解析 + 两步式预览/确认
- type: architecture
- status: accepted
- source: user
- priority: P0
- question: Excel 解析放前端还是后端？交互走一步直接入库还是两步预览？
- answer: 后端 openpyxl 解析（复用项目计划 `importer.py` 范式：按表头文字定位列、合并单元格 forward-fill、Excel 日期序列号转换、跳过全空行），交互走两步式：`import-preview` 返回带 `valid/error` 的行 → 用户确认 → `import-commit` 入库。弃用前端解析（需引 xlsx 新依赖、N 条 N 请求、反查逻辑搬前端）与一步导入（无预览、误入库难撤回）。
- normalized_requirement: 后端新增 `problem/importer.py` 纯解析模块（同步 `def`，调用方 `anyio.to_thread.run_sync` 包裹）；router 新增 2 端点；前端三态弹窗复制 `import-module-modal.tsx` 范式。
- impacts: [design-§5-Wave1, design-§7, task-importer, task-router, task-service, task-frontend-modal]
- evidence: `backend/app/modules/ppm/plan/importer.py`；`backend/app/modules/ppm/plan/router.py:354-394`；`frontend/src/components/ppm/milestone/import-module-modal.tsx`

## D-002@v1: 项目归属 = Excel 每行填项目名反查（跨项目导入）
- type: requirement
- status: accepted
- source: user
- priority: P0
- question: 导入的问题归属到哪个项目？问题清单页本身是跨项目的（项目只是筛选项）。
- answer: Excel 每行填「项目名称」，后端按名反查 `project_id`，支持一次导入多个项目的问题。
- normalized_requirement: 模板含「项目名称」列且**必填**；`import_preview` 按 `PpmProjectMaintenance.project_name` 精确反查 `id`；项目名填了但匹配不到 → 整行 `valid=false`。
- impacts: [design-§7-DTO, design-§10-R-02, task-importer-template, task-service-resolve]
- evidence: 用户澄清回答；`backend/app/modules/ppm/project/model.py:42`（class）+ `:79`（`project_name` 字段，**非 `.name`**）；`backend/app/modules/ppm/problem/service.py:435`（现网用 `.project_name`）

## D-003@v1: 导入字段 = 全部业务字段
- type: requirement
- status: accepted
- source: user
- priority: P1
- question: 导入模板包含哪些列？
- answer: 全部业务字段。17 列：项目名称、模块名称、问题描述、问题类型、是否加急、功能名称、责任人、发现人、发现时间、计划开始、计划结束、验证人、工作量(人天)、工作类型、问题答复、是否延期计划、备注。
- normalized_requirement: 模板 17 列；`ParsedProblemRow` / DTO 覆盖全部字段；预览 Table 全字段 + 状态列。
- impacts: [design-§7-DTO, task-importer, task-frontend-modal, task-template]
- evidence: 用户澄清回答；`backend/app/modules/ppm/problem/schema.py:23-50`（ProblemListBase）

## D-004@v1: 未匹配处理 = 严格模式（填了未匹配整行拒绝）
- type: requirement
- status: accepted
- source: user
- priority: P0
- question: Excel 里的责任人/验证人/模块/项目名匹配不到系统记录时怎么处理？
- answer: **严格模式**：填了但匹配不到 → 整行 `valid=false` 标红拒绝导入。未填（留空）的选填匹配字段不算未匹配，允许留空。与项目计划"标记留空仍导入"宽松模式**不同**。
- normalized_requirement: `import_preview` 逐行校验——匹配类（project 必填须匹配；module/duty/audit 填了须匹配）未匹配→`valid=false`，`error` 列明原因；`import_commit` 跳过 `valid=false` 行计入 `skipped`。**必填维度见 D-009**。
- impacts: [design-§7-DTO, design-§10-R-02, task-service-validate, task-frontend-modal-标红, verify-严格校验]
- evidence: 用户澄清回答；对比 `backend/app/modules/ppm/plan/service.py:1473-1615`（plan 宽松模式）

## D-005@v1: 重复处理 = 不查重
- type: requirement
- status: accepted
- source: user
- priority: P2
- question: Excel 里有重复行怎么处理？
- answer: 不查重，Excel 有几行就新建几条。
- normalized_requirement: `import_commit` 不做查重，遍历 `valid` 行逐条建对象。
- impacts: [task-service-commit]
- evidence: 用户澄清回答

## D-006@v1: 反查数据源
- type: architecture
- status: accepted
- source: code
- priority: P0
- question: project_id / module_id / duty_user_id / audit_user_id 按 Excel 姓名分别反查哪张表？
- answer:
  - `project_id` ← `PpmProjectMaintenance.project_name`（表 `ppm_project_maintenance`）
  - `module_id` ← 复用 `PlanService.list_modules_by_project(project_id)`，在行所属 project 下按模块名匹配 `PlanNodeModule.id`
  - `duty_user_id` / `audit_user_id` ← **限该项目成员** `PpmProjectMember`（见 D-014，对齐 create 表单语义，非全局 User）
  - 反查批量执行：先收集全部姓名/名去重，一次性查库建映射，避免逐行 N+1
- normalized_requirement: `import_preview` 实现 3 类批量反查 helper（project 全量映射；module 按出现 project_id 分组调 `list_modules_by_project`；duty/audit 按 project 分组查 `PpmProjectMember`）。反查逻辑只存在于 import 路径，不改现有 create。
- impacts: [design-§7, design-§10-R-01, task-service-resolve, verify-反查]
- evidence: `backend/app/modules/ppm/project/model.py:42,:79`（project_name）；`backend/app/modules/ppm/plan/router.py:321-335` + `plan/service.py:401-409`（list_modules_by_project 关联链自洽，grill X-010 核验）；`backend/app/modules/ppm/problem/service.py:292-309`（create 不反查）

## D-007@v1: 不导入系统字段；status 默认「新建」；created_by 当前用户
- type: boundary
- status: accepted
- source: code
- priority: P1
- question: 哪些字段不纳入导入？新建问题的系统字段默认值？
- answer: 不导入：附件 `file_urls`（URL/id 体系）、`real_end_time`/`audit_time`（执行产生）、`time_spent`/`now_node`/`now_handle_user`/`check_*`（流程字段）。新建 `status="新建"`、`created_by`=当前登录用户。
- normalized_requirement: `import_commit` 入库 `status="新建"`、`created_by=user.id`，不写上述系统字段；`file_urls` 走默认空列表。
- impacts: [design-§7, task-service-commit, task-template]
- evidence: `backend/app/modules/ppm/problem/model.py:85-88,:126-149`；`backend/app/modules/ppm/problem/service.py:305-307`

## D-008@v1: import_commit 原子性 = 单次事务提交（对齐项目计划）
- type: architecture
- status: accepted
- source: code
- priority: P1
- question: 批量入库是逐行 `_Crud.create`（每行单独 commit，非原子）还是单次事务原子提交？design 原文「复用 create_problem」与「完全对齐项目计划导入」互斥（grill B-001）。
- answer: **单次事务原子提交**，对齐项目计划 `import_commit`（`plan/service.py:1620-1621,1715` 单次 commit）。preview 已严格过滤 invalid，commit 只处理 valid 行；任一行 DB 异常 → 整批回滚，接口抛错（非部分入库）。`failed_rows` 字段语义改为「整批提交异常时的诊断信息」（原子成功时为空），不再暗示逐行失败。
- normalized_requirement: `import_commit` 内 `session.add_all([...])` + 单次 `await session.commit()`；不再逐行调 `_Crud.create`。DTO `ProblemImportResultResp.failed_rows` 文案同步更新。
- impacts: [design-§5-Wave1-service, design-§7-DTO, task-service-commit, verify-原子性]
- evidence: `backend/app/modules/ppm/plan/service.py:1617-1720`（plan 单次 commit 原子范式）；grill B-001

## D-009@v1: 导入必填字段 = 项目名称 + 问题描述
- type: requirement
- status: accepted
- source: code
- priority: P1
- question: D-004「严格校验」只定义了「匹配」维度，必填维度空白（grill B-002）。新建表单有 11 个 required，导入该强制哪些？
- answer: 导入必填仅 **项目名称（且须匹配）+ 问题描述**。其余字段全选填（模块/功能/责任人/验证人/各类时间/工作量/备注等均可留空，事后在页面补）。导入比新建表单宽松——批量录入优先「能进就进」，强约束留给匹配维度（D-004）。
- normalized_requirement: `import_preview` 校验 `project_name` 空/未匹配、`pro_desc` 空 → `valid=false`；其余字段空均允许。
- impacts: [design-§7, design-§10, task-service-validate, verify-必填]
- evidence: grill B-002；`frontend/src/app/(dashboard)/ppm/problem-list/_forms.tsx`（表单 required 是 UI 引导，不强制对齐）

## D-010@v1: date→datetime 转换在 service 入库前
- type: architecture
- status: accepted
- source: code
- priority: P2
- question: importer 产出 `date`，DTO/ORM 是 `datetime`，Pydantic v2 不自动强转会 422（grill B-004）。
- answer: importer 仍产出 `date`（纯解析职责）；`import_commit` 入库前把 `date` → `datetime`（对齐项目计划 `_date_to_datetime`，`plan/service.py:1564`）。
- normalized_requirement: service 提供日期转换 helper；DTO 声明 `datetime | None`，commit 入库前转换。
- impacts: [design-§7, task-service-commit, verify-日期转换]
- evidence: `backend/app/modules/ppm/plan/service.py:1564`（_date_to_datetime）；grill B-004

## D-011@v1: commit 不信任前端 UUID，重新反查 + data_scope 校验
- type: architecture
- status: accepted
- source: code
- priority: P2
- question: `ProblemImportPreviewRow` 同时含原文姓名与反查 UUID，commit 由前端回传——前端可篡改 UUID 越权（grill B-005）。
- answer: `import_commit` **不信任前端回传的 UUID**，按行内原文（project_name/module_name/duty_user_name/audit_user_name）**重新反查** UUID 后入库；并对每行 `project_id` 做 data_scope 可访问性校验（当前用户须能操作该项目）。前端回传的 UUID 字段仅作展示，入库时忽略。
- normalized_requirement: `import_commit` 复用 `import_preview` 的反查 helper 重算 UUID；校验失败（重算后未匹配/越权）的行计入 `failed_rows` 并跳过，不中断整批（但整批仍单次事务——见 D-008，重算失败行在 add 前剔除）。
- impacts: [design-§5-service, design-§10-R-06, task-service-commit, verify-防篡改]
- evidence: grill B-005；`backend/app/modules/ppm/common/data_scope.py`（data_scope 复用）

## D-012@v1: DTO.module_name → ORM.model_name + module_id 双写
- type: architecture
- status: accepted
- source: code
- priority: P2
- question: DTO 用 `module_name`（Excel 列名友好），ORM 列是 `model_name`（文本）+ `module_id`（UUID），直接 `**dict` 映射会 TypeError（grill B-006）。
- answer: DTO 字段命名 `module_name`（对 Excel/前端友好）；`import_commit` 入库时显式映射：`module_name` → ORM `model_name`（原文文本），反查到的 `module_id` → ORM `module_id`。不依赖 `**dict` 自动映射。
- normalized_requirement: service build ORM 对象时显式字段赋值（不用 `**row.dict()`）；列对照表写入 design §7。
- impacts: [design-§7, task-service-commit, verify-字段映射]
- evidence: `backend/app/modules/ppm/problem/model.py:81-82`（module_id + model_name 两列）；grill B-006

## D-013@v1: 上传校验抽到 ppm/common，不跨域引 plan 私有函数
- type: architecture
- status: accepted
- source: code
- priority: P2
- question: 复用 plan 的 `_validate_upload` 需跨子域引私有（`_` 前缀）函数且抛 `PlanError`（错误域错位）（grill B-007）。
- answer: 在 `backend/app/modules/ppm/common/` 新增通用上传校验 helper（.xlsx 扩展名 + 大小上限，抛中立异常如 `PpmImportError` 或复用 problem 域错误），problem 与 plan 后续均可引用。不直接 import plan 私有函数。
- normalized_requirement: 新增 `ppm/common/upload.py`（或并入现有 common 模块）`validate_xlsx_upload(file, file_bytes)`；problem router import-preview 调用它。
- impacts: [design-§5-Wave1, design-§6-文件清单, task-router, task-common-upload]
- evidence: grill B-007；`backend/app/modules/ppm/plan/router.py:1108`（_validate_upload 现状）

## D-014@v1: 责任人/验证人反查限该项目成员
- type: architecture
- status: accepted
- source: code
- priority: P2
- question: duty/audit 反查走全局 User 可绑非项目成员，与 create 表单（限 `PpmProjectMember`）语义不一致（grill B-008）。
- answer: duty/audit 反查限**当前行 project 的成员**（`PpmProjectMember`，按姓名/display_name 匹配 user_id），对齐 create 表单语义。匹配不到（非该项目成员）→ 按 D-004 整行 `valid=false`。
- normalized_requirement: 反查 helper 按 project_id 分组查 `PpmProjectMember`（姓名→user_id）；D-006 的 duty/audit 反查源以此为准（覆盖 D-006 原写的「全局 User」）。
- impacts: [design-§7, task-service-resolve, verify-成员范围]
- evidence: grill B-008；`frontend/src/app/(dashboard)/ppm/problem-list/_forms.tsx:445`（表单限项目成员）；`backend/app/modules/ppm/project/model.py:188`（PpmProjectMember）
