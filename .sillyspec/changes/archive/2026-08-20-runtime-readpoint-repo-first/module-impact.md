---
author: qinyi
created_at: 2026-08-20T10:55:00+08:00
---

# 模块影响分析（Module Impact）— 运行时状态读点修正（仓库优先，缓存回退）

依据：design.md §9 文件变更清单 + plan.md 任务列表，对照 `_module-map.yaml` 模块路径映射。

## 模块影响矩阵

| 模块 | 影响类型 | 说明 |
|---|---|---|
| backend | 修改 | `app/modules/runtime/service.py`：`_resolve_binding` 返回扩展为 `(daemon_id, root_path)`，四个服务方法 RPC params 加 `root_path`（经 `resolve_root_path_for_daemon` 改写）；`tests/test_live_service.py` / `tests/test_router.py` 断言同步（后者 :152 精确 params 断言连带修复） |
| sillyhub-daemon | 修改 | `src/runtime-handler.ts`：新增 `pickRuntimeSpecDir` 三道校验读点选择（元字符黑名单→assertWithinAllowedRoots→.runtime 存在性），构造参数扩 `rootsProvider`/`pathExists`，四方法接入；`src/daemon.ts`：`_registerRuntimeRpcHandler` 透传 `root_path`、类字段构造点注入 rootsProvider；`tests/runtime-handler.test.ts` 六类用例 |
| frontend | 修改 | `runtime/page.tsx`：user-inputs 超 50000 字符尾部截断 + 含文件路径提示、副标题文案；`page.test.tsx` 截断与文案用例 |
| sillyspec | 依赖变更 | `.sillyspec/local.yaml` modules 块补 `runtime` 子模块条目（backend/app/modules/runtime/ → pytest），verify 对账基础设施，先例同 2026-08-01/08-08/08-10 |

## 未匹配文件

无。

## 更新结果

| 目标 | 操作 | 状态 |
|------|------|------|
| `modules/backend.md` | 更新 backend 模块卡（runtime 模块 RPC 契约扩展 root_path 参数） | done（MANUAL_NOTES 区 2026-08-20 条目） |
| `modules/sillyhub-daemon.md` | 更新 daemon 模块卡（runtime.* 读点选择与三道校验） | done（MANUAL_NOTES 区 2026-08-20 条目） |
| `modules/frontend.md` | 更新 frontend 模块卡（runtime 页截断与文案） | done（MANUAL_NOTES 区 2026-08-20 条目） |
| `modules/sillyspec.md` | 更新 sillyspec 模块卡（local.yaml runtime 子模块映射） | done（MANUAL_NOTES 区 2026-08-20 条目） |
