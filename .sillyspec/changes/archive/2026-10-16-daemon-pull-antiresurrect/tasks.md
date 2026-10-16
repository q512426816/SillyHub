---
author: flow-machine-draft
created_at: 2026-10-16T12:31:51.997Z
---
# 任务注册表（Tasks）— 2026-10-16-daemon-pull-antiresurrect

- [x] task-01: pullSpecBundle 落地前按 LocalManifest 算「本地已删面」（manifest 有/盘面无/属同步面），解包产物命中文件不落地，swap 与 in-place 兜底两路径均不复活
- [x] task-02: manifest 缺失/解析失败/首拉 = 无抑制面，既有全量回放行为不变
- [x] task-03: 命中面 warn 点名（截断 5）+ 恢复通道（PullSpecBundleOptions.restoreDeleted 或环境变量 SILLYHUB_DAEMON_RESTORE_DELETED=1 跳过抑制）
- [x] task-04: 抑制不破坏既有回写语义（删除 op 上行成功后 manifest 不再含该路径，抑制面自然衰减）
- [x] task-05: vitest 新用例覆盖抑制/无基线全量/恢复通道/排除口径四点，既有测试零回归，tsc 通过
