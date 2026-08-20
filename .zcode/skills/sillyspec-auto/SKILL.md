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

## 阶段审核门控（Stage Review Gate）

审核发生在 brainstorm / plan / execute 各阶段的 review 步骤，**分级由 CLI 按变更规模自动判定**（不是 agent 凭关键词或复杂度启发式判断）：

- **tier=self**（变更 ≤3 文件）：当前 agent 自审，直接产 review.json。
- **tier=independent**（变更 >3 文件）：必须派发**独立 QA 子代理**（独立上下文，不共享实现者分析）产 review.json。

CLI 会在 review 步骤注入：完整 JSON schema 表 + 示例 + docHash 算法 + 自动决策 checklist（AC-001 起，逐条核验公共 API / schema / 鉴权 / 文件边界 / 依赖 / 核心模块 / 兼容性 / 业务等维度）。你按**实际注入的契约与 tier 指令**执行：

- checklist 全 ✅ 且方案唯一合理 → AUTO_DECIDED，推进下一阶段
- checklist 有 ❌（影响架构/数据/接口/权限/兼容性/业务）→ 暂停，用 AskUserQuestion 让用户选择

**不要**自行编造"简单/中等/复杂 → N 个审核子代理"规则——审核子代理数量由 tier 决定（self=0 额外子代理，independent=1 个独立 QA），不是复杂度启发式；以 CLI 实际注入的 tier 与 checklist 为准。

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
