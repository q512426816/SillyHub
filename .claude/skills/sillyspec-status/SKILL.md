---
name: sillyspec:status
description: 用于查看 SillySpec 当前进度和状态。适合用户说"看下状态、当前进度、status"。显示当前阶段、步骤完成度、活跃变更。
---

## 何时使用

- 用户说"看下状态、当前进度、status"
- 查看项目整体进度：活跃变更、各阶段状态、步骤完成度

## status vs state 分工

- **`/sillyspec:status`**（本 skill）— 查看项目整体进度（change 文件级别、各阶段状态）。走 `sillyspec run status` 阶段。
- **`/sillyspec:state`** — 查看当前工作状态（阶段/步骤级别、下一步建议）。走 `sillyspec progress show`。

两者互补：status 看"有什么"，state 看"在做什么"。

## 多变更说明

status 是辅助阶段。项目有多个活跃变更时，加 `--change <变更名>` 查看指定变更的详情；不指定时汇总显示所有变更。

## 步骤生命周期（所有阶段通用）

> `sillyspec status` 是 `sillyspec run status` 的顶层别名，两者等价。status 是辅助阶段，只读。

```bash
sillyspec run status                           # 输出当前步骤 prompt
sillyspec run status --done --output "摘要"    # 完成阶段
sillyspec run status --status                  # 查看阶段状态
```

## 通用参数（所有阶段适用）

| 参数 | 说明 |
|---|---|
| `--change <名>` | 指定变更名（多变更时查看指定变更详情） |
| `--spec-dir <path>` | 指定规范目录（默认 `<项目>/.sillyspec`） |
| `--json` | 输出 JSON（程序化读取） |

## 配套的只读查询命令（不经 run）

```bash
sillyspec progress show                        # 当前工作状态（阶段/步骤级）
sillyspec progress show --change <名>          # 指定变更详情
sillyspec progress check                       # 状态一致性检查
```

## 铁律

- status 是只读阶段，**不修改任何文件**
- **必须用 exec 工具（shell）执行 CLI**
- 完成后立即 `--done`，不跳过

## 用户指令
$ARGUMENTS
