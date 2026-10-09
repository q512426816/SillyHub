---
author: flow-machine-draft
created_at: 2026-10-09T14:58:49.787Z
---
# 设计记录（Design Record）— 2026-10-09-ws-create-spec-default-collapse

## 做法概述

纯前端交互调整，两个改动面：

1. **默认值翻转**：桌面端 `frontend/src/components/workspace-scan-dialog.tsx` 与移动端 `frontend/src/app/m/workspaces/page.tsx`（WorkspaceCreateSheet）的 `specStrategy` state 初始值从 `"platform-managed"` 改为 `"repo-native"`（移动端 `reset()` 同步改）。随之把「平台托管」选项文案里的「默认」字样移除（避免文案与新默认值矛盾）。
2. **收起/展开交互**：两端各加一个本地 `specExpanded` state（默认 false）。收起态渲染一行摘要（「spec 同步策略：<当前选中项 label>」）+「更多选项」文字按钮 + repo-native 的 ⚠ 警示；展开态渲染原有的三选项单选列表（条件渲染，非 CSS 隐藏，保证 FR-03 的 DOM 移除）+「收起」按钮。选项数组提为模块级常量并暴露 label 查找，摘要行与单选列表共用同一份，杜绝双份硬编码漂移。

选择该方案的原因：用户明确表达「默认源码即真理 + 低频选项收进更多选项」，不涉及后端/协议变化，最小改动面即两端表单组件 + 配套测试。

## 接口契约

- 后端 API（`POST /api/workspaces` 的 `spec_strategy` 字段）：**无变化**，仍是三值枚举透传，仅默认传入值从 platform-managed 变为 repo-native。
- `createWorkspace()` / `lib/workspaces.ts`：签名与行为无变化。
- 前端组件内部 state：`specStrategy` 默认值变更；新增 `specExpanded`（组件私有，不外溢）。
- 移动端 `SPEC_STRATEGY_OPTIONS` 常量：label 文案变更（去「默认」字样），value 不变。

## 边界与并发（盲维四问——每问必答，答不了即设计缺口）

1. 乱序/迟到到达：不适用——本变更纯本地 UI state，无事件流/异步输入参与 spec 策略选择；守护进程实例列表异步加载与 spec 区块渲染无交集。
2. 并发写：不适用——`specStrategy`/`specExpanded` 均为单组件内 React state，单用户会话内无并发写者；创建请求发出后表单控件即禁用，不存在提交中途改值。
3. 切换/生命周期：弹窗关闭（桌面 `destroyOnHidden` / 移动端 `reset()`）时 state 重置——桌面端因 destroyOnHidden 重建组件回到 repo-native 默认；移动端 reset() 显式重置为 repo-native。创建成功/失败路径不残留展开态影响下次打开（均回到默认收起）。
4. 作用域：不适用——specExpanded 是组件私有 state，不进全局 store/URL/持久化；spec_strategy 值仅随本次创建请求体提交，不写本地存储，多标签页/多实例无串台面。

## 风险与死路

- 最大风险：默认策略从「平台托管（不碰源项目）」翻转为「源项目即真理（扫描直接写源项目）」，新工作区默认行为变为写源项目 `.sillyspec`——已有 ⚠ 警示文案在收起态也保持可见（FR-05）来对冲用户无感知的风险；这是用户明确要求的默认值，属预期行为变化。
- 放弃的方案：CSS `display:none` 隐藏前两选项（不满足 FR-03 的 DOM 移除要求，且屏幕阅读器仍可聚焦）；把 spec 策略挪进独立的「高级设置」二级弹窗（改动面大、移动端无对应容器形态，收益低）。

## 文件变更清单

| 操作 | 路径 | 说明 |
| --- | --- | --- |
| 修改 | frontend/src/components/workspace-scan-dialog.tsx | 默认值 repo-native + spec 区块收起/展开交互 + 文案去「默认」 |
| 修改 | frontend/src/app/m/workspaces/page.tsx | 移动端同款：默认值/reset/收起展开 + SPEC_STRATEGY_OPTIONS 文案 |
| 修改 | frontend/src/components/__tests__/workspace-scan-dialog.test.tsx | 新增 spec 策略默认收起/展开切换/提交体用例 |
| 修改 | frontend/src/app/m/workspaces/__tests__/page.m-workspaces.test.tsx | 新增移动端默认值 + 收起态 DOM 断言用例 |
