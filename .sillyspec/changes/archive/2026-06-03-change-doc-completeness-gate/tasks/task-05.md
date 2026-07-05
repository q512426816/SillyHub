---
id: task-05
title: 验证 — change 模块测试全通过 + 前端 tsc 0 错误
priority: P0
estimated_hours: 0.5
depends_on: [task-03, task-04]
blocks: []
created_at: 2026-06-03 16:57:56
author: qinyi
allowed_paths:
  - （仅运行验证，不改源码；如发现问题回到对应 task）
---

# task-05: 验证 — change 模块测试全通过 + 前端 tsc 0 错误

收口验证任务。依赖 task-03（后端归档门禁测试）与 task-04（前端完整度分区 + 门禁渲染）完成后执行，对照 plan.md 的「全局验收标准」逐条核对。本任务**不修改任何源码**，只运行验证命令并做人工核对；发现失败时按归因规则回退到对应 task 修复，修复后重跑本任务。

## 修改文件（必填）

（无源码修改，仅运行验证命令；若失败定位到 task-01/02/03/04）

- 后端逻辑失败 → task-01（`backend/app/modules/change/service.py` 的 `check_archive_gate`）
- 后端测试断言/用例失败 → task-03（change 模块归档门禁测试文件）
- 前端类型/契约失败 → task-02（`frontend/src/lib/changes.ts`）
- 前端渲染/完整度计数失败 → task-04（`frontend/src/app/(dashboard)/workspaces/[id]/changes/[cid]/page.tsx`）

> 说明：plan.md 中 Wave 编号与本任务的 task 编号不完全一致；定位时以「失败现象 → 职责文件」为准，不要被编号绑死。

## 实现要求

逐条执行以下验证命令，全部满足期望结果方可判定本任务通过。命令路径以仓库根 `C:\Users\qinyi\IdeaProjects\multi-agent-platform` 为基准。

### 1. 后端 — change 模块测试全通过

在 `backend` 目录下执行：

```bash
python -m pytest app/modules/change/ tests/modules/change/ -q
```

- 期望：所有用例 PASSED，无 FAILED / ERROR，进程退出码 0。
- 重点覆盖 task-03 新增/调整的 `documents_complete` 门禁测试：四件套齐全 → `passed=true`；缺件 → `passed=false` 且 `detail` 指明缺哪些。
- 若 `tests/modules/change/` 路径不存在（测试就地放在 `app/modules/change/tests/` 下），pytest 会对缺失路径报 ERROR；此时改为只跑实际存在的目录（先用 Glob/Grep 确认门禁测试文件落点，再调整路径），不得因路径不存在就跳过测试。

### 2. 前端 — tsc 0 错误

在 `frontend` 目录下执行：

```bash
npx tsc --noEmit
```

- 期望：退出码 0，无任何 error 输出。
- 重点确认 task-02 的 `changes.ts` 类型（`ArchiveCheckItem={name,passed,detail}`、`ArchiveGateResponse.checks`，已删 `failed_checks`）与 task-04 的 `page.tsx` 渲染（`archiveGate.checks.find((c)=>c.name===item.check)`、`.passed`、`.detail`、未通过计数 `checks.filter((c)=>!c.passed).length`）类型自洽，无残留对 `failed_checks` / `.check` 字段的引用。

### 3. 人工核对（描述步骤，不强制起服务）

无需真正启动前后端，按以下逻辑路径核对即可（如已有 dev 环境可顺手验证）：

- **完整度卡片 4/4**：对一个仅含四件套（proposal/design/requirements/tasks）、无 plan/verify_result/module_impact 等可选文档的变更，核对完整度卡片标题计数为 `4/4`，且可选组缺失项灰显但不拉低分母（分母恒为 `REQUIRED_DOCS.length=4`）。可通过审阅 task-04 改后的 `page.tsx` 计数表达式 + 构造/选取一个仅四件套的样例变更确认。
- **归档门禁 UI 渲染 6 项 checks**：核对门禁 UI 能遍历后端返回的 `checks` 数组渲染 6 项（no_unresolved_feedback / ac_confirmed / tech_verification_passed / business_review_passed / feedback_categorized / documents_complete），每项展示 `passed` 状态与 `detail`，未通过 badge 计数等于 `checks.filter((c)=>!c.passed).length`。可对照后端 `ArchiveGateResponse` 契约 + 前端渲染代码静态核对，无需运行。

## 接口定义（代码类任务必填）

N/A — 验证任务。本任务不声明或修改任何接口，仅消费 task-01/02 已固化的 `ArchiveGateResponse { can_archive, checks: ArchiveCheckItem[] }` 与 `ArchiveCheckItem { name, passed, detail }` 契约。

## 边界处理（必填，≥5 条）

1. **测试失败归因不靠猜**：先看 pytest traceback 最末的断言/异常行，区分是「实现逻辑错」（回 task-01 改 service.py）还是「测试用例本身写错」（回 task-03 改测试），不要在本任务里直接动代码。
2. **不为通过而改测试断言**：严禁为了让 pytest 变绿而弱化或删改 task-03 的断言（如把 `passed=false` 的缺件用例改成期望 `true`）。测试反映 design 口径（四件套 exists），断言是规约不是障碍。
3. **tsc 报错定位**：`npx tsc --noEmit` 的错误带 `文件:行:列` 与 TSxxxx 码；优先看是否仍有对已删字段 `failed_checks` / `.check` 的引用（应回 task-02 或 task-04），而非盲目加 `as any` 或 `@ts-ignore` 抹掉。
4. **警告 vs 错误区分**：只有 tsc 的 `error TSxxxx` 与 pytest 的 FAILED/ERROR 才算未通过；lint warning、deprecation notice、pytest warning（如 PytestUnknownMarkWarning）不构成本任务失败项，不要为消除无关 warning 扩大改动范围。
5. **Windows 路径与主机名坑**：本机为 Windows，若验证中需访问本地服务，统一用 `127.0.0.1` 而非 `localhost`（localhost 在部分环境解析到 IPv6 ::1 导致连接失败）；命令路径用正斜杠或带引号的绝对路径，避免反斜杠转义问题。
6. **测试路径存在性**：`tests/modules/change/` 与 `app/modules/change/` 可能只存在其一；跑前用 Glob 确认实际落点，对不存在的路径不要硬塞进 pytest 参数导致 collection ERROR 误判为失败。
7. **环境干净度**：跑 pytest 前确认无半成品改动/未保存文件污染结果；前端先确保依赖已装（`node_modules` 存在），否则 tsc 报的是缺包错误而非真实类型错误，应先 `npm install` 而非记为失败。
8. **失败即回退、修复后重跑**：本任务任一项不通过时，修复落在对应 task 文件后，必须从头重跑 1+2（不只重跑失败项），确保改动未引入回归。

## 非目标

- 不修改任何源码、测试断言或类型定义（修改属于 task-01/02/03/04）。
- 不真正启动前后端服务做端到端联调（人工核对采用静态对照即可）。
- 不扩展测试覆盖范围、不新增用例（覆盖由 task-03 负责）。
- 不处理与本变更无关的既有 lint/warning/技术债。
- 不触碰后端门禁 schema、其余 5 项检查逻辑或 `ChangeDocument.status` 写入。

## 参考

- `design.md` — 完整度口径（四件套为必需）、`check_archive_gate` 的 `documents_complete` 改判逻辑、`ArchiveGateResponse` 契约（6 项 name 固定）。
- `plan.md` — 「全局验收标准」5 条、Wave 依赖关系。
- task-01：`backend/app/modules/change/service.py` `check_archive_gate`。
- task-02：`frontend/src/lib/changes.ts` 类型契约。
- task-03：change 模块归档门禁测试。
- task-04：`frontend/src/app/(dashboard)/workspaces/[id]/changes/[cid]/page.tsx` 完整度分区 + 门禁渲染。

## TDD 步骤

N/A — 纯验证任务，不写代码亦不写测试，仅运行既有测试与编译检查。

## 验收标准

| # | 验收项（对应 plan.md 全局验收标准） | 验证方式 | 期望结果 |
|---|---|---|---|
| AC-1 | 完整度卡片对仅四件套变更显示 4/4，可选文档缺失不影响计数 | 人工核对 `page.tsx` 计数表达式（分母=REQUIRED_DOCS.length=4）+ 仅四件套样例 | 标题显示 `4/4`，可选组缺失灰显不入分母 |
| AC-2 | documents_complete 四件套齐全 passed=true、缺件 passed=false 且 detail 指明缺哪些 | `python -m pytest app/modules/change/ tests/modules/change/ -q`（task-03 门禁用例） | 齐全/缺件两类用例均 PASSED，断言覆盖 detail 内容 |
| AC-3 | 归档门禁 UI 正确渲染后端 6 项 checks（passed+detail），未通过 badge 计数正确 | 人工核对 `page.tsx` 渲染：`checks.find(c=>c.name===item.check)`、`.passed`、`.detail`、`checks.filter(c=>!c.passed).length` | 6 项 name 全渲染，状态/说明取自 checks，badge 计数正确 |
| AC-4 | change 模块 pytest 全通过 | `cd backend && python -m pytest app/modules/change/ tests/modules/change/ -q` | 全 PASSED，无 FAILED/ERROR，退出码 0 |
| AC-5 | 前端 npx tsc --noEmit 0 错误 | `cd frontend && npx tsc --noEmit` | 退出码 0，无 error 输出，无 failed_checks/.check 残留引用 |
