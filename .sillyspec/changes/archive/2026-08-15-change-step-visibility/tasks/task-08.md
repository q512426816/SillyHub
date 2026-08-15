---
id: task-08
title: "全量回归"
title_zh: "backend pytest（change 模块 + 全量）+ frontend vitest 全量 + tsc 0 error + 不乱跳冒烟（轮询期间滚动/选中保留）"
author: qinyi
created_at: 2026-08-16 01:01:55
priority: P0
depends_on: [task-06, task-07]
blocks: []
requirement_ids: [FR-03]
decision_ids: [D-001@v1]
allowed_paths:
  - backend/app/modules/change/service.py
goal: >
  task-06/07 完成后的全量回归收口——backend 全量 pytest 与 frontend vitest 全量全绿、tsc 零错误。
  降级核对（design §9）——旧变更无 steps 数据时列表与详情视觉与现状一致。
  不乱跳冒烟（R-04 用户硬约束）——轮询期间滚动/选中/展开保留、纯 step 推进不重排行序；R-07——useQuery 改造后加载/错误/筛选语义不漂移。
implementation:
  - backend 回归——先跑 change 模块 pytest 确认新增测试绿，再全量 pytest -n auto -q 确认无回归
  - frontend 回归——vitest 全量跑绿（含 page.test.tsx 与 page-team-toggle.test.tsx 适配后测试）+ tsc --noEmit 零错误
  - 降级核对——找无 steps 数据的旧变更/占位行，确认列表无徽章副行、详情无时间线，视觉与现状一致
  - 不乱跳冒烟（R-04）——列表滚动到中部等两轮 30s 刷新，滚动位置/选中/展开保留，纯 step 推进不重排行序
  - 停轮冒烟（D-001）——全部变更终态后网络面板无周期请求；切后台 tab 无周期请求
  - 发现回归逐项修复——修复落回对应前序 task 的文件，修后重跑全量回归确认
acceptance:
  - backend change 模块与全量 pytest 全绿，以当日实际通过计数为基线（plan 基线 4278 仅参考）
  - frontend vitest 全量全绿
  - tsc --noEmit 0 error
  - 降级核对完成——无 steps 变更视觉与现状一致
  - 冒烟三条全过——轮询不乱跳/全终态停轮/切后台暂停
verify:
  - cd backend && ./.venv/Scripts/python.exe -m pytest -n auto -q
  - cd frontend && pnpm exec vitest run
  - cd frontend && pnpm exec tsc --noEmit
constraints:
  - 本 task 原则上只修回归不添功能，allowed_paths 仅登记被验证关键入口
  - 修复涉及文件须在对应前序 task allowed_paths 内，超出则回前序 task 或在本卡补列后修
  - 冒烟在本地部署环境做，不依赖线上
---
