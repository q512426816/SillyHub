---
name: sillyspec:scan
description: 用于扫描项目代码库，生成架构文档、代码约定、目录结构等。适合用户说"扫描项目、分析代码库、生成文档、scan"。产出 7 份扫描文档 + 模块映射。
---

## 何时使用

- 用户说"扫描项目、分析代码库、生成文档、scan"
- 棕地项目首次接入 sillyspec，生成架构/约定/结构等基础文档
- 产出 7 份 scan 文档（PROJECT/ARCHITECTURE/CONVENTIONS/STRUCTURE/INTEGRATIONS/TESTING/CONCERNS）+ 模块映射

## 多变更说明

scan 是辅助阶段，通常不需要 `--change`。但项目有多个活跃变更时，所有 `sillyspec run` 命令加 `--change <变更名>` 可指定操作目标。

## 步骤生命周期（所有阶段通用）

> `sillyspec scan` 是 `sillyspec run scan` 的顶层别名，两者等价。

```bash
sillyspec run scan                             # 输出当前步骤 prompt
sillyspec run scan --done --output "摘要"      # 完成当前步骤
sillyspec run scan --status                    # 查看阶段进度
sillyspec run scan --skip                      # 跳过可选步骤
sillyspec run scan --reset                     # 重置阶段（从头开始）
```

## 通用参数（所有阶段适用）

| 参数 | 说明 |
|---|---|
| `--spec-dir <path>` | 指定规范目录（默认 `<项目>/.sillyspec`） |
| `--non-interactive` | CI/脚本下禁用交互式 prompt |
| `--skip-approval` | 跳过审批/校验门控 |
| `--json` | 输出 JSON（程序化读取） |

## scan 特有参数

| 参数 | 说明 |
|---|---|
| `--deep` | 强制 deep 扫描 profile（完整流程，不按规模裁剪） |
| `--force-rescan` | 覆盖已有 scan 文档的保护（默认覆盖需 source_commit/updated_at 匹配） |

### scanProfile（按项目规模自动裁剪）

CLI 根据源码规模自动选择 profile，无需手动指定：

| profile | 触发条件 | 行为 |
|---|---|---|
| quick | ≤30 文件 且 ≤80KB 且 ≤3 项目 | 3 步，0 子代理，5 份核心文档 |
| standard | ≤200 文件 且 ≤800KB | 压缩步骤，最多 1 子代理 |
| deep | 大项目或 `--deep` | 完整流程 |

### post-check

scan 完成时 CLI 自动校验 7 份文档齐全。缺失会设状态为 `failed_post_check`，阻断进入主流程下游（brainstorm/plan 等），需修复后重跑 scan。

## 阶段流转

```
(项目起点) → scan → brainstorm
```

scan 完成后，运行 `sillyspec run brainstorm "<需求>"` 开始具体变更的设计。

## 铁律

- **必须用 exec 工具（shell）执行 CLI，不要自己编造流程**
- 只做当前步骤 prompt 描述的操作，不跳过
- scan 文档写入 `{DOCS_ROOT}/scan/`（平台模式用占位符路径，不写裸 `.sillyspec/`）
- 完成后立即 `--done`，不跳过

## 用户指令
$ARGUMENTS
