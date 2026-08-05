---
author: WhaleFall
created_at: 2026-08-04 11:04:59
---

# 任务清单（Tasks）

> 仅列任务名与要点，细节在 plan 阶段（Wave 分组 + 依赖）展开。

## A. daemon 构建号自动注入（sillyhub-daemon）
- [ ] task-01: 新增 `scripts/gen-build-id.mjs`（跨平台 `git rev-parse --short=8` + 时间戳，写 `src/build-id.ts`，非 git 目录 fallback `unknown-<ts>`）
- [ ] task-02: `src/build-id.ts` 移出版控（`.gitignore` 加项 + `git rm --cached`，顺序：先 ignore 后 rm）
- [ ] task-03: `package.json` 加 `prebuild` + `postinstall` 跑 `gen-build-id.mjs`
- [ ] task-04: `scripts/build-bundle.sh` 改用 `gen-build-id.mjs`（替换 `:29-39` printf，源头单一，保持输出格式）
- [ ] task-05: `gen-build-id` 输出格式回归测试（断言 backend 正则 `BUILD_ID\s*=\s*["']` 能从新 `build-id.ts` 提取，守护 self-update 链路）
- [ ] task-06: daemon 上报冒烟测试（gen 重构后断言 `BUILD_ID` 非空 + register/heartbeat 上报不变）

## B. backend runtime 端点 JOIN 修复
- [ ] task-07: `runtime/service.py` `list_runtimes` 等 6 处加 `JOIN DaemonInstance`（照搬 `list_runtimes_page` 的 `(runtime, instance)` tuple 模式 `service.py:484/523-525`）
- [ ] task-08: `router.py` 6 个 runtime 端点（list `:934-946` / read `:567` / update `:817` / disable `:834` / enable `:851` / offline `:885`）调 `_runtime_read` 填充 `daemon_version/daemon_build_id`
- [ ] task-09: 测试 — register 后 `GET /api/daemon/runtimes` + 5 个单端点断言 `daemon_version` 非 null；旧 daemon（NULL）兼容

## C. 验证
- [ ] task-10: 端到端 — 改 daemon + `pnpm build` + 重启 daemon + `GET /api/daemon/runtimes` 看到 `BUILD_ID` 变化
- [ ] task-11: `pnpm bundle` 回归 — `latest.json` version 仍被 backend 正则提取（`_compute_daemon_version`）
