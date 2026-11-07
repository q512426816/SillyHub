---
id: task-15
title: '现有 dialog/审批测试回归 + 原型产物对账（prototype 重编译 git diff 为空）'
title_zh: '现有 dialog/审批测试回归 + 原型产物对账（prototype 重编译 git diff 为空）'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-11-07 00:39:35
priority: P1
depends_on: [task-14]
blocks: []
requirement_ids: [FR-01, FR-02, FR-03, FR-04, FR-05, FR-06]
decision_ids: [D-008, D-009]
allowed_paths:
  - frontend/src/components/prototype/git-approval-view.tsx
  - frontend/scripts/prototype-build.mjs
  - frontend/src/components/daemon/__tests__/git-approval-card.test.tsx
  - frontend/src/components/daemon/__tests__/pending-dialog-dock.test.tsx
  - frontend/src/components/daemon/__tests__/plan-approval-card.test.tsx
  - frontend/src/components/daemon/__tests__/turn-timeline-dialog-inplace.test.tsx
  - frontend/src/components/daemon/__tests__/session-panel-dialog.test.tsx
  - frontend/src/components/permissions/__tests__/session-permission-minimize.test.tsx
  - frontend/src/components/group-chat/__tests__/group-askuser-aggregate.test.tsx
target_files: []  # 可选：本 task 计划改动的文件（对账用精确路径清单，格式见下方注释；不填保留 []）
goal: >
  变更收尾回归与对账——dialog/审批/dock 存量测试套件文件级零回归复核、原型产物重编译对账（pnpm -C frontend prototype:build 后原型相关 git diff 为空）、提交已批准冻结的原型两件（git-approval-view.tsx 与 prototype-build.mjs），兑现全局验收标准 1/5 与 R-08 批准冻结承诺。
implementation:
  - 存量回归（文件级禁全量）——跑 dialog/审批/dock 相关既有测试与本变更新增卡测试——pending-dialog-dock.test.tsx / plan-approval-card.test.tsx / turn-timeline-dialog-inplace.test.tsx / session-panel-dialog.test.tsx / permissions/session-permission-minimize.test.tsx / group-chat/group-askuser-aggregate.test.tsx / git-approval-card.test.tsx，全部通过即存量零回归（全局验收 1）
  - 回归发现断言失效时的处置——非测试逻辑本身有误禁改测试迁就，生产缺陷回流 task-11/12 修复；确属测试 mock 缺字段的按惯例补齐字段修好（规则 21 末条惯例），修正仅限 allowed_paths 内测试文件
  - 原型对账（R-08 批准冻结）——pnpm -C frontend prototype:build 重编译 → git status/diff 确认原型源 frontend/src/components/prototype/git-approval-view.tsx、VIEWS 登记 frontend/scripts/prototype-build.mjs、编译产物（变更目录 prototype-git-approval.html）三者均无新 diff，即重编译产物与落盘版本逐字节一致（全局验收 5）
  - 提交原型两件——git-approval-view.tsx 与 prototype-build.mjs 随本变更提交流程入库（走 sillyspec-commit；编译产物 HTML 已在变更目录一并入库）；对账不一致时先排查编译环境差异再回报，不手改产物 HTML
  - 终检——pnpm -C frontend exec tsc --noEmit；触及 src 文件改动时补跑 lint
acceptance:
  - 上述七个测试文件（六个存量 + 一个新增）全部通过——dialog/审批/dock 存量零回归（全局验收 1）
  - pnpm -C frontend prototype:build 后原型相关 git diff 为空（全局验收 5 / R-08 对账通过）
  - 原型两件（frontend/src/components/prototype/git-approval-view.tsx、frontend/scripts/prototype-build.mjs）已提交入库，git log 可见
  - pnpm -C frontend exec tsc --noEmit 通过
verify:
  - pnpm -C frontend test -- src/components/daemon/__tests__/pending-dialog-dock.test.tsx src/components/daemon/__tests__/plan-approval-card.test.tsx src/components/daemon/__tests__/turn-timeline-dialog-inplace.test.tsx src/components/daemon/__tests__/session-panel-dialog.test.tsx src/components/permissions/__tests__/session-permission-minimize.test.tsx src/components/group-chat/__tests__/group-askuser-aggregate.test.tsx src/components/daemon/__tests__/git-approval-card.test.tsx
  - pnpm -C frontend prototype:build 后 git status --porcelain 无原型相关新变更（diff 为空对账）
  - pnpm -C frontend exec tsc --noEmit
constraints:
  - 禁止跑全量测试（仅文件级相关套件，规则 0；全量留给 CI）
  - 非测试逻辑本身有误时禁改测试迁就——生产缺陷回流 task-11/12 修复
  - 原型两件为批准冻结形态——本卡不改其内容只做对账与提交；对账不一致先查环境再回报，禁止手改编译产物 HTML
  - 存量测试若因分流动断言失效需修正，仅限 allowed_paths 内测试文件且以补齐 mock 字段为限
---

<!-- 骨架由 sillyspec taskcard 生成（LF 行尾 + frontmatter 已闭合 + 硬校验 9 字段齐全）。
     用 Edit tool 填充上方占位符（allowed_paths/goal/implementation/acceptance/verify/constraints 等），
     勿用 Write 整文件重写——会引入 CRLF 行尾/漏闭合 ---/漏字段回归。
     ⚠️ plan --done 硬校验会拦截未替换的占位符（FR-XX / D-XXX / src/example/file.ts /
     一句话说明这个 task / 具体步骤 1 / 可验证的验收条件 1 / 边界约束 1）——占位符视同缺字段。
     target_files 格式（可选，对账用精确文件级意图声明，与 allowed_paths 语义不同）：
                    精确文件路径（仓根相对、正斜杠），当前不存在、将由本 task 新建的文件加
                    NEW: 前缀（如 NEW:src/foo.js）；禁 glob（src/**）、禁目录前缀（src/dir/）、
                    禁绝对路径；无明确文件级意图时保留 [] 占位行不动。
     implementation/acceptance 里的源码位置同样写仓根相对全路径+行号（src/foo.js:123）——
                    裸文件名在 docs-check 层1 靠 basename 全仓扫描找候选，找不到候选或关键词
                    窗口不匹配即失效，到 pre-push 才拦（2026-09-19 实证 64 处返工）。
     可选字段按需插进上方 frontmatter（规则见 taskcard-rules）：
     repo:          仅跨仓 task 填（local.yaml repos: 注册的仓 key；缺省=main。allowed_paths 相对该仓根写，
                    禁止带仓库名前缀/绝对路径——review 对账按仓根相对路径匹配，带前缀永不命中）
     provides:      仅当本 task 给其他 task 提供接口/DTO/响应时填
     expects_from:  仅当本 task 消费其他 task 的契约时填
     related_tests: 仅当本 task 改动导致既有测试断言失效时填（测试路径须同时进 allowed_paths） -->
