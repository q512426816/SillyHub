---
author: qinyi
created_at: 2026-10-26T23:05:00
---
# 提案书（Proposal）— 2026-10-26-mobile-four-page-layout-fix

## 动机

用户真机（iPhone）访问移动端四页面（工作区选择 /m/workspaces、会话对话 /m/workspaces/[id]/sessions/[sid]、会话列表 /m/workspaces/[id]/sessions、变更中心 /m/workspaces/[id]/changes），截图暴露系统性布局缺陷：共用 PC 组件在窄视口下溢出截断（运行状态条、轮次胶囊、模型名、搜索框），共用「平台同步」卡标题被挤成竖排，悬浮 TabBar/FAB 遮挡列表内容，/m/ 页面控件密度未按手机收敛（单屏 1~2 卡片）。此前 ql-20260915-009/013 两轮只收敛了会话页部分组件，本轮为第三轮系统性收敛。

## 变更范围

方案 A（D-001@v1，既有 mobile 分支机制）下四条线：

1. **全局外壳**（/m/ 独占）：底部 TabBar 避让 safe-area 精确化、TabBar 胶囊不透明底、m-app 壳内密度规约块。
2. **会话对话页共用组件链**（PC 共用，改动锁 mobile 分支）：TurnLiveMarquee / RoundDivider 新增 mobile prop（信息收窄、折行缩写），turn-timeline / turn-segment-views 挂载点透传，SessionConfigBar mobile 排列收紧，排队态占位短句。
3. **/m/ 三页面密度收敛**：PlatformSyncSection +mobile prop（标题禁断行）、变更中心搜索行两行化、工作区选择页密度收紧、会话列表 FAB 让位。
4. **回归治理**：mobile 用例 + desktop 锚定用例双覆盖，相关测试面 + tsc + eslint，PC 既有测试零回归核对，用户真机复验。

## 不在范围内（Non-Goals）

- 不重写移动端会话组件套件（D-003@v1）。
- 不做全局响应式断点改造、不给 PC 引入断点样式（D-002@v1）。
- 不改后端 API / schema / sillyspec CLI（接口面 0 端点）。
- 不改移动端信息架构与交互流程。
- 不处理 PPM 移动页面（/m/ppm/**）。

## 关键约束

**PC 端效果不得变差**（用户原话，硬验收）：共用组件所有改动锁 mobile 分支内，desktop 样式一行不动；结构性修复对 desktop 的同款溢出隐患改善属允许的「优化性影响」，逐处 desktop 锚定用例断言不劣化。

## 成功标准

- FR-01~09 场景逐条通过（requirements.md，测试断言 + 用户真机截图复验）。
- FR-10 硬验收：共用组件 desktop 形态锚定用例全绿，PC 端变更中心/会话相关既有测试零回归，tsc 0 新增错误、eslint 0 新增告警。
- 提交按 Wave 分笔，Conventional Commits 中文 subject。

## 决策覆盖

- D-001@v1（方案 A mobile 分支机制）→ 覆盖「变更范围」全部四条线。
- D-002@v1（落选：响应式重构）→ 覆盖 Non-Goals 第 2 条。
- D-003@v1（落选：独立组件套件）→ 覆盖 Non-Goals 第 1 条。

## 规模

scale=large：跨 4 页面 + 5 个 PC 共用组件、14+ 文件、Wave 编排（证据见 design.md 拆分判断节）。
