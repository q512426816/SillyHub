---
author: flow-machine-draft
created_at: 2026-10-21T00:44:22.605Z
---
# 提案书（Proposal）— 2026-10-21-gitlog-quotepath-fix

## 动机

任务原话转写：修复git日志非ASCII路径展示与空diff

动机：daemon git 调用未关 core.quotepath，中文等非 ASCII 路径以 C 引号转义形态透传到前端，目录树显示转义乱码、点击文件 diff 因路径失配恒为空（已在临时仓逐字节实证）。

成功标准：
- gitShow/gitDiffFile/gitStatus 的 git 调用统一带 -c core.quotepath=false，numstat 残余 C 引号路径在 daemon 侧解码为原文
- daemon 单测覆盖中文路径 numstat 解码与 diff pathspec 回查，前端 file-tree 覆盖中文路径聚合
- 实测含中文目录提交：树展示正确中文、点击文件返回非空 diff

## 变更范围

按成功标准机械推导，共 3 条验收面：
1. gitShow/gitDiffFile/gitStatus 的 git 调用统一带 -c core.quotepath=false，numstat 残余 C 引号路径在 daemon 侧解码为原文
2. daemon 单测覆盖中文路径 numstat 解码与 diff pathspec 回查，前端 file-tree 覆盖中文路径聚合
3. 实测含中文目录提交：树展示正确中文、点击文件返回非空 diff

## 成功标准（可验证）

1. gitShow/gitDiffFile/gitStatus 的 git 调用统一带 -c core.quotepath=false，numstat 残余 C 引号路径在 daemon 侧解码为原文
2. daemon 单测覆盖中文路径 numstat 解码与 diff pathspec 回查，前端 file-tree 覆盖中文路径聚合
3. 实测含中文目录提交：树展示正确中文、点击文件返回非空 diff
