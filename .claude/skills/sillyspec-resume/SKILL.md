---
name: sillyspec:resume
description: 恢复工作 — 从中断处继续
---

## 交互规范

**当需要用户从多个选项中做出选择时，必须使用 Claude Code 内置的 AskUserQuestion 工具，将选项以参数传入。**

不要用编号列表让用户手动输入数字。
如果需要自由输入，在 AskUserQuestion 的选项中加入"Other（自定义输入）"。

你现在是 SillySpec 的恢复管理器。

## 流程

### 1. 读取 progress.json

```bash
sillyspec run resume --status 2>/dev/null
```

### 2. 如果有 progress.json

直接从 progress.json 中提取并展示：

> 🔄 工作状态恢复
>
> **当前变更**：<名称>
> **当前阶段**：<阶段名> <状态>
> **下一步**：<命令>
>
> **阶段进度**（大模块）：
> | 阶段 | 状态 |
> |---|---|
> | stage-1 列表页 | ✅ |
> | stage-2 表单页 | 🔄 execute (2/6) |
> | stage-3 详情页 | ⬜ |
>
> **关键决策**：
> - xxx
>
> **下一步命令**：
> `/sillyspec:execute reward-punishment/stage-2`

**不需要执行 Git 操作或文件探测。** progress.json 已经包含所有信息。

使用 `sillyspec run resume --status` 查看。

然后问用户：
   1. 直接继续执行下一步
   2. 查看更多细节

### 3. 如果没有 progress.json

**不要直接说"没有记录"。** 自动探测项目状态：

```bash
# 检查主变更
ls .sillyspec/changes/*/MASTER.md 2>/dev/null

# 检查活跃变更
ls -d .sillyspec/changes/*/ | grep -v archive | grep -v stages | tail -1 2>/dev/null

# 检查子阶段
ls .sillyspec/changes/*/stages/*/proposal.md 2>/dev/null

# 检查代码库文档
ls .sillyspec/codebase/*.md 2>/dev/null

# 检查计划文件
ls -t .sillyspec/plans/*.md | head -1 2>/dev/null

# 检查需求/路线图
cat .sillyspec/REQUIREMENTS.md 2>/dev/null
cat .sillyspec/ROADMAP.md 2>/dev/null
```

#### 如果检测到 MASTER.md（大模块）

检查各阶段状态并输出阶段进度表（同步骤 2 格式）。

同时**运行 `sillyspec run resume --init`**，将探测到的信息写入 progress.json，后续命令执行时会自动更新。

#### 如果是普通变更（无 MASTER.md）

根据探测结果推断：

| 探测到的文件 | 推断阶段 | 建议操作 |
|---|---|---|
| 无任何 .sillyspec/ 内容 | 未开始 | `/sillyspec:init` 或 `/sillyspec:scan` |
| 有 SCAN-RAW.md 但缺失文档 | 扫描中断 | `/sillyspec:scan --deep`（断点续扫） |
| 有 codebase/ 但文档不全（快扫 3 份缺失） | 快扫中断 | `/sillyspec:scan`（补全缺失文档） |
| 有 codebase/ 7 份齐全但无 changes/ | 已扫描，未开始需求 | `/sillyspec:brainstorm "想法"` |
| 有 REQUIREMENTS.md 但无 changes/ | 绿地项目，已有需求 | `/sillyspec:brainstorm "想法"` |
| changes/ 下有 proposal，无 tasks | 已有规范，待计划 | `/sillyspec:plan` |
| changes/ 下有 tasks，有未完成 checkbox | 执行中 | `/sillyspec:execute` |
| tasks.md 全部完成 | 待验证 | `/sillyspec:verify` |

**扫描中断检测逻辑：**
- 有 `SCAN-RAW.md` → 说明深度扫描预处理已完成，检查 7 份文档缺哪些
- 有部分 codebase 文档（如只有 STACK 和 STRUCTURE）→ 说明快扫或深扫中断
- 缺失的文档列表直接展示给用户，告知 `/sillyspec:scan` 会自动跳过已存在的文档

**同时运行 `sillyspec run resume --init`** 记录推断的状态。

### 4. 关键原则

- **不需要 HANDOFF.json**。progress.json 是唯一的恢复数据源。
- **progress.json 不需要 Git 提交**（已在 .runtime/ 下，被 .gitignore 忽略）。
- **每次命令执行完自动更新 progress.json**（通过 `sillyspec run <stage> --done`），不需要用户手动保存。
