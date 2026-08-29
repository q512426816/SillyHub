---
id: task-05
title: 'e2e README + env template'
title_zh: '运行文档与凭据卫生（README + .env.e2e.example）'
author: 'qinyi'
created_at: 2026-08-29 14:55:00
priority: P1
depends_on: ['task-01', 'task-02']
blocks: ['task-08']
requirement_ids: [FR-06]
decision_ids: [D-008@v1]
allowed_paths:
  - frontend/e2e/README.md
  - frontend/e2e/.env.e2e.example
goal: >
  让开发者零上下文跑通 e2e：README 写清本机前置（compose 起 pg/redis、backend/.env 必含
  bootstrap admin + AUTH_LOGIN_RATE_LIMIT_PER_MINUTE=60、uvicorn、next dev）与运行命令；
  .env.e2e.example 提供凭据模板（.env.e2e 本体已 gitignore，design §5.1，FR-06）。
implementation:
  - README.md 章节：前置环境（四步，含限流说明 D-008@v1：默认 5 次/60s/IP 成败均计数，单 run 约 8 次登录，不放宽则第 6 次登录 429）、首次准备（cp e2e/.env.e2e.example e2e/.env.e2e 并填 bootstrap 凭据）、运行（pnpm test:e2e / 单 spec / --headed 调试 / trace 查看 playwright show-trace）、CI 说明（e2e-ci.yml 行为与 artifact）、captcha 阈值行为提示（A3 反复跑注意事项，R2）
  - .env.e2e.example：E2E_BASE_URL/E2E_API_URL（带默认值注释）+ E2E_BOOTSTRAP_EMAIL/E2E_BOOTSTRAP_PASSWORD（占位值 + 填写指引）
  - 中文书写（CLAUDE.md 规则 12）
acceptance:
  - 按 README 前置步骤从零准备后 pnpm test:e2e 可运行（与 task-08 验收联动）
  - .env.e2e.example 变量名与 e2e/env.ts 读取的变量完全一致
verify:
  - grep 比对 .env.e2e.example 与 e2e/env.ts 的变量名集合一致
  - 文档审阅（无过期命令）
constraints:
  - 只新增两文件
  - README 中 backend/.env 的 PLATFORM_BOOTSTRAP_ADMIN_* 变量名以 backend/.env.example 为准
---
