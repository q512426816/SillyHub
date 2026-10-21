---
author: flow-machine-draft
created_at: 2026-10-21T01:10:27.665Z
---
# 提案书（Proposal）— 2026-10-21-gitlog-conflict-quotepath

## 动机

任务原话转写：合并冲突链路非ASCII路径quotepath修复

动机：上变更评审 P3-2 指出 gitMerge 冲突链路同根因遗留——_listConflictFiles 的 git diff --name-only 未关 quotepath，中文冲突文件名以 C 引号转义形态进入 conflicts[].file 且后续 readFile 失配致 marker 计数落 catch 归 0，与 2026-10-21-gitlog-quotepath-fix 同款修法收编。

成功标准：
- _listConflictFiles 的 git diff --name-only 调用统一带 -c core.quotepath=false，残余 C 引号形态经 decodeGitCQuote 解码为原文
- daemon 单测覆盖中文冲突文件名解析，真实 git 集成实测中文文件名 merge 冲突：conflicts[].file 为原文且 marker_lines 正确计数
- 跑 git merge 相关既有测试全绿，daemon tsc 零错

## 变更范围

按成功标准机械推导，共 3 条验收面：
1. _listConflictFiles 的 git diff --name-only 调用统一带 -c core.quotepath=false，残余 C 引号形态经 decodeGitCQuote 解码为原文
2. daemon 单测覆盖中文冲突文件名解析，真实 git 集成实测中文文件名 merge 冲突：conflicts[].file 为原文且 marker_lines 正确计数
3. 跑 git merge 相关既有测试全绿，daemon tsc 零错

## 成功标准（可验证）

1. _listConflictFiles 的 git diff --name-only 调用统一带 -c core.quotepath=false，残余 C 引号形态经 decodeGitCQuote 解码为原文
2. daemon 单测覆盖中文冲突文件名解析，真实 git 集成实测中文文件名 merge 冲突：conflicts[].file 为原文且 marker_lines 正确计数
3. 跑 git merge 相关既有测试全绿，daemon tsc 零错
