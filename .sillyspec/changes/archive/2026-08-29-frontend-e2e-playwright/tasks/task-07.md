---
id: task-07
title: 'Remove puppeteer leftover dependency'
title_zh: '移除 puppeteer 残留依赖并更新 lockfile'
author: 'qinyi'
created_at: 2026-08-29 14:55:00
priority: P1
depends_on: ['task-01']
blocks: ['task-08']
requirement_ids: [FR-09]
decision_ids: [D-006@v1]
allowed_paths:
  - frontend/package.json
  - frontend/pnpm-lock.yaml
goal: >
  移除 frontend devDependencies 中 src 零引用的 puppeteer ^24.43（与 task-01 错 Wave 执行，
  共享 package.json），lockfile 同步更新保持 frozen-lockfile 一致（design §3.1/§6，FR-09）。
implementation:
  - cd frontend && pnpm remove puppeteer（devDeps 删除 + lockfile 同步）
  - 复核 grep -r puppeteer frontend/src 无引用（design 已核实零引用，执行时再确认一次）
  - 确认 @playwright/test ^1.60 仍在 devDependencies 不动
acceptance:
  - frontend/package.json devDependencies 无 puppeteer
  - cd frontend && pnpm install --frozen-lockfile 一致通过
  - grep -ri puppeteer frontend/src 零命中
verify:
  - cd frontend && pnpm install --frozen-lockfile
  - grep -ri puppeteer frontend/src | wc -l 输出 0
constraints:
  - 只动 package.json + pnpm-lock.yaml 两文件
  - 不动其它依赖版本（避免 lockfile 大面积抖动）
  - 与 task-01 的 package.json 修改必须串行（已由 Wave 划分保证，W1→W2）
---
