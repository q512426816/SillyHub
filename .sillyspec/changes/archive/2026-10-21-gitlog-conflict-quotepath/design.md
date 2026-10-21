---
author: flow-machine-draft
created_at: 2026-10-21T01:10:27.665Z
---
# 设计记录（Design Record）— 2026-10-21-gitlog-conflict-quotepath

## 做法概述

本变更怎么解决问题？改哪里、为什么选这个方案（一两段）。

答：收编上变更（2026-10-21-gitlog-quotepath-fix）评审 P3-2 的同根因遗留：gitMerge 冲突链路 `_listConflictFiles`（host-fs-handler.ts）跑 `git diff --name-only --diff-filter=U` 未关 `core.quotepath`，中文等非 ASCII 冲突文件名以 C 引号转义形态进入 `conflicts[].file`，且后续 `pathResolve(workdir, file)` + readFile 以转义串找文件必失配 → `_countConflictMarkers` 落 catch 归 0，backend 收到「零标记冲突」误导主代理解题。修法与上变更同款、复用其已落地的 `GIT_QUOTEPATH_OFF_ARGS` 常量与 `decodeGitCQuote` 纯函数：冲突列举调用插入参数 + 逐行解码；`gitMerge` 自身 `merge --no-ff` 的 stdout 不做路径解析（错误文案透传），保持最小面不加参。

## 接口契约

动了哪些函数/端点/命令/文件格式？对外可见的签名或行为变化是什么（含「无」的说明）？

答：daemon RPC `git_merge` 返回 `conflicts[].file` 语义变化：由「git 输出原样（可能是 C 引号转义形态）」变为「解码后的仓库内相对路径原文」——缺陷修复非破坏，`MergeConflict` 结构形状不变（file/marker_lines），backend 契约与 HTTP 形状不变。`_listConflictFiles` 为模块内私有方法，调用方仅 gitMerge 一处。其余方法/端点/命令：不变。

## 边界与并发（盲维四问——每问必答，答不了即设计缺口）

1. 乱序/迟到到达：输入或事件乱序时，本设计的假设还成立吗？

答：成立。`git diff --name-only` 单命令同步解析其 stdout，无跨命令流水乱序面；merge 失败后才列举冲突，时序由既有 gitMerge 控制流保证，本次不触及。

2. 并发写：两个执行体同时操作同一数据/文件会发生什么？

答：gitMerge 本身是写操作（merge 落工作树），这是 2026-07-12 变更的既有语义非本次引入；本变更仅在冲突列举的只读调用上加 per-invocation 参数并解码其输出，无新增写面，不改变与 backend converge 流的既有并发边界。

3. 切换/生命周期：会话、请求或变更中途切换/中断时状态是否安全？

答：安全。decodeGitCQuote 无状态纯函数；merge 中断留下的 MERGE_HEAD 等状态由既有 worker converge 流程处置，本次不触及。

4. 作用域：跨工作区/跨仓/多实例时数据会不会串台？

答：不会。per-invocation `-c` 只影响当次命令进程，不写宿主 config、不跨工作区泄漏；解码按 UTF-8 字节组装（git 内部即 UTF-8 存储路径），Windows/Linux/macOS 行为一致。

## 风险与死路

本方案最大的风险是什么？试过但放弃的方案及放弃理由？

答：风险①：`git diff --name-only` 输出按行切，文件名含字面换行仍会断行——但含控制字符的路径 git 恒强制 C 引号包裹（`\n` 被转义为字面 `\n` 两字符），单行假设不破，decodeGitCQuote 同款规则兜底（上变更风险③同机理，GL47 已实证）。风险②：`conflicts[].file` 语义变化对 backend converge_mission 的下游消费是修复性变化（原文路径才能 readFile），若存在依赖「转义形态」的下游断言需同步——检索 backend 侧对 conflicts 的消费为透传给 LLM 提示词，无形态依赖。死路①：不改 `_listConflictFiles` 改为 `git status --porcelain` 解析 U 态——porcelain 输出对特殊字符的引号规则随 `-z` 才关、解析面更大，弃。死路②：沿用上变更已弃的 `--numstat -z` 思路改 `-z`——name-only 的 `-z` 需改 NUL 切分且与既有行式解析不兼容，无收益，弃。

## 文件变更清单

| 操作 | 路径 | 说明 |
|---|---|---|
| 改 | sillyhub-daemon/src/host-fs-handler.ts | _listConflictFiles 冲突列举调用加 `-c core.quotepath=false`，逐行 decodeGitCQuote 解码 |
| 改 | sillyhub-daemon/tests/host-fs-handler-worktree.test.ts | 新增 WT4d：冲突列举命令构造断言 + C 引号中文路径解码进 conflicts[].file |
| 改 | sillyhub-daemon/tests/host-fs-handler-git-log-quotepath.test.ts | 新增真实 git 中文文件名 merge 冲突 describe（原文路径 + marker_lines 计数） |
