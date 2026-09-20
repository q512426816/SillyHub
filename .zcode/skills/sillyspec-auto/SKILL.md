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

按 brainstorm → plan → execute → verify 顺序自动推进；**编排由 CLI driver 承担，你只执行判断步**。

### 启动

```bash
sillyspec run auto --input "<用户需求>" [--mode <模式>]
```

零活跃变更时 CLI 自动创建（也可 `--change <名>` 指定）；多活跃变更 CLI 会列出候选要求显式指定。单活跃自动选中并回显，无需记忆/传递变更名。

### 每步循环（唯一纪律）

1. 跑 CLI 给出的命令（启动时是上面的 run auto；此后每步读上一步输出尾部的 **SS-META 块**）。
2. 读 prompt 尾部机器可读元数据块：

   ```
   <!--SS-META:{"stage":...,"requiresUser":true|false,"doneCommand":"...","waitHint":"..."}-->
   ```

3. 按块驱动：
   - `requiresUser=true` → 本步需要用户输入：按 prompt 的 wait 指令先展示选项，取得用户回答后走 `--continue --answer`，再 `--done`（用户在终端且带 `--wait-interactive` 时 CLI 会直接 readline 收，无需转抄）。
   - `requiresUser=false` → 执行本步任务（设计/实现/审查等判断工作），完成后**逐字执行 `doneCommand`**（`--output "你的摘要"` 换成真实一句话摘要）。
4. CLI 会在阶段边界自动流转（gate 不过会给出修复指引——修完重跑，进度不丢）。

### 终止

**CLI 打印「流程收尾总结」分隔线块（变更/阶段/任务勾选/产物清单）即全流程完成**——不要自行判断完成、不要自撰总结。CLI 若提示「全部流程已完成」（All auto flow stages are complete）同义。

### 边界

- 中断恢复：直接重跑 `sillyspec run auto`（进度已落盘，从断点续）。
- 分类为 quick 的小变更：CLI 会提示改跑 `sillyspec run quick`，照提示执行。
