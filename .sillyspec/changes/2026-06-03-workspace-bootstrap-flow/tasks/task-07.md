---
id: task-07
title: 同步受影响模块文档（workspace / agent）
priority: P1
estimated_hours: 1
depends_on: [task-01, task-02, task-03, task-04]
blocks: []
allowed_paths:
  - .sillyspec/docs/SillyHub/scan/INTEGRATIONS.md
  - .sillyspec/docs/SillyHub/scan/PROJECT.md
  - .sillyspec/docs/SillyHub/modules/workspace.md
  - .sillyspec/docs/SillyHub/modules/agent.md
author: WhaleFall
created_at: 2026-06-03 15:22:13
---

# task-07 同步受影响模块文档（workspace / agent）

## 背景

本变更 `2026-06-03-workspace-bootstrap-flow` 把「生成项目规范」统一为 Bootstrap 流程（方案 A），改动落在四个代码点：

- **workspace 模块**（`backend/app/modules/workspace/service.py`）：`scan_generate` 增加进行中 scan run 的幂等查询与返回（task-01）。
- **agent 模块**（`backend/app/modules/agent/service.py`）：`_execute_scan_run` 成功分支（`exit_code == 0`）增加收尾自动 reparse 子组件，包在独立 try/except，失败仅 `log.warning`（task-02）。
- **前端弹窗**（`frontend/src/components/workspace-scan-dialog.tsx`）：移除 `generating` 阶段与 SSE，「生成项目规范」改为 `scanGenerate` 后 `router.push` 跳详情页（task-03）。
- **前端详情页**（`frontend/src/app/(dashboard)/workspaces/[id]/page.tsx`）：`load()` 查询进行中 scan run 并自动恢复 SSE 回显，done 后刷新计数（task-04）。

本任务是 Wave 4 收尾任务：把上述行为变化同步进模块/扫描文档，保证文档与实现一致。

**文档同步策略**：`.sillyspec/docs/SillyHub/modules/` 目前仅有 `change_writer.md` 与 `git_gateway.md`，**尚无 `workspace.md` / `agent.md` 模块文档**。本任务**不强制**新建这两个模块文档；优先更新已存在的 scan 文档相关章节（`INTEGRATIONS.md` 描述 scan-generate / Bootstrap 数据流、`PROJECT.md` 概述层的产品能力描述），把新流程「生成项目规范 = 跳转详情页 + 自动恢复回显 + 后端幂等 + 收尾 reparse」记录清楚。若执行者认为有必要补建 `modules/workspace.md` / `modules/agent.md`，可参照 `change_writer.md` 的格式新建，但这是可选项，非本任务硬性要求。

依据文档：
- `design.md`（决策 1~4 + 文件变更清单）
- `plan.md`（task-07：W4，依赖 task-01/02/03/04）
- 现有 `change_writer.md`（模块文档格式参考）

## 修改文件（精确路径，列出候选文档）

主目标（必改）：

- `.sillyspec/docs/SillyHub/scan/INTEGRATIONS.md`
  - 在「子项目间集成 → Frontend → Backend」或「Backend → Claude Code」相邻处，补充 scan-generate / Bootstrap 数据流的新描述（跳转详情页 + SSE 恢复回显 + 后端幂等 + 成功收尾 reparse）。只增补相关段落，不重写整篇。
- `.sillyspec/docs/SillyHub/scan/PROJECT.md`
  - 在「项目目标」或「开发方法论」相邻处，更新 workspace bootstrap 流程的能力描述（从「弹窗内即时回显」改为「弹窗只建项目并跳转，详情页承载回显/恢复」）。只调整相关句子，不重写整篇。

可选目标（执行者判断，非强制）：

- `.sillyspec/docs/SillyHub/modules/workspace.md`（若决定新建：描述 `scan_generate` 幂等语义 + `_find_active_scan_run`）
- `.sillyspec/docs/SillyHub/modules/agent.md`（若决定新建：描述 `_execute_scan_run` 成功收尾 reparse）

> 只允许改动上述 `allowed_paths` 内的文档文件。不要改任何代码、测试或其他变更目录下的文件。

## 实现要求（每个文档更新的内容要点）

### 1. INTEGRATIONS.md — scan-generate / Bootstrap 数据流

补充一段描述「生成项目规范」端到端流程，要点：

- **入口**：`POST /api/workspaces/scan-generate`（语义增强为**幂等**）——后端在触发 scan dispatch 前查询该 workspace 是否已有进行中（pending/running、`change_id IS NULL`）的 scan run，有则直接返回该 run，不新建（task-01）。
- **前端跳转**：弹窗点击「生成项目规范」后不在弹窗内订阅 SSE，而是 `scanGenerate` 成功后 `router.push('/workspaces/{id}')` 跳转详情页（task-03）。
- **回显恢复**：详情页 `load()` 调用 `GET /api/workspaces/{id}/agent/runs` 筛出进行中的 scan run，用 `GET /api/workspaces/{id}/agent/runs/{run_id}/stream`（SSE）自动恢复日志回显（task-04），刷新/重进可恢复。
- **成功收尾**：scan run `exit_code == 0` 时，后端 `_execute_scan_run` 自动 reparse `spec_root/projects/*.yaml` 创建子 workspace + relations；reparse 失败仅 `log.warning`，不改变 run 的 completed 状态（task-02）。
- 复用既有 SSE / agent runs 基础设施，无新增 API。

### 2. PROJECT.md — workspace bootstrap 流程概述

更新概述层对 workspace bootstrap 的描述，要点：

- 「生成项目规范」流程统一为 Bootstrap：弹窗职责单一化（扫描 + 新建 + 跳转），详情页承载触发 / 实时回显 / 进入恢复。
- 防重复点击下沉到后端（幂等返回进行中 run），多标签页 / 并发安全。
- scan 成功后自动创建子组件（子 workspace），「项目组组件」计数随之刷新。
- 措辞与 design.md 决策 1~4 一致，不夸大、不杜撰未实现能力。

### 3.（可选）modules/workspace.md / modules/agent.md

若执行者决定补建模块文档，参照 `change_writer.md` 格式（职责 / 当前设计 / 对外接口表 / 关键数据流 / 设计决策表 / 依赖关系 / 注意事项 / 变更索引），并在「变更索引」追加本变更条目。新建时 frontmatter 必须含 `author` + `created_at`。**不新建也视为达标**——主目标是 scan 两文档。

## 接口定义

本任务为**文档任务**，无代码接口变更。文档需准确描述的**关键事实清单**（均已在 design.md / 各 task 蓝图中核对）：

| 事实 | 内容 | 来源 |
|------|------|------|
| F1 | `scan_generate` 幂等：进行中 scan run（pending/running 且 `change_id IS NULL`）存在时直接返回，不新建 | design 决策 3 / task-01 |
| F2 | scan run 成功（`exit_code==0`）收尾自动 reparse 子组件，失败仅 warning，不改 completed 状态 | design 决策 4 / task-02 |
| F3 | 弹窗去 SSE，「生成项目规范」改为 `router.push` 跳详情页 | design 决策 1 / task-03 |
| F4 | 详情页 `load()` 查进行中 scan run 并自动连 SSE 恢复回显，done 后刷新计数 | design 决策 2 / task-04 |
| F5 | 无新增表 / 字段 / API，复用 agent runs 列表 + SSE + reparse 既有能力 | design 数据模型 / API 设计 |

文档不得出现以上事实之外的、未在代码中实现的字段或行为。

## 边界处理（至少 5 条）

1. **文档 frontmatter 完整**：本任务若新建任何文档（如 `modules/workspace.md`），frontmatter 必须包含 `author`（WhaleFall）与 `created_at`（`2026-06-03 ...` 格式，与本变更其它文档一致）；修改已有 scan 文档时**不改动**其原有 frontmatter（保持 `author: qinyi` 与原 `created_at`，避免篡改归属）。
2. **不杜撰未实现的字段 / 行为**：只写代码已落地的事实（F1~F5）。例如不得声称依赖 `sync_status` 字段判定（design 决策 2 明确以真实 run 状态为准，未引入新字段）；不得声称引入了 DB 唯一约束（task-01 边界明确未引入）。
3. **与代码实际一致**：方法名 / 接口路径 / 状态取值必须与源码一致——`scan_generate`、`_execute_scan_run`、`GET /api/workspaces/{id}/agent/runs`、状态 `pending/running/completed/failed/killed`、`change_id IS NULL`。不臆造方法名或路径。
4. **保持现有文档风格**：scan 文档为中文 + 代码块 + 表格混排，沿用其既有标题层级与排版；模块文档（如新建）沿用 `change_writer.md` 的章节骨架。不引入新风格、不加 emoji。
5. **只改相关章节，不重写整篇**：INTEGRATIONS.md / PROJECT.md 仅在与 scan-generate / bootstrap 相关的段落做增补或微调，其余章节（CI/CD、Docker、技术栈表等）一字不动，避免无关 diff 污染。
6. **可选项不做也达标**：`modules/workspace.md` / `modules/agent.md` 为可选新建；不新建时本任务仍以「scan 两文档更新到位」为通过标准，不因缺少模块文档判失败。
7. **不删除现有内容**：更新描述时优先**改写措辞**而非删段；涉及行为变化（如「弹窗内即时回显」→「跳转详情页回显」）时改正旧描述，但不删除与本变更无关的上下文。

## 非目标

- **不写任何代码**：本任务仅改文档（Markdown），不触碰 `backend/` `frontend/` 下任何源码。
- **不改测试**：不新增 / 修改 `tests/` 下任何测试文件（测试归 task-05 / task-06）。
- **不改其它扫描文档**：`ARCHITECTURE.md` / `CONCERNS.md` / `CONVENTIONS.md` / `STRUCTURE.md` / `TESTING.md` 与本变更行为无关，不在本任务范围。
- **不强制新建模块文档**：`modules/workspace.md` / `modules/agent.md` 为可选，缺失不判失败。
- **不改 design.md / plan.md / 其它 task 蓝图**：这些是上游产物，本任务只读不写。

## 参考

- `.sillyspec/docs/SillyHub/modules/change_writer.md`——模块文档格式范本（frontmatter `author`/`created_at` + 「职责 / 当前设计 / 对外接口表 / 关键数据流 / 设计决策表 / 依赖关系 / 注意事项 / 变更索引」骨架）。若新建模块文档照此结构。
- `.sillyspec/docs/SillyHub/scan/INTEGRATIONS.md`（现有「子项目间集成」「Backend → Claude Code」段落）——增补 scan-generate 数据流时贴近其现有排版。
- `.sillyspec/docs/SillyHub/scan/PROJECT.md`（现有「项目目标」「开发方法论」段落）——更新 bootstrap 概述时贴近其行文。
- `design.md` 决策 1~4 与「文件变更清单」——文档描述的事实唯一权威来源。

## TDD 步骤

> 本任务为文档任务，**无自动化测试**，以人工核对为准。按以下顺序自验：

1. **读 design.md 决策 1~4 + 文件变更清单**，列出需写入文档的 5 条事实（F1~F5）。
2. **打开 INTEGRATIONS.md**，在 scan / Claude Code 相关段落增补 scan-generate 数据流（幂等 + 跳转 + 回显恢复 + 收尾 reparse），人工核对每句对应 F1~F4，无杜撰字段。
3. **打开 PROJECT.md**，更新 bootstrap 流程概述，人工核对措辞与 design 决策一致。
4. **逐条核对边界处理**：frontmatter 未篡改、无未实现字段、方法名/路径与源码一致、风格统一、仅改相关章节。
5. **（可选）若新建模块文档**：核对 frontmatter 含 author+created_at、章节骨架对齐 change_writer.md、变更索引追加本变更条目。
6. **通读 diff**：确认无关章节零改动，无代码/测试文件被误改。

## 验收标准

| AC | 验收点 | 验证方式 | 通过条件 |
|----|--------|----------|----------|
| AC-1 | INTEGRATIONS.md 记录 scan-generate 新流程 | 人工通读 INTEGRATIONS.md 相关段落 | 含幂等返回进行中 run（F1）、弹窗跳转详情页（F3）、详情页 SSE 恢复回显（F4）、成功收尾 reparse（F2）四要素，接口路径/方法名与源码一致 |
| AC-2 | PROJECT.md 更新 bootstrap 概述 | 人工通读 PROJECT.md 相关段落 | bootstrap 流程描述改为「弹窗只建项目并跳转 + 详情页回显/恢复 + 后端幂等 + 自动子组件」，措辞与 design 决策 1~4 一致 |
| AC-3 | 文档与代码实际一致、无杜撰 | 逐句比对 F1~F5 与源码 | 无未实现字段（如 sync_status 判定、新 DB 约束）；状态取值/方法名/路径准确 |
| AC-4 | frontmatter 与风格合规 | 检查改动文件 frontmatter 与排版 | 修改已有 scan 文档未篡改原 frontmatter；若新建文档则含 author=WhaleFall + created_at；整体风格沿用现有，无 emoji |
| AC-5 | 仅改相关章节，范围收敛 | review 文档 diff | 仅 scan-generate/bootstrap 相关段落变动，其余章节零改动；无代码/测试/其它 task 文件被改；改动文件均在 allowed_paths 内 |
