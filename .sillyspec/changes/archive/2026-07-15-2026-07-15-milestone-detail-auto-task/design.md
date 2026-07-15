---
author: WhaleFall
created_at: 2026-07-15T18:57:52
scale: large
---

# 设计文档（Design）— 里程碑明细提交自动创建任务计划

## 1. 背景

里程碑明细（`PsPlanNodeDetail`）是项目计划树（项目计划 → 里程碑 → 明细）的叶子节点，自带状态机 `draft → review → approve → done`。前期改动 `ql-20260713-010` 已把审核/审批环节去掉：前端「提交」直接把明细置为 `done`，Excel 导入时必填齐全的明细也直接落 `done`。

任务计划（`PlanTask` / `ppm_plan_task`）是另一套独立的「个人/团队任务台账」——周月计划、看板卡片、工时统计的数据源。它通过 `ps_plan_node_detail_id` 字段**可软关联**到某条里程碑明细。

**现状问题**：全代码库（`plan/service.py`、`task/service.py`、`kanban/service.py`、`workbench`、迁移脚本）中，**不存在任何「明细变 done → 自动创建 PlanTask」的逻辑**。`ps_plan_node_detail_id` 的赋值只出现在：①旧 RuoYi 系统迁移脚本 `migrate_from_ruoyi.py`；②测试夹具；③用户手动在看板/任务页建任务时。明细走完状态机只写一条流程履历，不产生任何任务。

**业务期望**：每提交（变完成）一条里程碑明细，系统自动生成一条对应任务计划挂在明细执行人名下，并在明细后续编辑、变更、删除时同步维护这条任务，使「明细」与「任务」保持一对一绑定。

## 2. 设计目标

- 明细变 `done`（手动提交 / Excel 导入）时，自动创建一条 `PlanTask` 并通过 `ps_plan_node_detail_id` 软关联，字段从明细映射、项目信息回溯自带。
- 明细被编辑、发起变更、删除时，已建任务随之同步更新 / 迁移 / 解关联。
- 强一致：明细操作与任务联动在同一数据库事务内完成，要么都成功、要么都回滚。
- 一条明细（含其变更版本链）始终只对应一条任务，杜绝重复任务与孤儿任务。

## 3. 非目标

- **不补建历史数据**：仅对本次上线后新提交/新导入的明细生效；历史已 `done` 的明细不追溯建任务（CLAUDE.md 规则 11，允许重置开发数据）。
- **不改明细状态机**：`draft → done` 流转保持现状（去审核已是既定行为）。
- **不改任务表结构**：复用 `PlanTask` 现有字段与 `ps_plan_node_detail_id`，不加列、不加约束。
- **不新增前端页面**：前端复用现有 `milestone-details` 提交入口与 `task-plan` 任务页。
- **不接管任务执行流**：建出的任务初始 `status="未开始"`，后续执行/工时/看板行为仍由 task/kanban 子域独立维护，联动逻辑不干预任务自身状态推进。
- **不做异步/事件总线**：同步同事务联动，不引入消息队列或事件机制（YAGNI）。

## 4. 拆分判断

单一聚焦功能（明细 ↔ 任务一对一联动）+ 边界处理（编辑/变更/删除/导入/查重），非 3+ 独立模块、非多角色视图、非跨页面流转。任务数 < 10，走标准开发流程，不拆分、不走批量模式（详见 step 5 评估）。

## 5. 总体方案

**策略**：在 `plan/service.py` 内聚实现「明细-任务联动」能力，以私有 helper 封装，在明细生命周期的 5 个触发点接入；联动直接在 `PlanService` 持有的 session 上用 ORM 操作 `PlanTask`（**不调用 `PlanTaskService.create`**，因其单独 `commit` 会破坏原子性——借鉴 `import_commit` 的事务范式：`session.add()` + 末尾统一 `commit()`），从而实现强一致。

### 5.1 触发点与联动行为

| 触发点（现有方法） | 条件 | 联动行为 |
|---|---|---|
| `create_detail(data)` | `data["status"]=="done"`（前端「提交」新建） | `_ensure_task_for_detail`：建任务；执行人为空则跳过 |
| `_transition`（`save_process` 推进）| `target == DONE`（编辑后「提交」） | commit 前调 `_ensure_task_for_detail` |
| `import_commit` | 行 `required_filled` → `done` | commit 前对每个 done 明细批量 `_ensure_task_for_detail` |
| `update_detail` | 明细已有关联任务 | `_sync_task_fields`：同步执行人/时间/主题/工作量/项目/模块（不动任务 status） |
| `change_process` | 旧 `done`→`archived` + 新 `draft` | commit 前调 `_migrate_task_to_version(old.id, new.id)`：任务 `ps_plan_node_detail_id` 迁移到新版本 |
| `delete_detail` | — | 删明细后 `_unlink_task`：关联任务 `ps_plan_node_detail_id` 置 `null`，任务保留 |

### 5.2 事务原子性保障

`_transition` / `import_commit` / `change_process` 已自行管理 session 并在末尾统一 `commit()`，只需在 commit 前插入联动调用即天然原子。`create_detail` / `update_detail` / `delete_detail` 当前走 `_Crud`（内部单独 `commit()`），需重构为「手动 session 操作 + 联动 + 统一 commit」以支持原子联动（见 §7 接口定义）。

### 5.3 字段映射（明细 `PsPlanNodeDetail` → 任务 `PlanTask`）

| PlanTask 字段 | 来源 | 说明 |
|---|---|---|
| `user_id` | `detail.execute_user_id` | 执行人为空则不建（`user_id` 非空约束，D-003） |
| `user_name` | `_lookup_user_name(execute_user_id)` | 反查 `PpmProjectMember.user_name`（与看板 `_lookup_user_name` 同口径，非 `User.display_name`，保证任务页/看板姓名一致） |
| `content` | `detail.task_theme` | 任务主题作内容 |
| `start_time` | `detail.plan_begin_time` | — |
| `end_time` | `detail.plan_complete_time` | — |
| `work_load` | `detail.plan_workload` | — |
| `ps_plan_node_detail_id` | `detail.id` | 软关联 |
| `project_id` / `project_name` | `_resolve_project_context(detail.plan_node_id)` | 回溯 `PsPlanNode.ps_project_plan_id → PsProjectPlan` |
| `module_id` | `detail.module_id` | 实施阶段有值 |
| `module_name` | — | 维持 `None`（明细侧无模块名冗余，避免再查 `PlanNodeModule`） |
| `status` | 新建=`"未开始"` | 同步更新时**不改**（保留任务自身推进） |
| `kanban_order` | 该 `user_id` 现有 `max(kanban_order)+1` | 与看板 `create_task` 行为一致 |

## 6. 文件变更清单

| 操作 | 文件路径 | 说明 |
|---|---|---|
| 修改 | `backend/app/modules/ppm/plan/service.py` | 新增联动 helper（§7）+ 6 触发点接入；`create_detail`/`update_detail`/`delete_detail` 重构为原子事务 |
| 修改 | `backend/app/modules/ppm/plan/router.py` | 无接口变化（联动在 service 内部触发）；仅可能透传 actor 到 `delete_detail`（若需） |
| 新增 | `backend/app/modules/ppm/plan/tests/test_detail_task_link.py` | 联动单测：建/同步/迁移/解关联/导入批量/执行人空跳过/版本链查重 |
| 修改 | `frontend/src/app/(dashboard)/ppm/milestone-details/page.tsx` | （可选）提交成功 toast 加一句「已自动创建任务」提示，纯文案 |

不改：明细状态机（`plan/fsm.py`）、`PlanTask` 表结构、task/kanban 子域 service。

## 7. 接口定义

`PlanService` 新增私有联动方法（均复用 `self._session`，不单独 commit）：

```python
async def _ensure_task_for_detail(
    self, detail: PsPlanNodeDetail
) -> PlanTask | None:
    """明细变 done 时建/更新关联任务（版本链查重）。

    - execute_user_id 为空 → 返回 None，跳过（D-003）
    - 查 PlanTask where ps_plan_node_detail_id == detail.id；命中 → 更新字段；
      未命中 → 新建（kanban_order = 该 user 现有 max+1）
    - 项目信息经 _resolve_project_context 回溯
    """

async def _sync_task_fields(self, detail: PsPlanNodeDetail) -> None:
    """编辑明细后同步关联任务字段（不改 task.status）。

    查 ps_plan_node_detail_id == detail.id 的任务，命中则更新
    user_id/user_name/content/start_time/end_time/work_load/project_*/module_id。
    """

async def _migrate_task_to_version(
    self, old_detail_id: uuid.UUID, new_detail_id: uuid.UUID
) -> None:
    """变更时把任务的 ps_plan_node_detail_id 从旧版本迁到新版本（D-001）。"""

async def _unlink_task(self, detail_id: uuid.UUID) -> None:
    """删明细时把关联任务 ps_plan_node_detail_id 置 null（任务保留，D-004）。"""

async def _resolve_project_context(
    self, plan_node_id: uuid.UUID | None
) -> tuple[uuid.UUID | None, str | None]:
    """回溯 plan_node → ps_project_plan，取 (project_id, project_name)。"""

async def _lookup_user_name(self, user_id: uuid.UUID | None) -> str | None:
    """反查 PpmProjectMember.user_name（项目成员冗余名，与 kanban 同口径）。

    复用 plan/service.py 已 import 的 PpmProjectMember；缺失返回 None
    （PlanTask.user_name nullable，合法）。
    """
```

`create_detail` 重构示意（status=done 时原子联动）：

```python
async def create_detail(self, data: dict[str, Any]) -> PsPlanNodeDetail:
    status = data.setdefault("status", PlanNodeDetailStatus.DRAFT.value)
    obj = PsPlanNodeDetail(id=uuid.uuid4(), **data)
    obj.created_at = obj.updated_at = _now()
    self._session.add(obj)
    if status == PlanNodeDetailStatus.DONE.value:
        await self._session.flush()          # 拿 obj.id
        await self._ensure_task_for_detail(obj)
    await self._session.commit()             # 统一 commit，原子
    await self._session.refresh(obj)
    return obj
```

`update_detail` / `delete_detail` 同理重构为「session 操作 + 联动 + 统一 commit」。

## 7.5 生命周期契约表

本变更涉及明细状态机流转（`state transition` / `complete` 关键词），其联动契约如下（均为同库同事务，发起方=API 调用方，接收方=`PlanService`）：

| 事件 | 发起方 | 接收方 | 必需字段 | 状态变化 / 联动 |
|---|---|---|---|---|
| 明细提交新建（create_detail） | 前端 | PlanService.create_detail | status=done, execute_user_id, task_theme, plan_begin/complete_time | 明细 → done；`_ensure_task_for_detail` 建任务 |
| 明细编辑后提交（save_process→DONE） | 前端 | PlanService._transition | detail.id, execute_user_id | 明细 → done；`_ensure_task_for_detail` 建/更新任务 |
| 明细批量导入（import_commit） | 前端 | PlanService.import_commit | sheets[].rows(duty_user_id 等) | done 明细 → 批量建任务 |
| 明细编辑（update_detail） | 前端 | PlanService.update_detail | detail.id, 变更字段 | 明细不变；`_sync_task_fields` 同步任务 |
| 明细变更（change_process） | 前端 | PlanService.change_process | detail.id, change_reason | 旧 done→archived、新 draft；`_migrate_task_to_version` |
| 明细删除（delete_detail） | 前端 | PlanService.delete_detail | detail.id | 明细删除；`_unlink_task` 解关联 |

每个事件均有对应代码任务（§文件清单）与测试任务（`test_detail_task_link.py`）；必需字段均来自真实 `PsPlanNodeDetail` / `ImportPreviewRow` 字段。

## 8. 数据模型

**无表结构变更**。复用现有：
- `ppm_plan_task.ps_plan_node_detail_id`（`Uuid, nullable`，已存在）——联动唯一写入点。
- `ppm_plan_task.user_id`（非空）——执行人为空则跳过建任务的依据（D-003）。
- `PsPlanNodeDetail.parent_id`（版本链）——变更查重的回溯链。

无新增 migration。

## 9. 兼容策略（brownfield）

- **未建任务的明细行为不变**：联动仅在「变 done / 编辑已有关联 / 变更 / 删除」时触发；`draft` 明细、与任务无关的 CRUD 路径不受影响。
- **回退路径**：若联动出现严重问题，移除 6 个触发点的 helper 调用即可完全回退到现状（明细与任务重新解耦），无 schema 依赖、无数据迁移。
- **不改变的 API/表**：`plan` / `task` 路由契约、请求/响应结构均不变；`PlanTask` 表结构不变。
- **历史数据**：不补建（D-006）。

## 10. 风险登记

| 编号 | 风险 | 等级 | 应对策略 |
|---|---|---|---|
| R-01 | 变更(change_process)导致重复任务 | P0 | `_migrate_task_to_version` 迁移 + `_ensure_task_for_detail` 命中即更新（D-001），双重保障 |
| R-02 | `create_detail`/`update_detail`/`delete_detail` 重构破坏既有调用 | P1 | 保持方法签名与返回类型不变，仅改内部事务组织；既有单测全部跑通 |
| R-03 | 联动建任务失败拖垮明细提交 | P1 | 强一致为既定选择（用户确认方案 A）；建任务为简单 insert，失败概率低 |
| R-04 | 导入大批量明细一次性建大量任务致事务长 | P2 | 同 `import_commit` 既有批量范式，单事务 commit；量级与导入明细数一致，可接受 |
| R-05 | 手动建的任务被自动联动覆盖 | P2 | 按 `ps_plan_node_detail_id` 查重，已挂同一明细的任务会被同步更新（符合「一对一绑定」语义），文档明示 |

## 11. 决策追踪

当前版本决策见 `decisions.md`，design 覆盖关系：

| 决策 | 覆盖章节 |
|---|---|
| D-001@v1 明细-任务一对一（含版本链） | §5.1（change_process 迁移）+ §7（`_migrate_task_to_version`）+ R-01 |
| D-002@v1 字段映射 | §5.3 |
| D-003@v1 执行人为空跳过 | §5.1 + §7（`_ensure_task_for_detail`）|
| D-004@v1 删除解关联 | §5.1 + §7（`_unlink_task`）|
| D-005@v1 导入批量建 | §5.1（import_commit）+ §7.5 |
| D-006@v1 历史数据不管 | §3 非目标 + §9 |
| D-007@v1 编辑同步 | §5.1（update_detail）+ §7（`_sync_task_fields`）|

无未解决决策。

## 12. 自审

- ✅ 需求覆盖：手动提交/导入建任务、归属执行人、编辑/变更同步、删除解关联、强一致——全部对应 §5 触发点。
- ✅ Grill 覆盖：D-001~D-007 全部在 §11 追踪，design 引用完整。
- ✅ 约束一致性：复用 `import_commit` 事务范式、平台级无 workspace、`_Crud` 风格、ppm 模块约定（curl 实测、import 校验）均对齐。
- ✅ 真实性：方法名（`_transition`/`create_detail`/`change_process`/`import_commit`/`update_detail`/`delete_detail`）、字段名（`execute_user_id`/`task_theme`/`plan_begin_time`/`ps_plan_node_detail_id`/`kanban_order`）、类名（`PsPlanNodeDetail`/`PlanTask`/`PsProjectPlan`/`PsPlanNode`）均来自真实代码。
- ✅ YAGNI：不引入事件总线/异步/新表/新页面。
- ✅ 验收标准：见 `requirements.md` FR（建/同步/迁移/解关联/导入/查重/执行人空，各可测）。
- ✅ 非目标清晰：§3 明确 6 项不做。
- ✅ 兼容策略：§9 回退路径明确。
- ✅ 生命周期契约表：§7.5 含 6 事件，字段来自真实 DTO。
- ⚠️ 自审存疑：`update_detail` 同步字段是否必须强一致（同事务）——当前设计为同事务原子（§5.2），若实施中发现 `_Crud.update` 重构成本过高，可降级为 best-effort 并在风险登记补记；实施时确认。

自审通过。
