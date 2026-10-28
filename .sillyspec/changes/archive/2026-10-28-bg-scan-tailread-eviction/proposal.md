---
author: flow-machine-draft
created_at: 2026-10-27T23:44:45.002Z
---
# 提案书（Proposal）— 2026-10-28-bg-scan-tailread-eviction

## 动机

任务原话转写：后台任务扫描环区间读与快照淘汰修复

动机：2026-10-28-bg-task-status-report（cdcb97fdb）落地的 daemon 后台任务终态扫描环 _bgTaskFinalLoop 存在两处缺陷（2026-10-28 只读风险审查高置信发现 2/3，用户按报告指示修复）：①每 60s 对每个 claude-code 日志 readFile 全量进内存再 subarray 取 64KB 尾段，内存分配与日志全大小成正比（本仓有 OOM 前科，同仓既有实践 liveness/tailer.ts:137-143 是 open+read 按区间读）；②_bgTaskSnapshots 清理只删空内层 Map，而内层 Map 一旦 set 过条目永远非空，注释声称的「防只增不减」不成立，Map 随历史 logPath 无界增长。

成功标准：
- _bgTaskFinalLoop 读日志改为 open+read 按区间读最后 64KB（文件小于窗口时整读），不再 readFile 全量进内存；读失败仍走既有 continue 下轮再看
- _bgTaskSnapshots 每轮按本轮 targets 可见集核对淘汰不再产出的 logPath（非空内层 Map 也可淘汰），消除只增不减
- 新增单测覆盖区间读（大于窗口取尾/小于窗口整读/文件缺失拒判）与淘汰（可见集外移除/全不可见清空/可见全保留）；daemon 相关既有测试回归零破坏

## 变更范围

按成功标准机械推导，共 3 条验收面：
1. _bgTaskFinalLoop 读日志改为 open+read 按区间读最后 64KB（文件小于窗口时整读），不再 readFile 全量进内存；读失败仍走既有 continue 下轮再看
2. _bgTaskSnapshots 每轮按本轮 targets 可见集核对淘汰不再产出的 logPath（非空内层 Map 也可淘汰），消除只增不减
3. 新增单测覆盖区间读（大于窗口取尾/小于窗口整读/文件缺失拒判）与淘汰（可见集外移除/全不可见清空/可见全保留）；daemon 相关既有测试回归零破坏

## 成功标准（可验证）

1. _bgTaskFinalLoop 读日志改为 open+read 按区间读最后 64KB（文件小于窗口时整读），不再 readFile 全量进内存；读失败仍走既有 continue 下轮再看
2. _bgTaskSnapshots 每轮按本轮 targets 可见集核对淘汰不再产出的 logPath（非空内层 Map 也可淘汰），消除只增不减
3. 新增单测覆盖区间读（大于窗口取尾/小于窗口整读/文件缺失拒判）与淘汰（可见集外移除/全不可见清空/可见全保留）；daemon 相关既有测试回归零破坏
