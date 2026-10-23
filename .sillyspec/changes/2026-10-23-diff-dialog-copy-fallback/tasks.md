---
author: flow-machine-draft
created_at: 2026-10-23T03:31:55.136Z
---
# 任务注册表（Tasks）— 2026-10-23-diff-dialog-copy-fallback

- [x] task-01: turn-file-diff.ts 新增 diffRowsToText 纯映射（- / + / 空格前缀、hunk 分隔伪行剔除、不截断）+ vitest 单测先行并跑绿
- [x] task-02: TurnFileDiffDialog 每段标题行挂常显复制按钮（daemon CopyButton 覆盖定位，data-testid=turn-file-diff-copy）+ 复制内容/超 2000 行完整性/无补丁态无按钮用例并跑绿
- [x] task-03: 回归面——file-changes 全族 + turn-timeline 挂载 vitest 全绿 + tsc --noEmit 零错 + lint 新增面零警告
