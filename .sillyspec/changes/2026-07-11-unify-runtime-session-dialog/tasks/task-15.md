---
id: task-15
title: playwright 端到端验证
title_zh: 端到端验证四项关键场景
author: qinyi
created_at: 2026-07-12 00:30:00
priority: P0
depends_on: [task-14]
blocks: []
requirement_ids: [FR-01, FR-02, FR-03, FR-04, FR-05, FR-06, FR-07, FR-08]
decision_ids: [D-001, D-002, D-003, D-004, D-005, D-006]
allowed_paths: [docs/sillyspec/verification/task-15-e2e.md]
provides:
  - verification: e2e_playwright
goal: >
  playwright 端到端验证四项：attach 历史 BUG 消失、删除软删 deleted_at 非空、runtimes 弹窗样式与变更会话一致、ended/failed 直接续聊。
implementation:
  - 场景1 attach BUG：打开 /runtimes?session=<active>，attach 历史会话，断言消息区无 [SYSTEM:thinking_tokens]/[THINKING] 原始标记、无重复内容（如「你哈啊 你哈啊」只一次）
  - 场景2 软删：点会话删除按钮，断言会话从列表消失；查 DB agent_sessions.deleted_at 非空、行仍在、agent_runs.agent_session_id 未断
  - 场景3 样式一致：对比 /runtimes 弹窗列表与 /workspaces/.../changes/... 变更会话区块，断言视觉一致（圆角卡片 + 蓝色选中边框 + 顶部新建按钮）
  - 场景4 ended/failed 续聊：点 ended/failed 会话，断言直接进续聊面板（无返回栏、无只读回看），先 reopen 再 attach
acceptance:
  - attach 历史 BUG 消失：消息区无 [SYSTEM:thinking_tokens]/[THINKING] 标记、无重复内容
  - 删除软删：会话从列表消失，DB agent_sessions.deleted_at 非空、行在、agent_runs.agent_session_id 未断
  - 样式一致：runtimes 弹窗列表与变更会话区块视觉一致
  - ended/failed 续聊：点开直接进续聊面板，无返回栏、无只读回看
verify:
  - cd frontend && pnpm playwright:e2e（或项目既有 playwright 命令，跑 attach/删除/样式/ended 续聊四场景）
  - DB 验证：psql 查 agent_sessions.deleted_at 与 agent_runs.agent_session_id
constraints:
  - 本机 docker 部署访问用 127.0.0.1 非 localhost（IPv6 ::1 不通，记忆 [[docker-localhost-ipv6-use-127.0.0.1]]）
  - 改 router 重建容器看 docker logs import 栈（记忆 [[backend-router-change-run-router-tests]]）
  - e2e 前确认 backend 镜像已 rebuild 含 task-05 schema 变更 + migration 已 apply
  - 端到端依赖真实 daemon 会话，若 daemon 离线软删仍成功（design §7.5），但 attach/续聊场景需 daemon 在线
---

## 验收标准
- attach 历史 BUG 消失：消息区无 [SYSTEM:thinking_tokens]/[THINKING] 标记、无重复内容
- 删除软删：会话从列表消失，DB agent_sessions.deleted_at 非空、行在、agent_runs.agent_session_id 未断
- 样式一致：runtimes 弹窗列表与变更会话区块视觉一致
- ended/failed 续聊：点开直接进续聊面板，无返回栏、无只读回看

## 验证步骤
- cd frontend && pnpm playwright:e2e（或项目既有 playwright 命令，跑 attach/删除/样式/ended 续聊四场景）
- DB 验证：psql 查 agent_sessions.deleted_at 与 agent_runs.agent_session_id
