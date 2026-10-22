---
author: flow-machine-draft
created_at: 2026-10-21T00:44:22.606Z
---
# 任务注册表（Tasks）— 2026-10-21-gitlog-quotepath-fix

- [x] task-01: daemon host-fs-handler.ts——gitShow/gitDiffFile 的 show 调用与 gitStatus 的 status/diff 调用加 `-c core.quotepath=false`，新增导出 decodeGitCQuote 并在 numstat path 解码处应用；同步更新既有 args 索引断言（GL25/29/37/42/43/45）。验证：sillyhub-daemon vitest 全绿
- [x] task-02: 单测补齐——daemon 既有 mock 文件新增 GL46（命令构造含 quotepath）/GL47（decodeGitCQuote 五形态）/GL48（中文引号路径 numstat 解码）；前端 file-tree.test.tsx 新增中文路径聚合与点击用例。验证：daemon + 前端 vitest 全绿
- [x] task-03: 真实 git 实测——新建不 mock execFile 的 host-fs-handler-git-log-quotepath.test.ts（真实临时仓含中文目录真实提交：gitShow 解码路径逐字符相等 + gitDiffFile 回查非空 diff）；daemon tsc --noEmit 零错。验证：集成测试绿 + tsc 零错
