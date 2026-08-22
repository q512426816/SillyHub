---
id: task-09
title: 'full-regression-and-deploy-evidence'
title_zh: '全量回归与三入口部署实证'
author: 'qinyi'
created_at: 2026-08-22 17:15:00
priority: P0
depends_on: [task-08]
blocks: []
requirement_ids: [FR-07]
decision_ids: [D-001@v1]
allowed_paths:
  - frontend/src/components/sessions/sessions-portal.tsx
expects_from:
  task-08:
    - contract: portal-tests-green
      needs: [three-scope-cases, migration-semantics]
goal: >
  收尾验证——全量三件套零失败后重建 3001 部署，浏览器三入口对照实证观感一致（回归类任务，allowed_paths 为被验证关键入口非改动授权）。
implementation:
  - 全量 vitest 与 tsc 与 lint 三件套（记录数字与基线对比）
  - 三守护 grep（三路由渲染点均为 SessionsPortal、退役组件零残留、SessionPanel 渲染面清单）
  - 3001 镜像重建与容器重启（deploy compose build frontend 后 up -d）
  - 浏览器三入口截图对照（全局/工作区/变更级，仅列表范围与标题后缀不同）
acceptance:
  - 三件套零失败；渲染点 grep 三路由均命中门户组件
  - 3001 部署后三入口可达且浏览器断言门户一致性（详情归 verify 阶段实证留档）
verify:
  - cd frontend && pnpm test
  - cd frontend && pnpm exec tsc --noEmit
  - cd frontend && pnpm lint
constraints:
  - 本任务不改产品码（发现缺陷回派对应 task）
  - 部署动作用 deploy compose 仅重建 frontend 服务
---

<!-- 骨架由 sillyspec taskcard 生成（LF 行尾 + frontmatter 已闭合 + 硬校验 9 字段齐全）。
     用 Edit tool 填充上方占位符（allowed_paths/goal/implementation/acceptance/verify/constraints 等），
     勿用 Write 整文件重写——会引入 CRLF 行尾/漏闭合 ---/漏字段回归。
     可选字段按需插进上方 frontmatter（规则见 taskcard-rules）：
     provides:      仅当本 task 给其他 task 提供接口/DTO/响应时填
     expects_from:  仅当本 task 消费其他 task 的契约时填
     related_tests: 仅当本 task 改动导致既有测试断言失效时填（测试路径须同时进 allowed_paths） -->
