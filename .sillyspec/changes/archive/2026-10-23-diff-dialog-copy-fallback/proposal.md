---
author: flow-machine-draft
created_at: 2026-10-23T03:31:55.136Z
---
# 提案书（Proposal）— 2026-10-23-diff-dialog-copy-fallback

## 动机

任务原话转写：变更弹窗超长diff补复制兜底

动机与背景：上一变更 2026-10-23-file-card-agent-grouping 评审留档 P3-1——TurnFileDiffDialog 每段补丁用 DiffView 渲染，超 2000 行时 DiffView 截断脚注提示「完整内容用「复制」按钮」，但弹窗没提供复制按钮，超长 diff 无法取回完整内容。本次补上：每段补丁标题行加常显复制按钮，复制文本由 DiffRow 重建（- / + / 空格前缀），跳过 parseStructuredPatch 插入的 hunk 间「…」分隔伪行（oldNo/newNo 均 null 的 ctx 行），不受 2000 行渲染截断影响。

成功标准：
- 弹窗每段补丁标题行有常显复制按钮（非 hover 才可见），点击复制该段完整 diff 文本
- 复制文本含全部 diff 行（含超过 2000 行渲染上限的部分），hunk 分隔伪行不进入文本
- 无补丁说明态/删除说明态不出现复制按钮
- 相关测试绿（diffRowsToText 纯映射 + 弹窗按钮与复制内容）+ tsc 零错

## 变更范围

按成功标准机械推导，共 4 条验收面：
1. 弹窗每段补丁标题行有常显复制按钮（非 hover 才可见），点击复制该段完整 diff 文本
2. 复制文本含全部 diff 行（含超过 2000 行渲染上限的部分），hunk 分隔伪行不进入文本
3. 无补丁说明态/删除说明态不出现复制按钮
4. 相关测试绿（diffRowsToText 纯映射 + 弹窗按钮与复制内容）+ tsc 零错

## 成功标准（可验证）

1. 弹窗每段补丁标题行有常显复制按钮（非 hover 才可见），点击复制该段完整 diff 文本
2. 复制文本含全部 diff 行（含超过 2000 行渲染上限的部分），hunk 分隔伪行不进入文本
3. 无补丁说明态/删除说明态不出现复制按钮
4. 相关测试绿（diffRowsToText 纯映射 + 弹窗按钮与复制内容）+ tsc 零错
