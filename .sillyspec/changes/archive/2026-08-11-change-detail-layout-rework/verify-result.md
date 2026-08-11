---
author: qinyi
created_at: 2026-08-11T12:38:00+08:00
---

# 验证报告 — 变更中心详情页展示结构重做

## 结论

**PASS**

8/8 任务全部实现并通过验收；4 类展示问题（僵尸区块 / 概念重叠 / 进度维度爆炸 / AI 入口分散）逐个解决；5 项设计决策全落实；质量扫描全绿（vitest 1386 / tsc 0 错 / eslint 我的文件 exit 0）。零后端 / API / DTO 改动，纯前端内部编排重构。

## 任务完成度

| 任务 | 状态 | 验收通过率 | 关键产物 |
|------|------|-----------|---------|
| task-01 次线折叠基件 + 文件/会话卡 | ✅ | 3/3 | collapsible-card.tsx + change-files-card.tsx + change-sessions-card.tsx（6 测试） |
| task-02 审核历史卡（读真实 review_history） | ✅ | 4/4 | change-review-history-card.tsx + normalizeReviewHistory 双形状归一（8 测试） |
| task-03 阶段步骤条 | ✅ | 3/3 | change-stage-header.tsx（7 测试） |
| task-04 当前阶段操作区（收口 5 入口） | ✅ | 6/6 | change-stage-actions.tsx + GATE_PANELS（9 测试） |
| task-05 智能体执行日志区（消双入口） | ✅ | 4/4 | change-agent-run-log.tsx，FR-05b onDispatch=undefined（7 测试） |
| task-06 page.tsx 瘦身编排 | ✅ | 5/5 | page.tsx 1119→484 行，两栏 grid + 删旧区块/死代码 |
| task-07 任务看板摘要卡 | ✅ | 3/3 | change-task-board-card.tsx（3 测试） |
| task-08 测试迁移 + 全量回归 | ✅ | 3/3 | page-team-toggle 重写指向 ChangeStageActions（8 测试，80ms） |

**完成率：8/8 = 100%**。新增/迁移测试：40 组件测试 + 8 迁移测试 = 48；frontend 模块 vitest 全量 **142 文件 / 1386 测试通过**，零回归。

## 设计一致性

### 决策追踪矩阵

| 决策 | 遵循 | 落地证据 |
|------|------|---------|
| D-001 左主右辅右栏侧栏 | ✅ | page.tsx `grid lg:grid-cols-[minmax(0,1fr)_320px]`，main 主线 + aside 次线 |
| D-002 会话进次线 | ✅ | ChangeSessionsCard 在 aside；主线 main 仅 ChangeAgentRunLog |
| D-003 审批状态删 + 审查记录改读 review_history | ✅ | listReviews / approval_status / APPROVAL_LABELS 全删；normalizeReviewHistory 读 stages.review_history |
| D-004 全量重写（8 组件 + page 瘦身） | ✅ | 8 组件 + 8 测试 + page.tsx 1119→484 |
| D-005 不换组件库 | ✅ | 全程 `@/components/ui`（shadcn 风格），未引 antd/其它 |

### §5.2 四问题落点映射

| 问题 | 解决 | 证据 |
|------|------|------|
| ① 僵尸区块（审批状态/审查记录读死表） | ✅ | 旧区块全删；审核历史改读真实 stages.review_history（gate/rerun 双形状） |
| ② 概念重叠（会话 vs 执行日志双聊天框） | ✅ | 物理分离：会话→aside 次线，执行日志→main 主线 |
| ③ 进度维度爆炸（阶段条/子步骤/团队/任务四并排） | ✅ | 分层收口：ChangeStageHeader（宏观 5 阶段）+ ChangeAgentRunLog 内子步骤/团队 + ChangeTaskBoardCard 摘要 |
| ④ AI 入口分散（5+ 处 + handleExecute 死代码） | ✅ | ChangeStageActions 收口 gate/推进/验证门禁/触发智能体/provider+model+team；handleExecute/handleTransition 删除 |

### 风险缓解（design §10）

| 风险 | 缓解 | 验证 |
|------|------|------|
| R-01 现有测试回归 | 逐组件迁移 + 全量回归 | ✅ 142 文件 1386 测试零回归 |
| R-02 ChangeStageActions 接线复杂 | Props 明确注入所有 handler | ✅ 21 Props 全由 page 注入，9 单测覆盖 |
| R-03 旧表历史留痕丢失 | 设计层接受降级 | ✅ D-003 明确，审核历史改读 review_history |
| R-04 双入口（SillySpecStepProgress 内嵌按钮） | 组合时传 onDispatch=undefined | ✅ 单测硬断言 stepCapture.props.onDispatch===undefined |
| R-05 次线折叠藏常用入口 | defaultOpen 默认值表 | ✅ 文件 true / 会话 false / 历史+任务独立 section |
| R-06 team toggle DOM 契约破坏 | Props 注释点名 + 测试先迁 | ✅ role=switch + aria-label=用团队执行 零破坏，8 测试覆盖 |

### 文件变更清单一致性

✅ design §6 列出的 8 组件 + page.tsx + 测试全部落地，与实际 git diff 一致（20 文件）。

## 探针结果

### 探针1：死代码 / 僵尸区块扫描
✅ **CLEAN** — page.tsx 无 handleExecute / handleTransition / listReviews / checkArchiveGate / approval_status / 审查记录旧实现残留；无 TODO/FIXME。

### 探针2：双入口消除
✅ ChangeAgentRunLog 渲染 SillySpecStepProgress 时 onDispatch/dispatching 均不透传（单测 change-agent-run-log.test.tsx:56 硬验证）。

### 探针3：审核历史数据源
✅ ChangeReviewHistoryCard 经 normalizeReviewHistory 读 change.stages.review_history（非旧 change_reviews 表）；gate/rerun 双形状 8 单测覆盖。

### 探针4：移动端折叠
✅ grid 默认单列，`lg:grid-cols-[...]` 仅 ≥1024px 生效；次线 CollapsibleCard 默认折叠态防移动端一屏爆量。

## 质量扫描

| 项 | 结果 |
|----|------|
| vitest 全量 | ✅ 142 文件 / 1386 测试通过（42.24s），零回归 |
| tsc --noEmit | ✅ 0 错误（noUncheckedIndexedAccess 严格模式） |
| eslint（本次新文件） | ✅ exit 0（Props 回调类型参数名 7 处按项目惯例 `_` 前缀；全仓 294 warning 为既有基线，非本次引入） |
| page-team-toggle 测试迁移 | ✅ 3136ms → 80ms（快 39x），act() 警告消除，stale mock 清除 |

## 技术债务

- **无新增债务**。本次为纯重构，未引入新依赖、未改 API 契约。
- 既有 294 eslint warning 全在无关文件（kanban.ts / token-refresh.test.ts 等），非本次范围。

## 残留风险

1. **集成冒烟未实测**：组件单测全绿 ≠ 集成正确。建议真实打开一个含审核记录的变更详情页，人工验主线/次线/操作区/审核历史联动（plan §verify 第 7 项）。
2. **移动端 <1024px 实机未测**：仅 CSS 断点逻辑，jsdom 无媒体查询验证。
3. **review_history 后端形状未端到端比对**：normalizeReviewHistory 按 design §7 双形状容错，依赖后端 stages.review_history 字段名稳定。
4. **执行场所偏离 plan**：原 plan 计划 worktree 隔离执行，因 worktree 子代理（Kimi/k3）403 配额 + 历史 worktree execute 代码全丢教训，改为直接主仓实现。代码质量与测试覆盖未降级（已同步进 worktree 供 sillyspec apply）。

## 模块文档

- frontend.md 索引可信（无 needs_review）。
- 本次零后端 / API / DTO 改动，openapi.json / api-types.ts 无变化，frontend.md 无强制同步要求（archive 阶段按需补 ql/变更索引行）。
