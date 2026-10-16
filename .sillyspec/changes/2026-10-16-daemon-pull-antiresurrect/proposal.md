---
author: flow-machine-draft
created_at: 2026-10-16T12:31:51.997Z
---
# 提案书（Proposal）— 2026-10-16-daemon-pull-antiresurrect

## 动机

任务原话转写：移植 sillyspec CLI 防复活抑制到本仓 sillyhub-daemon：CLI 侧 da8d2449 已修 pullSpecBundle 回放复活（基线定已删面+跳过+恢复通道），daemon「按 spec_version 自动取新」（心跳预取/lease/batch 三入口共用 pullSpecBundle）存在同款路径——hasUnsyncedLocalChanges 的 mtime/pending 信号漏判纯删除（删除不产生新 mtime），删除未上行窗口内自动拉取整树覆盖（swap/in-place 兜底）把已删文件写回=复活。移植判据用现成 LocalManifest（pull/push 后回写=上次成功同步文件全集，删除上行成功自然衰减），过滤同 isUploadExcludedPath 口径。

成功标准：
- pullSpecBundle 落地前按 LocalManifest 算「本地已删面」（manifest 有/盘面无/属同步面），解包产物命中文件不落地，swap 与 in-place 兜底两路径均不复活
- manifest 缺失/解析失败/首拉 = 无抑制面，既有全量回放行为不变
- 命中面 warn 点名（截断 5）+ 恢复通道（PullSpecBundleOptions.restoreDeleted 或环境变量 SILLYHUB_DAEMON_RESTORE_DELETED=1 跳过抑制）
- 抑制不破坏既有回写语义（删除 op 上行成功后 manifest 不再含该路径，抑制面自然衰减）
- vitest 新用例覆盖抑制/无基线全量/恢复通道/排除口径四点，既有测试零回归，tsc 通过

## 变更范围

按成功标准机械推导，共 5 条验收面：
1. pullSpecBundle 落地前按 LocalManifest 算「本地已删面」（manifest 有/盘面无/属同步面），解包产物命中文件不落地，swap 与 in-place 兜底两路径均不复活
2. manifest 缺失/解析失败/首拉 = 无抑制面，既有全量回放行为不变
3. 命中面 warn 点名（截断 5）+ 恢复通道（PullSpecBundleOptions.restoreDeleted 或环境变量 SILLYHUB_DAEMON_RESTORE_DELETED=1 跳过抑制）
4. 抑制不破坏既有回写语义（删除 op 上行成功后 manifest 不再含该路径，抑制面自然衰减）
5. vitest 新用例覆盖抑制/无基线全量/恢复通道/排除口径四点，既有测试零回归，tsc 通过

## 成功标准（可验证）

1. pullSpecBundle 落地前按 LocalManifest 算「本地已删面」（manifest 有/盘面无/属同步面），解包产物命中文件不落地，swap 与 in-place 兜底两路径均不复活
2. manifest 缺失/解析失败/首拉 = 无抑制面，既有全量回放行为不变
3. 命中面 warn 点名（截断 5）+ 恢复通道（PullSpecBundleOptions.restoreDeleted 或环境变量 SILLYHUB_DAEMON_RESTORE_DELETED=1 跳过抑制）
4. 抑制不破坏既有回写语义（删除 op 上行成功后 manifest 不再含该路径，抑制面自然衰减）
5. vitest 新用例覆盖抑制/无基线全量/恢复通道/排除口径四点，既有测试零回归，tsc 通过
