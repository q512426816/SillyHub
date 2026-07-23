---
name: sillyspec:propose
description: 生成结构化规范 — proposal + design + tasks。适合用户说"生成规范、补全四件套、propose"。产出 proposal.md + design.md + tasks.md（+ 可能的 requirements.md）。
---

## 何时使用

- 用户说"生成规范、补全四件套、propose"
- 已有零散设计/需求，需补全结构化规范四件套
- 产出：`proposal.md` + `design.md` + `tasks.md`（+ 可选 `requirements.md`）

> 注：propose 与 brainstorm 都产出四件套。brainstorm 是从需求开始的完整设计流程；propose 更偏"补全/生成规范"。新需求一般走 brainstorm。

## 多变更说明

项目有多个活跃变更（`.sillyspec/changes/` 下有多个目录）时，所有 `sillyspec run` 命令需加 `--change <变更名>` 指定操作目标；只有一个变更时可省略（CLI 自动检测）。

## 步骤生命周期（所有阶段通用）

> `sillyspec run propose` 需用 `run` 形式（propose 无顶层别名，与 brainstorm/plan 等不同）。

```bash
sillyspec run propose                          # 输出当前步骤 prompt
sillyspec run propose --done --output "摘要"   # 完成当前步骤
sillyspec run propose --status                 # 查看阶段进度
sillyspec run propose --skip                   # 跳过可选步骤
sillyspec run propose --reset                  # 重置阶段（从头开始）
sillyspec run propose --reopen --from-step N   # 重新打开已完成阶段修订
```

## 通用参数（所有阶段适用）

| 参数 | 说明 |
|---|---|
| `--change <名>` | 指定变更名（多活跃变更必填，单变更可省略自动检测） |
| `--spec-dir <path>` | 指定规范目录（默认 `<项目>/.sillyspec`） |
| `--non-interactive` | CI/脚本下禁用交互式 prompt |
| `--skip-approval` | 跳过审批/校验门控 |
| `--json` | 输出 JSON（程序化读取） |

## propose 特有：自检门控

propose 含自检步骤（按规模分级：tier=self 当前 agent 自审 / tier=independent 启动独立审查子代理产出 stage review.json），完成时校验四件套文档齐全 + 内容章节（如 proposal 的 Non-Goals、design 的文件变更清单/风险登记/自审）。缺失会阻断完成。

## 阶段流转

```
(零散设计/需求) → propose → plan
```

propose 完成后（四件套齐 + 自检通过），运行 `sillyspec run plan --change <变更名>` 进入实现计划。

## 铁律

- **必须用 exec 工具（shell）执行 CLI，不要自己编造流程**
- 只做当前步骤 prompt 描述的操作，不跳过
- 产物写入 CLI 输出的 `changeDir` 目录
- 完成后立即 `--done`，不跳过

## 用户指令
$ARGUMENTS
