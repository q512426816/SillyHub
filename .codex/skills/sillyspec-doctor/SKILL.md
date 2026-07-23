---
name: sillyspec:doctor
description: 用于 SillySpec 自检和状态修复。适合用户说"检查下状态、修复 progress、doctor、状态不对"。全量扫描进度一致性，修复进度数据与实际产出不匹配的问题。
---

## 何时使用

- 用户说"检查下状态、修复 progress、doctor、状态不对"
- 进度数据与实际产出不匹配时自检修复
- 5 步：环境检查 → 项目配置 → 数据库完整性 → 状态一致性 → 修复建议

## 前置检查

**执行任何步骤前，先确认 SillySpec CLI 可用：**

```bash
sillyspec --version
```

失败则提示 `❌ SillySpec CLI 未安装` + 安装命令 `npm install -g sillyspec`，停止。

## 步骤生命周期（所有阶段通用）

> `sillyspec doctor` 是 `sillyspec run doctor` 的顶层别名，两者等价。

```bash
sillyspec run doctor                           # 输出当前步骤 prompt
sillyspec run doctor --done --output "摘要"    # 完成当前步骤
sillyspec run doctor --status                  # 查看阶段进度
sillyspec run doctor --reset                   # 重置阶段（从头开始）
```

## 通用参数（所有阶段适用）

| 参数 | 说明 |
|---|---|
| `--spec-dir <path>` | 指定规范目录（默认 `<项目>/.sillyspec`） |
| `--non-interactive` | CI/脚本下禁用交互式 prompt |
| `--json` | 输出 JSON（程序化读取） |

## doctor 特有

doctor 是辅助阶段，用于诊断而非推进流程。配套的轻量诊断命令（不经 run）：

```bash
sillyspec progress show                        # 查看当前进度
sillyspec progress check                       # 状态一致性检查（只报告，不修复）
sillyspec progress repair                      # 修复状态元数据（dry-run）
sillyspec progress repair --apply              # 真正修复
sillyspec progress validate                    # 校验并修复
sillyspec worktree doctor [--fix]              # worktree 健康检查 + 修复
sillyspec doctor --align-execute-progress --change <name>          # 按 plan.md 声明对齐 execute 派生戳（dry-run，只报告将补哪些 step）
sillyspec doctor --align-execute-progress --change <name> --confirm # 实际落盘：补 step 戳 + 置 execute stage status=completed
```

> `--align-execute-progress` 仅当 `plan.md` 所有 task checkbox 全勾时才对齐 execute 阶段进度戳。典型用于 worktree 已 cleanup（终态）但 execute 派生戳未盖上的死锁。默认 dry-run，加 `--confirm` 才写盘。doctor 信任 `plan.md` 声明、不复核代码，verify 阶段兜底。`--change` 缺省时按单活跃变更自动兜底。

## 铁律

- **必须用 exec 工具（shell）执行 CLI，不要自己编造流程**
- doctor 只诊断和建议，修复操作要让用户确认
- 完成后立即 `--done`，不跳过

## 用户指令
$ARGUMENTS
