---
author: WhaleFall
created_at: 2026-07-14 18:35:40
scale: large
---

# 需求规格（Requirements）— 里程碑明细·实施阶段 模块导入

## 功能需求（FR）

### FR-001 两级导入（D-001）
导入须同时创建模块与明细两级：按「平台/子系统」分组建成 `PlanNodeModule`，组内每行建成 `PsPlanNodeDetail`，明细通过 `module_id` 关联所属模块。
- 字段映射：平台/子系统→`module_name`；任务分类→`detailed_stage`；任务主题→`task_theme`；任务描述→`task_description`；工作量→`plan_workload`；开始/结束日期→`plan_begin_time`/`plan_complete_time`。

### FR-002 计划类型字段（D-003）
`PlanNodeModule` 新增 `plan_type`（正常计划/临时计划）。正常计划 Sheet（表头含「计划类型」列）→「正常计划」；临时插单 Sheet（无该列）→「临时计划」。模块列表展示该列。

### FR-003 Excel 按表头名解析（D-007）
后端 openpyxl 解析，按表头**文字**定位列（非列号），对列顺序变化鲁棒；处理合并单元格（序号/平台向下填充）、Excel 日期序列号转换；跳过全空行；忽略周次/状态/执行情况/备注。

### FR-004 责任人反查（D-002）
解析阶段对每行责任人按姓名反查当前项目成员 UUID（直接 ORM 查 `ProjectMember` 全量，`user_name` 为空不可匹配）；未匹配行 `valid=False` 不导入并在结果报告列出；多人（顿号/逗号）取首个，未采用姓名标出。

### FR-005 Sheet 勾选（D-003）
预览阶段列出所有数据 Sheet 供用户勾选；非数据 Sheet（如周历表）忽略。

### FR-006 同名模块合并（D-004）
commit 阶段按 `plan_node_id` + `module_name` 查重，已存在则复用 id 追加明细，否则新建。

### FR-007 模块自动汇总（D-005）
commit 时按组聚合模块层字段：`plan_begin_time`=组内非空开始日期 min；`plan_complete_time`=组内非空结束日期 max；`plan_workload`=组内数值求和（非数字/空→视为 0；全组无有效数字→NULL）；`duty_user_id`=组内首个匹配责任人。明细各行保留各自值。

### FR-008 预览后确认（D-006）
导入经两阶段无状态端点：`import-preview`（解析+反查返回 JSON）→ 前端展示预览 → 用户勾选 Sheet + 确认 → `import-commit`（前端回传选中数据入库）→ 结果报告。后端无状态，commit 凭回传数据。

### FR-009 原子导入（D-008）
commit 阶段所有模块/明细写入在同一事务，全成功或全回滚；禁止逐条 commit（不复用 `_Crud.create`，改 `session.add()` + 末尾单次 `commit()`）。

### FR-010 导入明细状态
导入的明细固定 `status="draft"`，不触发状态机，需用户后续手动提交（与 ql-20260713-010「提交=done」语义区隔）。

## 非功能需求（NFR）
- **NFR-001 权限**：导入端点复用 `Permission.PPM_PLAN_WRITE`。
- **NFR-002 性能**：Excel 解析（`load_workbook` + 解析）用 `anyio.to_thread.run_sync` 包裹，不阻塞事件循环（X-002 约定）。
- **NFR-003 兼容**：`plan_type` nullable，旧模块数据 NULL 不影响既有展示/流程；未用导入功能时现有 CRUD 不变。
- **NFR-004 依赖**：后端新增 `python-multipart`（`UploadFile` 必需）；Docker 镜像需 rebuild。
- **NFR-005 跨平台**：兼容 Windows/Linux/macOS（日期解析、文件读写不依赖平台特性）。

## 验收标准（摘要，详见 tasks.md）
- 解析两份参考 xlsx 正确识别正常/临时 Sheet，字段映射无误，合并单元格向下填充正确，日期序列号正确转换。
- 责任人未匹配的行在预览标红、不入库、出现在结果报告。
- 同名模块追加明细而非重复创建。
- 模块汇总值正确（min/max/求和；非数字工作量防御性处理）。
- commit 中途失败时整体回滚，无脏数据。
- 前端 上传→预览→确认→结果 流程闭环，列表显示「计划类型」列。
