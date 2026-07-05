---
author: qinyi
created_at: 2026-07-04 18:39:53
change: 2026-07-04-daemon-version-management
verdict: CONDITIONAL_PASS
---

# verify-result.md — daemon 版本可见 + 远程升级入口

## 验证结论

**CONDITIONAL_PASS**：本变更实现完整、对照 design/plan 一致、相关测试全绿。7 个预存失败属 2026-07-03-daemon-entity-binding 遗留（与本变更无关，git diff 证实未碰相关文件），不阻塞本变更归档，建议单独 quick 修复。

## 实现完整性（对照 design.md / plan.md）

| Task | 状态 | 依据 |
|---|---|---|
| task-01 backend model + migration | ✅ | DaemonInstance.build_id 列 + migration 202607041800（down=b16bf63a5d05，alembic 单 head 确认） |
| task-02 daemon hub-client 上报 | ✅ | RegisterBody/HeartbeatBody 加字段，register/heartbeat 内部填 DAEMON_VERSION/BUILD_ID（ESM .js import） |
| task-03 backend schema 接收 | ✅ | DaemonRegisterRequest + router.py L152 DaemonHeartbeatRequest（生效版）加 Optional 字段；schema.py 旧残留标注废弃（R-01） |
| task-04 backend service 写入 | ✅ | runtime + facade register/heartbeat 写 version/build_id（heartbeat 仅非 None 刷新，D-008） |
| task-05 daemon 上报测试 | ✅ | hub-client.test.ts 版本字段断言（39 passed） |
| task-06 backend DTO 返回 | ✅ | DaemonRuntimeRead/DaemonInstanceRead 加字段 + list_runtimes_page JOIN daemon_instances + _runtime_read 填充 |
| task-07 GET /version 扩展 | ✅ | _compute 双提取 + get_daemon_latest_semver + DaemonVersionResponse 加 latest_version/build_id；get_daemon_latest_version 不变（D-009） |
| task-08 前端类型 + hook | ✅ | api-types 重生成 + daemon.ts triggerDaemonSelfUpdate/getDaemonVersion/DaemonVersionInfo |
| task-09 runtimes 页展示 + 升级按钮 | ✅ | RuntimeCard 版本 + SHA 短码 + 徽标 4 态 + 升级按钮 + toast + offline 禁用 |
| task-10 前端测试 | ✅ | page.test.tsx 8 用例（18/18 passed） |
| task-11 端到端 + backend 测试 | ✅ | test_daemon_version_management.py 7 用例 + facade 透传修复（64 passed） |

FR-01~FR-09 全覆盖；D-001~D-009 全落地；design §2-§11 各章节与实现一致，无偏差。

## 测试结果

| 子项目 | 结果 | 说明 |
|---|---|---|
| backend pytest | 2205 passed / 3 failed / 10 skipped / 5 xfailed | 3 failed 为 2026-07-03 遗留（见下） |
| frontend vitest | 618 passed / 0 failed / 29 todo / 1 skipped | 全绿零回归 |
| daemon vitest | 1704 passed / 4 failed / 8 skipped | 4 failed 为 2026-07-03 遗留（见下） |
| backend ruff format/check | Passed | Wave 1/2/3 + task-11 全过 |
| frontend tsc --noEmit | 通过 | 子代理验证 |

**本变更相关测试全绿**：backend daemon 模块 64（57+7 新）、frontend runtimes 页 18、daemon hub-client 39。

## 预存失败（非本变更引起，不阻塞归档）

`git diff fecaa155 main -- tests/modules/auth/ tests/e2e/ app/modules/auth/ sillyhub-daemon/tests/ws-client.test.ts sillyhub-daemon/src/ws-client.ts` 为空，确认本变更未碰这些文件。

| 失败 | 根因 | 归属 |
|---|---|---|
| backend test_api_key_lifecycle ×2 | register 端点改 per-daemon body（daemon_local_id/server_url/hostname/providers 必填，2026-07-03 D-007 WS breaking），测试仍用旧 per-provider body `{name, provider}` → 422 | 2026-07-03-daemon-entity-binding 遗留 |
| backend test_e2e_three_member_collaboration | 同上（register body） | 2026-07-03 遗留 |
| daemon ws-client.test.ts ×4 | WS query param 改 `daemon_local_id`（ws-client.ts:337），测试期望旧 `runtime_id` | 2026-07-03 遗留 |

建议：单独 quick 变更修复这 7 个测试（更新期望对齐 per-daemon body + daemon_local_id query）。

## 合理偏差

- **facade 透传修复跨 allowed_paths**：task-04/task-11 改了 `app/modules/daemon/service.py`（DaemonService facade），超出 task-04 的 allowed_paths（runtime/service.py）。但这是 Wave 1 必要遗漏修复——端点 router 转发依赖 facade 签名，不修则 register/heartbeat 端点 TypeError 500。task-11 service 测试抓出。已记录。

## 遗留运行时验证

端到端「daemon 注册 → backend 看到 version/build_id → 前端显示 → 点升级 → daemon 重启 → re-register 新版本刷新」需部署环境（含真实 daemon 客户端 + Redis）手动确认，不阻塞 archive。

## 建议

- 归档本变更（实现完整、相关测试全绿）
- 单独 quick 变更修复 7 个 2026-07-03 遗留测试
