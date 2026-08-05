---
id: task-11
title: "pnpm bundle regression (latest.json version still extractable by backend regex)"
title_zh: "pnpm bundle 回归（latest.json version 仍被 backend 正则提取）"
author: WhaleFall
created_at: 2026-08-04 11:14:15
priority: P1
depends_on: [task-04, task-05]
blocks: []
requirement_ids: [FR-02]
decision_ids: []
allowed_paths:
  - sillyhub-daemon/build/bundle/sillyhub-daemon.js
  - sillyhub-daemon/scripts/build-bundle.sh
expects_from:
  task-04:
    - build-bundle.sh 已改用 node scripts/gen-build-id.mjs，bundle 产物 sillyhub-daemon.js 内 BUILD_ID 字面量由 gen 产出（export const BUILD_ID: string = "<sha>-<ts>"; 经 tsc + ncc 内联）
  task-05:
    - gen-build-id.mjs 输出格式正则回归测试已落地（断言 backend 正则 BUILD_ID\s*=\s*["'] 能从新 build-id.ts 提取）
goal: >
  跑一次 pnpm bundle 生成 build/bundle/sillyhub-daemon.js，用 backend 同款正则
  （_compute_daemon_version router.py:110-125）从 bundle JS 提取 BUILD_ID，
  断言非空且格式为 <sha>-<ts>，确认 latest.json 的 version 链路（backend 从
  bundle 正则提取）不被 gen-build-id.mjs 新格式（带 : string 注解 + 双引号）
  破坏，守护 daemon self-update 升级判断（R-04）。
implementation:
  - 在 sillyhub-daemon 目录跑 pnpm bundle（等价 bash scripts/build-bundle.sh），等 tsc + ncc 产出 build/bundle/sillyhub-daemon.js
  - 用 backend _compute_daemon_version 同款正则 BUILD_ID\s*=\s*["']([^"']+) 从 sillyhub-daemon.js 文本提取，正则字符类按 router.py:122 原样复刻（含 \x27 单引号容忍）
  - 断言提取结果非空、不等于 unknown、且匹配 ^[A-Za-z0-9]+-\d{14}$（sha 前缀 + 14 位时间戳）
  - 同步跑 _compute_daemon_semver 正则 DAEMON_VERSION\s*=\s*["']([^"']+) 提取，断言语义版本非空（self-update 展示链路）
  - 若本地非 git 目录，断言 fallback 形如 unknown-\d{14}（R-01 兜底路径仍被正则提取，self-update 不破）
acceptance:
  - pnpm bundle 产物 build/bundle/sillyhub-daemon.js 存在且非空
  - 用 backend 同款正则从该 bundle 提取的 BUILD_ID 非空且格式为 <sha>-<ts>（dev 环境 sha 缺失时为 unknown-<ts>）
  - 提取结果与单独跑 node scripts/gen-build-id.mjs 写入 src/build-id.ts 的值一致（同源 D-002）
  - DAEMON_VERSION 提取结果非空（self-update 版本展示链路同步不破）
verify:
  - 手动 pnpm bundle 后 grep build/bundle/sillyhub-daemon.js 确认 BUILD_ID 字面量已被 ncc 内联（非旧硬编码 4c238ebe-20260729112052）
  - 用 python -c 复刻 _compute_daemon_version 正则对 bundle 文本提取，比对与 gen 产出一致
  - 可选：把 bundle 复制到 backend daemon_dist_dir，启动 backend 调 GET /api/daemon/version 确认返回非 unknown（端到端 self-update 链路）
constraints:
  - 本任务为回归验证类，不修改 gen-build-id.mjs / build-bundle.sh / router.py 逻辑（这三处改动分别归 task-01 / task-04 / backend 既有）
  - 提取正则以 backend router.py:110-125 现状为准（容忍 : string 注解 + 双引号），不在此任务改 backend 正则
  - 跨平台：pnpm bundle 在本机（Windows git bash）/CI（Linux）均跑得通；gen 脚本跨平台责任在 task-01
  - 不写持久化单测（单测归 task-05），本任务以手动/脚本断言验证为主，避免与 task-05 重复
---
