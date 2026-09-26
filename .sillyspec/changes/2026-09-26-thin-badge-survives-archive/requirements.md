---
author: flow-machine-draft
created_at: 2026-09-26T13:39:44.512Z
---
# 需求规格（Requirements）— 2026-09-26-thin-badge-survives-archive

## 功能需求（GWT 骨架已机器预填——可编辑覆盖；FR 进知识索引）

<!--AGENT:FR区 agent 填写功能需求（GWT 骨架已预填——覆盖/修改/保留均可） -->
### FR-01: 已归档变更若为轻量出身则标题显示双徽章:轻量变更品牌紫徽章与已归档徽章并存
Given 系统就绪
When 已归档变更若为轻量出身
Then 标题显示双徽章:轻量变更品牌紫徽章与已归档徽章并存

### FR-02: 出身判定:current_stage 为 archived 或 location 为 archive
Given 系统就绪
When 出身判定:current_stage 为 archived 或 location 为 archive,且 change_type 为 quick,且 creat
Then 行为符合本条标准描述

### FR-03: 2026-09-25 前建的历史 quick 变更与普通归档变更仍只显示已归档徽章,行为零回归
Given 系统就绪
When 2026-09-25 前建的历史 quick 变更与普通归档变更仍只显示已归档徽章,行为零回归
Then 行为符合本条标准描述

### FR-04: 页面级测试补双徽章用例与旧 quick 不误标用例,既有用例不回归
Given 测试 相关模块就绪
When 页面级测试补双徽章用例与旧 quick 不误标用例,既有用例不回归
Then 行为符合本条标准描述

### FR-05: frontend tsc 无错误
Given 系统就绪
When frontend tsc 无错误
Then 行为符合本条标准描述

## 测试绑定（每条 FR 至少一行——空槽将在 flow done 时自动从测试结果补全）

<!--AGENT:测试绑定FR-01 哪个测试文件/用例覆盖这条 FR（无测试面写「不适用：理由」）——例外裁决书写面（机器段之外合法） -->
frontend/src/app/(dashboard)/workspaces/[id]/changes/[cid]/__tests__/page-restore-assets.test.tsx::已归档轻量出身双徽章 用例

<!--AGENT:测试绑定FR-02 哪个测试文件/用例覆盖这条 FR（无测试面写「不适用：理由」）——例外裁决书写面（机器段之外合法） -->
同文件::2026-09-25 前历史 quick 归档仅单徽章 用例

<!--AGENT:测试绑定FR-03 哪个测试文件/用例覆盖这条 FR（无测试面写「不适用：理由」）——例外裁决书写面（机器段之外合法） -->
详情页 __tests__ 三文件全套一次跑过 + pnpm exec tsc --noEmit exit 0（2026-09-26 实测）

