---
name: sillyspec:execute
description: 用于按 plan 执行代码实现。适合用户说"开始写代码、执行任务、跑 execute、开干"。按 plan.md 中的 Wave 和 Task 逐步实现，遵循 design.md 和模块文档。
---

## 何时使用

- 用户说"开始写代码、执行任务、跑 execute、开干"
- 按 plan.md 的 Wave 分组和 Task 逐步实现代码
- 遵循 design.md + 模块文档 + CONVENTIONS.md

## 多变更说明

项目有多个活跃变更（`.sillyspec/changes/` 下有多个目录）时，所有 `sillyspec run` 命令需加 `--change <变更名>` 指定操作目标；只有一个变更时可省略（CLI 自动检测）。

## 步骤生命周期（所有阶段通用）

> `sillyspec execute` 是 `sillyspec run execute` 的顶层别名，两者等价。

```bash
sillyspec run execute                          # 输出当前步骤 prompt（首次自动创建 worktree）
sillyspec run execute --done --output "摘要"   # 完成当前步骤（--input "用户原话" 记录输入）
sillyspec run execute --status                 # 查看阶段进度
sillyspec run execute --skip                   # 跳过可选步骤
sillyspec run execute --reset                  # 重置阶段（从头开始）
sillyspec run execute --reopen --from-step N   # 重新打开已完成阶段修订（N=序号或名称）
```

## 通用参数（所有阶段适用）

| 参数 | 说明 |
|---|---|
| `--change <名>` | 指定变更名（多活跃变更必填，单变更可省略自动检测） |
| `--spec-dir <path>` | 指定规范目录（默认 `<项目>/.sillyspec`） |
| `--non-interactive` | CI/脚本下禁用交互式 prompt |
| `--skip-approval` | 跳过审批/校验门控（需明确意图） |
| `--json` | 输出 JSON（程序化读取） |

## execute 特有：Worktree 隔离

- CLI 启动 execute 阶段时**自动创建 git worktree**，AI 不需要手动创建
- worktree 路径在步骤 prompt 中输出（`worktreePath`），后续子代理的 cwd 必须设为该路径
- **禁止跳过 worktree 或在主仓库直接写代码**
- worktree 创建失败时 CLI 报错退出，排查后重试
- dirty 状态/未提交文件**不影响** worktree 创建和进入，直接按 CLI 输出的路径操作，不要自行检查 git 状态

### 依赖门控（depsStatus）

`--done` 时 CLI 校验 worktree 的依赖状态（`depsStatus`）。不达标会阻断完成并提示：

```bash
# 修复依赖供给
sillyspec worktree doctor --fix --change <变更名>
```

`linked / installed / n/a` 放行；`missing / stale / failed / unknown` 阻断。Wave 内所有 task 声明 `no_deps_verify: true` 时可 opt-out。

### Task Review Gate

execute 完成时，每个 task 必须有 `review.json` 且 verdict 通过，否则阻断完成。`cannot_verify` 的 task 会写入 `verify-required-evidence.json`，由 verify 阶段消费。

## worktree 子命令（execute 相关）

```bash
sillyspec worktree apply <变更名>              # 校验并应用 worktree 变更到主工作区
sillyspec worktree apply <变更名> --check-only # 只检查不应用
sillyspec worktree assess <变更名>             # 风险审计 + 自动 apply
sillyspec worktree list                        # 列出所有活跃 worktree
sillyspec worktree meta <变更名>               # 读取 worktree meta.json
sillyspec worktree cleanup <变更名>            # 清理 worktree
sillyspec worktree doctor [--fix]              # 健康检查 + 修复
```

## 阶段流转

```
plan → execute → verify
```

execute 完成后（所有 Wave/task 完成 + Task Review Gate 通过），运行 `sillyspec run verify --change <变更名>` 验证。

## 铁律

- **必须用 exec 工具（shell）执行 CLI，不要自己编造流程**
- 你是执行者不是设计师——按 plan 搬砖，发现 plan 不合理就停下来反馈，不自己改方案
- 子代理 cwd 必须用 CLI 输出的 worktreePath
- 完成后立即 `--done`，不跳过

## 用户指令
$ARGUMENTS
