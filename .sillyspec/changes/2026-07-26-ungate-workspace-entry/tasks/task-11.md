---
id: task-11
title: 180072 真实点页 e2e verify
title_zh: 无 binding 成员真实点开各页验证
author: qinyi
created_at: 2026-07-26 15:36:00
priority: P0
depends_on: [task-10]
blocks: []
requirement_ids: [FR-01, FR-02, FR-03, FR-04, FR-05]
decision_ids: [D-001, D-004]
allowed_paths: []
goal: >
  用 180072（无 binding 成员）真实点开各工作区页面，验证门禁后移全链路。
implementation:
  - 本地 Docker 已部署（frontend 重建带本变更）；180072 登录（密码 biz123456，e2e 已设）
  - 点 SillyHub 工作区 → 直接进（不弹 Dialog）✓ FR-01
  - 概览页 → WorkspaceConfigCard 配置引导（非阻断）✓ FR-03
  - 文件中心/变更中心/成员/知识库 → 正常浏览 ✓ FR-05
  - 运行时/扫描文档/组件 → DaemonRequiredNotice 空态 ✓ FR-04
  - 详情页 guard → 不阻断 ✓ FR-02
  - admin（已绑定）→ 原行为零回归（进门/编辑/agent/scan）
acceptance:
  - 180072 进门直进、文档类正常、daemon 依赖页空态、概览 config-card 引导
  - admin 零回归
verify:
  - 人工点页（前端 http://127.0.0.1:3001）+ 截图/记录
  - 可选：curl /api/auth/me 确认 180072 权限（daemon:borrow）+ admin 权限
constraints:
  - 本地 Docker 部署 verify（CLAUDE.md 规则 11 允许重置测试数据）
  - 本变更为 frontend，需重建 frontend 镜像再验
---
