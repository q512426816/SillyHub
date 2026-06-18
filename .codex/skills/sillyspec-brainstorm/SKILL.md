---
name: sillyspec:brainstorm
description: 用于正式开始开发前的需求澄清和技术方案设计。适合用户提出新功能、新模块、架构调整、复杂改造，或说"先做需求分析、输出技术方案、创建变更前先梳理、帮我设计下"。产出结构化方案，但不直接写代码。
---

## 多变更说明

如果项目有多个活跃变更（`.sillyspec/changes/` 下有多个目录），所有 `sillyspec run` 命令需要加 `--change <变更名>`。只有一个变更时可省略（CLI 自动检测）。

## 执行

**你必须使用 exec 工具（shell）执行以下命令，不要自己编造流程：**

1. 运行 `sillyspec run brainstorm` — 读取输出的步骤 prompt
2. 按照输出的 prompt **严格执行**，不要跳过或自行添加步骤
3. 步骤完成后，运行 `sillyspec run brainstorm --done --output "你的摘要"`
4. 重复 2-3 直到阶段完成
5. **禁止**在没有运行 CLI 的情况下自行决定流程

## 特殊步骤：requiresWait

某些步骤（如"对话式探索"）需要等待用户输入。AI agent 可以：

- **方式一（推荐）**：通过自己的对话工具与用户交互，完成后直接 `--done --answer "用户回答"` 一步完成
- **方式二**：先 `--wait` 记录等待状态，再 `--continue --answer "用户回答"`，最后 `--done`

```bash
# 一步完成 wait + done（AI agent 已自行与用户交互）
sillyspec run brainstorm --done --change <变更名> --answer "信息够了，进入方案讨论" --output "需求已澄清"

# 分步完成
sillyspec run brainstorm --wait --change <变更名> --reason "等待用户回答" --output "探索问题"
sillyspec run brainstorm --continue --answer "用户回答" --change <变更名>
sillyspec run brainstorm --done --change <变更名> --output "需求已澄清"
```

## 注意
- 推荐指定 `--change <变更名>`（格式：`YYYY-MM-DD-<简短描述>`），不指定时自动生成
- 步骤 prompt 由 CLI 管理，不需要手动读取
- 依赖 scan 阶段完成，CLI 会自动提醒
- brainstorm 完成后，运行 `sillyspec run plan --change <变更名>` 进入实现计划

## 用户指令
$ARGUMENTS
