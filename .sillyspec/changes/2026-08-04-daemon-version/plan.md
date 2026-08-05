---
plan_level: full
author: WhaleFall
created_at: 2026-08-04 11:14:15
---

# 实现计划（Plan）— daemon 版本可见与构建号自动注入

## 模块并行策略
两条独立改动线，Wave 间可并行：
- **A 线（sillyhub-daemon）**：构建号 build 自动注入（task-01~06）
- **B 线（backend）**：runtime 端点 JOIN 修复（task-07~09）
- 汇聚于 Wave 4 端到端验证（task-10/11）

## Wave 1（基础，并行，无依赖）
- [ ] task-01: 新增 `sillyhub-daemon/scripts/gen-build-id.mjs`（覆盖：FR-02, D-001@v1, D-002@v1）
- [ ] task-07: `backend/app/modules/daemon/runtime/service.py` 6 处加 `JOIN DaemonInstance`（覆盖：FR-01, D-004@v1）

## Wave 2（接线，依赖 Wave 1）
- [ ] task-02: `src/build-id.ts` 移出版控（`.gitignore` + `git rm --cached`，先 ignore 后 rm）（覆盖：FR-03, D-003@v1；depends: task-01）
- [ ] task-03: `package.json` 加 `prebuild` + `postinstall` 跑 `gen-build-id.mjs`（覆盖：FR-03, D-003@v1；depends: task-01）
- [ ] task-04: `scripts/build-bundle.sh` 改用 `gen-build-id.mjs`（替换 :29-39 printf，源头单一）（覆盖：FR-02, D-002@v1；depends: task-01）
- [ ] task-05: `gen-build-id` 输出格式回归测试（断言 backend 正则 `BUILD_ID\s*=\s*["']` 能从新 build-id.ts 提取）（覆盖：R-04；depends: task-01）
- [ ] task-08: `router.py` 6 个 runtime 端点调 `_runtime_read` 填充版本字段（覆盖：FR-01, D-004@v1；depends: task-07）

## Wave 3（集成测试，依赖 Wave 2）
- [ ] task-06: daemon 上报冒烟测试（gen 重构后断言 `BUILD_ID` 非空 + register/heartbeat 不变）（覆盖：FR-02；depends: task-01, task-03, task-04）
- [ ] task-09: backend 端点测试（register 后 list + 5 单端点断言 `daemon_version` 非 null；旧 daemon NULL 兼容）（覆盖：FR-01；depends: task-07, task-08）

## Wave 4（端到端验证，依赖 Wave 3）
- [ ] task-10: 端到端 — 改 daemon + `pnpm build` + 重启 daemon + `GET /api/daemon/runtimes` 看到 `BUILD_ID` 变化（覆盖：FR-01, FR-02；depends: task-01~09）
- [ ] task-11: `pnpm bundle` 回归 — `latest.json` version 仍被 backend 正则提取（`_compute_daemon_version`）（覆盖：R-04, FR-02；depends: task-04, task-05）

## 任务总表
| 编号 | 任务 | Wave | 优先级 | 依赖 | 覆盖 FR/D | 说明 |
|---|---|---|---|---|---|---|
| task-01 | 新增 gen-build-id.mjs（跨平台 git-sha+ts，写 build-id.ts，非 git fallback unknown-<ts>） | W1 | P0 | — | FR-02, D-001, D-002 | A 线基础 |
| task-07 | service.py list_runtimes 等 6 处 JOIN DaemonInstance（照搬 list_runtimes_page tuple） | W1 | P0 | — | FR-01, D-004 | B 线基础 |
| task-02 | build-id.ts 移出版控（.gitignore + git rm --cached） | W2 | P0 | task-01 | FR-03, D-003 | 先 ignore 后 rm |
| task-03 | package.json prebuild + postinstall | W2 | P0 | task-01 | FR-03, D-003 | 双保险生成 |
| task-04 | build-bundle.sh 改用 gen-build-id.mjs | W2 | P0 | task-01 | FR-02, D-002 | 源头单一 |
| task-05 | gen 输出格式正则回归测试 | W2 | P1 | task-01 | R-04 | 守护 self-update |
| task-08 | router.py 6 端点调 _runtime_read 填充 | W2 | P0 | task-07 | FR-01, D-004 | 复用 :442-463 模式 |
| task-06 | daemon 上报冒烟测试 | W3 | P1 | task-01,03,04 | FR-02 | BUILD_ID 非空 |
| task-09 | backend 端点测试（list + 5 单端点 + NULL 兼容） | W3 | P0 | task-07,08 | FR-01 | register→list 断言 |
| task-10 | 端到端验证（dev rebuild + GET runtimes 见版本变） | W4 | P0 | task-01~09 | FR-01,02 | 全链路 |
| task-11 | pnpm bundle 回归（latest.json 正则提取） | W4 | P1 | task-04,05 | R-04, FR-02 | self-update 链路 |

## 关键路径
- **A 线**：task-01 → task-03 → task-06 → task-10（dev 构建号验证）
- **B 线**：task-07 → task-08 → task-09 → task-10（backend 版本可见）
- **汇聚**：task-10（端到端，需 A+B 都完成）；task-11（bundle 链：task-01→task-04→task-11）
- 最长 4 个 Wave（W1→W2→W3→W4）

## 文件覆盖对账（design 文件变更清单 → task allowed_paths）
| design 清单文件 | 覆盖 task |
|---|---|
| `sillyhub-daemon/scripts/gen-build-id.mjs`（新） | task-01 |
| `sillyhub-daemon/scripts/build-bundle.sh` | task-04 |
| `sillyhub-daemon/package.json` | task-03 |
| `sillyhub-daemon/.gitignore` | task-02 |
| `sillyhub-daemon/src/build-id.ts`（移出版控） | task-02（rm --cached）+ task-01（gen 写） |
| `backend/app/modules/daemon/runtime/service.py` | task-07 |
| `backend/app/modules/daemon/router.py` | task-08 |
| `backend/app/modules/daemon/tests/` | task-09（+ task-05 在 sillyhub-daemon/tests） |

## 全局验收标准
- [ ] 所有单元/集成测试通过（backend pytest + sillyhub-daemon vitest）
- [ ] `pnpm build` 后 `BUILD_ID` 变化（git sha + 新时间戳）
- [ ] `GET /api/daemon/runtimes`（+ 5 单 runtime 端点）register 后返回 `daemon_version/daemon_build_id` 非 null
- [ ] clone + `pnpm install` + `pnpm build` 不缺 `build-id.ts`（postinstall/prebuild 生成）
- [ ] `pnpm bundle` 后 `latest.json` version 仍被 backend 正则提取（self-update 不破）
- [ ] 旧 daemon（不上报版本）兼容（字段 Optional，instance=None 返回 None）
- [ ] （brownfield）未上报版本的旧 daemon 行为不变

## 覆盖矩阵（decisions.md）
| ID | 覆盖任务 | 验收证据 |
|---|---|---|
| D-001@v1 | task-01, task-06, task-10 | BUILD_ID 每次 build 变化（AC: pnpm build 后 BUILD_ID 不同）|
| D-002@v1 | task-01, task-04, task-05 | gen-build-id.mjs 被 build + bundle 共用（AC: build-bundle.sh 调 gen）|
| D-003@v1 | task-02, task-03, task-10 | build-id.ts 移出版控 + postinstall/prebuild 生成（AC: clone+install+build 不缺文件）|
| D-004@v1 | task-07, task-08, task-09 | backend 6 端点 JOIN 修复（AC: GET runtimes daemon_version 非 null）|
