# plan — 平台搭建实施计划

## 1. 阶段划分

```text
V0 文档基线
V1 SillySpec Native Viewer
V2 平台写入 SillySpec
V3 工作流、审批、审计
V4 Agent 受控执行
V5 部署、运维、复盘闭环
```

## 2. V0：文档基线

目标：形成标准 SillySpec 变更包。

产物：

- MASTER.md
- proposal.md
- requirements.md
- design.md
- plan.md
- tasks.md
- verification.md
- references/*

验收：

- 能解释 Workspace、ProjectComponent、Change、Task、Runtime。
- 能解释多人 Git 隔离设计。
- 能作为开发输入。

## 3. V1：SillySpec Native Viewer

目标：平台能读取真实 `.sillyspec` 结构并展示。

功能：

1. 选择 Workspace。
2. 解析 projects/*.yaml。
3. 解析 docs/{component}/scan/*.md。
4. 解析 changes/change/*。
5. 解析 changes/archive/*。
6. 解析 tasks.md 和 tasks/*.md。
7. 读取 .runtime/progress.json。
8. 展示 Workspace 首页、组件页、变更中心、任务看板。
9. 建立 GitIdentity、WorktreeLease、GitOperationLog 基础模型。

## 4. V2：平台写入 SillySpec

目标：平台可以创建和修改 Change 包。

功能：

1. 创建 Change。
2. 生成 proposal.md。
3. 生成 requirements.md。
4. 生成 design.md。
5. 生成 plan.md。
6. 生成 tasks.md。
7. 生成 tasks/task-xx.md。
8. 查看 Git diff。
9. 使用用户 Git Identity 提交到任务分支。
10. 创建 PR。

## 5. V3：工作流、审批、审计

目标：让 Change 生命周期状态化。

功能：

1. Change 状态机。
2. Task 状态机。
3. Spec Guardian 检查。
4. Review 封驳。
5. 审批节点。
6. 审计日志。
7. Git Tool Gateway 完整落地。
8. Worktree Lease 释放和清理。

## 6. V4：Agent 受控执行

目标：接入 Claude Code、Codex、Cursor。

功能：

1. Agent Adapter。
2. Agent Run。
3. 上下文注入。
4. allowed_paths / denied_paths。
5. shell/git/file 工具网关。
6. 代码 diff 收集。
7. 测试执行。
8. verification 更新。
9. 人工审批后 PR。

## 7. V5：部署与运维闭环

目标：从需求到部署完整闭环。

功能：

1. 发布单。
2. 环境管理。
3. 部署审批。
4. 回滚方案。
5. 监控结果回填。
6. 事故记录。
7. 复盘沉淀到 knowledge。

## 8. 推荐时间线

| 阶段 | 周期 | 重点 |
|---|---:|---|
| V0 | 1 周 | 文档基线 |
| V1 | 3-4 周 | 只读解析和展示 |
| V2 | 3-4 周 | 写入和 Git 分支 |
| V3 | 4-5 周 | 审批、审计、状态机 |
| V4 | 5-6 周 | Agent 执行 |
| V5 | 4-6 周 | 部署闭环 |

## 9. 第一迭代只做什么

第一迭代建议只做：

```text
SillySpec Native Viewer + Git Identity 数据模型 + Worktree 隔离基础
```

不要提前做：

```text
自动 Agent 编码
生产部署
完整工作流引擎
复杂多租户
Kubernetes
```
