---
author: flow-machine-draft
created_at: 2026-10-19T02:23:47.129Z
---
# 设计记录（Design Record）— 2026-10-19-hide-shared-profile-in-session

## 做法概述

只改 `frontend/src/components/sessions/session-config-bar.tsx` 档案下拉一处：新增 `visibleProfiles` 派生（useMemo）——provisional（预会话）时共享智能体条目（id ∈ sharedProfileIds，数据源 useActiveSharedAgents 即 shared-agents/active 真实库列表，非名称匹配）置顶、普通档案保持原序；真会话时过滤掉共享条目、但 `p.id === agentProfileId`（当前会话档案）豁免保留。下拉渲染由 `profiles.map` 换 `visibleProfiles.map`，其余（SharedTag 标识、空态提示、点击行为）零变化。

背景依据：后端 `_detect_platform_profile_binding` 全库唯一调用点在创建会话链路（inject_gates.py:129），会话内切档案只换人格提示词（D-013）——但用户对「共享智能体」的心智预期是整套环境，中途误选产生困惑；预会话保留是因为无机器用户（180072 类）新建会话靠它（2026-10-19-shared-agent-onboarding-hint 已做默认选中引导），置顶呼应「新建弹窗里更好找」的诉求。放弃「把共享智能体提升到机器/智能体选择层（pre-session-picker）」的方案：结构改动大（picker 组件重构），thin 体量不匹配，且预会话档案下拉置顶已满足可发现性。

## 接口契约

- 无后端/API/类型契约变化（不触发 gen:types 义务）。
- 前端组件行为变化：SessionConfigBar 真会话档案下拉不再列出共享智能体条目（当前项豁免）；预会话下拉共享条目置顶。
- DOM 无新增锚点（复用既有「选择 <档案名>」aria-label 与「共享」Tag）。

## 边界与并发（盲维四问——每问必答，答不了即设计缺口）

1. 乱序/迟到到达：active 列表经 react-query 异步到达，visibleProfiles 随 sharedProfileIds 变化重算（useMemo 依赖），到达前后各渲染一次属预期；失败降级 [] → sharedProfileIds 空集 → 真会话不过滤、预会话不置顶（零回归）。
2. 并发写：纯派生只读，不写任何共享状态；同 props 重复计算幂等。
3. 切换/生命周期：真会话→预会话（或反向）模式切换时 visibleProfiles 按 provisional 分支重算；用户在真会话「不指定」后当前项豁免不再适用（agentProfileId=null，共享条目全部隐藏），符合「不再提供共享档案入口」的语义。
4. 作用域：sharedProfileIds 是全局 active 共享授权集合（管理员停用某共享后 active 不再返回，条目自动回普通档案语义），无跨工作区串台。

## 风险与死路

最大风险：真会话隐藏后，用户想在中途把普通会话「升级」为共享智能体会话无入口——这是刻意边界（共享智能体环境是创建时服务端强制的钉定+约束，中途切入既然后端也不会生效，隐藏正是对齐真实语义）；需要共享环境应新建会话。放弃的方案：①按名称过滤——用户明确指出名称不可靠，必须按 active 列表 id；②提升到机器/智能体选择层——改动面与 thin 不匹配（见做法概述）。

## 文件变更清单

| 操作 | 路径 | 说明 |
| --- | --- | --- |
| 修改 | frontend/src/components/sessions/session-config-bar.tsx | visibleProfiles 派生（真会话隐藏共享条目/当前项豁免；预会话置顶）+ 下接渲染切换 |
| 修改 | frontend/src/components/sessions/__tests__/session-config-bar.test.tsx | 新增真会话隐藏/当前项豁免/预会话置顶用例；既有「共享标识」用例迁至预会话场景 |
