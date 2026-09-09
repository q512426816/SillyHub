---
author: qinyi
created_at: 2026-09-08 15:54:00
---

# 并行会话对同一 change `--done` 会把尚未实现的下一 Wave 标完成

> 状态：活跃（2026-09-08-cursor-interactive-session 实证）。

## 现象

会话 A 在 CLI Wave 3（task-03）工作；会话 B 同时完成了 Wave 3 并 `--done`。会话 A 随后对「自己以为的 Wave 3」再跑 `--done`，CLI 实际完成的是**当时的当前步 = Wave 4**，摘要却仍是 Wave 3 的产出说明。进度显示 Wave 4 已完成，但 worktree 里 `cursor-driver.ts` 仍是空占位（0 字节），task-04 未勾选。

## 影响

后续 Wave（task-05/06 注册点）会在 CursorDriver 未落地时启动。`--reopen --from-step 8` 可退回 Wave 4 重做（本会话已用）。

## 绕过

- 每次 `--done` 前先 `sillyspec progress show` + `sillyspec run execute` 确认当前 `stepName` 与自己刚做完的 Wave 一致。
- `--done --output` 写当前 Wave 的 task 编号；若 CLI 打印的「✅ Step N 完成：Wave X」与刚做的 Wave 不符，立刻 `--reopen --from-step` 退回，不要继续下一 Wave。
- 同一 change 不要两个会话同时 `--done`。

## 待工具修复

`--done` 可要求 `--output` 含当前 stepName 关键字，或在步骤刚被其他进程推进时拒绝「过期 --done」。

## 处置进展（2026-09-09 定时收口，双层防护落地，意图断言留后续）

已落地（sillyspec 仓 `src/run/complete.js` 完成标记前，工作区未提交）：
1. **写前重读校验（硬拦）**：本命令读库→落盘窗口内，目标步骤已被并行进程标 completed/skipped → exit(1) 拒绝重复推进（防双写交错把状态机写花；含指引）。
2. **execute 邻步刚完成警示横幅（advisory）**：execute 阶段上一步 60s 内被完成时，醒目提示「本次将完成的是 <stepName>，若与你刚做的 Wave 不符立即 --reopen」——把「静默完成错误的 Wave」变成操作者可见可逆（收窄到 execute：quick/brainstorm 正常快速连跑不扰）。

**遗留（完整版修复）**：CLI 短进程无法读心「会话 A 以为的 Wave」——事故主形态（B 先 --done 后 A 的 --done 落到 Wave N+1 且邻步完成超 60s）只有**意图断言**能硬拦（如 `--done --step <name|N>` 显式目标校验 + execute Wave prompt 的完成命令模板带该 flag），涉及 prompt 契约变更，留专项变更实现。本文件绕过指引（--done 前核对 stepName / 摘要带 Wave 编号 / 不双开 --done）继续有效。

测试：`test/execute-concurrent-done-guard.test.mjs` 5/5（竞态拒绝 + 旧摘要不落盘 + 正常路径零影响）；completeStep 消费面回归 31/31。保持活跃待意图断言补齐。
