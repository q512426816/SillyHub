---
author: qinyi
created_at: 2026-07-24 09:16:11
scale: large
---

# 设计文档（Design）— 问题清单 Excel 批量导入

> 本文档已经 Design Grill 交叉审查（review.json: specVerdict=pass / qualityVerdict=pass），并据其 P1/P2 gap 补强（D-008~D-014）。docHash 以审查快照为准（abeed0f6…），修订后哈希已变，属预期。

## 1. 背景与需求概述

问题清单（`/ppm/problem-list`）目前只能逐条「新建问题」录入，批量录入效率低。本次新增 **Excel 批量导入**：下载标准模板 → 填好上传 → 系统解析预览（项目名/责任人/验证人/模块名匹配不到或必填缺失的行标红）→ 确认后批量入库。

交互与技术范式**对齐已有的「项目计划导入」**（`plan/importer.py` + `import-preview`/`import-commit` 两步端点 + 前端三态弹窗）。差异点：问题清单**校验更严格**——姓名/项目/模块填了但匹配不到 → 整行拒绝（项目计划是标记留空仍导入）。

详细决策见 `decisions.md` D-001 ~ D-014。

## 2. 设计目标

- 支持一次导入多条、跨多个项目的问题（Excel 每行一个项目）。
- 全字段导入（17 列业务字段）。
- 入库前预览，未匹配/必填缺失的行**标红可见**，不误入库。
- 批量入库**原子**（要么全进要么全回滚，不部分入库脏数据）。
- 与项目计划导入 UX 一致，用户零学习成本。

## 3. 非目标

- **不做**附件导入（`file_urls` 体系复杂，导入后可在页面补）。
- **不做**查重（Excel 几行建几条，D-005）。
- **不做**导入非「新建」态问题（只产「新建」态，后续走 start/execute）。
- **不做**动态下拉模板（静态模板 + 严格校验已够）。
- **不改**现有 `create_problem` / 导出 / 列表 API 与表结构。

## 4. 拆分判断

单一功能（导入），跨 backend + frontend 两个子项目，无独立可交付子模块、无多角色视图、无跨页面状态流转 → **不拆分**，作为单变更两 Wave 推进（后端先行、前端接入）。非批量模式。

## 5. 总体方案

### Wave 1 — 后端解析与端点

1. **`ppm/common/upload.py`（新建，D-013）**：通用上传校验 `validate_xlsx_upload(file, file_bytes)`（.xlsx 扩展名 + 大小上限，抛中立异常），不跨域引 plan 私有 `_validate_upload`。
2. **`problem/importer.py`（新建）**：纯解析，复用 plan importer 套路。`parse_problem_workbook(file_bytes) -> list[ParsedProblemRow]`（同步 `def`，调用方 `anyio.to_thread.run_sync` 包裹）。按表头**文字**定位列（normalize 去空白/换行，容错列顺序）、合并单元格 forward-fill、Excel 日期序列号 → `date`、跳过全空行。枚举规范化在此层：`is_urgent`/`is_delay_plan`「是/否」→ `"1"`/`"0"`（空→None）；`pro_type` 原样保留（bug/change/其他）。**不反查、不碰 DB**。
3. **`problem/schema.py`（+4 DTO）**：`ProblemImportPreviewRow` / `ProblemImportPreviewResp` / `ProblemImportCommitReq` / `ProblemImportResultResp`（详见 §7）。
4. **`problem/router.py`（+2 端点）**：`POST /api/ppm/problem-list/import-preview`（`UploadFile`，`validate_xlsx_upload` → `anyio.to_thread` 包解析 → service.import_preview）+ `POST /api/ppm/problem-list/import-commit`（JSON → service.import_commit）。权限复用现有 problem 创建权限。
5. **`problem/service.py`（+2 方法 + 反查/转换 helpers）**：
   - `import_preview`：解析 → 批量反查（D-006/D-014：project=`PpmProjectMaintenance.project_name`；module=`list_modules_by_project(project_id)` 范围内按名；duty/audit=该项目 `PpmProjectMember` 按名）→ 逐行严格校验（匹配维度 D-004 + 必填维度 D-009：project_name 必填须匹配、pro_desc 必填）→ 填 `valid`/`error`/反查UUID。
   - `import_commit`：**不信任前端 UUID，按原文重新反查**（D-011）+ data_scope 校验 project 可访问；重算失败的行剔除并计入 `failed_rows`；`date`→`datetime` 转换（D-010）；显式字段映射（D-012：`module_name`→`model_name`，`module_id` 单独赋）；`status="新建"`、`created_by=user`；`session.add_all` + **单次 commit 原子提交**（D-008）。
6. **后端测试**：`tests/test_importer.py`（解析：表头容错/合并填充/日期/跳空行/枚举规范化）+ `tests/test_router.py` 增 import-preview/import-commit 用例（未匹配标红、必填缺失、正常入库、原子性、commit 重查防篡改、权限）。

### Wave 2 — 前端组件与接入

1. **`lib/ppm/problem.ts`（+2 函数）**：`importProblemsPreview(file)`（FormData）/ `importProblemsCommit(body)`（JSON）。
2. **`lib/ppm/types.ts`（+类型）**：与后端 DTO 对齐。
3. **`components/ppm/problem/import-problem-modal.tsx`（新建）**：复制 `import-module-modal.tsx` 范式适配全字段，三态（上传 Dragger + 下载模板 / 预览全字段 Table + 标红 / 结果统计），`onSuccess` 刷新列表。
4. **`page.tsx`（接入）**：顶部「导出」旁加「导入」按钮 → 打开 modal。
5. **模板**：`frontend/public/templates/problem-import-template.xlsx`（静态，17 列中文表头 + 1 行示例）。
6. **前端测试**：`import-problem-modal.test.tsx`（三态切换 + 标红渲染 + 提交回传）。

## 6. 文件变更清单

| 操作 | 文件路径 | 说明 |
|---|---|---|
| 新增 | `backend/app/modules/ppm/common/upload.py` | 通用 .xlsx 上传校验（D-013） |
| 新增 | `backend/app/modules/ppm/problem/importer.py` | Excel 纯解析 + 枚举规范化 |
| 修改 | `backend/app/modules/ppm/problem/schema.py` | +4 导入 DTO |
| 修改 | `backend/app/modules/ppm/problem/router.py` | +import-preview / import-commit 端点 |
| 修改 | `backend/app/modules/ppm/problem/service.py` | +import_preview / import_commit + 反查/转换/映射 helpers |
| 新增 | `backend/app/modules/ppm/problem/tests/test_importer.py` | 解析单测 |
| 新增 | `backend/app/modules/ppm/problem/tests/test_import_flow.py` | 导入端点用例（problem/tests/ 无 test_router.py） |
| 新增 | `frontend/src/components/ppm/problem/import-problem-modal.tsx` | 三态导入弹窗 |
| 修改 | `frontend/src/lib/ppm/problem.ts` | +importProblemsPreview/Commit |
| 修改 | `frontend/src/lib/ppm/types.ts` | +导入类型 |
| 修改 | `frontend/src/app/(dashboard)/ppm/problem-list/page.tsx` | +导入按钮接入 |
| 新增 | `frontend/src/components/ppm/problem/import-problem-modal.test.tsx` | 弹窗测试（组件旁） |
| 新增 | `frontend/public/templates/problem-import-template.xlsx` | 静态导入模板 |

## 7. 接口定义

### 端点

```
POST /api/ppm/problem-list/import-preview
  multipart/form-data, field: file (.xlsx)
  → 200 ProblemImportPreviewResp     权限: 同 create_problem

POST /api/ppm/problem-list/import-commit
  application/json, body: ProblemImportCommitReq
  → 200 ProblemImportResultResp       权限: 同 create_problem
```

### DTO

```python
class ProblemImportPreviewRow(BaseModel):
    row_index: int
    # 业务字段（Excel 原文 / 解析后；importer 已规范化枚举）
    project_name: str | None
    module_name: str | None            # Excel 列名友好；入库→ORM.model_name（D-012）
    pro_desc: str | None
    pro_type: str | None               # bug / change / 其他（原样）
    is_urgent: str | None              # importer 已转 "1"/"0"
    func_name: str | None
    duty_user_name: str | None
    find_by: str | None                # 文本，不反查
    find_time: datetime | None         # DTO 用 datetime；importer 产 date，service 转换（D-010）
    plan_start_time: datetime | None
    plan_end_time: datetime | None
    audit_user_name: str | None
    work_load: str | None
    work_type: str | None
    pro_answer: str | None
    is_delay_plan: str | None          # importer 已转 "1"/"0"
    remarks: str | None
    # 反查结果（preview 填，仅供前端展示；commit 不信任，重新反查 D-011）
    project_id: uuid.UUID | None
    module_id: uuid.UUID | None
    duty_user_id: uuid.UUID | None
    audit_user_id: uuid.UUID | None
    valid: bool
    error: str | None

class ProblemImportPreviewResp(BaseModel):
    rows: list[ProblemImportPreviewRow]
    parse_errors: list[str]
    valid_count: int
    invalid_count: int

class ProblemImportCommitReq(BaseModel):
    rows: list[ProblemImportPreviewRow]   # 前端勾选回传；UUID 仅展示，commit 重算

class ProblemImportResultResp(BaseModel):
    created: int
    skipped: int                          # preview 阶段 valid=false 未回传的（前端统计）
    failed_rows: list[str]                # commit 重查/data_scope 失败行诊断；原子提交成功时空
```

### 字段映射表（commit 入库，D-012；显式赋值，不用 **dict）

| DTO 字段 | ORM 字段（PpmProblemList） | 备注 |
|---|---|---|
| project_id（commit 重算） | project_id | data_scope 校验 |
| module_name | model_name | 文本原文 |
| module_id（commit 重算） | module_id | 该 project 下 PlanNodeModule |
| pro_desc/func_name/pro_type/work_type/pro_answer/remarks | 同名 | 直传 |
| is_urgent/is_delay_plan（importer 已 1/0） | 同名 | 直传 |
| duty_user_id（commit 重算） | duty_user_id | 该 project 成员 |
| duty_user_name | duty_user_name | 原文 |
| audit_user_id（commit 重算） | audit_user_id | 该 project 成员 |
| find_by | find_by | 原文 |
| find_time/plan_start_time/plan_end_time（date→datetime） | 同名 | service 转换 |
| work_load | work_load | 原文 |
| —（系统赋值） | status="新建", created_by=user.id, file_urls=[] | D-007 |

### importer

```python
@dataclass(slots=True)
class ParsedProblemRow:
    project_name: str | None; module_name: str | None; pro_desc: str | None
    pro_type: str | None; is_urgent: str | None; func_name: str | None
    duty_user_name: str | None; find_by: str | None
    find_time: date | None; plan_start_time: date | None; plan_end_time: date | None
    audit_user_name: str | None; work_load: str | None; work_type: str | None
    pro_answer: str | None; is_delay_plan: str | None; remarks: str | None
    row_index: int

def parse_problem_workbook(file_bytes: bytes) -> list[ParsedProblemRow]:
    """同步：openpyxl 解析 .xlsx → 全字段行（枚举已规范化）。调用方 anyio.to_thread 包裹。"""
```

### service

```python
async def import_preview(self, file_bytes: bytes, user: User) -> ProblemImportPreviewResp
async def import_commit(self, req: ProblemImportCommitReq, user: User) -> ProblemImportResultResp
```

## 8. 数据模型

**无表结构/字段变更**。复用：`ppm_problem_list`（写入目标）、`PpmProjectMaintenance`（项目名反查，字段 `project_name`）、`PlanNodeModule`（模块反查 via `list_modules_by_project`）、`PpmProjectMember`（责任人/验证人反查，限项目范围）、`User`。无 Alembic migration。

## 9. 兼容策略（brownfield）

- 纯新增 2 端点 + 1 公共校验 + 1 前端组件 + 1 模板，**不改任何现有 API / 表 / 现有组件行为**。
- 未使用导入功能时，问题清单页行为完全不变（仅顶部多一个「导入」按钮）。
- `create_problem` / 导出 / 列表 / 3 态执行流均不受影响。
- 反查/转换逻辑只存在于 import 新路径，不侵入现有 create。

## 10. 风险登记

| 编号 | 风险 | 等级 | 应对策略 |
|---|---|---|---|
| R-01 | module 反查关联链 | P2 | grill X-010 已核验 `list_modules_by_project` 关联链对 problem project_id 自洽；复用该方法不自己拼 SQL |
| R-02 | 严格校验误杀（别名/旧名匹配不到） | P2 | 预览标红 + 明确 error 文案，用户改 Excel 重传，不污染数据 |
| R-03 | 大文件解析阻塞事件循环 | P1 | importer 同步 `def` + `anyio.to_thread.run_sync`（对齐 plan） |
| R-04 | 表头排版/列顺序变化 | P2 | 按表头文字定位列（normalize），非硬编码列号 |
| R-05 | verify PPM 前端关联 ppm 后端超时 | P2 | `SILLYSPEC_TEST_TIMEOUT_MS=900000` 重跑（已知坑） |
| R-06 | 越权/篡改（前端伪造 UUID） | P1 | commit 不信任前端 UUID，按原文重新反查 + data_scope 校验 project（D-011） |
| R-07 | 原子提交时单行 DB 异常致整批回滚 | P2 | preview 已严格过滤；commit 重查失败行 add 前剔除；异常时整批回滚返回诊断（D-008） |

## 11. 决策追踪

当前版本决策（详见 `decisions.md`）：
- **D-001@v1** 导入范式=后端解析+两步式 → §5、§7
- **D-002@v1** 项目归属=Excel 项目名反查（`project_name`） → §7、§10 R-02
- **D-003@v1** 全字段 → §7
- **D-004@v1** 严格匹配校验 → §7、§10 R-02（必填维度见 D-009）
- **D-005@v1** 不查重 → §3、§5
- **D-006@v1** 反查源 → §7、§8、§10 R-01（duty/audit 范围见 D-014）
- **D-007@v1** 系统字段不导入+status/created_by → §3、§7、§5
- **D-008@v1** import_commit 单次事务原子（grill B-001） → §5、§7、§10 R-07
- **D-009@v1** 必填=项目名+问题描述（grill B-002） → §7、§5
- **D-010@v1** date→datetime 转换（grill B-004） → §7、§5
- **D-011@v1** commit 重查防篡改+data_scope（grill B-005） → §5、§10 R-06
- **D-012@v1** module_name→model_name+module_id 映射（grill B-006） → §7 映射表
- **D-013@v1** 上传校验抽 ppm/common（grill B-007） → §5、§6
- **D-014@v1** duty/audit 限项目成员（grill B-008） → §7、§8

无未解决决策；grill 全部 P1 gap 已修正。

## 12. 自审

- ✅ 必填章节齐全（背景/目标/非目标/拆分/总体方案/文件清单/接口定义/数据模型/兼容/风险/决策追踪/自审）。
- ✅ 不涉及 session/lease/agent_run/daemon/lifecycle 关键词 → 无需生命周期契约表。
- ✅ design.md 引用全部当前版本 D-001~D-014。
- ✅ Design Grill（独立子代理）specVerdict=pass / qualityVerdict=pass，3 P1 + 5 P2 gap 已全部修正（D-008~D-014）。
- ✅ 反查字段名已据源码更正（`project_name` 非 `.name`）。
- ✅ 无 schema/migration 变更（纯复用）。
- 语义最终一致性已由 grill + 本次修订收敛；进入 plan 阶段。
