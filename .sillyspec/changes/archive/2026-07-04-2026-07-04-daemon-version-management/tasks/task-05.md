---
author: qinyi
created_at: 2026-07-04 17:33:31
task_id: task-05
allowed_paths:
  - sillyhub-daemon/src/__tests__/hub-client.test.ts
---

# task-05: daemon 上报测试

## 所属 Wave
Wave 1

## 文件
- 修改/新增 `sillyhub-daemon/src/__tests__/hub-client.test.ts`（或对应 hub-client 测试文件）

## 验收标准
- [ ] 断言 register 请求 body 含 daemon_version + daemon_build_id
- [ ] 断言 heartbeat 请求 body 含 daemon_version + daemon_build_id
- [ ] 断言值来自 DAEMON_VERSION / BUILD_ID 常量
- [ ] 全量 daemon 测试通过

## 依赖
- task-02（字段已加）

## 覆盖
- FR-01, FR-02, D-001@V1

## 测试命令
`cd sillyhub-daemon && pnpm test`（或 vitest 对应）

## 风险防范
- mock fetch/请求时核对 body 字段名拼写
