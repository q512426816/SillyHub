---
author: qinyi
created_at: 2026-07-04 17:33:31
task_id: task-02
allowed_paths:
  - sillyhub-daemon/src/hub-client.ts
---

# task-02: daemon 上报版本字段

## 所属 Wave
Wave 1（与 task-01 并行，daemon 侧独立）

## 文件
- 修改 `sillyhub-daemon/src/hub-client.ts`：
  - `RegisterBody`（L37-47）加 `daemon_version: string` + `daemon_build_id: string`
  - `HeartbeatBody`（L85-90）加 `daemon_version: string` + `daemon_build_id: string`
  - `register()`（L294-319）+ `heartbeat()`（L326-335）构造 body 时填入（从 `daemon-version.ts` 的 `DAEMON_VERSION` 与 `build-id.ts` 的 `BUILD_ID` import）

## 验收标准
- [ ] RegisterBody/HeartbeatBody 类型含两字段
- [ ] register/heartbeat 实际请求体含两字段
- [ ] dev 构建 build_id="dev"，release 构建为 git SHA
- [ ] 类型检查 + 现有测试通过

## 依赖
无（与 task-01 并行）

## 覆盖
- FR-01, FR-02, D-001@V1, D-002@V1

## 风险防范
- 字段语义清晰：daemon_version=语义版本，daemon_build_id=SHA（勿与 providers[].version=agent CLI 版本混淆）
