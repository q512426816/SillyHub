---
author: flow-machine-draft
created_at: 2026-10-21T04:01:29.176Z
---
# 任务注册表（Tasks）— 2026-10-21-archive-patch-repair

- [x] task-01: 重写归档 change.patch——`git diff c71b875a1..e88ffddb7 -- <change-file-tree.tsx> <change-file-tree-autorefresh.test.tsx>` 原样落盘，重读比对逐字节一致
- [x] task-02: 修准 change-patch.json——files/totals/scopeAudit.totals/scopeAudit.rows 按 numstat 实数与 planned verdict 修准、剔除他侧两行 doc 条目、新增 repair 注记（保留原错误锚 7f14be0a…）、重算并回写 patchSha256，python 重算比对逐字一致
- [x] task-03: 展示面验证——直调 slice_patch_for_file 断言两源码路径命中（含 syncing hunk）、两 doc 路径返回 None；platform sync --change 2026-10-21-files-refresh-spinner 回执成功
