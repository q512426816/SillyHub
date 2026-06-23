---
name: sillyspec:execute
description: 用于按 plan 执行代码实现。适合用户说"开始写代码、执行任务、跑 execute、开干"。按 plan.md 中的 Wave 和 Task 逐步实现，遵循 design.md 和模块文档。
---

## 多变更说明

如果项目有多个活跃变更（`.sillyspec/changes/` 下有多个目录），所有 `sillyspec run` 命令需要加 `--change <变更名>`。只有一个变更时可省略（CLI 自动检测）。

## 执行

**你必须使用 exec 工具（shell）执行以下命令，不要自己编造流程：**

1. 运行 `sillyspec run execute` — CLI 会自动创建 worktree 隔离环境，然后输出步骤 prompt
2. 按照输出的 prompt **严格执行**，不要跳过或自行添加步骤
3. 步骤完成后，运行 `sillyspec run execute --done --output "你的摘要"`
4. 重复 2-3 直到阶段完成
5. **禁止**在没有运行 CLI 的情况下自行决定流程

## Worktree 隔离

- CLI 启动 execute 阶段时**自动创建 git worktree**，AI agent 不需要手动创建
- Worktree 路径在 Step 3（确认 worktree 路径）中输出，后续子代理的 cwd 必须设为该路径
- **禁止跳过 worktree 或在主仓库直接写代码**
- 如果 worktree 创建失败，CLI 会报错并退出，需要排查后再重试
- **未提交的文件、dirty 状态等不影响 worktree 创建和进入，直接按 CLI 输出的 worktree 路径操作即可**
- 不要自行检查 git 状态来判断是否可以进入 worktree，CLI 会自动处理

## 用户指令
$ARGUMENTS
