---
author: qinyi
created_at: 2026-11-06 23:10:00
generated_by: manual-fallback
change: 2026-11-06-session-reopen-no-cwd
---
# 模块影响分析（Module Impact）

> CLI 自动生成未触发（平台指针漂移期间 --done 同步异常），按 gate 提示手写兜底；execute/verify 按实际 diff 回填影响类型与更新结果。

## 模块影响矩阵

| 文件 | 模块 | 影响类型 |
|---|---|---|---|
| backend/app/modules/daemon/session/service/session_lifecycle.py | backend | <!--TODO--> |
| backend/app/modules/daemon/sweep.py | backend | <!--TODO--> |
| backend/app/modules/daemon/session/service/errors.py | backend | <!--TODO--> |
| backend/app/modules/daemon/router/notify.py | backend | <!--TODO--> |
| backend/app/modules/daemon/schema.py | backend | <!--TODO--> |
| backend/app/modules/daemon/tests/test_session_reopen.py | backend | <!--TODO--> |
| backend/app/modules/daemon/tests/test_session_reconnect_sweep.py | backend | <!--TODO--> |
| sillyhub-daemon/src/daemon.ts | sillyhub-daemon | <!--TODO--> |
| sillyhub-daemon/src/hub-client.ts | sillyhub-daemon | <!--TODO--> |
| sillyhub-daemon/tests/daemon-session-resume-route.test.ts | sillyhub-daemon | <!--TODO--> |
| frontend/src/lib/api-types.ts | lib-api | <!--TODO-->（gen:types 生成物） |
| sillyhub-daemon/src/api-types.ts | sillyhub-daemon | <!--TODO-->（gen:types 生成物） |
| backend/openapi.json | backend | <!--TODO-->（OpenAPI 导出生成物） |

## 未匹配文件

（无——全部文件均命中 _module-map.yaml 前缀归属）

## 更新结果

| 模块文档 | 状态 |
|---|---|
| modules/backend.md | pending |
| modules/sillyhub-daemon.md | pending |
| modules/lib-api.md | pending |
| modules/_module-map.yaml | pending |
