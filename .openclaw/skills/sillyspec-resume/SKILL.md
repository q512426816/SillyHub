---
name: sillyspec:resume
description: 恢复工作 — 从中断处继续
---

## 交互规范

**当需要用户从多个选项中做出选择时，必须使用 Claude Code 内置的 AskUserQuestion 工具，将选项传入。** 不要用编号列表让用户手动输入数字。需要自由输入时在选项中加入"Other（自定义输入）"。

## 流程

1. **读进度**：跑 `sillyspec progress show`。
2. **有活跃变更**：把当前状态（变更/阶段/步骤）转述给用户，用 AskUserQuestion 问「直接继续执行下一步 / 查看更多细节」。
3. **无活跃变更**：跑 `sillyspec next`——CLI 已内置全套探测（文件存在性 → 推断阶段 → 建议命令 + 依据），按输出转述并执行建议命令。勿自行 ls/cat 重算（输出与实际不符时才手工核对）。

## 关键原则

- 进度存 SQLite（`.sillyspec/.runtime/sillyspec.db`），随 `sillyspec run <stage> --done` 自动更新，不需要手动保存、不需要从中途状态"恢复文件"——直接续跑即可。

## 用户指令
$ARGUMENTS
