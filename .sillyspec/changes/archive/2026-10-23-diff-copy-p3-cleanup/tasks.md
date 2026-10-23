---
author: flow-machine-draft
created_at: 2026-10-23T03:49:04.072Z
---
# 任务注册表（Tasks）— 2026-10-23-diff-copy-p3-cleanup

- [x] task-01: dialog 复制按钮改 CopyButton getText 惰性取值（点击才调用 diffRowsToText）+ 复制内容测试全绿
- [x] task-02: 补丁区脚注补边界说明（行级文本/不含 hunk 头/不可直接 git apply）+ 脚注断言用例
- [x] task-03: 无补丁/删除说明态用例改 findByText 等待说明文案后再断言无按钮
- [x] task-04: 触及面回归——file-changes 全族 + turn-timeline 挂载 vitest 全绿 + tsc 零错 + lint 新增面零警告
