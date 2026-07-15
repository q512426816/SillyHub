---
author: WhaleFall
created_at: 2026-07-14 18:22:10
scale: large
---

# 设计文档（Design）— 里程碑明细·实施阶段 模块导入

> 关联原型：`prototype-milestone-module-import.html`
> 关联决策台账：`decisions.md`

## 1. 背景

里程碑明细页（`milestone-details`）中，**实施阶段**里程碑下存在「明细 · 模块」两级结构：模块（`PlanNodeModule`）→ 明细（`PsPlanNodeDetail`）。当前模块与明细只能逐条手工新建，当项目从外部 Excel 计划（如《项目详细开发计划》）迁移时，几十上百条数据要逐条录入，效率低且易错。

业务方已有标准 Excel 模板（参考 `C:\Users\12532\Desktop\参考` 下两个 xlsx），包含「平台/子系统（模块）、任务分类（明细阶段）、任务主题、任务描述、工作量、责任人、起止日期」等列，且区分「正常计划」与「临时插单」两类。

需要增加一个**导入功能**：在实施阶段里程碑的「明细 · 模块」列表批量导入 Excel，自动建成模块 + 明细两级数据，并新增「计划类型」列以区分正常/临时。

## 2. 设计目标

- 在「明细 · 模块」列表顶部新增「导入模块」按钮，针对当前实施阶段里程碑导入。
- 解析参考格式 Excel（`.xlsx`），支持「项目详细计划（正常计划）」与「临时插单计划（临时计划）」两类 Sheet。
- 两级落地：按「平台/子系统」分组建成模块，组内每行建成明细（明细阶段=任务分类、主题=任务主题、描述=任务描述、工作量/责任人/起止日期进明细）。
- 模块层新增「计划类型」字段（正常计划 / 临时计划），并在列表展示。
- 预览后确认：上传 → 解析预览（勾选 Sheet + 标错）→ 确认 → 入库 → 结果报告。
- 责任人按姓名反查当前项目成员 UUID，匹配不到的行进失败清单不导入。
- 同名模块合并：把新明细追加到当前里程碑下已存在的同名模块。
- 模块层字段自动汇总（起止取组内 min/max、工作量求和、责任人取组内首个）。

## 3. 非目标

- 不导入：周次、状态、计划执行情况（开始/完成时间/延期原因/执行说明）、评估说明、备注 等列。
- 不支持 `.xls`（老格式）、CSV（本期不做）。
- 不做多级表头嵌套超过 2 行的兼容（参考模板为 2 行合并表头）。
- 不做导入撤销/回滚按钮（依赖数据库事务保证原子性；误导入手动删除）。
- 不改「模板簇」（`plan-nodes` 页）的模块表，本期只覆盖 ps 执行簇的「实施阶段里程碑」。
- 不做导入进度条/异步任务队列（单文件量级小，同步线程池解析即可）。

## 4. 拆分判断

不拆分。理由：是单一连贯功能（上传 → 解析 → 入库），前后端 + 一个字段迁移耦合紧密，不足 3 个独立可交付模块、无多角色权限差异、无审批流。不满足批量模式（非「模板 × 数据」）。按正常 Wave 推进。

## 5. 总体方案

采用**方案 A：后端 openpyxl 解析 + 按表头名匹配列 + 无状态两阶段端点**（见 `decisions.md` D-007）。

### 流程

```
[实施阶段里程碑 → 明细·模块列表]
  └─ [📥 导入模块] 按钮
       │ 前端 FormData 上传 .xlsx
       ▼
POST /api/ppm/plan-node/{plan_node_id}/modules/import-preview?pm_project_id=...
  （anyio.to_thread 包 openpyxl.load_workbook；识别数据 Sheet；
   按表头名定位列；合并单元格向下填充；日期序列号转换；
   责任人姓名 → 项目成员 UUID 反查）
       │ 返回预览 JSON
       ▼
前端预览弹窗：勾选 Sheet + 表格预览（未匹配责任人/错误行标红）
       │ 用户勾选 + [确认导入]
       ▼
POST /api/ppm/plan-node/{plan_node_id}/modules/import-commit
  （前端回传选中的解析数据；按平台/子系统分组；
   模块新建/合并 + 自动汇总；明细逐行创建；单事务）
       │ 返回结果报告
       ▼
toast + 刷新列表 + 关闭弹窗
```

### Phase 划分（对应 plan.md 的 Wave）

- **Wave 1（数据模型）**：`PlanNodeModule` 加 `plan_type` 字段 + alembic migration + schema/DTO + 前端类型与列表列。
- **Wave 2（后端解析+入库）**：新建 `importer.py` 解析模块；service 加 `import_preview`/`import_commit`；router 加两个端点；加 `python-multipart` 依赖。
- **Wave 3（前端交互）**：导入按钮 + 上传 fetch（FormData + token 刷新）+ 预览弹窗 + 确认提交。
- **Wave 4（测试）**：后端解析/反查/入库单测 + 端点集成测试；前端流程测试。

## 6. 文件变更清单

| 操作 | 文件路径 | 说明 |
|---|---|---|
| 修改 | `backend/app/modules/ppm/plan/model.py` | `PlanNodeModule` 新增 `plan_type` 字段（`String(32)`，nullable，default `"正常计划"`） |
| 新增 | `backend/migrations/versions/<alembic 自动生成>_add_plan_type_to_plan_node_module.py` | alembic 迁移：`ppm_plan_node_module` 加 `plan_type` 列（nullable，旧数据留 NULL） |
| 修改 | `backend/app/modules/ppm/plan/schema.py` | `PlanNodeModuleBase/Create/Update/Resp` 加 `plan_type`；新增导入 DTO（见 §7） |
| 新增 | `backend/app/modules/ppm/plan/importer.py` | Excel 解析：识别 Sheet、按表头名定位列、合并单元格向下填充、日期转换、构造预览行 |
| 修改 | `backend/app/modules/ppm/plan/service.py` | 新增 `import_preview(file_bytes, plan_node_id, pm_project_id)`、`import_commit(req, plan_node_id)`（含责任人反查、模块合并、汇总、明细创建） |
| 修改 | `backend/app/modules/ppm/plan/router.py` | 新增 `POST /plan-node/{plan_node_id}/modules/import-preview`、`POST .../modules/import-commit`（注意路由顺序，见 R-06） |
| 修改 | `backend/pyproject.toml` | 新增依赖 `python-multipart`（`UploadFile` 必需） |
| 新增 | `backend/app/modules/ppm/plan/tests/test_importer.py` | 解析单测：正常/临时 Sheet、合并单元格、日期、多人责任人、空行、表头变体 |
| 修改 | `backend/app/modules/ppm/plan/tests/test_router.py` | 导入端点集成测试（预览 + 提交 + 同名合并 + 责任人未匹配） |
| 修改 | `frontend/src/lib/ppm/types.ts` | `PlanNodeModule` 加 `plan_type`；新增导入相关 TS 类型 |
| 修改 | `frontend/src/lib/ppm/plan.ts` | 新增 `importModulesPreview(planNodeId, projectId, file)`、`importModulesCommit(planNodeId, payload)` |
| 修改 | `frontend/src/lib/ppm/export.ts` | 复用/抽取带 token 刷新的 fetch，新增 `uploadExcelWithAuth(url, file)`（FormData，不复用 `apiFetch`） |
| 修改 | `frontend/src/app/(dashboard)/ppm/milestone-details/page.tsx` | `ModuleLevelTable` 顶部加「导入模块」按钮；`moduleColumns` 加「计划类型」列；新增 `ImportModuleModal` 组件（上传态/预览态/结果态） |

## 7. 接口定义

### 7.1 新增端点

```python
# router.py —— import-preview / import-commit 须声明在 /plan-node-module/{item_id} 之前（路由顺序，R-06）

@router.post("/plan-node/{plan_node_id}/modules/import-preview")
async def import_modules_preview(
    plan_node_id: str,
    pm_project_id: str = Query(...),          # 用于责任人反查项目成员
    file: UploadFile = File(...),
    session: SessionDep,
    user: Annotated[User, Depends(require_permission_any(Permission.PPM_PLAN_WRITE))],
) -> ImportPreviewResp: ...

@router.post("/plan-node/{plan_node_id}/modules/import-commit")
async def import_modules_commit(
    plan_node_id: str,
    body: ImportCommitReq,
    session: SessionDep,
    user: Annotated[User, Depends(require_permission_any(Permission.PPM_PLAN_WRITE))],
) -> ImportResultResp: ...
```

### 7.2 数据结构（schema.py 新增）

```python
class ImportPreviewRow(PydanticModel):
    sheet_name: str
    plan_type: str                 # "正常计划" / "临时计划"
    module_name: str | None        # 平台/子系统（已向下填充）
    detailed_stage: str | None     # 任务分类
    task_theme: str | None
    task_description: str | None
    plan_workload: str | None      # 原样字符串
    duty_user_name: str | None     # Excel 原始责任人（多人取首个，原文保留）
    duty_user_id: uuid.UUID | None # 反查到的 UUID；未匹配为 None
    duty_matched: bool             # 是否匹配到项目成员
    duty_unmatched_note: str | None  # 多人时未采用的姓名提示
    plan_begin_time: datetime | None
    plan_complete_time: datetime | None
    valid: bool                    # 是否可导入（责任人未匹配/必填缺失→False）
    error: str | None              # 不可导入原因

class ImportPreviewSheet(PydanticModel):
    name: str
    plan_type: str
    row_count: int
    rows: list[ImportPreviewRow]

class ImportPreviewResp(PydanticModel):
    sheets: list[ImportPreviewSheet]
    parse_errors: list[str]        # 整体解析错误（如找不到表头）

class ImportCommitReq(PydanticModel):
    # duty_user_id 已在 preview 反查并随行回传，commit 无需 pm_project_id（Grill X-008）
    sheets: list[ImportCommitSheet]

class ImportCommitSheet(PydanticModel):
    name: str
    plan_type: str
    rows: list[ImportPreviewRow]   # 前端回传用户确认导入的行（valid 行）

class ImportResultResp(PydanticModel):
    created_modules: int
    merged_modules: int            # 追加明细到已存在同名模块
    created_details: int
    skipped_rows: int              # valid=False 被排除
    failed_rows: list[str]         # 入库阶段失败的行描述
```

### 7.3 Service 方法签名

```python
class PlanService:
    async def import_preview(
        self, file_bytes: bytes, plan_node_id: str, pm_project_id: str
    ) -> ImportPreviewResp:
        # 1. anyio.to_thread 包 importer.parse_workbook(file_bytes) 得结构化行
        #    （两类 Sheet 列位不同：正常计划「平台/子系统」在 col4、有「计划类型」col2；
        #     临时插单「平台/子系统」在 col3、无「计划类型」列。importer 按表头文字
        #     分别定位列，不依赖固定列号 —— Grill X-009）
        # 2. 直接 ORM 查 ProjectMember 全量（where pm_project_id，不走 REST 分页，
        #    避免 page_size 截断），建 {user_name: user_id} 反查表；
        #    user_name 为空的成员不可匹配（Grill X-005）
        # 3. 对每行做责任人反查，标记 duty_matched/valid
        # 4. 组装 ImportPreviewResp

    async def import_commit(
        self, req: ImportCommitReq, plan_node_id: str
    ) -> ImportResultResp:
        # ⚠ 不复用 _Crud.create / create_module / create_detail（其每次单独 commit，
        #    破坏原子性）；改用 session.add() 批量挂对象 + 末尾单次 commit()（D-008@v1）
        # 1. 按 module_name（平台/子系统）分组
        # 2. 每组：查 plan_node_id + module_name 是否已有 PlanNodeModule → 合并/新建
        # 3. 模块自动汇总（可测试定义，Grill X-001/X-002）：
        #    - plan_begin_time   = 组内非空「开始日期」的 min；组内全空 → NULL
        #    - plan_complete_time= 组内非空「结束日期」的 max；组内全空 → NULL
        #    - plan_workload     = 组内工作量数值求和；非数字/空 → 视为 0（不影响该行 valid）；
        #                          全组无有效数字 → NULL（工作量列为 String，求和经 _to_decimal）
        #    - duty_user_id      = 组内首个 duty_matched=True 的 duty_user_id
        # 4. 每行建 PsPlanNodeDetail(plan_node_id, module_id, detailed_stage, ..., status="draft")
        #    status 固定 draft，不触发状态机（与 ql-20260713-010「提交=done」语义区隔；
        #    导入的明细需用户后续手动提交）—— Grill X-010
        # 5. session.add() 全部对象 → 末尾单次 commit()；任一失败 → 整体回滚，返回 failed_rows
```

## 8. 数据模型

### 字段变更

`PlanNodeModule`（表 `ppm_plan_node_module`）新增：

```python
plan_type: str | None = Field(
    default="正常计划",
    sa_column=Column(String(32), nullable=True, default="正常计划"),
)
```

取值约束（业务层，非 DB 枚举）：`"正常计划"` | `"临时计划"`。在 `importer` / `service` 层校验，schema 层用 `Literal["正常计划", "临时计划"]` 约束导入路径。

### Migration

新增 alembic 迁移 `add_plan_type_to_plan_node_module`：`ALTER TABLE ppm_plan_node_module ADD COLUMN plan_type VARCHAR(32)`（不加 NOT NULL，旧数据留 NULL）。

### 两级关联（既有，不变）

- 模块：`PlanNodeModule(plan_node_id=里程碑id, module_name, plan_workload, plan_begin_time, plan_complete_time, duty_user_id, plan_type)`
- 明细：`PsPlanNodeDetail(plan_node_id=里程碑id, module_id=模块id, detailed_stage, task_theme, task_description, plan_workload, plan_begin_time, plan_complete_time, execute_user_id, status="draft")`
  - `status` 固定 `draft`，不触发状态机（与 ql-20260713-010「提交=done」语义区隔；导入明细需用户后续手动提交）
  - 模块层汇总规则见 §7.3（工作量非数字→视为 0、日期空→忽略、组内全空→NULL）

## 9. 兼容策略（brownfield）

- `plan_type` nullable，旧模块数据为 NULL；前端列表对 NULL 显示「—」（或按需默认「正常计划」），不影响既有展示。
- 未使用导入功能时，现有「新建模块」「编辑模块」流程完全不变；`ModuleFormDrawer` 可选是否加「计划类型」选择（本期列表展示为主，表单补充计划类型为可选增强）。
- 新增两个端点为独立路径，不影响现有 `/plan-node-module` CRUD。
- 回退路径：不点「导入模块」按钮即不触发；误导入的数据可在列表手动删除（模块/明细已有 DELETE 端点）。
- 不改变的 API / 表结构：除 `ppm_plan_node_module` 加一列外，其余表结构不变。

## 10. 风险登记

| 编号 | 风险 | 等级 | 应对策略 |
|---|---|---|---|
| R-01 | 新增 `python-multipart` 依赖 | P2 | 写入 `pyproject.toml`，文档注明需 `pip install -e .` 重建；Docker 镜像 rebuild |
| R-02 | 用户 Excel 表头/列顺序与模板不一致 | P1 | 按表头**文字**匹配列（trim + 忽略换行符），非按列号；找不到关键列→`parse_errors` 提示 |
| R-03 | 责任人姓名重名（项目内多个同名） | P2 | 反查命中多个时取第一个，`duty_unmatched_note` 标出存在重名；预览可见 |
| R-04 | 合并单元格（序号/平台）解析遗漏 | P1 | 用 `openpyxl` 读 `merged_cells.ranges`，对合并区域向下填充；单测覆盖 |
| R-05 | 大文件解析阻塞 asyncio 事件循环 | P1 | `load_workbook` + 解析整体用 `anyio.to_thread.run_sync` 包裹（复用 export 的 X-002 约定） |
| R-06 | 路由顺序（Grill 核查后降级） | P2 | 新端点 `/plan-node/{id}/modules/import-*` 与现有 `/plan-node-module/{item_id}` 前缀不同；与 `/plan-node/{id}`（GET）段数 + method 不同，**实测不冲突**。保持前置注册习惯即可，无需额外回归测试（Grill X-004） |
| R-07 | commit 阶段部分失败导致脏数据 | P1 | `import_commit` **不复用 `_Crud.create`**（其逐条 commit 破坏原子性），改用 `session.add()` + 末尾单次 `commit()`，任一失败整体回滚（D-008@v1） |
| R-08 | 日期为 Excel 序列号（如 46149）解析错 | P1 | 用 `openpyxl.utils.datetime.from_excel` 转换；同时兼容文本日期（YYYY-MM-DD）；单测覆盖 |
| R-09 | 多人责任人（顿号分隔）信息丢失 | P2 | 取首个为 `duty_user_id`，原文存 `duty_user_name`，未采用姓名写 `duty_unmatched_note`，预览可见 |

## 11. 决策追踪

引用 `decisions.md` 当前版本决策：

| 决策 ID | 问题 | 结论 | 覆盖章节 |
|---|---|---|---|
| D-001@v1 | 导入层级 | 两级：模块 + 明细 | §5、§7.3、§8 |
| D-002@v1 | 责任人匹配不到 | 该行进失败清单不导入 | §7.2(valid)、§10 R-03 |
| D-003@v1 | 多 Sheet 处理 | 上传后列 Sheet 让用户勾选 | §5、§7.2(sheets) |
| D-004@v1 | 同名模块已存在 | 合并，追加明细 | §7.3、§10 R-07 |
| D-005@v1 | 模块层字段取值 | 自动汇总（min/max/求和/首个） | §7.3、§8 |
| D-006@v1 | 导入确认方式 | 预览后确认（两阶段） | §5、§7 |
| D-007@v1 | 实现方案 | 方案 A：后端 openpyxl + 按表头名 | §5、§6(importer.py) |
| D-008@v1 | 事务原子性 | import_commit 不复用 `_Crud.create`，改 `session.add()` + 单次 commit | §7.3、§10 R-07 |

无未解决决策。

## 12. 自审

| 检查项 | 结果 | 说明 |
|---|---|---|
| 需求覆盖 | ✅ | 两级导入、计划类型、预览确认、责任人反查、同名合并、自动汇总、多 Sheet 勾选 全覆盖 |
| Grill/决策覆盖 | ✅ | 7 条 D-xxx@v1 全部在 §11 引用并映射到章节 |
| 约束一致性 | ✅ | 复用 `anyio.to_thread`(X-002)、`PlanService._Crud`、`PPM_PLAN_WRITE`、5 子域 `/api/ppm` 前缀、路由顺序约定（ppm.md） |
| 真实性 | ✅ | 表名 `ppm_plan_node_module`/`ppm_ps_plan_node_detail`、类名 `PlanNodeModule`/`PsPlanNodeDetail`、方法 `create_module`/`create_detail`、端点 `/plan-node/{id}/modules` 均来自真实代码 |
| YAGNI | ✅ | 不做 .xls/CSV/撤销/异步队列/模板簇（§3 非目标） |
| 验收标准 | ✅ | 见 tasks（解析正确率、字段映射、同名合并、未匹配跳过、事务回滚可测） |
| 非目标清晰 | ✅ | §3 明确 7 项不做 |
| 兼容策略 | ✅ | §9：nullable 字段、既有流程不变、回退路径 |
| 风险识别 | ✅ | §10 共 9 项 P1/P2，均有对策 |
| 生命周期契约表 | N/A | 不涉及 session/lease/agent_run/daemon/lifecycle/claim/heartbeat 关键词，省略 |
| Design Grill（Step 12） | ✅ passed | 10 项交叉检查全部处置：C3 事务原子性(P0→新增 D-008@v1)、C1/C2 汇总空值/非数字定义(补入§7.3)、C5 责任人反查走 ORM 全量(补入§7.3)、C8 删冗余 pm_project_id(改§7.2)、C9 两 Sheet 列位差异(补入§7.3)、C4 R-06 路由顺序降级(改写)、C6 migration 命名(改写)、C10 status=draft 注明(补入§7.3/§8) 均已融入正文；C7 python-multipart 确认缺失(R-01 处理正确,需 Docker rebuild) |

⚠️ 自审存疑：`ModuleFormDrawer` 是否同步加「计划类型」编辑项——Design Grill 确认 `PlanNodeModuleUpdate`（schema）与前端 `PlanNodeModuleUpdate`（types.ts）须同步加 `plan_type` 字段（否则编辑保存会丢字段，§6 已覆盖）；但表单 UI 是否暴露「计划类型」选择器为可选增强，本期列表展示已满足核心需求，留 plan 阶段定夺，不阻塞。
