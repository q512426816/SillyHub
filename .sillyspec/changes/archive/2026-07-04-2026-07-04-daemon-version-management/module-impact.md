---
author: qinyi
created_at: 2026-07-04 18:42:00
change: 2026-07-04-daemon-version-management
---

# module-impact.md — daemon 版本可见 + 远程升级入口

## 模块影响矩阵

以 `git diff fecaa155 main --name-only` 为准（真实 > 声明）。`_module-map.yaml` 在 specDir 缺失（daemon-client spec sync 已知问题），按源码目录归类。

| 模块 | 影响类型 | 相关文件 | 更新内容摘要 | needs_review |
|---|---|---|---|---|
| backend/daemon | 数据结构变更 + 接口变更 + 逻辑变更 | `app/modules/daemon/model.py` | DaemonInstance 新增 build_id 列 | false |
| backend/daemon | 数据结构变更 | `migrations/versions/202607041800_daemon_instance_build_id.py` | 新增 alembic migration（down=b16bf63a5d05） | false |
| backend/daemon | 接口变更 | `app/modules/daemon/schema.py` | DaemonRegisterRequest 加 daemon_version/build_id；DaemonRuntimeRead/DaemonInstanceRead 加版本字段；旧 DaemonHeartbeatRequest 标注废弃 | false |
| backend/daemon | 接口变更 + 逻辑变更 | `app/modules/daemon/router.py` | DaemonHeartbeatRequest（生效版）加字段；GET /version 扩展 latest_version/build_id + get_daemon_latest_semver；register/heartbeat 端点传参；list_runtimes_page JOIN；_runtime_read 填充 | false |
| backend/daemon | 逻辑变更 | `app/modules/daemon/runtime/service.py` | register_daemon/heartbeat_daemon 写 version/build_id；list_runtimes_page JOIN daemon_instances | false |
| backend/daemon | 逻辑变更 | `app/modules/daemon/service.py` | DaemonService facade register/heartbeat 透传版本参数（Wave 1 遗漏修复） | false |
| backend/daemon | 测试 | `tests/modules/daemon/test_daemon_version_management.py` | 新增 7 用例（GET /version + register/heartbeat 写入 + 兼容 + migration） | false |
| sillyhub-daemon | 接口变更 | `src/hub-client.ts` | RegisterBody/HeartbeatBody 加 daemon_version/build_id；register/heartbeat 内部填 DAEMON_VERSION/BUILD_ID | false |
| sillyhub-daemon | 测试 | `tests/hub-client.test.ts` | 版本字段断言 | false |
| frontend/lib | 接口变更 | `src/lib/api-types.ts` | OpenAPI 重生成（含新字段） | false |
| frontend/lib | 接口变更 + 逻辑变更 | `src/lib/daemon.ts` | DaemonRuntimeRead/DaemonInstanceRead 加字段；新增 triggerDaemonSelfUpdate/getDaemonVersion/DaemonVersionInfo | false |
| frontend/lib | 逻辑变更 | `src/lib/query-keys.ts` | 加 daemonVersion query key | false |
| frontend/runtimes | 逻辑变更 + UI | `src/app/(dashboard)/runtimes/page.tsx` | RuntimeCard 版本展示 + 徽标 4 态 + 升级按钮 + toast + offline 禁用 | false |
| frontend/runtimes | 测试 | `src/app/(dashboard)/runtimes/__tests__/page.test.tsx` | 新增 8 用例 | false |

## 未匹配文件

| 文件 | 说明 |
|---|---|
| `backend/openapi.json` | `pnpm gen:types` 副产物（dump backend openapi），随 task-08 类型重生成带入；非源码逻辑 |

## 三重交叉验证

- **声明范围**（design §6）：14 文件清单 → 与实际一致
- **任务范围**（plan.md / tasks）：task-01~11 allowed_paths → 与实际一致（task-04 facade 修复跨 allowed_paths，已记 verify-result.md 合理偏差）
- **真实变更**（git diff）：15 文件（含 openapi.json 副产物）→ 与声明一致 + 1 副产物

无遗漏、无幽灵文件。
