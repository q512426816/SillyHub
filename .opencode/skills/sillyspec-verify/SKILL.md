---
name: sillyspec:verify
description: 用于验证代码实现是否符合 design 和模块文档。适合用户说"验证下、检查下、跑 verify"。对照 design.md + 模块文档检查任务完成度、设计一致性、运行测试。
---

## 何时使用

- 用户说"验证下、检查下、跑 verify"
- 对照 design.md + 模块文档检查任务完成度
- 设计一致性检查 + 运行测试套件
- 产出 `verify-result.md`（PASS / PASS WITH NOTES / FAIL）

## 多变更说明

项目有多个活跃变更（`.sillyspec/changes/` 下有多个目录）时，所有 `sillyspec run` 命令需加 `--change <变更名>` 指定操作目标；只有一个变更时可省略（CLI 自动检测）。

## 步骤生命周期（所有阶段通用）

> `sillyspec verify` 是 `sillyspec run verify` 的顶层别名，两者等价。

```bash
sillyspec run verify                           # 输出当前步骤 prompt
sillyspec run verify --done --output "摘要"    # 完成当前步骤（--input "用户原话" 记录输入）
sillyspec run verify --status                  # 查看阶段进度
sillyspec run verify --skip                    # 跳过可选步骤
sillyspec run verify --reset                   # 重置阶段（从头开始）
sillyspec run verify --reopen --from-step N    # 重新打开已完成阶段修订（N=序号或名称）
```

## 通用参数（所有阶段适用）

| 参数 | 说明 |
|---|---|
| `--change <名>` | 指定变更名（多活跃变更必填，单变更可省略自动检测） |
| `--spec-dir <path>` | 指定规范目录（默认 `<项目>/.sillyspec`） |
| `--non-interactive` | CI/脚本下禁用交互式 prompt |
| `--skip-approval` | 跳过阶段转换/审批检查（不能跳产物校验 gate——review.json/文档产物硬校验仍在） |

## verify 特有：完成门控（重要）

verify 是只读阶段（**禁止改代码/改 git 状态**，只检查 + 写报告）。

**diff 对账基点**：本变更走 worktree 时，「加载规范并锚定」步骤会注入 worktree 基线锚点（分支名 + `git merge-base` 真实基点）——对照设计做 diff 对账时以它为基点，**不要拿主仓当前 HEAD 当基点**（主仓在 execute 期间可能被并行推进，用错基点会把别人的演进误判为本变更越权改动）。task review 的 base/head 引用分支上的 commit，逐 task 核验用 `git diff <base>..<head>`。完成时有硬校验：

- **必须产出 `verify-result.md`**——不存在则阻断完成（不能跳过报告直接 `--done`）
- **结论为 `FAIL` 则阻断完成**——不能带着 FAIL 标记 verify 完成
- **`integration-critical` / `deployment-critical` 变更**（design/plan 含 daemon/session/lease/lifecycle 等关键词）：结论 PASS WITH NOTES 降级为 FAIL，必须有真实集成证据（Runtime Evidence section）——该证据为 Agent 自报告，CLI 仅校验其字面存在、不独立运行时核验，须真实执行过
- `verify-required-evidence.json`（execute 写入，schema `{items:[{task,verdict,evidence:[]}]}`）中 cannot_verify 任务未在 verify-result.md 体现 → **advisory warn（不阻断归档）**；evidence 是否真满足（satisfied/missing/partial）由 agent 在 verify-result.md 自报告，CLI 只查任务被提及、不替你语义判定。结论能否 PASS 由你诚实判定（有 missing evidence 不应 PASS）。

被阻断时 CLI 打印 ❌ 校验失败，不会提示"验证通过"。修复 `verify-result.md` 后重新 `--done`。

## verify-result.md 格式

> 🔧 **机械探针 + 报告骨架一条命令**：`sillyspec verify-probes --change <变更名> --init`——探针 1（TODO 标记）/3（测试覆盖）/5（API 契约对账）/6（删除对账）CLI 跑完并预填进 verify-result.md 骨架（七章节、已存在不覆盖）；探针 2/4（关键词/决策追踪）与断言抽查、集成盲区标注是语义判断，替换骨架里的 `<!--TODO-->` 完成。结论必须写明 PASS/FAIL——留「待填」会被 gate 判不过。
>
> 🔧 **test/lint 实测对账**：`--done` 时 CLI 亲自执行 local.yaml 的 `commands.test`（实测失败阻断 verify 完成）与 `commands.lint`（advisory 对账，实测失败会明示）——自报告与实测不符时以实测为准，勿谎报跑过。

```markdown
# 验证报告
## 结论
PASS / PASS WITH NOTES / FAIL      ← 必须有结论章节（标题含"结论/Conclusion/Result/结果"即可，不限于确切"## 结论"），FAIL 会阻断 verify 完成
## 任务完成度
## 设计一致性
## 探针结果
## 测试结果
## 变更风险等级
## Runtime Evidence（integration/deployment-critical 必填；自报告，CLI 仅字面校验、不独立核验）
```

## 阶段流转

```
execute → verify → archive
```

verify 通过（PASS）后，运行 `sillyspec run archive --change <变更名>` 归档。FAIL 则修复后重跑 `sillyspec run verify`。

## 铁律

- **必须用 exec 工具（shell）执行 CLI，不要自己编造流程**
- verify 阶段**绝对禁止** git checkout/restore/reset、删除/覆盖源码文件——只检查 + 报告
- 发现问题只报告，不尝试修复（修复回 execute）
- `verify-result.md` 结论必须基于证据，不写"看起来没问题"
- 完成后立即 `--done`，不跳过

## 用户指令
$ARGUMENTS
