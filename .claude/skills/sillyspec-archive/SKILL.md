---
name: sillyspec:archive
description: 用于归档已验证完成的变更。适合用户说"归档、archive、收尾这个变更"。执行模块影响分析 + 同步模块文档 + 移动到 archive 目录 + 更新 ROADMAP。
---

## 何时使用

- 用户说"归档、archive、收尾这个变更"
- verify 已通过，把变更包归档沉淀
- 5 步：任务完成度检查 → 模块影响分析 → 同步模块文档 → 确认归档 → 更新路线图

## 多变更说明

项目有多个活跃变更（`.sillyspec/changes/` 下有多个目录）时，所有 `sillyspec run` 命令需加 `--change <变更名>` 指定操作目标；只有一个变更时可省略（CLI 自动检测）。

## 步骤生命周期（所有阶段通用）

> `sillyspec archive` 是 `sillyspec run archive` 的顶层别名，两者等价。

```bash
sillyspec run archive                          # 输出当前步骤 prompt
sillyspec run archive --done --output "摘要"   # 完成当前步骤
sillyspec run archive --status                 # 查看阶段进度
sillyspec run archive --skip                   # 跳过可选步骤
sillyspec run archive --reset                  # 重置阶段（从头开始）
sillyspec run archive --reopen --from-step N   # 重新打开已完成阶段修订（N=序号或名称）
```

## 通用参数（所有阶段适用）

| 参数 | 说明 |
|---|---|
| `--change <名>` | 指定变更名（多活跃变更必填，单变更可省略自动检测） |
| `--spec-dir <path>` | 指定规范目录（默认 `<项目>/.sillyspec`） |
| `--non-interactive` | CI/脚本下禁用交互式 prompt |
| `--skip-approval` | 跳过审批/校验门控（需明确意图） |
| `--json` | 输出 JSON（程序化读取） |

## archive 特有

### `--confirm`（确认归档步骤必填）

第 4 步「确认归档」由 CLI 执行目录移动，**必须带 `--confirm`**：

```bash
sillyspec run archive --done --confirm --output "确认归档"
```

不带 `--confirm` 时 CLI 回退步骤为 pending 并提示，不会误归档。

### 归档前硬校验

CLI 移动目录前会校验 `plan.md` 存在——缺失则 `exit(1)` 阻断（目录尚未移动，可补全后重试）。移动后校验 `design.md` / `module-impact.md`（缺失只告警，因目录已移动）。

### 模块文档同步（第 3 步）

第 3 步「sync-module-docs」会更新 `_module-map.yaml` + 模块卡片，**必须暂停等用户确认**：

```bash
sillyspec run archive --wait --reason "等待用户确认模块文档同步" --options "确认写入,跳过同步" --output "diff 摘要"
sillyspec run archive --continue --answer "确认写入"
```

只有用户 `--continue --answer "确认写入"` 后才写入文件。

### 归档结果

归档后变更目录从 `changes/<名>/` 移到 `changes/archive/YYYY-MM-DD-<名>/`，并从活跃列表注销。后续用 `/sillyspec:commit` 提交。

## 阶段流转

```
verify → archive → git commit
```

archive 完成后，运行 `/sillyspec:commit` 提交归档结果（`git add .sillyspec/changes/`）。

## 铁律

- **必须用 exec 工具（shell）执行 CLI，不要自己编造流程**
- 不要用 `mv`/`rename` 重命名变更目录，必须由 CLI 的「确认归档」步骤移动
- 归档不可逆——确认前核对变更名、文件列表、module-impact.md
- 完成后立即 `--done`，不跳过

## 用户指令
$ARGUMENTS
