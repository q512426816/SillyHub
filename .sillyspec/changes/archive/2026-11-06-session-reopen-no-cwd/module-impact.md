---
author: qinyi
created_at: 2026-11-06 23:10:00
generated_by: manual-fallback
change: 2026-11-06-session-reopen-no-cwd
---
# 模块影响分析（Module Impact）

> CLI 自动生成未触发（平台指针漂移期间 --done 同步异常），按 gate 提示手写兜底；verify 收尾已按实际 diff 回填影响类型与更新结果。

## 模块影响矩阵

| 文件 | 模块 | 影响类型 |
|---|---|---|
| backend/app/modules/daemon/session/service/session_lifecycle.py | backend | 行为变更（DS-7 门放宽 + payload cwd 条件键） |
| backend/app/modules/daemon/sweep.py | backend | 行为变更（恢复路径 payload cwd 条件键） |
| backend/app/modules/daemon/session/service/errors.py | backend | 接口收缩（DaemonSessionNoCwd 退役） |
| backend/app/modules/daemon/router/notify.py | backend | 接口扩展（两 schema 可选 cwd + ready 可选 body + 落库） |
| backend/app/modules/daemon/schema.py | backend | 无直接改动（SessionRuntimeRequest 实际内联 notify.py——执行期定位修正，清单已同步） |
| backend/app/modules/daemon/service.py | backend | 签名扩展（confirm 门面 cwd 透传，三层门面中转） |
| backend/app/modules/daemon/session/service/__init__.py | backend | 签名扩展（confirm 门面 cwd 透传） |
| backend/app/modules/daemon/session/service/recovery.py | backend | 行为扩展（confirm 成功分支同事务落库 cwd） |
| backend/app/modules/daemon/tests/test_session_reopen.py | backend | 测试（改写 TestReopenEmptyCwd + 新增 TestCwdReporting 5 用例 + 既有断言随新契约更新 2 处） |
| backend/app/modules/daemon/tests/test_session_sweep_recover.py | backend | 测试（空 cwd payload 无键用例 + 既有用例补 cwd 断言） |
| sillyhub-daemon/src/daemon.ts | sillyhub-daemon | 行为变更（三级链 _resolveResumeCwd + 三发送点携带 + ClientLike 声明） |
| sillyhub-daemon/src/hub-client.ts | sillyhub-daemon | 签名扩展（两方法可选 cwd，不传不发键） |
| sillyhub-daemon/tests/daemon-session-resume-route.test.ts | sillyhub-daemon | 测试（三级链 describe 7 用例 + 携带断言） |
| sillyhub-daemon/tests/hub-client.test.ts | sillyhub-daemon | 测试（序列化契约 describe 6 用例） |
| frontend/src/lib/api-types.ts | lib-api | 生成物（gen:types，SessionReadyRequest + cwd 可选字段） |
| sillyhub-daemon/src/api-types.ts | sillyhub-daemon | 生成物（gen:types 同步） |
| backend/openapi.json | backend | 生成物（OpenAPI 导出） |

## 未匹配文件

（无——全部文件均命中 _module-map.yaml 前缀归属；schema.py 一行为执行期定位修正的说明行，无实际 diff）

## 更新结果

| 模块文档 | 状态 |
|---|---|
| modules/backend.md | done（变更索引追加 2026-11-06-session-reopen-no-cwd 条目） |
| modules/sillyhub-daemon.md | done（变更索引追加条目） |
| modules/lib-api.md | done（变更索引追加 api-types 再生成条目） |
| modules/_module-map.yaml | skipped（无新 entrypoints/features 面——既有端点加可选键、无新导出符号，不新增映射行） |
