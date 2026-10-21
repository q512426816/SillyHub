---
author: flow-machine-draft
created_at: 2026-10-21T23:14:12.277Z
---
# 任务注册表（Tasks）— 2026-10-22-review-risk-fixes

- [x] task-01: page.tsx 补 `export const dynamic = "force-dynamic"`（FR-01）——验证：源码声明在场 + `cd frontend && pnpm tsc --noEmit` 零错
- [x] task-02: frontend/.dockerignore 追加 `/.proto-staging/` 与 `/public/__proto*/`（FR-02）——验证：两行在场且语法正确（`docker` 通配注释行可读）
- [x] task-03: event-loop-watch defaultSleep 正常到期摘 abort 监听器 + 新增测试（真实 defaultSleep 连续窗口计数归零、abort 路径 reject 不变）（FR-03）——验证：`cd sillyhub-daemon && pnpm vitest run tests/event-loop-watch.test.ts` 全绿
- [x] task-04: decodeGitCQuote 字面字符按 codePoint UTF-8 原字节组装 + 新增 GL49 用例（混合路径/增补平面逐字符还原，既有 GL47 断言不动）（FR-04）——验证：`cd sillyhub-daemon && pnpm vitest run tests/host-fs-handler-git-log.test.ts` 全绿
- [x] task-05: 回归对账——daemon 侧 event-loop-watch / git-log / git-log-quotepath / conflict-quotepath 目标套件全绿 + frontend `pnpm tsc --noEmit` 零错；顺带核知识抽查项 FR-frontend-020/021 绑定
