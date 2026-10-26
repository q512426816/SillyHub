---
author: flow-machine-draft
created_at: 2026-10-26T01:06:55.909Z
---
# 需求规格（Requirements）— 2026-10-26-worktree-group-collapse

## 功能需求

### FR-01: 三个分组标题可点击切换展开/收起（箭头随状态翻转，带 aria-expanded）

- 「更改」「未纳入版本管理」「已忽略」三个分组头必须为可点击按钮：每次点击切换该组内容显隐，箭头随开合旋转，且按钮必须携带 aria-expanded 反映当前态。

#### 场景：主路径

Given 卡片已渲染出至少一组内容
When 点击该组头按钮
Then 该组内容隐藏、aria-expanded=false；再次点击恢复显示、aria-expanded=true

### FR-02: 未纳入版本管理与已忽略默认收起、更改默认展开

- 组件首次渲染必须呈现：更改组展开、未纳入版本管理组收起、已忽略组收起；收起组头必须仍显示该组条目计数（展开后内容才进 DOM）。

#### 场景：主路径

Given 含 untracked 与 ignored 条目的工作区数据
When 卡片渲染完成（未点任何组头）
Then 更改组文件行在 DOM；untracked 行与 ignored 行不在 DOM；两组头可见且带计数

### FR-03: 既有 worktree-changes-card 聚焦测试按新默认态更新并全绿（仅跑该测试文件）

- 涉及 untracked/ignored 内容断言的既有用例必须先展开对应分组再断言；禁止跑全量测试（聚焦该测试文件）。

#### 场景：主路径

Given 本变更代码与测试更新落盘
When 运行 vitest 单文件 worktree-changes-card.test.tsx
Then 全部用例通过（14/14）

## 测试绑定（每条 FR 至少一行——`FR-NN: test/路径「用例名」`；空行/待填在 flow done 拒收）

FR-01: frontend/src/components/git-log/__tests__/worktree-changes-card.test.tsx「分组折叠：untracked/ignored 默认收起、更改默认展开、点击切换」
FR-02: frontend/src/components/git-log/__tests__/worktree-changes-card.test.tsx「分组折叠：untracked/ignored 默认收起、更改默认展开、点击切换」+「三分组渲染归属」
FR-03: frontend/src/components/git-log/__tests__/worktree-changes-card.test.tsx（全文件 14 用例，2026-10-26 实测 14/14 绿）
