---
author: qinyi
created_at: 2026-07-03T00:02:40
---

# 多变更环境 `quick --done` 触发交互式 prompt 阻塞自动化

## 现象

项目存在多个活跃变更（`.sillyspec/changes/` 或平台模式 specDir 下有多个变更目录）时，
`sillyspec run quick --done --output "..."` 会弹出 inquirer select 交互 prompt：

```
🔗 检测到多个活跃变更，选择本次 quick 关联哪些（可多选；不勾选任何项 = 仅记 QUICKLOG，不关联变更）
❯◯    2026-07-02-xxx
 ◯    default
```

在非交互环境（CI、脚本、Bash 工具管道、stdin 关闭）下，prompt 无法响应，
进程收到 stdin EOF 后抛 `ExitPromptError: User force closed the prompt`，`--done` 失败、
阶段不推进。

## 复现

- 平台模式（specDir 在 `~/.sillyhub/.../changes/`），下有 `default` + 至少一个其他变更
- 执行 `sillyspec run quick --done --output "..."`（无 stdin 喂入）

## 规避

管道喂一个回车 = 空选择 = 仅记 QUICKLOG 不关联变更：

```bash
printf "\n" | sillyspec run quick --done --output "摘要"
```

注意：`--done --change <name>` **不能**用来绕过 —— memory `sillyspec-quick-done-change-resets`
记录该写法会重置 step（重新打印 Step1 完成 + Step2）。

## 建议（改进点）

- CLI 增加 `--no-interact` 或 `--associate none|<change>` 参数，显式跳过交互；
- 或检测 stdin 非 TTY 时默认「不关联」并继续，而非崩溃；
- 当前 `--change` 语义（重置 step）与「指定关联变更」的直觉冲突，建议一并梳理。
