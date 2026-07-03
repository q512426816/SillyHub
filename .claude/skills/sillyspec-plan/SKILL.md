---
name: sillyspec:plan
description: 用于把 design 拆解为可执行的实现计划。适合用户说"拆任务、做计划、排 wave、规划实现步骤"。产出 plan.md（Wave 分组 + Task 列表 + 依赖关系）。
---

## 何时使用

- 用户说"拆任务、做计划、排 wave、规划实现步骤"
- 把 brainstorm 的 design.md 拆成可执行的 Wave + Task
- 产出：`plan.md`（Wave 分组 + Task 列表 + 依赖关系），可能含 `tasks/task-NN.md` 任务蓝图

## 多变更说明

项目有多个活跃变更（`.sillyspec/changes/` 下有多个目录）时，所有 `sillyspec run` 命令需加 `--change <变更名>` 指定操作目标；只有一个变更时可省略（CLI 自动检测）。

## 步骤生命周期（所有阶段通用）

> `sillyspec plan` 是 `sillyspec run plan` 的顶层别名，两者等价。

```bash
sillyspec run plan                             # 输出当前步骤 prompt
sillyspec run plan --done --output "摘要"      # 完成当前步骤（--input "用户原话" 记录输入）
sillyspec run plan --status                    # 查看阶段进度
sillyspec run plan --skip                      # 跳过可选步骤
sillyspec run plan --reset                     # 重置阶段（从头开始）
sillyspec run plan --reopen --from-step N      # 重新打开已完成阶段修订（N=序号或名称）
sillyspec run plan --wait --reason "..." --options "A,B"   # 暂停等用户决策
sillyspec run plan --continue --answer "..."               # 恢复等待中的步骤
sillyspec run plan --done --answer "..." --output "..."    # 一步完成 wait+done
```

## 通用参数（所有阶段适用）

| 参数 | 说明 |
|---|---|
| `--change <名>` | 指定变更名（多活跃变更必填，单变更可省略自动检测） |
| `--spec-dir <path>` | 指定规范目录（默认 `<项目>/.sillyspec`） |
| `--non-interactive` | CI/脚本下禁用交互式 prompt |
| `--interactive` | 强制交互（即便 stdin 非 TTY） |
| `--skip-approval` | 跳过审批/校验门控（需明确意图） |
| `--json` | 输出 JSON（程序化读取） |

## plan 特有

### 动态步骤

plan 的步骤是动态的：`generate_plan` 步骤完成后，CLI 会从刚生成的 `plan.md` 解析出 task，自动插入"任务蓝图协调器"步骤（per-task）。这是正常行为，不要手动添加。

### 契约门控（阻断完成）

- **plan 启动前**：CLI 校验 `design.md` 是否满足 plan 契约（缺文件变更清单/风险登记/自审章节会阻断）。若失败需先 `sillyspec run brainstorm --reopen --from-step N` 修订设计。
- **plan 完成时**：CLI 校验 `plan.md` 是否满足 execute 契约（Wave 结构、task 引用等）。失败会阻断完成，提示修复后重新 `--done`。

### 生产接线路径检查

plan 完成校验会检查：design 提到入口文件（cli.ts/main.ts/server.ts 等）但 task 的 allowed_paths 不含该文件 → 报 error。若确实不需要改入口，在 design.md 明示理由。

## 阶段流转

```
brainstorm → plan → execute
```

plan 完成后（plan.md 通过 execute 契约校验），运行 `sillyspec run execute --change <变更名>` 开始实现。

## 铁律

- **必须用 exec 工具（shell）执行 CLI，不要自己编造流程**
- 只做当前步骤 prompt 描述的操作，不跳过、不自行扩展
- plan.md 是任务完成的唯一真相源，task 拆解粒度要均匀、依赖要明确
- 完成后立即 `--done`，不跳过

## 用户指令
$ARGUMENTS
