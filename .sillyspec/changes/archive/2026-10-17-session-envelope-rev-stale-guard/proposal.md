---
author: flow-machine-draft
created_at: 2026-10-17T13:14:59.532Z
---
# 提案书（Proposal）— 2026-10-17-session-envelope-rev-stale-guard

## 动机

任务原话转写：动机：2026-10-17-session-replay-pingpong-fix 评审 P3-3——跨标签回放无版本概念，迟到的旧信封（内容基于已过时的本页状态）仍会覆盖较新的本地值，可造成已登出/已续票标签页的幽灵状态复活，与刚修掉的 11 小时 401 风暴同源子系统隐患；修法小而内聚值得现在收口。
成功标准：
- SessionState 新增单调 rev 计数器：setTokens/setUser/clear 三个用户驱动变更加一，storage 回放不自动加一而是采纳远端 rev
- 回放守卫：远端信封 rev 严格小于本地 rev 时整体忽略（陈旧）；等于时走既有内容比对（同值静默）；大于时采纳内容并同步 rev；内容全等但 rev 更新时仅同步 rev
- 向后兼容：无 rev 字段的旧形状信封走既有内容比对路径，既有 6+3 用例语义不变
- 新增单测覆盖：陈旧忽略、新 rev 采纳并同步、同内容仅同步 rev、等值同内容静默、变更加一
- 既有 token-refresh/session 测试不回归

## 变更范围

按成功标准机械推导，共 5 条验收面：
1. SessionState 新增单调 rev 计数器：setTokens/setUser/clear 三个用户驱动变更加一，storage 回放不自动加一而是采纳远端 rev
2. 回放守卫：远端信封 rev 严格小于本地 rev 时整体忽略（陈旧）；等于时走既有内容比对（同值静默）；大于时采纳内容并同步 rev；内容全等但 rev 更新时仅同步 rev
3. 向后兼容：无 rev 字段的旧形状信封走既有内容比对路径，既有 6+3 用例语义不变
4. 新增单测覆盖：陈旧忽略、新 rev 采纳并同步、同内容仅同步 rev、等值同内容静默、变更加一
5. 既有 token-refresh/session 测试不回归

## 成功标准（可验证）

1. SessionState 新增单调 rev 计数器：setTokens/setUser/clear 三个用户驱动变更加一，storage 回放不自动加一而是采纳远端 rev
2. 回放守卫：远端信封 rev 严格小于本地 rev 时整体忽略（陈旧）；等于时走既有内容比对（同值静默）；大于时采纳内容并同步 rev；内容全等但 rev 更新时仅同步 rev
3. 向后兼容：无 rev 字段的旧形状信封走既有内容比对路径，既有 6+3 用例语义不变
4. 新增单测覆盖：陈旧忽略、新 rev 采纳并同步、同内容仅同步 rev、等值同内容静默、变更加一
5. 既有 token-refresh/session 测试不回归
