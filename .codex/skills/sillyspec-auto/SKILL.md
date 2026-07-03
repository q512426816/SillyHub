---
name: sillyspec:auto
description: 自动模式 — 全流程自动推进（通用版）
argument-hint: "<需求描述>"
---

## 交互规范

**当需要用户从多个选项中做出选择时，必须使用 Claude Code 内置的 AskUserQuestion 工具，将选项以参数传入。** 不要用编号列表让用户手动输入数字。

## 用法

- `/sillyspec:auto 实现用户登录功能`
- `/sillyspec:auto 修复搜索结果的排序问题`

## 任务
$ARGUMENTS

---

## 执行流程

你是全流程编排器，按 brainstorm → plan → execute → verify 顺序自动推进。

### 启动

```bash
sillyspec run auto --input "<用户需求>" [--mode <模式>]
```

2. 读取 CLI 输出的 step prompt（含角色描述）
3. 执行 prompt 中的操作
4. **记录 CLI 输出中显示的 Change 名称**（如 `Change: 2026-06-02-xxx`）

### 步骤循环

重复以下循环直到 CLI 输出"全部流程已完成"：

1. **读取 CLI 输出的 step prompt**
2. **判断是否需要用户确认：**
   - prompt 含"请用户选择 / 等待用户回答 / 展示给用户 / 用户确认" → **暂停，等用户回复**
   - 纯内部操作 → **直接执行**
3. **执行 prompt 要求的操作**
4. **完成后运行：**
   ```bash
   sillyspec run auto --done --change <变更名> --output "<你的摘要>"
   ```
   - ⚠️ **必须携带 `--change <变更名>`**，变更名来自启动时 CLI 输出的 `Change:` 字段
   - **绝不使用 `--change default`**，除非 CLI 启动时明确显示的 Change 名称就是 `default`
5. **读取 CLI 输出的下一步 prompt**，回到步骤 1

### auto 参数

| 参数 | 说明 |
|---|---|
| `--input "<需求>"` | 启动时传入用户需求 |
| `--mode <模式>` | 显式指定流程模式（默认按复杂度自动分类） |
| `--done --change <名> --output "..."` | 完成当前步骤（必带 --change） |
| `--spec-dir <path>` | 指定规范目录 |
| `--non-interactive` | CI/脚本下禁用交互 |

## 阶段审核门控

**brainstorm 完成后**，评估需求复杂度（基于 design.md 的模块拆分、批量操作、多角色交互特征）：

| 复杂度 | 审核策略 |
|--------|---------|
| 简单（无拆分、无批量） | 不审核，直接进入 plan |
| 中等（有拆分或批量） | 启动 1 个审核子代理（QA 视角）审查 design.md |
| 复杂（拆分 + 批量/多角色） | 启动 2-3 个审核子代理多角度审查 |

多角度审核子代理分工：
- **架构师** — 设计合理性、技术选型 trade-off、模块划分
- **安全专家** — 安全隐患、权限设计、数据校验
- **QA 专家** — 需求覆盖率、边界场景、验收标准

审核流程：暂停提示复杂度 → 用户确认 → 启动子代理读 design/requirements/tasks → 汇总问题 → 询问是否修改 → 需要则修复重审，不需要则进下一阶段。

**plan 完成后**，同样评估复杂度启动审核（项目经理审拆解粒度、工程师审可行性、QA 审验收标准）。

## 关键规则

- 不要跳过任何步骤
- 不要手动修改进度数据（SQLite 数据库）
- 不要自动 commit，只 `git add`
- 不要使用 npx
- 不要编造不存在的 CLI 子命令
- 遇到命令报错 → 展示错误，暂停等用户介入
- **每次 `sillyspec run auto --done` 都必须携带 `--change <变更名>`**（= CLI 首次输出的 Change 名）

## 异常处理

- 命令执行失败 → 展示错误信息，暂停等待用户指示
- 用户说"停止"/"暂停" → 立即停止，报告当前进度

## 完成条件

CLI 输出"全部流程已完成"后，输出完整流程总结，提示用户提交改动（`/sillyspec:commit`）。
