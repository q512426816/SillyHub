---
author: flow-machine-draft
created_at: 2026-10-27T23:33:32.445Z
---
# 提案书（Proposal）— 2026-10-28-cgroup-v2-watermark-fix

## 动机

任务原话转写：内存水位预警补 cgroup v2 限制文件兼容

动机：2026-10-27-archive-reparse-oom-governance（60629d2bb）落地的内存水位预警在 cgroup v2 宿主上静默失效——drift_probe.py _CGROUP_LIMIT_FILES 首候选 /sys/fs/cgroup/memory.limit 在 v2 统一层级不存在（v2 实为 memory.max），生产容器为 v2 形态：current 可读而 limit=None，水位告警一次不发，且与「无 cgroup 环境」不可区分。来源：2026-10-28 只读风险审查高置信发现 1；用户按审查报告指示修复。

成功标准：
- _CGROUP_LIMIT_FILES 候选补 /sys/fs/cgroup/memory.max（v2 在前、v1 兜底保留），模块 docstring 的 v2 文件名同步修正
- memory.max 内容为字面量 "max"（无限制）时安全跳过：不抛错、不误告警、返回 None
- 新增 pytest 用例覆盖四形态：v2 正常读取算出比例、超 0.8 阈值出告警、"max" 字面量跳过、无 cgroup 环境跳过；spec_workspace 相关测试全绿

## 变更范围

按成功标准机械推导，共 3 条验收面：
1. _CGROUP_LIMIT_FILES 候选补 /sys/fs/cgroup/memory.max（v2 在前、v1 兜底保留），模块 docstring 的 v2 文件名同步修正
2. memory.max 内容为字面量 "max"（无限制）时安全跳过：不抛错、不误告警、返回 None
3. 新增 pytest 用例覆盖四形态：v2 正常读取算出比例、超 0.8 阈值出告警、"max" 字面量跳过、无 cgroup 环境跳过；spec_workspace 相关测试全绿

## 成功标准（可验证）

1. _CGROUP_LIMIT_FILES 候选补 /sys/fs/cgroup/memory.max（v2 在前、v1 兜底保留），模块 docstring 的 v2 文件名同步修正
2. memory.max 内容为字面量 "max"（无限制）时安全跳过：不抛错、不误告警、返回 None
3. 新增 pytest 用例覆盖四形态：v2 正常读取算出比例、超 0.8 阈值出告警、"max" 字面量跳过、无 cgroup 环境跳过；spec_workspace 相关测试全绿
