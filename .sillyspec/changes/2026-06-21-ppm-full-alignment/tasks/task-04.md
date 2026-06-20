---
id: task-04
title: psplannone 审批6态表单(覆盖:FR-04)
priority: P1
estimated_hours: 4
depends_on: [task-02]
blocks: []
requirement_ids: [FR-04]
decision_ids: []
author: qinyi
created_at: 2026-06-21T02:37:10+0800
allowed_paths:
  - /Users/qinyi/SillyHub/frontend/src/app/(dashboard)/ppm/milestone-details/page.tsx
  - /Users/qinyi/SillyHub/frontend/src/components/ppm-status-actions.tsx
  - /Users/qinyi/SillyHub/frontend/src/components/ppm-sub-table.tsx
  - /Users/qinyi/SillyHub/frontend/src/lib/ppm/plan.ts
  - /Users/qinyi/SillyHub/frontend/src/lib/ppm/types.ts
  - /Users/qinyi/SillyHub/frontend/src/app/(dashboard)/ppm/milestone-details/__tests__
  - /Users/qinyi/SillyHub/backend/app/modules/ppm/plan/router.py
  - /Users/qinyi/SillyHub/backend/app/modules/ppm/plan/service.py
  - /Users/qinyi/SillyHub/backend/app/modules/ppm/plan/fsm.py
---

# task-04: psplannone 审批6态表单

## 现状勘验(关键:6 态已落地,本任务为收口/对齐/补测试)

读现有源码后确认,FR-04 的主体功能**已存在并跑通**:

1. **6 态分发已实现** — `milestone-details/page.tsx` 的 `DrawerMode`(`create`/`edit`/`audit`/`approve`/`change`/`view`) 与 `modeForStatus(status)` 已按 status 路由到对应表单形态,对照源 Vue 6 表单(AddNodeDetailForm/NodeDetailForm/AuditNodeDetailForm/ApproveNodeDetailForm/ChangeNodeDetailForm/ViewNodeDetailForm)。
2. **`PlanDetailActions` 操作按钮组件已抽取** — `ppm-status-actions.tsx`,按 status + 当前用户(`matchAnyUser` 判 audit_user/approve_user)显隐「提交审核/审核通过/审批通过/驳回/重新提交/变更」按钮,缺失指派时 disabled + title 提示。
3. **`PpmSubTable` 主子结构已通用化** — `ppm-sub-table.tsx`,支持展开行模式(里程碑→模块→明细三级)。
4. **流程端点已就绪** — 后端 `router.py` `/plan-node-detail/{id}/process/{save,reject,change}` + `/processes` + `/versions`;前端 `lib/ppm/plan.ts` `savePlanNodeDetailProcess`/`rejectPlanNodeDetailProcess`/`changePlanNodeDetailProcess`/`listPlanNodeDetailProcesses`/`listPsPlanNodeDetailVersions` 全部封装。
5. **状态机已定义** — `backend/app/modules/ppm/plan/fsm.py` `PlanNodeDetailStatus`(draft→review→approve→done + rejected/archived) + `TRANSITIONS` 白名单。

**重要差异**:design.md §5 W4 提到「复用 task-02 的 submitDetail 端点」,但实际 plan 子域用 `save` 端点覆盖了 submit 语义(`draft→save→review`、`review→save→approve`、`approve→save→done`)。task-02 的 `submitDetail` 属 problem/变更流域,plan 子域不直接依赖。本任务**不新建 submitDetail 端点**,以现有 save/reject/change 三端点为准。

因此本任务实质为 **FR-04 收口**:补齐对照源 9 Vue 表单的剩余字段/边界、为 6 态分发加组件渲染测试、对照源做字段完整性核验。

## 修改文件

| 文件 | 改动性质 | 说明 |
|---|---|---|
| `/Users/qinyi/SillyHub/frontend/src/app/(dashboard)/ppm/milestone-details/page.tsx` | 核验 + 小幅完善 | 6 态分发主体已就绪;核验 modeForStatus 默认分支(status 未识别→view)、权限按钮显隐、change 表单提交回滚;按源对照补遗漏字段 |
| `/Users/qinyi/SillyHub/frontend/src/components/ppm-status-actions.tsx` | 复用(不改) | PlanDetailActions props 已满足;仅复用 |
| `/Users/qinyi/SillyHub/frontend/src/components/ppm-sub-table.tsx` | 复用(不改) | 展开行模式已支撑主子三级 |
| `/Users/qinyi/SillyHub/frontend/src/lib/ppm/plan.ts` | 复用(不改) | save/reject/change client 已封装,无需新增 submitDetail |
| `/Users/qinyi/SillyHub/frontend/src/app/(dashboard)/ppm/milestone-details/__tests__/milestone-details.test.tsx` | **新建** | 6 态分发组件渲染测试(TDD) |
| `/Users/qinyi/SillyHub/backend/app/modules/ppm/plan/{router,service,fsm}.py` | 复用(不改) | 状态机 + 三端点已就绪;若核验发现并发/乐观锁缺失则小补 |

## 覆盖来源

- FR-04(psplannode 审批 6 态:Add/Approve/Audit/ChangeApprove/Change/View)

## 实现要求

### 6 态定义(对照源 9 Vue 抽象)

| 源 Vue 表单 | 映射状态 | DrawerMode | 可编辑块 |
|---|---|---|---|
| AddNodeDetailForm | 新建(draft 之前) | `create` | 全字段 |
| NodeDetailForm | 草稿/驳回返工(draft/rejected) | `edit` | 全字段 |
| AuditNodeDetailForm | 审核中(review) | `audit` | audit_opinion/audit_back_flag(其余 disabled) |
| ApproveNodeDetailForm | 审批中(approve) | `approve` | approve_opinion/approve_back_flag(审核意见只读) |
| ChangeNodeDetailForm | 变更(任意非终态) | `change` | change_reason(前序审核/审批意见只读) |
| ChangeApproveNodeDetailForm | 变更审批 | (并入 approve 分支,`detail.parent_id != null` 时展示变更标识) | approve 块 |
| ViewNodeDetailForm | 只读(done/archived/未识别) | `view` | 全 disabled + Timeline 履历 |

> 源 9 Vue → 本任务 6 DrawerMode 的归并:`ChangeApproveNodeDetailForm` 并入 approve 分支(以 `parent_id` 区分变更审批标识),`AddNodeDetailForm`+`NodeDetailForm` 合并为 create/edit 两态。

### 分发逻辑

- `modeForStatus(status)`:`draft`/`rejected`→edit,`review`→audit,`approve`→approve,`done`/`archived`/default→view
- `change` 模式由操作列/抽屉 footer 的「变更」按钮显式触发(`openDetail(d, "change")`)
- 抽屉内信息块可见性 + disabled 由 `baseEditable`/`auditEditable`/`approveEditable` 三态派生

### 复用方式

- **ppm-status-actions**:`PlanDetailActions` 渲染操作列 + 抽屉 footer 按钮,`onSubmit(id, action)` 回调到 `handleSubmit`
- **ppm-sub-table**:`PpmSubTable<PsPlanNode>` 展开行模式渲染里程碑主表 + 嵌套 `ModuleLevelTable`/`DetailLevelTable`
- **PpmUserSelect / PpmText / PpmFileUrls**:人员选择、人员展示、附件,均复用

## 接口定义

### 6 表单组件 props(实际为单 DetailDrawer 内 mode 分支,非独立组件)

```ts
interface DetailDrawerState {
  open: boolean;
  mode: DrawerMode; // create|edit|audit|approve|change|view
  planNodeId?: string;
  moduleId?: string | null;
  detail?: PsPlanNodeDetail;
}

// DetailDrawer props(承载 6 态全部表单)
interface DetailDrawerProps {
  mode: DrawerMode;
  planNodeId: string;
  moduleId: string | null;
  detail?: PsPlanNodeDetail;
  projectId: string | null;
  currentUserId: string;
  onClose: () => void;
  onSaved: () => void;
  onSubmit: (
    detailId: string,
    action: "save" | "reject" | "change",
    body?: { handleInfo?: string; changeReason?: string },
  ) => void;
}
```

### 状态 → 表单映射表

| detail.status | 默认 mode | 触发按钮 |
|---|---|---|
| draft | edit(或 create 新建) | 提交审核→save;变更→change |
| review | audit | 审核通过→save;驳回→reject;变更→change |
| approve | approve | 审批通过→save;驳回→reject;变更→change |
| rejected | edit(返工) | 重新提交→save |
| done | view | —(终态) |
| archived | view | —(终态) |
| 未识别 | view(降级只读) | — |

### TS client 调用(已存在,复用)

- `savePlanNodeDetailProcess(detailId, { handle_info })` — 推进/审批通过
- `rejectPlanNodeDetailProcess(detailId, { handle_info })` — 驳回
- `changePlanNodeDetailProcess(detailId, { change_reason })` — 变更新版本
- `listPlanNodeDetailProcesses(detailId)` — Timeline 履历
- `listPsPlanNodeDetailVersions(detailId)` — 变更版本链

## 边界处理

1. **status 未识别**: `modeForStatus` 的 `default` 分支落到 `view`,展示全 disabled 表单 + 履历,不报错。
2. **权限不足隐藏按钮**: `PlanDetailActions` 按 `matchAnyUser([audit_user_id], currentUserId)` / `matchAnyUser([approve_user_id], currentUserId)` 判定,非审核/审批人对应按钮 disabled;抽屉内 `auditEditable`/`approveEditable` 同步控制信息块 disabled。
3. **审核/审批人未指派(X-003 fallback)**: `now_handle_user` 缺失时按钮 disabled + title「待指派」,不发起请求。
4. **表单提交失败回滚**: `submit()` catch `ApiError` 显示 toast/抽屉 err,不关闭抽屉、不清表单值,用户可改后重试。
5. **并发审批乐观锁**: 后端 `save_process`/`reject_process` 应校验当前 status 是否仍处于期望前置态(若已被人推进则抛 409/状态不匹配);前端 catch 后 reload 列表并提示「该明细已被他人处理」。核验现有 service 是否已有该校验,缺则补。
6. **change 必填校验**: change_reason 为空时前端拦截(showToast「变更原因不能为空」),不发请求;后端 schema 层 `ChangeProcessReq.change_reason` 应有 min_length 约束兜底。
7. **流程履历加载失败不阻塞**: `listPlanNodeDetailProcesses` catch 静默,表单仍可用。

## 非目标

- **不做全新审批引擎**: 复用现有 save/reject/change 三端点 + fsm 状态机,不引入 task-02 的 problem 变更流 ProChangeProcesssExecutor。
- **不新建 submitDetail 端点**: design.md 所述 submitDetail 在 plan 子域由 save 端点覆盖,本任务不重复造。
- **不做文件附件上传服务**: 沿用 `PpmFileUrls`(file_urls JSON,无上传端点,D-007/010 之外)。
- **不拆 6 个独立表单组件**: 保持单 `DetailDrawer` 内 mode 分支(已实现,源 9 Vue 已归并)。
- **不做工作流 silly 引擎接入**(D-002 之外)。

## 参考

- 源:`dept_project_front/.../psplannode/{AddNodeDetailForm,NodeDetailForm,AuditNodeDetailForm,ApproveNodeDetailForm,ChangeNodeDetailForm,ChangeApproveNodeDetailForm,ViewNodeDetailForm}.vue`(9 Vue → 6 DrawerMode 归并)
- 组件:`frontend/src/components/ppm-status-actions.tsx`(`PlanDetailActions` + `matchAnyUser` + 状态字典)
- 组件:`frontend/src/components/ppm-sub-table.tsx`(展开行模式)
- 页面:`frontend/src/app/(dashboard)/ppm/milestone-details/page.tsx`(6 态分发主体)
- 状态机:`backend/app/modules/ppm/plan/fsm.py`(`PlanNodeDetailStatus` + `TRANSITIONS`)
- 端点:`backend/app/modules/ppm/plan/router.py` L444-518(save/reject/change/processes)
- client:`frontend/src/lib/ppm/plan.ts` L286-327

## TDD 步骤

前端组件渲染测试(无后端集成测试,端点已就绪):

1. **新建** `milestone-details/__tests__/milestone-details.test.tsx`,mock `@/lib/ppm` 的 list/get/process 函数。
2. **测试 6 态分发**:
   - `modeForStatus("draft")` → edit;`"review"` → audit;`"approve"` → approve;`"done"`/`"archived"`/`"unknown"` → view
   - 传 detail.status=draft 打开抽屉 → 渲染「开立信息」块且 base 字段可编辑
   - status=review + currentUserId===audit_user_id → audit 块可编辑 + 「审核通过/驳回」按钮可点
   - status=approve + currentUserId!==approve_user_id → approve 块 disabled + 按钮禁用
   - status=done → 全 disabled + 无提交按钮
3. **测试操作按钮显隐**:渲染 `PlanDetailActions`,断言各 status 下按钮存在/禁用。
4. **测试 change 提交校验**:change 模式空 reason → 不调 onSubmit,显示错误。
5. 运行 `pnpm --filter frontend test`(若项目无 vitest 则退化为 `pnpm --filter frontend exec tsc --noEmit` 类型核验 + 手动渲染验证)。

## 验收标准

| AC# | 标准 | 验证方式 |
|---|---|---|
| AC-1 | 6 态按 status 切换:detail.status=draft/review/approve/done/archived/未知 → edit/audit/approve/view/view/view | 页面操作 + 单测 |
| AC-2 | 每表单字段可提交:create/edit 调 create/update;audit/approve 调 save/reject 带 handle_info;change 调 change 带 change_reason | 页面提交 + 网络面板 |
| AC-3 | ppm-sub-table 子任务(明细)三级渲染:里程碑→模块(实施阶段)→明细 | 页面展开行 |
| AC-4 | 权限按钮隐藏:非审核/审批人对应 save/reject disabled;未指派时全 disabled + 待指派 | 切换用户验证 |
| AC-5 | 只读 View:done/archived 全字段 disabled + Timeline 履历 + 变更版本链展示 | 进入终态明细 |
| AC-6 | typecheck 通过:`pnpm --filter frontend exec tsc --noEmit` 无新增类型错误 | CI/本地 |
| AC-7 | 对照源 9 Vue 表单字段无遗漏(开立/审核/审批/变更四块字段完整) | 人工对照源 |
| AC-8 | 并发审批:两人同时审批同一明细,后者收到状态不匹配提示而非脏写 | 双窗口验证(若后端已实现则核对;缺则补 service 校验) |
