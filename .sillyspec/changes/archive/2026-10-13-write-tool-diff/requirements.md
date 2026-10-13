---
author: flow-machine-draft
created_at: 2026-10-13T02:48:04.597Z
---
# 需求规格（Requirements）— 2026-10-13-write-tool-diff

## 功能需求

### FR-01: Write 工具展开区在有 edit_patch（structuredPatch）时渲染红删绿增 DiffView，与 Edit 分支同管线

- 会话面板 Write 工具段携带可解析的 `editPatch`（structuredPatch hunks JSON）时，展开区必须以 DiffView 渲染红删绿增行级 diff（行号取自 hunk oldStart/newStart 真实文件行号），禁止回退纯文本全文展示。

#### 场景：覆盖写真实 diff

Given 一条带合法 editPatch 的 Write 工具段（覆盖已有文件）
When 用户展开该工具卡
Then 删除行红底（仅旧侧行号）、新增行绿底（仅新侧行号），标题含「变更对比」，且保留复制完整原文按钮

### FR-02: 无 edit_patch 时整文件按新增行全绿展示，保留复制内容按钮

- `editPatch` 缺失或解析失败时，Write 展开区必须把 `args.content` 整文件按新增行展示（全绿、新侧行号自 1 起计），且必须保留复制完整原文（不截断）的按钮。

#### 场景：新建文件全绿展示

Given 无 editPatch 的 Write 工具段（新建文件或非 claude provider）
When 用户展开该工具卡
Then 内容行全部绿底 add 展示、标题「写入内容（N 行）」、复制按钮复制完整原文；超 2000 行时 DiffView 截断护栏生效且复制仍完整

### FR-03: 相关前端测试通过，不改动 Edit 分支现有行为

- 本变更落地后，Edit 分支既有渲染行为必须保持不变（其既有测试用例零改动通过），且 Write 新契约与 Edit 接线回归的相关前端测试必须全绿。

#### 场景：Edit 接线回归

Given 既有 tool-args-detail / turn-segment-views 测试套件
When 跑这两个文件的全部用例
Then 全绿——Edit 既有用例零改动通过，Write 用例按新契约通过，`pnpm typecheck` 零错误

## 测试绑定（每条 FR 至少一行——`FR-NN: test/路径「用例名」`；空行/待填在 flow done 拒收）

FR-01: frontend/src/components/daemon/__tests__/tool-args-detail.test.tsx「有 editPatch：structuredPatch 红删绿增渲染（覆盖写真实 diff），标题含「变更对比」」
FR-02: frontend/src/components/daemon/__tests__/tool-args-detail.test.tsx「无 editPatch：整文件按新增行全绿展示（新侧行号自 1 起计）+ 复制内容按钮」+ frontend/src/components/daemon/__tests__/turn-segment-views.test.tsx「Write 超长内容：diff 行 2000 行截断护栏（DiffView 复用），复制仍带完整原文」
FR-03: frontend/src/components/daemon/__tests__/turn-segment-views.test.tsx「Edit 展开渲染行级 diff：红底 - 旧行 / 绿底 + 新行 + 双侧行号列，不再是两个裸代码块」（Edit 零改动回归）+ frontend/src/components/daemon/__tests__/tool-args-detail.test.tsx「parseStructuredPatch」组（Edit 同管线既有断言）
