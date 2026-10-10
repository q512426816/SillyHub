---
author: qinyi
created_at: 2026-10-09 12:02:21
---

# 模块影响分析

## 变更：2026-10-09-tombstone-conflict-root-fix

> 依据 design.md 文件变更清单（主仓 16 文件 + sillyspec 仓 4 文件）与文件路径归类（backend/frontend/sillyhub-daemon 三模块命中 + 跨仓 sillyspec）。

## 模块影响矩阵

| 模块 | 影响类型 | 相关文件 | 更新内容摘要 |
|------|----------|----------|-------------|
| backend | 逻辑变更 | backend/app/modules/daemon/router/machines.py + router/__init__.py | 新端点（fire-and-forget WS 指令+请求体类）+_ENDPOINT_ORDER 登记（守卫表不变量，dc2397a3） |
| backend | 逻辑变更 | backend/app/modules/daemon/ws_hub.py | 新增 send_sillyspec_tombstone_cleanup（消息 daemon:sillyspec_tombstone_cleanup，透传 change+workspace_id） |
| backend | 零改动（design 预估修正） | backend/app/modules/daemon/model.py | action 为宽松 str 透传（runtimes.py:196）——design 预估的 Literal 扩展不存在，实际零改动 |
| backend | 逻辑变更 | backend/app/modules/daemon/schema.py | 新请求体 MachineSillySpecTombstoneCleanupRequest{workspace_id, change} |
| backend | 零改动（design 预估修正） | backend/app/modules/daemon/router/heartbeat.py | 落槽为 model_dump 整包直写（377-379）——action 新值天然透传，零改动（design 兼容策略钉死不新增关闭逻辑） |
| backend | 逻辑变更 | backend/app/modules/change/service.py | delete_change 主事务终 commit 后查绑定数据源机器 fire-and-forget 下发（失败仅日志） |
| backend | 测试 | backend/app/modules/daemon/tests/test_sillyspec_platform_commands.py | 执行期裁决：测试落点就近扩展（参数化 _ENDPOINT_IDS 加第三端点+envelope/白名单/OpenAPI 断言，57 绿；原 NEW 计划文件未建） |
| backend | 测试 | backend/app/modules/change/tests/test_delete_change.py | 删除环下发三态用例（在线发出/离线不阻塞/无绑定跳过） |
| backend | 契约 | backend/openapi.json | dump_openapi.py 重生成（529 paths，含新端点+请求体 schema；供两端 gen:types） |
| sillyhub-daemon | 逻辑变更 | sillyhub-daemon/src/daemon.ts | WS 消息分发 daemon:sillyspec_tombstone_cleanup（必填校验+executor 调用） |
| sillyhub-daemon | 逻辑变更 | sillyhub-daemon/src/sillyspec-manager.ts | 新执行器 runTombstoneCleanup：根解析→隔离区移动（tombstone-quarantine/）→doctor 归档→幂等回执 |
| sillyhub-daemon | 契约 | sillyhub-daemon/src/api-types.ts | gen:types 重生成（新端点+action 枚举） |
| sillyhub-daemon | 测试新增 | NEW:sillyhub-daemon/tests/sillyspec-tombstone-cleanup.test.ts | 执行器矩阵用例（幂等/双区定位/移动失败/回执） |
| frontend | 逻辑变更 | frontend/src/components/changes/platform-sync-section.tsx | 冲突行双源 join+墓碑形态三态渲染+收敛按钮+回显（matchesCommandResult 加分支+renderRows 合并注册表独有行，e0999476） |
| frontend | 逻辑变更 | frontend/src/lib/daemon/machines.ts | 新增 triggerMachineSillySpecTombstoneCleanup 封装 |
| frontend | 契约 | frontend/src/lib/api-types.ts | gen:types 重生成 |
| frontend | 测试 | frontend/src/components/changes/__tests__/platform-sync-section.test.tsx | 墓碑行渲染/权限/回显/混合行不受影响用例 |
| sillyspec（跨仓） | 逻辑变更 | sillyspec 仓 src/spec-sync.js | 纯墓碑归因记账（按被删变更落文件+幂等合并）+全绿清理+横幅单根因叙事 |
| sillyspec（跨仓） | 逻辑变更 | sillyspec 仓 src/progress/stage-machine.js | _listPendingConflicts type 判定优先读记录 kind（'tombstone' 透传） |
| sillyspec（跨仓） | 测试 | sillyspec 仓 test/spec-sync-platform-deleted-receipt.test.mjs | 既有用例扩展 |
| sillyspec（跨仓） | 测试新增 | NEW:sillyspec 仓 test/spec-sync-tombstone-attribution.test.mjs | 归因矩阵用例 |

## 未匹配文件

| 文件路径 | 说明 |
|----------|------|
| .sillyspec/changes/2026-10-09-tombstone-conflict-root-fix/*（四件套/原型/任务卡） | 变更产物本身，非模块代码 |

## 更新结果

| 模块文档 | 操作 | 状态 |
|----------|------|------|
| modules/sillyhub-daemon.md | execute 收口：tombstone_cleanup 执行器条目（c2a42fcb） | ✅ 已同步（verify 阶段复核） |
| modules/backend.md | execute 收口：指令端点+删除环下发条目（dc2397a3/93c61da3） | ✅ 已同步（verify 阶段复核） |
| modules/frontend.md | execute 收口：冲突行墓碑三态条目（e0999476） | ✅ 已同步（verify 阶段复核） |
| 跨仓 sillyspec（docs/sillyspec/file-lifecycle.md） | task-05 已同步（d8811604：.runtime 清单补归因记账语义+updated_at 批次头） | ✅ 已同步 |
