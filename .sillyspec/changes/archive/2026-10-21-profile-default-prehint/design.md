---
author: flow-machine-draft
created_at: 2026-10-21T08:50:00.000Z
---
# 设计记录（Design Record）— 2026-10-21-profile-default-prehint

## 做法概述

本变更怎么解决问题？改哪里、为什么选这个方案（一两段）。

单点修 session-config-bar：profileLabel 与档案下拉兜底项按 provisional + 用户默认档案（profiles.find(is_user_default)，useMineAgentProfiles 数据已带 is_user_default）动态化。与供应商显示修复（2026-10-21-provider-default-ui-hint）同构；差异点：默认档案只在**创建时**注入，存量会话不追溯——非 provisional 未选必须显示真值「未指定」，仅 provisional（将创建）预示默认。

## 接口契约

动了哪些函数/端点/命令/文件格式？对外可见的签名或行为变化是什么（含「无」的说明）？

- session-config-bar profileLabel 计算 + 档案下拉兜底 SwitchItem label（组件内，无导出签名变化）；无端点/schema 变化；后端零改动。

## 文件变更清单

| 操作 | 路径 | 说明 |
|---|---|---|
| 修改 | frontend/src/components/sessions/session-config-bar.tsx | profileLabel provisional 分支 + 兜底项动态文案 |
| 修改 | frontend/src/components/sessions/__tests__/session-config-bar.test.tsx | 两分支用例 |

## 边界与并发（盲维四问——每问必答，答不了即设计缺口）

1. 乱序/迟到到达：输入或事件乱序时，本设计的假设还成立吗？
   成立。profiles 异步加载未到位时显示「未指定」，到位后重渲染自愈（响应式派生）。
2. 并发写：两个执行体同时操作同一数据/文件会发生什么？
   不适用：纯展示派生无写路径。
3. 切换/生命周期：会话、请求或变更中途切换/中断时状态是否安全？
   安全。纯派生值；provisional → 创建后 config_snapshot.profile_name 接棒显示，无缝。
4. 作用域：跨工作区/跨仓/多实例时数据会不会串台？
   不会。is_user_default 按请求者计算（后端 _to_read），profiles 列表本人可见集。
## 风险与死路

本方案最大的风险是什么？试过但放弃的方案及放弃理由？

最大风险：provisional 兜底项文案「不指定（默认：名）」与运行中「不指定（无人格）」语义并存，用户切换会话形态时文案变化——有依据（两态实际语义确实不同），非漂移。死路：把默认名显示进非 provisional 会话——放弃：该会话不会注入默认，显示即撒谎。
