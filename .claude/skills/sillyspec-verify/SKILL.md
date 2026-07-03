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
| `--skip-approval` | 跳过审批/校验门控（需明确意图） |
| `--json` | 输出 JSON（程序化读取） |

## verify 特有：完成门控（重要）

verify 是只读阶段（**禁止改代码/改 git 状态**，只检查 + 写报告）。完成时有硬校验：

- **必须产出 `verify-result.md`**——不存在则阻断完成（不能跳过报告直接 `--done`）
- **结论为 `FAIL` 则阻断完成**——不能带着 FAIL 标记 verify 完成
- **`integration-critical` / `deployment-critical` 变更**（design/plan 含 daemon/session/lease/lifecycle 等关键词）：结论 PASS WITH NOTES 降级为 FAIL，必须有真实集成证据（Runtime Evidence section）
- `verify-required-evidence.json`（execute 写入）中每条 missing evidence → 阻断

被阻断时 CLI 打印 ❌ 校验失败，不会提示"验证通过"。修复 `verify-result.md` 后重新 `--done`。

## verify-result.md 格式

```markdown
# 验证报告
## 结论
PASS / PASS WITH NOTES / FAIL      ← 必须有此章节，FAIL 会阻断 verify 完成
## 任务完成度
## 设计一致性
## 探针结果
## 测试结果
## 变更风险等级
## Runtime Evidence（integration/deployment-critical 必填）
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
