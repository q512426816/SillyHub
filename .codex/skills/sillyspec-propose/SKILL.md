---
name: sillyspec:propose
description: 已废弃重定向 — 生成结构化规范四件套请直接走 brainstorm。适合用户说"生成规范、补全四件套、propose"——一律转用 /sillyspec:brainstorm。
---

## propose 阶段已废弃（重定向到 brainstorm）

`propose` 阶段已从 CLI 移除（`src/stages/propose.js` 标注 @deprecated 且未注册进 stageRegistry）——**`sillyspec run propose` 不存在**（报「未知阶段: propose」）。本 skill 只保留触发词重定向，没有任何 propose 专属流程，勿尝试执行任何 `run propose` 命令。

用户说"生成规范 / 补全四件套 / propose"时，**直接执行 `/sillyspec:brainstorm`**：

- brainstorm 产出同一套四件套（`proposal.md` + `design.md` + `requirements.md` + `tasks.md`），且含需求澄清与 Design Grill 审查
- 「已有零散设计只需补全」与「新需求从零设计」在 brainstorm 内同流程处理——若用户明确要求跳过澄清，在对话探索步骤直接说明「需求已明确」尽早推进即可

## 用户指令
$ARGUMENTS
