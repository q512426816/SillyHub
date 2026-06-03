---
id: task-02
title: 前端归档门禁契约对齐后端（changes.ts 类型）
priority: P0
estimated_hours: 0.5
created_at: 2026-06-03 16:57:56
author: qinyi
depends_on: []
blocks: [task-04]
allowed_paths:
  - frontend/src/lib/changes.ts
---

# task-02: 前端归档门禁契约对齐后端（changes.ts 类型）

## 修改文件（必填）

| 操作 | 文件路径 | 说明 |
|---|---|---|
| 修改 | frontend/src/lib/changes.ts | `ArchiveCheckItem` 重定义为 `{name,passed,detail}`；`ArchiveGateResponse` 的 `failed_checks` 改名为 `checks` |

> 本任务只改 `changes.ts` 中的两个 type 定义。**不碰 page.tsx**（page.tsx 的消费改动归 task-04）。

## 实现要求

当前前端契约与后端完全不一致，导致归档门禁 UI 是死的。后端为契约基准（不改），前端对齐。

### 改前（changes.ts 第 93–107 行）

```ts
/** 归档门禁单项检查结果 */
export type ArchiveCheckItem = {
  /** 检查项名称 */
  check: string;
  /** 未通过时的说明信息 */
  message: string;
};

/** 归档门禁检查响应 */
export type ArchiveGateResponse = {
  /** 是否全部通过，可执行归档 */
  can_archive: boolean;
  /** 未通过的检查项列表 */
  failed_checks: ArchiveCheckItem[];
};
```

### 改后

```ts
/** 归档门禁单项检查结果（对齐后端 ArchiveCheckItem） */
export type ArchiveCheckItem = {
  /** 检查项名称，固定 6 项之一：no_unresolved_feedback / ac_confirmed /
   *  tech_verification_passed / business_review_passed /
   *  feedback_categorized / documents_complete */
  name: string;
  /** 该项是否通过 */
  passed: boolean;
  /** 说明信息（通过时通常为空串，未通过时给出原因） */
  detail: string;
};

/** 归档门禁检查响应（对齐后端 ArchiveGateResponse） */
export type ArchiveGateResponse = {
  /** 是否全部通过，可执行归档 */
  can_archive: boolean;
  /** 全部 6 项检查结果（含通过与未通过） */
  checks: ArchiveCheckItem[];
};
```

### 字段映射（前端旧 → 后端新）

| 旧字段 | 新字段 | 变化 |
|---|---|---|
| `ArchiveCheckItem.check` | `ArchiveCheckItem.name` | 改名 |
| `ArchiveCheckItem.message` | `ArchiveCheckItem.detail` | 改名 |
| —（无） | `ArchiveCheckItem.passed: boolean` | 新增 |
| `ArchiveGateResponse.failed_checks` | `ArchiveGateResponse.checks` | 改名；语义从"仅未通过项"变为"全部 6 项" |
| `ArchiveGateResponse.can_archive` | `ArchiveGateResponse.can_archive` | 不变 |

## 接口定义（代码类任务必填）

最终形态（照抄即可，含注释）：

```ts
/** 归档门禁单项检查结果（对齐后端 ArchiveCheckItem） */
export type ArchiveCheckItem = {
  name: string;
  passed: boolean;
  detail: string;
};

/** 归档门禁检查响应（对齐后端 ArchiveGateResponse） */
export type ArchiveGateResponse = {
  can_archive: boolean;
  checks: ArchiveCheckItem[];
};
```

后端契约基准（来自 `backend/app/modules/change/schema.py`，不改）：

```
ArchiveGateResponse { can_archive: bool, checks: ArchiveCheckItem[] }
ArchiveCheckItem    { name: str, passed: bool, detail: str }
```

`checkArchiveGate(workspaceId, changeId)` 函数（第 305–309 行）签名与返回泛型 `ArchiveGateResponse` **保持不变**，仅其引用的类型结构随之更新，无需改动函数体。

## 边界处理（必填，≥5 条）

1. **逐字段对齐后端**：`name`/`passed`/`detail` 三字段名、类型必须与后端 `schema.py` 的 `ArchiveCheckItem` 完全一致；`can_archive`/`checks` 与后端 `ArchiveGateResponse` 完全一致。不得自创字段或保留旧字段。
2. **删除而非保留旧字段**：`failed_checks`、`check`、`message` 三个旧字段名必须删除，不得为"兼容"而双写。本项目未上线，无契约兼容负担。
3. **不碰 page.tsx**：page.tsx 当前引用 `archiveGate.failed_checks`、`c.check`、`c.message`，改完本文件后 page.tsx 会暂时 tsc 报错——**这是预期行为，由 task-04 修复**。本任务严禁修改 page.tsx。
4. **不动 changes.ts 其他 type**：仅改 `ArchiveCheckItem`、`ArchiveGateResponse` 两个 type；`ChangeSummary`/`ChangeRead`/`TransitionRequest`/`FeedbackRequest` 等其余类型与所有 export 函数一律不动。
5. **注释同步更新**：原 `failed_checks` 注释"未通过的检查项列表"语义已变（现为全部 6 项），需改为"全部 6 项检查结果（含通过与未通过）"，避免注释误导。`check`/`message` 的旧注释一并替换。
6. **不改 import 与文件其余结构**：顶部 `import { apiFetch } from "./api";`、各 export 函数体、文件分节注释均保持原样。
7. **passed 字段类型严格为 boolean**：不可写成 `boolean | undefined` 或可选 `passed?`，后端必返该字段。

## 非目标（本任务不做的事）

- 不修改 page.tsx（归档门禁渲染与完整度卡片均属 task-04）。
- 不修改后端 schema.py / service.py（后端是契约基准，task-01 另行处理 service 逻辑）。
- 不修改 `checkArchiveGate` 等任何 export 函数的实现。
- 不为旧字段做向后兼容或 deprecated 别名。
- 不调整 changes.ts 中除两个目标 type 外的任何代码。

## 参考

- design.md「前端归档门禁契约对齐（问题 3 连带）」节，第 55–59 行
- design.md「接口定义」节，第 72–79 行（后端契约基准 + 6 项固定 name）
- plan.md task-03 行（本任务在 plan 中对应 task-03）：`changes.ts: ArchiveCheckItem→{name,passed,detail}，ArchiveGateResponse.failed_checks→checks`
- 后端基准：`backend/app/modules/change/schema.py` 的 `ArchiveGateResponse` / `ArchiveCheckItem`
- 源文件当前定义：`frontend/src/lib/changes.ts` 第 93–107 行

## TDD 步骤

前端无单元测试，以 `tsc` 类型检查为验证手段：

1. 改前在 `frontend/` 下记录基线：`npx tsc --noEmit`（此时通过，旧契约内部自洽）。
2. 按「接口定义」替换两个 type。
3. 改后单独跑 `cd frontend && npx tsc --noEmit`：**预期 page.tsx 报错**（引用了已不存在的 `failed_checks` / `.check` / `.message`）。这不是本任务的失败，而是 task-04 的待办。
4. 人工核对：报错仅来自 page.tsx 对归档门禁字段的引用，**不得**出现来自 changes.ts 本身的报错（如出现说明本文件改错）。
5. 最终的 tsc 0 错误验证在 task-04 完成后、由 task-05 统一执行。

## 验收标准

| 编号 | 验收项 | 判定方式 | 期望结果 |
|---|---|---|---|
| AC-1 | `ArchiveCheckItem` 字段对齐后端 | 查看 changes.ts | 仅含 `name: string`、`passed: boolean`、`detail: string` 三字段，无 `check`/`message` |
| AC-2 | `ArchiveGateResponse` 字段对齐后端 | 查看 changes.ts | 含 `can_archive: boolean`、`checks: ArchiveCheckItem[]`，无 `failed_checks` |
| AC-3 | 仅改两个目标 type | `git diff frontend/src/lib/changes.ts` | diff 仅落在第 93–107 行区域两个 type 及其注释，其余无改动 |
| AC-4 | 未触碰 page.tsx | `git status` | page.tsx 不在本任务暂存改动中 |
| AC-5 | changes.ts 自身无 tsc 报错 | `cd frontend && npx tsc --noEmit` | 报错（若有）仅来自 page.tsx，无一条来自 changes.ts |
| AC-6 | 注释与新语义一致 | 查看 changes.ts | `checks` 注释体现"全部 6 项"，无残留"未通过项列表"措辞 |
