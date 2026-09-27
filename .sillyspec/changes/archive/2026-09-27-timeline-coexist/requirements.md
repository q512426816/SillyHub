---
author: flow-machine-draft
created_at: 2026-09-27T13:35:24.365Z
---
# 需求规格（Requirements）— 2026-09-27-timeline-coexist

## 功能需求（GWT 骨架已机器预填——可编辑覆盖；FR 进知识索引）

<!--AGENT:FR区 agent 填写功能需求（GWT 骨架已预填——覆盖/修改/保留均可） -->
### FR-01: 变更详情页步骤时间线卡与真实留痕时间线卡共存：steps 非空时合成时间线卡也渲染（组件自身空态静默
Given 组件 相关模块就绪
When 变更详情页步骤时间线卡与真实留痕时间线卡共存：steps 非空时合成时间线卡也渲染（组件自身空态静默隐藏兜底不变）
Then 行为符合本条标准描述

### FR-02: thin 在途（steps 恒空）行为不变：合成卡独立承担叙事
Given 系统就绪
When thin 在途（steps 恒空）行为不变：合成卡独立承担叙事
Then 行为符合本条标准描述

### FR-03: 相关前端测试同步更新并全部通过
Given 前端 / 测试 相关模块就绪
When 相关前端测试同步更新并全部通过
Then 行为符合本条标准描述

## 测试绑定（每条 FR 至少一行——空槽将在 flow done 时自动从测试结果补全）

<!--AGENT:测试绑定FR-01 哪个测试文件/用例覆盖这条 FR（项目相对全路径＋用例名；空槽将在 flow done 自动从测试结果补全——预填可加速）——例外裁决书写面（机器段之外合法） -->
frontend/src/app/(dashboard)/workspaces/[id]/changes/[cid]/__tests__/page-restore-assets.test.tsx :: 共存（2026-09-27-timeline-coexist）：归档补种 steps 后真实留痕时间线卡不被顶掉

<!--AGENT:测试绑定FR-02 哪个测试文件/用例覆盖这条 FR（项目相对全路径＋用例名；空槽将在 flow done 自动从测试结果补全——预填可加速）——例外裁决书写面（机器段之外合法） -->
frontend/src/app/(dashboard)/workspaces/[id]/changes/[cid]/__tests__/page-restore-assets.test.tsx :: FR-03（2026-09-26-change-real-timeline）：steps 为空时主线挂载真实留痕时间线卡

<!--AGENT:测试绑定FR-03 哪个测试文件/用例覆盖这条 FR（项目相对全路径＋用例名；空槽将在 flow done 自动从测试结果补全——预填可加速）——例外裁决书写面（机器段之外合法） -->
frontend/src/app/(dashboard)/workspaces/[id]/changes/[cid]/__tests__/page-restore-assets.test.tsx :: 变更详情页恢复钉子（2026-09-26-change-detail-restore-assets） 全部 9 用例；防回归面 page-team-toggle.test.tsx（13 用例）/ page-last-signal.test.tsx（5 用例）/ change-timeline-card.test.tsx（4 用例）
