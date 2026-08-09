---
id: task-02
title: 前端移动登录页同步删明文密码缓存与默认回填
title_zh: 移动登录页删 localStorage 明文密码与 admin/admin123 默认回填
author: qinyi
created_at: 2026-08-09 13:18:35
priority: P0
depends_on: []
blocks: [task-07]
requirement_ids: [FR-01, FR-02, FR-03, FR-04]
decision_ids: [D-001@v1]
allowed_paths:
  - frontend/src/app/m/login/page.tsx
goal: >
  移动登录页与桌面 task-01 同构改法，删 localStorage 明文密码与默认回填，清洗旧缓存，文案改记住登录名。
implementation:
  - 回填段（:104-122）改只 setFieldsValue account 与 remember，删 ?? admin 与 ?? admin123
  - doLogin 写缓存段（:133-144）只存 {account, remember}，删 password 字段
  - 回填时加旧缓存清洗逻辑 同 task-01
  - 复选框文案（:236）记住密码改为记住登录名
acceptance:
  - 登录后 localStorage sillyhub.login.remember 无 password 键
  - 清空缓存进登录页 账号密码均空
  - 旧格式含 password 缓存被重写为无 password 版
  - 复选框显示记住登录名
verify:
  - cd frontend && pnpm exec tsc --noEmit
  - cd frontend && pnpm lint
constraints:
  - 与桌面 task-01 同 key（sillyhub.login.remember）同清洗逻辑
  - 不动 presetRedirect / middleware rewrite 逻辑
  - 不动验证码链路
related_tests: []
---

# task-02 移动登录页

详见 frontmatter。源文件 `frontend/src/app/m/login/page.tsx`，与 task-01 同构，对照 design.md §6.1。
