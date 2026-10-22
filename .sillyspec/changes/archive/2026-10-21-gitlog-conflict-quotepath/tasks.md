---
author: flow-machine-draft
created_at: 2026-10-21T01:10:27.665Z
---
# 任务注册表（Tasks）— 2026-10-21-gitlog-conflict-quotepath

- [x] task-01: _listConflictFiles 的 git diff --name-only 调用统一带 -c core.quotepath=false，残余 C 引号形态经 decodeGitCQuote 解码为原文
- [x] task-02: daemon 单测覆盖中文冲突文件名解析，真实 git 集成实测中文文件名 merge 冲突：conflicts[].file 为原文且 marker_lines 正确计数
- [x] task-03: 跑 git merge 相关既有测试全绿，daemon tsc 零错
