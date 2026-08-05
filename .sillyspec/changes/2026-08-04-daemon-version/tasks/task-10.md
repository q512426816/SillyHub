---
id: task-10
title: "End-to-end verify daemon rebuild reflects new BUILD_ID via GET /api/daemon/runtimes"
title_zh: "端到端验证改 daemon + pnpm build + 重启 daemon + GET /api/daemon/runtimes 看到 BUILD_ID 变化"
author: WhaleFall
created_at: 2026-08-04 11:14:15
priority: P0
depends_on:
  - task-01
  - task-02
  - task-03
  - task-04
  - task-05
  - task-06
  - task-07
  - task-08
  - task-09
blocks: []
requirement_ids: [FR-01, FR-02]
decision_ids: []
allowed_paths:
  - sillyhub-daemon/src/cli.ts
goal: >
  端到端串起 A 线（daemon 构建号自动注入）与 B 线（backend runtime 端点 JOIN 修复）
  的全链路验收，证明 task-01~09 落地后真实可用：改 daemon 源码触发 pnpm build 重新生成
  BUILD_ID，重启 daemon 让新 BUILD_ID 经 register/heartbeat 上报到 backend，再通过
  GET /api/daemon/runtimes（X-API-Key）读到 daemon_build_id 与之前不同且 daemon_version
  非 null，验证 dev rebuild 立即见效（FR-02）+ runtime 端点版本可见（FR-01）。
implementation:
  - 记下当前 BUILD_ID，curl GET /api/daemon/runtimes 带 X-API-Key 抓 response_body 的 daemon_build_id 与 daemon_version 存为 BEFORE_BUILD_ID / BEFORE_VERSION
  - 对 daemon 源码做无害改动（如 sillyhub-daemon/src/cli.ts 末尾加一行注释），git add + git commit -m "chore(daemon) touch cli for e2e BUILD_ID verify" 推进 git short sha
  - 在 sillyhub-daemon 目录跑 pnpm build 触发 prebuild（task-03）→ gen-build-id.mjs（task-01）重写 src/build-id.ts（新 sha + 新时间戳），cat src/build-id.ts 确认 BUILD_ID 已变
  - 用 sillyhub-daemon stop 再 sillyhub-daemon start --api-key <key> 重启 daemon，让 register 重新上报新 BUILD_ID 与 DAEMON_VERSION 到 backend daemon_instances
  - 再次 curl GET /api/daemon/runtimes 带 X-API-Key 抓 daemon_build_id 存为 AFTER_BUILD_ID，断言 AFTER_BUILD_ID 与 BEFORE_BUILD_ID 不同（BUILD_ID 随 build 变化）
  - 断言 daemon_version 非 null（等于 DAEMON_VERSION 0.1.0，验证 task-07/08 JOIN 修复让版本字段在 runtime 端点可见）
acceptance:
  - 改 daemon 源码 + pnpm build 后 src/build-id.ts 的 BUILD_ID 与改之前不同（时间戳推进 + sha 推进）
  - 重启 daemon 后 GET /api/daemon/runtimes 返回的 daemon_build_id 与 BEFORE_BUILD_ID 不同
  - 同一响应 daemon_version 非 null（不再恒 null，FR-01 验证）
  - 全链路无报错：git commit 成功，pnpm build 退出码 0，daemon start 成功，curl 200
verify:
  - 记 BEFORE，git rev-parse --short=8 HEAD 与 cat sillyhub-daemon/src/build-id.ts 各取一次
  - 改 sillyhub-daemon/src/cli.ts 加一行注释后 git add sillyhub-daemon/src/cli.ts && git commit -m "chore(daemon) e2e verify BUILD_ID bump"
  - cd sillyhub-daemon && pnpm build（prebuild 自动跑 gen-build-id.mjs）
  - cat sillyhub-daemon/src/build-id.ts 确认 BUILD_ID 已变
  - sillyhub-daemon stop 然后 sillyhub-daemon start --api-key "$DAEMON_API_KEY"
  - curl -s -H "X-API-Key: $DAEMON_API_KEY" http://127.0.0.1:8000/api/daemon/runtimes | jq '.items[0] | {daemon_build_id, daemon_version}'
  - 断言 daemon_build_id 与 BEFORE 不同，daemon_version 非 null
constraints:
  - 仅做端到端验证，不改业务源码（除 cli.ts 加一行无害注释推动 sha 外不动其它代码）
  - 不修改测试，不修改 gen-build-id.mjs / router.py / service.py
  - 不手改 build-id.ts 绕过 gen 注入，BUILD_ID 必须由 pnpm build 真实生成
  - daemon 重启走正式 stop/start 命令，不 kill -9
  - 验证完毕保留 cli.ts 的无害注释提交，不回滚（避免下次 sha 又变）
---
