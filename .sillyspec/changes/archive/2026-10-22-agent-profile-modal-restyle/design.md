---
author: flow-machine-draft
created_at: 2026-10-22T01:29:54.658Z
---
# 设计记录（Design Record）— 2026-10-22-agent-profile-modal-restyle

## 做法概述

本变更怎么解决问题？改哪里、为什么选这个方案（一两段）。

按用户两轮反馈定稿的原型（`.sillyspec/explore/prototype-agent-profile-modal-restyle.html`）重构 `agent-profile-form.tsx` 的 Modal 呈现层；业务流（hooks/校验/提交/工作区归属判定）不动。核心两处：①技能选择从裸 `Checkbox.Group` 换为表单受控的自定义控件 `SkillPickerGroup`（Form.Item 注入 value/onChange）——内部维护搜索词、派生筛选集，全选三态只作用于筛选集，芯片两行（名称+简介）；②数据面把 `skillOptions` 从 `string[]` 扩为 `{name, desc}[]`（Map 合并去重，自定义技能先入优先，desc 取数据源 description 字段），`skill_refs` 表单值与后端契约仍是 `string[]` 零变化。滚动条问题以 globals.css 新增作用域工具类 `.thin-scroll`（文件级非 @layer，防 purge，先例同 silly-route-loading 位置区）+ 三主题 `--scroll-thumb/--scroll-thumb-hover` 变量解决，不动全局滚动条。

## 接口契约

动了哪些函数/端点/命令/文件格式？对外可见的签名或行为变化是什么（含「无」的说明）？

- `AgentProfileForm` 对外 props 不变（mode/workspaceId/profile/onClose）；`toCreateBody`/`toUpdateBody` 导出签名与行为不变（skill_refs 仍 string[]），后端端点与 schema 零变化。
- 组件内部新增局部类型 `SkillOption {name, desc}` 与内部组件 `SkillPickerGroup`（不对外导出）。
- globals.css 新增公开工具类 `.thin-scroll` 与三主题 `--scroll-thumb`/`--scroll-thumb-hover` CSS 变量（消费方目前仅技能芯片滚动容器）。
- 无命令/文件格式/环境变量变化。

## 边界与并发（盲维四问——每问必答，答不了即设计缺口）

1. 乱序/迟到到达：输入或事件乱序时，本设计的假设还成立吗？

   成立。技能清单经 react-query 可先空后满（自定义/平台两源各自到达）——SkillPickerGroup 一切视图态由 options 派生，迟到只是重渲染；`skill_refs` 表单值中已不在清单的存量引用保留在表单值里但不渲染芯片（与现版 Checkbox.Group 对未知 value 的行为一致），提交语义交由后端既有处理。

2. 并发写：两个执行体同时操作同一数据/文件会发生什么？

   纯前端单用户表单，无共享写面；多标签页各持独立表单实例与 Modal 生命周期，互不串。

3. 切换/生命周期：会话、请求或变更中途切换/中断时状态是否安全？

   安全。Modal destroyOnClose 下每次打开 Form 重建，搜索词为组件内 state 随销毁归零，无跨开合泄漏；保存中 loading/禁用与现版一致。

4. 作用域：跨工作区/跨仓/多实例时数据会不会串台？

   不串。技能引用只存 name 进 skill_refs（跨工作区/平台档案引用同名技能的既有语义不变）；样式作用域——.thin-scroll 只挂技能芯片滚动容器选择器内，不影响全局滚动条；颜色全部走 brand/语义 token，随 html[data-theme] 换肤。

## 风险与死路

本方案最大的风险是什么？试过但放弃的方案及放弃理由？

最大风险：既有单测查询方式依赖旧 DOM（antd Checkbox.Group 的 label 结构），重构后需按新 DOM（芯片以 role=checkbox/aria-checked 暴露）调整查询手段——行为断言不变、只改查询方式，逐用例核对防止「改测试凑通过」。次风险：antd Modal title 传 ReactNode 后高度变化在不同视口的表现，靠实页三主题截图对照兜底。已放弃方案：①继续用 antd Checkbox.Group + options render 定制两行芯片（Group 布局受限、工具栏与三态联动要绕过 Group 自身 state，别扭且难测，放弃）；②全局滚动条主题化（影响面全站，超出本变更范围，收窄为作用域工具类，全局化留给后续独立变更）。

## 文件变更清单

| 操作 | 路径 | 说明 |
| --- | --- | --- |
| 修改 | frontend/src/components/agent-profile-form.tsx | 弹窗头/页脚/小节头重构；SkillPickerGroup（全选三态/搜索/计数/清空/两行芯片/键盘可达/空态）；skillOptions 扩为 {name,desc} 并集（自定义优先）；预览 chips 悬停简介 |
| 修改 | frontend/src/components/__tests__/agent-profile-form.test.tsx | 新增 FR-01/02/03 用例；既有用例查询方式适配新 DOM（行为断言不变） |
| 修改 | frontend/src/app/globals.css | .thin-scroll 作用域工具类 + 三主题 --scroll-thumb/--scroll-thumb-hover 变量 |
| 新增 | .sillyspec/changes/2026-10-22-agent-profile-modal-restyle/visual-evidence.md | 实页三主题渲染与原型对照证据（截图结论） |
