---
id: task-09
title: '收尾——部署说明（先 backend 后 daemon）+ 模块文档同步（backend.md/daemon.md 契约层）+ 全量回归（backend pytest / daemon vitest / frontend vitest，按 local.yaml）'
title_zh: '收尾——部署说明（先 backend 后 daemon）+ 模块文档同步（backend.md/daemon.md 契约层）+ 全量回归（backend pytest / daemon vitest / frontend vitest，按 local.yaml）'
author: 'qinyi'
created_at: 2026-08-21 11:55:44
priority: P2
depends_on: [task-01, task-02, task-03, task-04, task-05, task-06, task-07, task-08]
blocks: []
requirement_ids: [NFR-03]
decision_ids: []
allowed_paths:
  - .sillyspec/docs/multi-agent-platform/modules/backend.md
  - .sillyspec/docs/multi-agent-platform/modules/sillyhub-daemon.md
  - .sillyspec/changes/2026-08-21-session-reopen-resume/deploy-notes.md
  - backend/app/modules/daemon/tests/test_session_reopen.py
goal: >
  变更收尾（Wave 4，依赖 task-01~08 全部）——产出部署说明（发版顺序 + 旧 daemon 过渡期 +
  回滚）、把本变更新契约同步进 backend.md / sillyhub-daemon.md 契约摘要、跑三模块全量回归，
  为 reopen 链路变更收口。
implementation:
  - 新建 .sillyspec/changes/2026-08-21-session-reopen-resume/deploy-notes.md——①发版顺序：先 backend 后 daemon，理由 = backend 兜底先行（task-05 sweeper 自动收敛 + task-04 手动重试窗口先就位，旧 daemon 不发 confirm 也不会永久卡死）；②旧 daemon 过渡期行为：不发 confirm → 会话停 reconnecting → 180s（RECONNECTING_RETRY_WINDOW_SEC）后 sweeper 置 failed + 挂起 lease cancelled，用户可再次 reopen（前端 240s 后出现重开入口）；③回滚注意：反序回滚（先 daemon 后 backend）；新 daemon 确认请求携带的 lease_id 在旧 backend schema 下被忽略、退回旧翻转语义（陈旧确认防护失效的窗口期，需尽快二次对齐版本）；行为回滚按 plan.md「风险与回退」以单 commit 粒度 git revert
  - backend.md「契约摘要」追加本变更条目，格式对齐既有条目（- **<名称>**（2026-08-21-session-reopen-resume）：<简述>）——涵盖：confirm-reconnected / mark-recovery-failed 请求体 SessionRuntimeRequest 新增可选 lease_id（不匹配当前 lease 幂等跳过防陈旧确认，未提供保持现状向后兼容）；reopen 窗口语义（reconnecting 且 last_active_at 超时 >180s 放行重开、旧挂起 lease 置 cancelled；cwd 空 409 中文文案拒绝）；lifespan 常驻巡检协程（60s 周期，reconnecting 超时置 failed + lease 置 cancelled，同时覆盖旧 daemon 过渡期）
  - sillyhub-daemon.md「契约摘要」追加本变更条目（同款变更名前缀 + 简述格式）——SESSION_RESUME 恢复成功/失败双向确认：_routeSessionResume 成功调 confirmReconnected、失败（restoreAndReconnect 抛错 + SessionAlreadyExistsError try 前分支）调 markRecoveryFailed，均携 lease_id；runtimeId 从 SESSION_RESUME payload 显式供给（F1，不依赖仅 recover 链路填充的内存映射）
  - 三模块全量回归（local.yaml commands.test 拆开跑）——cd backend && uv run pytest -q --no-cov；cd frontend && pnpm test；cd sillyhub-daemon && pnpm test；backend 全量历史记录 ~12min（local.yaml 坑 2），执行时超时给足（单命令上限不足则按 local.yaml modules 块分子模块跑，或用 SILLYSPEC_TEST_TIMEOUT_MS 调整 gate 超时）
  - 兜底检查 backend/app/modules/daemon/tests/test_session_reopen.py TestReopenConfirmLinkage docstring（:638-640「no lease/token check」）已随 task-03 更新为 lease_id 校验现状——task-03 未做则此处补（plan.md 连带测试债清单；仅改 docstring，不动断言与测试逻辑）
acceptance:
  - backend pytest / frontend vitest / daemon vitest 三模块全量绿（含 task-01~08 新增测试零回归）
  - backend.md 与 sillyhub-daemon.md 契约摘要各含本变更条目（lease_id 可选字段、reopen 窗口、sweeper 协程 / daemon 双向确认）
  - deploy-notes.md 存在且含发版顺序（先 backend 后 daemon + 理由）、旧 daemon 过渡期行为、回滚注意三部分
  - TestReopenConfirmLinkage docstring 与 lease_id 校验现状一致（无「no lease/token check」过时表述）
verify:
  - cd backend && uv run pytest -q --no-cov
  - cd frontend && pnpm test
  - cd sillyhub-daemon && pnpm test
constraints:
  - 纯收尾任务——不改业务代码；唯一例外是 test_session_reopen.py docstring 兜底更新（仅注释，不动断言）
  - daemon 套件已知并发 flaky 3 文件（task-09-spec-pull-push / spec-transport-tar-sync/daemon-interactive-spec-sync / daemon-borrow-sandbox，local.yaml 有记录）若满载偶发 timeout，按 local.yaml 惯例以 maxForks=1 串行独跑复验，不算回归
  - design.md 不回改（保持已过审 hash 稳定）；契约细节以 design §5 生命周期契约表为准
  - 文档默认中文（必要专业术语除外）；deploy-notes.md 落在变更目录内，不散落仓库根
---

<!-- 骨架由 sillyspec taskcard 生成（LF 行尾 + frontmatter 已闭合 + 硬校验 9 字段齐全）。
     用 Edit tool 填充上方占位符（allowed_paths/goal/implementation/acceptance/verify/constraints 等），
     勿用 Write 整文件重写——会引入 CRLF 行尾/漏闭合 ---/漏字段回归。
     可选字段按需插进上方 frontmatter（规则见 taskcard-rules）：
     provides:      仅当本 task 给其他 task 提供接口/DTO/响应时填
     expects_from:  仅当本 task 消费其他 task 的契约时填
     related_tests: 仅当本 task 改动导致既有测试断言失效时填（测试路径须同时进 allowed_paths） -->
