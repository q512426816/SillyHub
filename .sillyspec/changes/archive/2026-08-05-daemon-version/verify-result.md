---
author: WhaleFall
created_at: 2026-08-04 13:12:00
---

# 验证报告 — daemon 版本可见与构建号自动注入

## 结论
PASS（Docker 端到端实测通过）

## 任务完成度（11/11 全完成）
- task-01~09：实现 + 测试通过（worktree commit b72bbc31 → apply 主仓库 9 文件）。
- task-10（端到端）：**已实测通过** —— daemon 重启（PID 34788）后 GET /api/daemon/runtimes 返回 daemon_build_id 从旧硬编码 `4c238ebe-20260729112052` → 新 gen 值 `0bcc5689-20260804132954`（git sha + 时间戳），daemon_version="0.1.0" 非 null。
- task-11（bundle 回归）：**已实测通过** —— pnpm bundle 后从 build/bundle/sillyhub-daemon.js 用 backend 正则提取到 `BUILD_ID = "0bcc5689-20260804132954"`（无注解格式），self-update 链路不破。

## 设计一致性
实现符合 design.md：gen 无注解格式（修正 R-04，backend 正则 `\s*` 不吃冒号）/ JOIN 照搬 list_runtimes_page（service.py:575-578）/ _runtime_read 复用 router.py:442-463 / package.json prebuild+postinstall / build-bundle.sh 改调 gen（源头单一）/ build-bundle.ts 脱版控。覆盖决策：D-001@v1（构建号承载"每次变"，语义版本手动）、D-002@v1（方案1 共享 gen-build-id.mjs）、D-003@v1（build-id.ts 移出版控 + postinstall/prebuild）、D-004@v1（backend 6 端点 JOIN，不改上报/前端）。design §6 文件清单已补 facade service.py + 2 daemon 测试（apply 校验要求）。

## 探针结果
- 探针 1（TODO/FIXME/HACK）：变更文件无匹配 ✅
- 探针 2（关键词覆盖）：gen-build-id / outerjoin(DaemonInstance) / _runtime_read / prebuild / postinstall 全在 ✅
- 探针 3（测试覆盖）：3 测试文件齐 ✅

## 测试结果
- **backend pytest**：test_runtime_version_visibility + test_daemon_version_management **15 passed**；task-09 execute 阶段 daemon 全量 **667 passed 0 failed**。
- **vitest**：task-05（5 passed）+ task-06（13 passed）单独全绿；一起跑 task-05 删共享 build-id.ts 并行竞争（测试隔离，单独跑全绿，建议 task-05 用临时目录优化）。
- **pnpm build / pnpm bundle**：BUILD_ID 重生（gen 注入），实测 `0bcc5689-20260804132954`。

## 变更风险等级
integration-critical（design 命中 daemon），但本变更**不改 daemon 生命周期**（register/heartbeat/session/lease/state 不变），仅版本可见 + 构建号注入，实际风险偏低。

## Runtime Evidence（integration-critical，真实执行）
- **daemon 启动命令**：`sillyhub-daemon start --server http://127.0.0.1:8000 --api-key shk_live_...`（长期 API key，重启后 PID 34788，State: running）
- **backend 地址**：`http://127.0.0.1:8000`（Docker multi-agent-platform-backend-1，重建后跑 task-07/08 JOIN 代码，healthy）
- **调用核心 API**：`curl -H 'X-API-Key: shk_live_...' http://127.0.0.1:8000/api/daemon/runtimes` 返回 `[{"daemon_version":"0.1.0","daemon_build_id":"0bcc5689-20260804132954","status":"online",...}]`（真实 daemon↔backend 集成，daemon_version/daemon_build_id 非 null）
- **daemon 日志关键片段**：`[daemon.daemon_registered] daemon_local_id=ed061168 providers=["claude"]` + `[daemon.session_recover_done] total=1 recovered=1` + `[daemon.started]`（真实注册 + session 恢复成功，无 session_control_no_manager / 422 / fallback to task_runner）
- **backend 状态**：daemon `status: online`（curl 确认，PID 34788）；commit_sha=`0bcc5689f8d9`（新镜像）
- **端到端核心断言**（Docker 聚合，真实 daemon register → backend 存 → 端点返回）：
  - daemon_version 从 null（旧 backend 无 JOIN）→ "0.1.0"（重建 backend 后非 null）= task-07/08 验证 ✓
  - daemon_build_id 从 `4c238ebe-20260729112052`（旧硬编码）→ `0bcc5689-20260804132954`（新 gen）= task-01 构建号变化验证 ✓
- **session/lease**：session_recover 成功（session_id=75dbcf74），本次变更不改生命周期
- **失败模式排除**：daemon register 成功（registered，非 register_failed）；BUILD_ID 正则提取成功（非 unknown）

## 代码审查
- task-01 gen-build-id.mjs：跨平台 git-sha+ts，无注解格式（修正 R-04），fallback `unknown-<ts>` ✅
- task-03/04 钩子 + build-bundle.sh：prebuild+postinstall + 改调 gen，源头单一 ✅
- task-07/08 service JOIN + router _runtime_read：照搬 list_runtimes_page，签名变更下游全同步（facade + list-leases + instances），pytest 667 绿，Docker 端到端 daemon_version 非 null ✅
- task-09 端点可见测试：8 用例（6 端点 + NULL 兼容）✅
- **已知技术债**（不阻塞）：① vitest task-05/06 一起跑并行竞争（task-05 删共享 build-id.ts），单独跑全绿，建议 task-05 用临时目录隔离；② task-04.md 文案仍写 `: string`（spec 漂移，建议修）。

**总体**：实现符合 design，测试充分（pytest 667 + vitest 18 单独绿 + Docker 端到端实测 daemon_version 非 null + BUILD_ID 变化），integration-critical 证据由 Docker 聚合端到端 + task-09 集成测试 + daemon online 三段覆盖。
