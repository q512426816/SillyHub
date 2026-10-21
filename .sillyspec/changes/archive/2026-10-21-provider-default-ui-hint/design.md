---
author: flow-machine-draft
created_at: 2026-10-21T07:45:00.000Z
---
# 设计记录（Design Record）— 2026-10-21-provider-default-ui-hint

## 做法概述

本变更怎么解决问题？改哪里、为什么选这个方案（一两段）。

纯前端显示对齐：lib/api/llm-providers.ts 加 `noProviderLabel(providers)` 单源 helper（is_default 项命中 → 「不指定（默认：{name}）」，否则现状文案），四处固定文案替换（session-config-bar 兜底项、create-group-wizard 成员卡、member-panel 两处、page-helpers 轮 whoLine 回填）。行为链路（claim 注入）已验证生效零改动——只修显示滞后。选单源 helper 是防四处文案再漂移。

## 接口契约

动了哪些函数/端点/命令/文件格式？对外可见的签名或行为变化是什么（含「无」的说明）？

- 新增 `noProviderLabel(providers: LlmProviderRead[] | null | undefined): string`（lib/api/llm-providers.ts，纯函数）。
- UI 文案变化（4 处固定 → 动态）；无端点/schema/协议变化；后端零改动。

## 文件变更清单

| 操作 | 路径 | 说明 |
|---|---|---|
| 修改 | frontend/src/lib/api/llm-providers.ts | noProviderLabel helper |
| 修改 | frontend/src/components/sessions/session-config-bar.tsx | 兜底项文案 ×2 |
| 修改 | frontend/src/components/group-chat/create-group-wizard.tsx | 成员卡下拉 placeholder/option |
| 修改 | frontend/src/components/group-chat/member-panel.tsx | 两处下拉 |
| 修改 | frontend/src/components/daemon/session-panel/page-helpers.tsx | whoLine providerName null 回填默认名 |
| 修改 | 对应测试文件 | 文案分支用例 |

## 边界与并发（盲维四问——每问必答，答不了即设计缺口）

1. 乱序/迟到到达：输入或事件乱序时，本设计的假设还成立吗？
   成立。providers 列表异步加载，未到位时 helper 落「本机默认」文案，到位后重渲染自愈（config bar/page-helpers 均为响应式数据源）。
2. 并发写：两个执行体同时操作同一数据/文件会发生什么？
   不适用：纯展示函数无写路径；设默认后列表 refetch 拿新 is_default。
3. 切换/生命周期：会话、请求或变更中途切换/中断时状态是否安全？
   安全。文案是纯派生值，无中间态。
4. 作用域：跨工作区/跨仓/多实例时数据会不会串台？
   不会。is_default 是用户级（llm-providers 列表按 owner 过滤），显示随请求者。
## 风险与死路

本方案最大的风险是什么？试过但放弃的方案及放弃理由？

最大风险：历史轮 timeline 用当前默认名标注的轻微失真（默认改名后历史轮名跟着变）——已声明可接受（FR-02），优于现状「本机默认」的反向误导。死路：把默认名写进会话/轮快照（config_snapshot）——放弃：属后端改动且引入快照一致性维护，显示问题不值当。
