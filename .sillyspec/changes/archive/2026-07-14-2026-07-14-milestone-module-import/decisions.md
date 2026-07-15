---
author: WhaleFall
created_at: 2026-07-14 18:23:40
---

# 决策台账（Decisions）— 里程碑明细·实施阶段 模块导入

> 本次变更的需求澄清与方案决策记录。长期术语在 archive/scan 时提升到 glossary.md。

---

## D-001@v1 — 导入层级

- **type**: 架构 / 数据模型
- **status**: accepted
- **source**: brainstorm Step 6 对话式探索（推断，Step 9 用户确认设计）
- **question**: Excel 的「任务分类/任务主题/任务描述」是明细层字段，「平台/子系统」是模块层。导入数据怎么落地？
- **answer**: 两级导入——按「平台/子系统」分组建成模块（`PlanNodeModule`），组内每行建成明细（`PsPlanNodeDetail`，`detailed_stage`=任务分类、`task_theme`=任务主题、`task_description`=任务描述、工作量/责任人/起止进明细）。
- **normalized_requirement**: FR-两级导入：导入须同时创建模块与明细两级，明细通过 `module_id` 关联所属模块。
- **impacts**: `importer.py` 分组逻辑；`service.import_commit` 两表写入；字段映射表（design §7.3/§8）
- **evidence**: model.py——`PlanNodeModule` 仅 5 字无 task_theme/description；`PsPlanNodeDetail` 有 detailed_stage/task_theme/task_description；前端 `milestone-details/page.tsx` L1169 明细按 `module_id` 过滤、L1498 创建明细写 `module_id`
- **priority**: P0

---

## D-002@v1 — 责任人匹配策略

- **type**: 错误处理 / 用户场景
- **status**: accepted
- **source**: brainstorm Step 6 用户选择
- **question**: Excel 责任人是中文姓名（可能多人），系统按项目成员 UUID 存储。匹配不到时怎么办？
- **answer**: 按姓名反查当前项目成员（`pm_project_id`）；匹配不到的行 `valid=False` 进失败清单不导入；多人（顿号/逗号分隔）取第一个为 `duty_user_id`，未采用姓名写 `duty_unmatched_note`，预览标出。
- **normalized_requirement**: FR-责任人反查：解析阶段对每行责任人做姓名→UUID 反查；未匹配行不导入并在结果报告列出。
- **impacts**: `ImportPreviewRow.duty_matched/valid/error`；`service.import_preview` 反查；结果 `failed_rows`
- **evidence**: model.py `execute_user_id`/`duty_user_id` 均 UUID 外键；`ppm/project/router.py` `/project-member` 提供成员查询
- **priority**: P1

---

## D-003@v1 — 多 Sheet 处理

- **type**: 用户场景 / 交互
- **status**: accepted
- **source**: brainstorm Step 6 用户选择
- **question**: 每个 Excel 含「正常计划」和「临时插单」两个 Sheet，上传时怎么处理？
- **answer**: 上传后解析列出所有数据 Sheet，让用户勾选要导入哪些再执行；正常计划 Sheet→`plan_type="正常计划"`，临时插单 Sheet（无计划类型列）→`plan_type="临时计划"`；非数据 Sheet（如周历表）忽略。
- **normalized_requirement**: FR-Sheet勾选：预览阶段列出数据 Sheet 供用户勾选；Sheet 类型按表头是否含「计划类型」列自动判定。
- **impacts**: `ImportPreviewResp.sheets`；前端预览 Sheet checkbox；`importer` Sheet 识别逻辑
- **evidence**: 参考文件两 xlsx 的「项目详细计划」含计划类型列、「临时插单计划」无、「周历表」空表
- **priority**: P1

---

## D-004@v1 — 同名模块处理

- **type**: 数据处理 / 边界
- **status**: accepted
- **source**: brainstorm Step 6 用户选择
- **question**: 导入时若某「平台/子系统」模块名在当前里程碑下已存在，怎么办？
- **answer**: 合并——不重复建模块，把新明细追加到已存在的同名 `PlanNodeModule`（按 `plan_node_id` + `module_name` 查）下。
- **normalized_requirement**: FR-同名合并：commit 阶段按 `plan_node_id`+`module_name` 查重，已存在则复用 id 追加明细，否则新建。
- **impacts**: `service.import_commit` 模块查重；`ImportResultResp.merged_modules` 计数
- **evidence**: `PlanNodeModule.plan_node_id` + `module_name` 可唯一定位里程碑下模块
- **priority**: P1

---

## D-005@v1 — 模块层字段取值

- **type**: 数据处理
- **status**: accepted
- **source**: brainstorm Step 7 用户选择
- **question**: 一个模块（平台/子系统）下有多行任务，模块这一层的「工作量/起止日期/责任人」怎么填？
- **answer**: 自动汇总——`plan_begin_time`=组内最早、`plan_complete_time`=组内最晚、`plan_workload`=组内各行数值求和（String 存）、`duty_user_id`=组内首个匹配到的责任人。明细各行保留各自值。
- **normalized_requirement**: FR-模块汇总：commit 时按组聚合模块层字段（min/max/sum/首个）。
- **impacts**: `service.import_commit` 聚合逻辑；`plan_workload` String→float 求和→str
- **evidence**: `PlanNodeModule.plan_workload` 为 `String(64)`（model.py L130）
- **priority**: P1

---

## D-006@v1 — 导入确认方式

- **type**: 交互 / 架构
- **status**: accepted
- **source**: brainstorm Step 7 用户选择
- **question**: 上传 Excel 后是否需要先预览再正式写入？
- **answer**: 预览后确认——两阶段无状态端点：`import-preview`（解析+反查返回 JSON）→ 前端展示预览 → 用户勾选 Sheet + 确认 → `import-commit`（前端回传选中数据入库）→ 结果报告。
- **normalized_requirement**: FR-预览确认：导入须经预览（展示解析结果、责任人匹配、错误行）→ 用户确认 → 入库 两阶段；后端无状态（commit 凭前端回传数据，不依赖服务端缓存）。
- **impacts**: 两个端点（§7.1）；前端三态弹窗；`ImportCommitReq` 回传结构
- **evidence**: 与 export 的 `anyio.to_thread` 模式对称；无 Redis 基础设施→选无状态
- **priority**: P0

---

## D-007@v1 — 实现方案

- **type**: 架构
- **status**: accepted
- **source**: brainstorm Step 8 用户授权推荐
- **question**: Excel 在哪解析、怎么定位列？（方案 A 后端按表头名 / B 后端按列号 / C 前端 SheetJS）
- **answer**: 方案 A——后端 `openpyxl` 解析（`anyio.to_thread` 包裹），按**表头文字**匹配定位列（容错：trim、忽略换行符），解析与责任人反查集中在 `import-preview` 单端点。
- **normalized_requirement**: FR-后端解析按表头名：Excel 解析在后端用 openpyxl，按表头文字定位列（非列号），对列顺序变化鲁棒。
- **impacts**: `importer.py`；复用 export 约定；不引前端 xlsx 库
- **evidence**: 项目已有 openpyxl + `anyio.to_thread` 约定（export.py / router.py L164/L372/L548）；B 列号不健壮、C 前端引库且复杂度前移
- **priority**: P0

---

## D-008@v1 — 事务原子性（Design Grill 修正）

- **type**: consistency / risk
- **status**: accepted
- **source**: design-grill（Step 12 X-003）
- **question**: design §7.3 声称「单事务提交，失败回滚」，但 `service.create_module`/`create_detail` 都走 `_Crud.create`，而 `_Crud.create` 每次单独 `commit()` —— 复用它们则 R-07 原子性对策失效？
- **answer**: `import_commit` **不复用** `_Crud.create`/`create_module`/`create_detail`；改用 `session.add()` 批量挂载所有新建的 `PlanNodeModule`/`PsPlanNodeDetail` 对象，末尾执行**单次** `commit()`；任一写入失败 → 异常冒泡触发整体回滚，返回 `failed_rows`。
- **normalized_requirement**: FR-原子导入：commit 阶段所有模块/明细写入在同一事务，全成功或全回滚，禁止逐条 commit。
- **impacts**: design §7.3 import_commit 实现；R-07 升级为 P1；plan 的 importer commit 任务须注明绕过 `_Crud`
- **evidence**: `service.py` `_Crud.create` 内部 `await self._session.commit()`（逐条提交）；`create_module`（L269）/`create_detail`（L367）均为 `_Crud(...).create(...)` 薄封装
- **priority**: P0
