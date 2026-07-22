---
author: qinyi
created_at: 2026-07-22T21:32:00
scale: large
---

# 设计文档（Design）— 执行记录附件上传与回显（问题执行 + 计划任务执行）

## 背景

平台级文件中心（变更 `2026-07-22-platform-file-center`，已合并 main + 部署生产）建立了通用文件服务：后端 `/api/file` + MinIO 存储 + 前端 `FileUpload`（编辑态上传）/`FileViewer`（只读态预览）。PPM 的父记录 `PlanTask` / `PpmProblemList` 等已接入 `file_urls`（存文件 id）。

但 PPM 的**执行记录 `TaskExecute`**（问题清单「问题执行」与任务计划「计划任务执行」**共用此表**）**尚未接入附件**：

- 执行填报时（跨天逐天填报耗时 + 执行情况说明）**无法上传附件**（如现场照片、完成凭证、文档）。
- 执行记录表（开始/结束/耗时/说明 4 列）**不回显附件**。

file-center 设计时已预期 TaskExecute 接附件——`backend/app/modules/file/model.py:28` 注释把 `ppm_task_execute` 列为合法 `owner_type`，只是 ppm task 子域未落地该列（模型/schema/migration 均无 `file_urls`）。

本变更给 `TaskExecute` 加 `file_urls` 字段，在两个执行填报弹窗（`task-detail-modal` + `problem-detail-modal`）接入附件上传 + 执行记录回显。

> 本变更**复用** file-center 的 D-006（file_urls 存文件 id）与 D-008（owner_id 可空）决策，不改 file 模块本身。

## 设计目标

- `TaskExecute`（问题 + 计划任务共用执行记录）支持 `file_urls`（文件 id 列表）。
- 问题执行 + 计划任务执行**填报**时，每一天（跨天拆分）各自上传附件（按记录级归属）。
- 执行记录表**回显**每条记录的附件。
- **复用**已有 `FileUpload`（编辑态）/`FileViewer`（只读态）组件 + `file_urls` 模式，零新组件、零新 API。

## 非目标

- **不改** file 模块（`/api/file`、`File` 表、MinIO 存储）—— 纯复用。
- **不做** `/ppm/task-execute` 独立执行记录页的附件展示（YAGNI；只做两个详情弹窗）。
- **不改** PPM 父记录（`PlanTask`/`PpmProblemList`）的 `file_urls`（已接入）。
- **不做**附件必填校验（与问题附件一致，非必填）。
- **不做**附件按归属精确查阅 / 孤儿回收（沿用 file-center D-008，`owner_id` 仅辅助）。

## 拆分判断

- **单 change**：问题执行 + 计划任务执行**共用 `TaskExecute` 表**（同一后端字段/migration），功能内聚，不拆。
- **不走批量模式**：两侧业务流一致（都是 start→execute 跨天填报），但**后端 service/router 结构两侧不同**（见 D-006），非「模板×数据」批量。
- ⚠️ **「镜像」澄清**（Design Grill C3）：两侧**业务流程**一致（跨天拆分 + 首天收口 in-flight + 后续天 start），但**代码结构不镜像**——task 侧 `execute_plan(req: ExecutePlanReq)` 取整对象、router 直传 body；problem 侧 `execute_problem(...)` 取独立 kwargs、router 逐字段拆包。前端 task 预填内联、problem 预填纯函数（`buildDetailDays`）。下文按两侧实际结构分别描述。

## 决策

### D-001: file_urls 存文件 id（继承 file-center D-006）

`TaskExecute.file_urls` 复用 file-center 的 `file_urls` 语义（`string[]`，值=文件 id），与 `PlanTask`/`PpmProblemList` 完全一致。

### D-002: 附件按记录级归属（用户确认）

跨天填报时每一天生成**一条独立 `TaskExecute` 记录**（首天收口 in-flight，后续天 `start` 新记录再 `execute`）。附件按「每条记录各自一组」归属——填报区每天一行各自 `FileUpload`；执行记录表每行回显当天附件。符合「执行记录里回显」语义，数据干净。

**备选**：整个填报一组附件（跨天时归属模糊，回显不一致）—— 否决。

### D-003: 首天 in-flight 已有 file_urls 回填预填

用户重开填报弹窗时，首天（in-flight 记录）已上传的附件应回填到填报区 `DetailDay.fileUrls`（与现有 `time_spent`/`execute_info` 首天预填一致），避免丢失已传附件。后续天空白（新记录尚未创建）。
- task 侧：内联预填（`task-detail-modal` L94-101 段）。
- problem 侧：`buildDetailDays`（纯函数 L74-97）入参 `InflightLike` 需加 `file_urls` 字段（Design Grill C8/B3）。

### D-004: 执行记录表附件列行内 FileViewer

执行记录表新增「附件」列，行内用 `FileViewer`（图片缩略图 + 文件图标，点击预览/下载）。不用展开行（弹窗 760px 列宽够）。

### D-005: owner_id 策略（继承 file-center D-008）

- **首天**：in-flight 记录已存在，`FileUpload owner_id = inflightId`。
- **后续天**：`start` 创建新记录发生在提交循环内（上传时记录尚未创建），`FileUpload owner_id = null`（file/model.py L47-51 `owner_id` nullable=True，FileUpload Props 支持 `owner_id?: string | null`，已核实可行）；提交 `execute` 时 `file_urls` 存入新记录。

### D-006: 后端 task/problem 两侧结构差异 + router 链路（Design Grill B1，P1）

两侧执行入口代码结构不同，file_urls 落库链路需分别处理：

- **task 侧（2 处改）**：`execute_plan(req: ExecutePlanReq)` 取整对象，`task/router.py` L203 直传 `svc.execute_plan(body, user.id)`。→ 加 `ExecutePlanReq.file_urls` + `execute_plan` L343-355 逐字段赋值段补 `if req.file_urls is not None: exc.file_urls = req.file_urls`。**task router 不用改**（直传 body 自动透传）。
- **problem 侧（3 处改，关键）**：`execute_problem(...)` 取**独立 kwargs**（非 req 整对象），`problem/router.py` L313-322 把 `ProblemExecuteReq` **逐字段拆包**传 `execute_problem`。→ 必须三处同改：①`ProblemExecuteReq` 加 `file_urls`；②`execute_problem` signature 加 `file_urls: list[str] | None = None` + L585-594 赋值段补 `if file_urls is not None: exc.file_urls = file_urls`；③**`problem/router.py` 拆包处补 `file_urls=body.file_urls`**。只改前两处，file_urls 会在 router 解包层被丢弃、永远落不进库（且 service 单测直传 kwarg 能过、缺陷被遮蔽，仅在 e2e 暴露——对照 memory「过度 mock 遮蔽真实 FK」教训）。

### D-007: file_urls 守卫语义（Design Grill B2/C9，P2）

执行请求 schema（`ExecutePlanReq`/`ProblemExecuteReq`）的 `file_urls` 用 `list[str] | None = None`（**非** `default_factory=list`），service 用 `if req.file_urls is not None` 守卫赋值。

**理由**：与现有执行字段（`execute_info`/`time_spent` 等 Optional + None + `is not None` 守卫）风格一致；语义正确——前端**传了** file_urls 才更新，**不传**（如跨天补登某天只改耗时）保留原值不清空。若用 `default_factory=list` 则 `is not None` 恒真、空提交会把附件覆盖为 []。

> `TaskExecuteCreate`（看板 CRUD 创建路径）仍用 `list[str] = Field(default_factory=list)`（创建默认空）；`TaskExecuteUpdate` 用 `list[str] | None = None`；`TaskExecuteResponse` 用 `list[str]`。三场景区分。

## 总体方案

### 后端

**task 侧**：
1. `TaskExecute` 模型（`task/model.py` ~L168）加 `file_urls` JSON 列（抄 `PlanTask` L115-118）。
2. `task/schema.py`：`ExecutePlanReq` 加 `file_urls: list[str] | None = None`；`TaskExecuteCreate`(default_factory=list)/`Update`(| None = None)/`Response`(list[str]) 加 `file_urls`。
3. `task/service.py::execute_plan`（L343-355 逐字段赋值段）补 `if req.file_urls is not None: exc.file_urls = req.file_urls`。
4. `task/router.py` **不用改**（L203 直传 body）。

**problem 侧（3 处）**：
5. `problem/schema.py::ProblemExecuteReq` 加 `file_urls: list[str] | None = None`。
6. `problem/service.py::execute_problem`（L522-632）：signature 加 `file_urls: list[str] | None = None` 参数；L585-594 赋值段补 `if file_urls is not None: exc.file_urls = file_urls`。
7. `problem/router.py`（L313-322 拆包处）补 `file_urls=body.file_urls`。

**公共**：
8. 新 alembic migration：`ppm_task_execute` 加 `file_urls` 列（`down_revision = 202607221500_create_file`，已用 `alembic heads` 官方命令核实为唯一 head）。
9. `TaskExecuteService.create`（`model_dump()`）自动透传 `file_urls`，不改。

### 前端

1. `lib/ppm/types.ts`：`TaskExecute`(`file_urls: string[]`)/`ExecutePlanReq`/`ProblemExecuteReq`/`TaskExecuteCreate`/`TaskExecuteUpdate` 加 `file_urls`。
2. `task-detail-modal.tsx`：`DetailDay` 加 `fileUrls: string[]`；首天从 in-flight 内联预填 `file_urls`（L94-101 段）；填报区每天加 `<FileUpload owner_type="ppm_task_execute" owner_id={inflightId} value={d.fileUrls} onChange=.../>`；`handleSubmit`（L166-173）每天带 `file_urls: d.fileUrls`；执行记录表（L274-289）加附件列 `<FileViewer fileIds={e.file_urls ?? []}/>`。
3. `problem-detail-modal.tsx`：`InflightLike` 加 `file_urls: string[] | null`；`buildDetailDays` 首天预填 `file_urls`（L84-91 段）；填报区 `FileUpload` + `handleSubmit`（L193-199）带 `file_urls` + 执行记录表附件列——同 task 侧业务逻辑。

## 文件变更清单

| 操作 | 文件路径 | 说明 |
|---|---|---|
| 改 | backend/app/modules/ppm/task/model.py | `TaskExecute` 加 `file_urls` JSON 列（~L168） |
| 改 | backend/app/modules/ppm/task/schema.py | `ExecutePlanReq`(`| None=None`)/`TaskExecuteCreate`/`Update`/`Response` 加 `file_urls` |
| 改 | backend/app/modules/ppm/task/service.py | `execute_plan` 逐字段赋值段（L343-355）补 `file_urls` |
| 改 | backend/app/modules/ppm/problem/schema.py | `ProblemExecuteReq` 加 `file_urls: list[str] \| None = None` |
| 改 | backend/app/modules/ppm/problem/service.py | `execute_problem` signature 加 `file_urls` 参数 + L585-594 赋值段补 `file_urls` |
| 改 | backend/app/modules/ppm/problem/router.py | L313-322 拆包处补 `file_urls=body.file_urls`（Design Grill B1，漏则附件落不进库） |
| 加 | backend/migrations/versions/20260722220000_add_file_urls_to_task_execute.py | `ppm_task_execute` 加 `file_urls` 列（down_revision=`202607221500_create_file`，revision=`20260722220000_add_file_urls` ≤32 字符（version_num varchar(32)），downgrade 用 drop_column） |
| 改 | frontend/src/lib/ppm/types.ts | `TaskExecute`/`ExecutePlanReq`/`ProblemExecuteReq`/`TaskExecuteCreate`/`Update` 加 `file_urls` |
| 改 | frontend/src/app/(dashboard)/ppm/_components/task-detail-modal.tsx | `DetailDay` 加 `fileUrls`+首天预填+填报区 `FileUpload`+`handleSubmit` 带 `file_urls`+执行记录表附件列 |
| 改 | frontend/src/app/(dashboard)/ppm/_components/problem-detail-modal.tsx | `InflightLike` 加 `file_urls`+`buildDetailDays` 预填+填报区 `FileUpload`+`handleSubmit`+附件列 |
| 改 | backend/app/modules/ppm/problem/tests/test_problem_flow.py | 问题 execute 带 `file_urls` 落库单测（**含 router→service 透传断言**，防 B1 遮蔽） |
| 加/改 | backend/app/modules/ppm/task/tests/test_task.py | `execute_plan` 带 `file_urls` 落库单测 |
| 改 | frontend/src/app/(dashboard)/ppm/_components/problem-detail-modal.test.tsx | `buildDetailDays` 首天预填 `file_urls` 单测（已存在文件加用例） |
| 加 | frontend/src/app/(dashboard)/ppm/_components/task-detail-modal.test.tsx | task 侧组件渲染预填 + 附件列回显单测（新建） |
| 改 | frontend/src/app/(dashboard)/ppm/kanban/_components/kanban-task-detail-drawer.test.tsx | TaskExecute fixture 补 `file_urls:[]`（task-10 必填字段下游适配，纯 fixture 非逻辑改） |

## 接口定义

**`ExecutePlanReq`（task/schema.py，加 `file_urls`）**：
```python
class ExecutePlanReq(PydanticModel):
    plan_task_id: uuid.UUID
    action: Literal["submit", "complete"]
    task_execute_id: uuid.UUID
    execute_info: str | None = None
    time_spent: float | None = None
    actual_start_time: datetime | None = None
    actual_end_time: datetime | None = None
    execute_user_id: uuid.UUID | None = None
    start_remark: str | None = None
    end_remark: str | None = None
    file_urls: list[str] | None = None  # 新增(D-007: None 默认+is not None 守卫)
```

**`ProblemExecuteReq`（problem/schema.py，加 `file_urls`）**：
```python
class ProblemExecuteReq(PydanticModel):
    task_execute_id: uuid.UUID
    action: Literal["submit", "complete"]
    execute_info: str | None = None
    time_spent: float | None = None
    actual_start_time: datetime | None = None
    actual_end_time: datetime | None = None
    execute_user_id: uuid.UUID | None = None
    file_urls: list[str] | None = None  # 新增(D-007)
```

**`execute_problem`（problem/service.py，signature 加参数，D-006）**：
```python
async def execute_problem(
    self, *, problem_id, task_execute_id, action,
    execute_info=None, time_spent=None, actual_start_time=None,
    actual_end_time=None, execute_user_id=None,
    file_urls: list[str] | None = None,  # 新增
) -> ...
```

**`TaskExecute` schema 字段（task/schema.py）**：
- `TaskExecuteCreate.file_urls: list[str] = Field(default_factory=list)`
- `TaskExecuteUpdate.file_urls: list[str] | None = None`
- `TaskExecuteResponse.file_urls: list[str]`（`from_attributes` 自动映射 ORM）

**前端类型（`lib/ppm/types.ts`）**：
```ts
interface TaskExecute { /* 现有 */; file_urls: string[] }
interface ExecutePlanReq { /* 现有 */; file_urls?: string[] }
interface ProblemExecuteReq { /* 现有 */; file_urls?: string[] }
```

> 本变更**不涉及** session/lease/agent_run/daemon/lifecycle/claim/heartbeat 等关键词，生命周期契约表省略。

## 数据模型

`ppm_task_execute` 表加一列：

| 字段 | 类型 | 说明 |
|---|---|---|
| file_urls | JSON | 文件 id 列表，`nullable=False`，`server_default='[]'` |

参照 `ppm_plan_task.file_urls`（migration `202607041100_create_ppm_task.py` L62：`sa.Column("file_urls", sa.JSON(), nullable=False, server_default="[]")`）。

## 兼容策略

项目未正式上线（CLAUDE.md 规则 11），允许重置开发/测试数据，不要求历史兼容。`ppm_task_execute` 现有记录无 `file_urls`，migration 加列 `server_default='[]'`，旧记录 `file_urls=[]`（无附件），无需历史数据迁移。

## 风险与回滚

- **problem router 拆包层（D-006/B1，最高风险）**：problem 侧 file_urls 必须经 router 拆包层透传到 service，漏改则附件落不进库且被单测遮蔽。**缓解**：文件清单显式列 `problem/router.py`；problem 单测断言「router→service 透传 file_urls」（不只测 service 直传 kwarg）。
- **守卫语义（D-007/B2）**：执行请求 `file_urls` 必须用 `| None = None`（非 default_factory=list），否则 `is not None` 恒真、空提交清空附件。
- **逐字段赋值遗漏**：`execute_plan` / `execute_problem` 是逐字段赋值（非 `model_dump`），加 schema/参数后**必须**在 service 补赋值。
- **migration 链**：`down_revision` 接 `202607221500_create_file`（已 `alembic heads` 核实唯一 head），避免多头（参照 `migration-chain-fragmentation-pattern`）。
- **回滚**：单 change，`git revert` + `alembic downgrade -1`。

## 测试策略

- **后端**：`execute_plan` 带 `file_urls` 落库（task service 单测）；**问题 execute 单测含 router→service 透传 file_urls 断言**（problem，防 B1 遮蔽）；`TaskExecuteResponse` 返回 `file_urls`。
- **前端**：`buildDetailDays` 首天预填 `file_urls`（problem 纯函数单测）；task 侧无纯函数、用组件渲染测预填；填报区 `FileUpload` 接入；执行记录表附件列 `FileViewer` 回显；`handleSubmit` 每天带 `file_urls`。antd 动态组件 jsdom 处理参照 `frontend-markdown-text-jsdom-null`。
- **migration**：`upgrade`/`downgrade` 验证（加列/撤列）。

## 自审（含 Design Grill 修订）

- **章节齐全**：背景/目标/非目标/拆分判断/决策 D-001~D-007/总体方案/文件清单/接口定义/数据模型/兼容策略/风险/测试/自审。生命周期契约表按规则省略（不涉及关键词）。
- **Design Grill 修订已落实**：B1（problem router 拆包链路，文件清单+D-006+风险+测试断言）、B2（守卫语义 D-007）、B3（InflightLike 加 file_urls D-003）、C3（镜像措辞澄清）。
- **方案自洽**：复用 file_urls 模式 + `FileUpload`/`FileViewer`；后端 task(2 处)/problem(3 处含 router) 分别处理 + migration；前端两弹窗按各自结构（task 内联/problem 纯函数）接入；闭环。
- **边界清晰**：非目标明确（不改 file 模块/不做独立页/不必填）。
- **依据充分**：Design Grill 独立审查（review.json 已落盘，specVerdict 修订前 fail → 修订后 blocker 清除）+ 调研报告 + file-center design.md（D-006/D-008）+ 源码核实（execute_plan L343-355、execute_problem L522-632/L585-594、problem router L313-322、alembic head、file/model.py owner_id nullable）。
