---
id: task-11
title: '回归确认——R-02 沙箱 marker interactive 行为回归 + 写约束集成冒烟（writable_dir 内可写/外拒绝/Bash gate 拒绝，D-009 落地确认）+ 守护进程页面/会话选择器对照原型手工验收'
title_zh: '回归确认——R-02 沙箱 marker interactive 行为回归 + 写约束集成冒烟（writable_dir 内可写/外拒绝/Bash gate 拒绝，D-009 落地确认）+ 守护进程页面/会话选择器对照原型手工验收'
author: 'qinyi'
created_at: 2026-08-28 01:24:05
priority: P0
depends_on: ['task-09', 'task-10']
blocks: []
requirement_ids: [FR-01, FR-02, FR-03, FR-04, FR-05]
decision_ids: [D-009@v1]
allowed_paths:
  - backend/app/modules/daemon/session/service.py
  - backend/app/modules/daemon/grants/router.py
  - backend/app/modules/agent/placement.py
  - frontend/src/app/(dashboard)/runtimes/page.tsx
  - frontend/src/components/daemon/shared-machines-section.tsx
  - frontend/src/components/daemon/platform-shared-agents-card.tsx
  - frontend/src/components/floating/floating-session-host.tsx
  - frontend/src/components/sessions/session-config-bar.tsx
  - frontend/src/components/daemon/session-panel.tsx
  - frontend/src/lib/use-daemon-machines.ts
goal: >
  全链路回归确认收口——R-02 interactive 借用沙箱 marker 行为回归、D-009 写约束集成冒烟（writable_dir 内可写/外拒绝/Bash gate 拒绝）、守护进程页面与会话选择器对照原型手工验收。
implementation:
  - R-02 回归（只读确认）——独占串行跑 sillyhub-daemon/tests/daemon-borrow-sandbox.test.ts 验证 interactive 借用 marker/prepareWorkspace/registerBorrowSandbox 链路，backend daemon 模块会话借用测试同步回归，不改 daemon 代码
  - 按 local.yaml / Makefile 既有方式起 backend 服务集成冒烟——workspace 共享会话钉定创建成功且 daemon_borrow_audit 落行（grant_id 非空）；platform 共享智能体会话对 writable_dir 内 Write 成功、目录外 Write 拒绝、Bash 在 canUseTool gate 直接拒绝（D-009 落地确认）
  - 前端对照原型 prototype-daemon-agent-share.html 逐项走查——统计行「共享给我」计数/共享区块虚线卡仅会话按钮且离线禁用/管理卡创建表单与生效列表与停用（仅 admin 可见）/机器选择器三入口共享徽标/档案选择器共享标识/会话头「平台共享」徽标/无共享数据用户页面零变化（兼容红线）
  - 走查与冒烟结果记录到本 change 执行记录；发现的问题登记（属本变更范围的小修须回到对应 task 卡权限内执行）
acceptance:
  - daemon-borrow-sandbox 与 backend daemon/agent 模块命中测试全绿（R-02 回归通过）
  - 冒烟三项写约束行为符合 D-002@v2 与 D-009——writable_dir 内可写/外拒绝/Bash gate 拒绝
  - workspace 共享会话审计行含 grant_id；修改类端点 owner-only 语义未变（FR-03 抽查）
  - 原型走查清单逐项通过并留痕（清单见 implementation 第 3 条）
verify:
  - cd backend && uv run pytest app/modules/daemon -q --no-cov -n auto
  - cd backend && uv run pytest app/modules/agent -q --no-cov -n auto
  - cd sillyhub-daemon && pnpm exec vitest run tests/daemon-borrow-sandbox.test.ts --poolOptions.forks.maxForks=1
  - cd frontend && pnpm test src/components/daemon/__tests__/shared-machines-section.test.tsx src/components/daemon/__tests__/platform-shared-agents-card.test.tsx src/components/floating/floating-session-host.test.tsx
constraints:
  - 验证型任务，仅在发现问题且属本变更范围时才小修（须对应 task 卡权限），否则记录问题不改码
  - 不改 sillyhub-daemon 代码（design §3 Non-Goal）
  - 禁跑全量测试（CLAUDE.md 规则 0）——仅命中模块与文件子集
  - daemon-borrow-sandbox 属预存 fragile 用例，按 local.yaml 惯例独占串行（maxForks=1）执行
---

<!-- 骨架由 sillyspec taskcard 生成（LF 行尾 + frontmatter 已闭合 + 硬校验 9 字段齐全）。
     用 Edit tool 填充上方占位符（allowed_paths/goal/implementation/acceptance/verify/constraints 等），
     勿用 Write 整文件重写——会引入 CRLF 行尾/漏闭合 ---/漏字段回归。
     ⚠️ plan --done 硬校验会拦截未替换的占位符（FR-XX / D-XXX / src/example/file.ts /
     一句话说明这个 task / 具体步骤 1 / 可验证的验收条件 1 / 边界约束 1）——占位符视同缺字段。
     可选字段按需插进上方 frontmatter（规则见 taskcard-rules）：
     repo:          仅跨仓 task 填（local.yaml repos: 注册的仓 key；缺省=main。allowed_paths 相对该仓根写，
                    禁止带仓库名前缀/绝对路径——review 对账按仓根相对路径匹配，带前缀永不命中）
     provides:      仅当本 task 给其他 task 提供接口/DTO/响应时填
     expects_from:  仅当本 task 消费其他 task 的契约时填
     related_tests: 仅当本 task 改动导致既有测试断言失效时填（测试路径须同时进 allowed_paths） -->
