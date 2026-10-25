---
author: qinyi
created_at: 2026-10-25 20:05:00
generated_by: hand (brainstorm 四件套收口；plan 阶段展开写回)
---
# 任务清单（Tasks）

> 顶层任务分解（plan 阶段展开定稿——实现+单测同卡粒度，7 卡 4 Wave；Wave 分组与依赖详见 plan.md；TaskCard 见 tasks/task-NN.md）。

- [x] task-01: daemon 双指令——gitDirtyFiles/gitWorktreeDiff 实现与平名注册 + 解析单测（含 untracked exit 1 语义、porcelain 末段 rejoin、u 条目、ignored 聚合、中文/空格路径、detached HEAD 用例）
- [x] task-02: backend 双端点——schema 4 DTO + service get_dirty_files/get_worktree_diff + router 两端点 + tests/modules/git_log/test_git_log_dirty_files.py 降级测试（404/502/422/no_git/正常聚合 mock RPC）
- [x] task-03: gen:types 三份产物同批再生成（backend/openapi.json + frontend/src/lib/api-types.ts + sillyhub-daemon/src/api-types.ts；前置前端 node_modules 健康检查）
- [x] task-04: 前端取数层与工作区更改卡——lib/git-log.ts 一次性扩展（fetchDirtyFiles + fetchWorktreeDiff + 两 hook + queryKeys）+ worktree-changes-card.tsx（三分组树+四色+计数+刷新）+ 卡片测试 (depends_on: task-03)
- [x] task-05: 文件 diff 弹窗——file-tree.tsx 导出 buildFileTree/diff 渲染件 + worktree-diff-modal.tsx（组件内取数+错误分型降级；回归既有 file-tree.test.tsx）+ 弹窗测试 (depends_on: task-04)
- [x] task-06: Git 日志页挂载接线——git-log/page.tsx 挂 WorktreeChangesCard（GitStatusBar 之下）+ 弹窗状态接线 + no_git 空态不堆叠（回归 git-log-page/git-status-bar 测试） (depends_on: task-04,05)
- [x] task-07: explorer 树四色着色——file-explorer.tsx 渲染期状态映射（含改动目录蓝点/忽略灰徽标/点击行为不变；回归既有 file-explorer.test.tsx）+ 着色测试 + 收尾对账（原型 3 件冻结重编译/漂移产物还原/验收对照） (depends_on: task-04)
