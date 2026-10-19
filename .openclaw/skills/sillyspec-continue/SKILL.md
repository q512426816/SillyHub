---
name: sillyspec:continue
description: 自动判断并执行下一步
---

## 流程

**先跑 `sillyspec next`**——CLI 已内置全套探测（HANDOFF / 活跃变更逐个产物推断 / task 勾选进度 / scan 文档 / 绿地棕地判定），直接输出「状态 + 下一步命令 + 依据」。

1. 把探测结果转述给用户（状态 / 下一步 / 依据三行）。
2. 按输出的建议命令直接执行对应 skill（如 `sillyspec run brainstorm` / `plan` / `execute` / `verify` / `archive`）。
3. 仅当 CLI 异常或输出与实际明显不符时，才手工核对 `.sillyspec/` 下的产物文件后重新判断。

勿自行 ls/cat 重算探测表——那就是 `next` 命令本体。

## 用户指令
$ARGUMENTS
