---
author: flow-machine-draft
created_at: 2026-10-21T00:44:22.606Z
---
# 设计记录（Design Record）— 2026-10-21-gitlog-quotepath-fix

## 做法概述

本变更怎么解决问题？改哪里、为什么选这个方案（一两段）。

答：根因是 daemon 五个平名 git 方法执行 `git` 时未关 `core.quotepath`，git 默认把含非 ASCII 字节的路径以 C 引号形态（`"…\345\257\274…"`）输出；该形态经 numstat 解析（`host-fs-handler.ts` gitShow 的 `m[3]` 原样透传，:247 注释明示「保持 git C 引号形态」）→ backend 转发 → 前端 buildFileTree 按 `/` 拆分——引号挂在首尾段、目录名显示八进制转义；前端点击叶子又把带引号转义串当 pathspec 回传 gitDiffFile，git 匹配不到真实路径 → exit 0 空输出 → 前端「（无差异内容）」。修复两层、均在 daemon（backend/frontend 为透传层零改动）：① 命令层——gitShow/gitDiffFile 的 `git show`、gitStatus 的 `status --porcelain=v2` 与 `diff --numstat` 四条会显示路径的调用统一插入 `-c core.quotepath=false`（per-invocation，不污染宿主全局/仓配置；`git remote`/`git fetch` 不显示路径不动）；② 解析层——新增导出纯函数 `decodeGitCQuote`，按 git C 引号规则解码 numstat 路径（八进制 `\NNN` 还原字节后按 UTF-8 组装、`\"`/`\\`/`\a\b\f\n\r\t\v` 标准转义、非引号与畸形形态原样返回），兜住 `quotepath=false` 下 git 对字面 `"`/`\`/控制字符仍强制引号的残余面。选此方案而非 `--numstat -z`：见「风险与死路」死路①。

## 接口契约

动了哪些函数/端点/命令/文件格式？对外可见的签名或行为变化是什么（含「无」的说明）？

答：daemon RPC `git_show` 返回 `files[].path` 语义变化：由「git numstat 输出原样（可能是 C 引号转义形态）」变为「解码后的仓库内相对路径原文」——属缺陷修复而非破坏，原引号形态即本次修复的缺陷面；backend 契约模型（`_DaemonShowFile.path: str`）与 HTTP 响应字段形状不变，前端消费方式不变。daemon 模块新增导出纯函数 `decodeGitCQuote(path: string): string`（供单测直接断言）。`git_log` / `git_refs`（pretty/for-each-ref 输出不含路径名，quotepath 不适用）与 `git remote`/`git fetch` 调用不变。backend / frontend 源码：零改动。

## 边界与并发（盲维四问——每问必答，答不了即设计缺口）

1. 乱序/迟到到达：输入或事件乱序时，本设计的假设还成立吗？

答：成立。每条 RPC 独立执行单条 git 命令并同步解析其 stdout，无跨命令流水的乱序面；RPC 层乱序/超时/断连由既有 502/504 链路兜底，本次不触及。

2. 并发写：两个执行体同时操作同一数据/文件会发生什么？

答：不适用（无写面）。五个 git 方法全只读，`-c` 仅作用于当次子进程，无共享状态；多 daemon 实例并发执行互不影响。

3. 切换/生命周期：会话、请求或变更中途切换/中断时状态是否安全？

答：安全。decodeGitCQuote 为无状态纯函数，git 子进程随调用生灭；daemon 重启/重连不携带任何本次新增状态。

4. 作用域：跨工作区/跨仓/多实例时数据会不会串台？

答：不会。per-invocation `-c` 只影响当次命令进程，不写宿主 git config、不跨工作区/跨仓泄漏；中文路径按 UTF-8 字节解码（git 内部即 UTF-8 存储路径），Windows/Linux/macOS 宿主行为一致。

## 风险与死路

本方案最大的风险是什么？试过但放弃的方案及放弃理由？

答：死路①（已试已弃）：改用 `git show --numstat -z` 按 NUL 切分原文路径——`-z` 在 `git show`（log 族）语境同时是「提交分隔符」语义，与 `--pretty=format:` 混用行为含混，且需重写 numstat 两段式分区解析，相对 `-c core.quotepath=false` + 解码兜底无额外收益，弃。风险①：路径含非法 UTF-8 字节序列时 `Buffer.from(bytes).toString('utf8')` 产生 U+FFFD 替换符——防御性行为可接受（git 真实输出不会出现：路径字节即提交时的合法编码）。风险②：既有命令构造断言用例按 args 位置逐 token 断言（GL25/GL29/GL37/GL42/GL43/GL45），插入 `-c` 对后需同步更新索引——漏更即测试红，已列入 task-01 验证面。风险③：porcelain/diff 加 `quotepath=false` 后含换行的文件名仍被 git 强制引号包裹（控制字符恒转义），单行解析假设不破——decodeGitCQuote 同款规则保证。

## 文件变更清单

| 操作 | 路径 | 说明 |
|---|---|---|
| 改 | sillyhub-daemon/src/host-fs-handler.ts | gitShow/gitDiffFile/gitStatus(status/diff) 加 `-c core.quotepath=false`；新增导出 decodeGitCQuote；numstat path 解码 |
| 改 | sillyhub-daemon/tests/host-fs-handler-git-log.test.ts | 既有 args 索引断言更新（GL25/29/37/42/43/45）；新增 GL46~GL48（命令构造 quotepath / decodeGitCQuote 纯函数 / 中文引号路径 numstat 解码） |
| 新 | sillyhub-daemon/tests/host-fs-handler-git-log-quotepath.test.ts | 不 mock execFile 的真实 git 集成测试：临时真实仓中文目录提交 → gitShow 解码 + gitDiffFile 回查非空 diff |
| 改 | frontend/src/components/git-log/__tests__/file-tree.test.tsx | 新增中文路径聚合 + 点击发起中文 path 请求用例 |
