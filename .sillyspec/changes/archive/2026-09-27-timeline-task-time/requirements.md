---
author: flow-machine-draft
created_at: 2026-09-27T14:21:02.878Z
---
# 需求规格（Requirements）— 2026-09-27-timeline-task-time

## 功能需求（GWT 骨架已机器预填——可编辑覆盖；FR 进知识索引）

<!--AGENT:FR区 agent 填写功能需求（GWT 骨架已预填——覆盖/修改/保留均可） -->
### FR-01: TimelineTask 增加 time 字段（翻格顺序推断的勾选时刻，游标衔接赋值、中段断裂停止、
Given 系统就绪
When TimelineTask 增加 time 字段（翻格顺序推断的勾选时刻，游标衔接赋值、中段断裂停止、尾部未勾不标断裂——CLI inferFlipTimes 同
Then 行为符合本条标准描述

### FR-02: 前端任务面显示 ≈HH:mm:ss 时刻列（已勾无时刻显示 ?，未勾不显示）
Given 前端 相关模块就绪
When 前端任务面显示 ≈HH:mm:ss 时刻列（已勾无时刻显示 ?，未勾不显示）
Then 行为符合本条标准描述

### FR-03: openapi.json + api-types.ts 同步再生，后端/前端相关测试通过
Given api / 前端 / 测试 相关模块就绪
When openapi.json + api-types.ts 同步再生，后端/前端相关测试通过
Then 行为符合本条标准描述

## 测试绑定（每条 FR 至少一行——空槽将在 flow done 时自动从测试结果补全）

<!--AGENT:测试绑定FR-01 哪个测试文件/用例覆盖这条 FR（项目相对全路径＋用例名；空槽将在 flow done 自动从测试结果补全——预填可加速）——例外裁决书写面（机器段之外合法） -->
backend/app/modules/change/tests/test_timeline.py :: test_timeline_task_time_stage_prefix_and_cursor_break；test_timeline_golden_aggregation（金样本补 time 断言）

<!--AGENT:测试绑定FR-02 哪个测试文件/用例覆盖这条 FR（项目相对全路径＋用例名；空槽将在 flow done 自动从测试结果补全——预填可加速）——例外裁决书写面（机器段之外合法） -->
frontend/src/components/changes/detail/__tests__/change-timeline-card.test.tsx :: 三段渲染：诞生锚 + 事件轴（中文标签/commit 标题）+ 任务面（勾选×提交锚）+ 统计（含 ≈时刻断言与未勾无时刻）

<!--AGENT:测试绑定FR-03 哪个测试文件/用例覆盖这条 FR（项目相对全路径＋用例名；空槽将在 flow done 自动从测试结果补全——预填可加速）——例外裁决书写面（机器段之外合法） -->
backend/app/modules/change/tests/test_timeline.py 全 6 用例 + frontend/src/components/changes/detail/__tests__/change-timeline-card.test.tsx 全 4 用例；tsc --noEmit 0 错；gen:types 再生（openapi.json + api-types.ts 均含 TimelineTask.time）
