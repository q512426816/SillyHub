---
id: task-13
title: 全局验收测试
title_zh: 全局验收——middleware rewrite/外壳 5 Tab/MobileCardList/各移动页/守卫一致/桌面零回归 + test/typecheck/lint/build 全绿
author: qinyi
created_at: 2026-07-22 23:47:21
priority: P0
depends_on: [task-01, task-02, task-03, task-04, task-05, task-06, task-07, task-08, task-09, task-10, task-11]
blocks: []
requirement_ids: [FR-01, FR-02, FR-03, FR-04, FR-05, FR-06, FR-07, FR-08, FR-09]
decision_ids: []
allowed_paths:
  - frontend/src/app/m/layout.tsx
goal: >
  task-01~11 全部落地后的全局收尾验收：端到端核验 middleware 设备分流（无 FOUC）、移动外壳底部 5 Tab、4 个移动页面全功能与桌面对齐、数据层复用 lib/*、workspaces 详情提示电脑端、移动/桌面守卫语义一致；并用 git diff 证明桌面 (dashboard)/**、app-shell.tsx、(auth)/login 零回归；pnpm test/typecheck/lint/build 全绿。
implementation:
  - middleware（FR-01）：手机 UA 访问 /ppm/workbench、/ppm/task-plans、/ppm/problem-list、/workspaces、/login，确认 rewrite 到 /m/、地址栏 URL 不变、首屏无 FOUC；桌面 UA 与 UA 异常确认不 rewrite、走桌面
  - 外壳与导航（FR-02）：/m/ 任一页有移动顶栏+内容+底部 5 Tab，当前页高亮，点击各 Tab 跳转正确，「平台切换」到 /workspaces
  - 登录（FR-03）：未登录手机访问受保护移动页 → 移动登录页 → 登录后回目标页，复用桌面 auth
  - 4 移动页全功能（FR-04~07）：工作台卡片流、计划任务/问题清单卡片列表（新建/编辑/导出/批量删除/执行/详情/筛选/分页）、workspaces 列表（创建/绑定/别名），均与桌面对齐（D-008）；workspaces 详情提示「请在电脑端打开」（D-006）
  - 数据层（FR-08）：grep 移动 page 确认全部走 lib/* 函数/stores，无自写 fetch；守卫一致（R-10）：route-guard 单测镜像桌面守卫语义
acceptance:
  - 手机 UA rewrite 到 /m/ 无 FOUC，桌面/异常 UA 不 rewrite
  - 底部 5 Tab 导航正确，「平台切换」可到 /workspaces
  - 4 个移动页全功能可用、与桌面对齐；workspaces 详情提示电脑端
  - 移动视图数据全部复用 lib/*，无自写请求
  - 桌面零回归：git diff --stat -- frontend/src/app/(dashboard) frontend/src/components/app-shell.tsx frontend/src/app/(auth)/login 输出为空
  - pnpm test / typecheck / lint / build 全绿
verify:
  - cd frontend && pnpm test
  - cd frontend && pnpm exec tsc --noEmit
  - cd frontend && pnpm lint
  - cd frontend && pnpm build
  - git diff --stat -- frontend/src/app/\(dashboard\) frontend/src/components/app-shell.tsx frontend/src/app/\(auth\)/login
constraints:
  - 验收类任务，仅核对/只读，不在本任务堆补丁；发现问题回退对应 task 修
  - 桌面零回归是硬指标：上述 git diff 必须为空，否则前置 task 未守住边界
  - 不依赖 task-12（文档），二者 W7 并行；不修改测试迁就让测试过（CLAUDE.md 规则 9）
---
