---
name: sillyspec:commit
description: 智能提交 — 自动收集变更信息，生成 commit message
argument-hint: "[可选：自定义 commit message]"
version: "3.7.32"
---

## 交互规范
当需要用户从多个选项中做出选择时，必须使用 Claude Code 内置的 AskUserQuestion 工具，将选项以参数传入。

## 用法
- /sillyspec:commit — 智能提交：自动收集变更信息，生成 commit message
- /sillyspec:commit "自定义 message" — 使用指定 message 直接提交

## 任务
$ARGUMENTS

---

## 流程

### 1. 收集变更上下文 + 建议 message（一条命令）

```bash
sillyspec commit
```

CLI 已接管全部手工收集（上次 commit 时间过滤 QUICKLOG 条目、活跃变更已勾 task、按路径模式归类阶段产出、diff stat），并按下方 type 表生成建议 message + 可照抄的 `git add -A && git commit -m ...` 命令。**它只建议不提交。**

- 命令输出「没有需要提交的修改」→ 结束。
- 无语义来源匹配（输出会明说）→ 展示 diff stat，让用户自己写。

### 2. 展示确认

把 `sillyspec commit` 的建议 message + 文件统计原样展示给用户（AskUserQuestion）：

选择：确认提交 / 编辑 message / 取消

用户选择编辑 → 让用户输入新 message → 再次确认。

### 3. 执行提交

用户确认后执行 `git add -A` + 输出里给出的 `git commit` 命令（或用户编辑后的 message）。

提交成功后展示 commit hash + 文件数 + 行数统计。

### 参考：message 生成口径（CLI 同源实现，src/commit-suggest.js）

| 来源 | type | 示例 |
|---|---|---|
| 只有 quick 条目 | fix | fix: 手机号校验修复（含正则修正） |
| 只有 execute 已勾 task | feat | feat: <变更名> 完成 task ×N |
| 只有阶段产出 | docs | docs: sillyspec scan 完成 |
| 混合来源 | 取最主要的 type | body 里列出所有条目 |
| 无匹配来源 | — | 展示 diff stat，让用户自己写 |

**如果 $ARGUMENTS 非空**，直接使用用户指定的 message，跳过自动生成，但仍展示 diff stat。

## 多项目
检查修改的文件分别属于哪个子项目：
- 修改集中在一个子项目 → 在该子项目目录中 commit
- 修改跨多个子项目 → 用 AskUserQuestion 让用户选择：分开提交（每个子项目一个 commit）/ 合并提交

## 绝对规则
- ❌ 不要自动提交，必须展示 message 让用户确认
- ❌ 不要丢弃用户的修改
- ✅ $ARGUMENTS 非空时展示 diff stat 后直接提交（不需手动确认）
