---
author: qinyi
created_at: 2026-10-09 10:24:30
---

# 模块影响分析

## 变更：2026-10-09-workspace-init-skill-gate

> 依据 design.md 文件变更清单（10 文件）与 _module-map.yaml 模块路径归类（backend/frontend/sillyhub-daemon 三模块命中）。

## 模块影响矩阵

| 模块 | 影响类型 | 相关文件 | 更新内容摘要 |
|------|----------|----------|-------------|
| sillyhub-daemon | 逻辑变更 | sillyhub-daemon/src/spec-sync.ts | `runSillyspecInit` spawn 参数去 `--no-skills`；`MIN_SILLYSPEC_VERSION_FOR_INIT` 3.26.8→3.32.2；块注释同步（D-004@v1 修订留痕） |
| sillyhub-daemon | 逻辑变更 | sillyhub-daemon/src/task-runner/runner-types.ts | `SILLYSPEC_VALID_TOOLS` 补 `'zcode'`（7 值对齐 CLI v3.32.2），注释同步 |
| sillyhub-daemon | 测试 | sillyhub-daemon/tests/run-sillyspec-init.test.ts | 断言反转：spawn 无 `--no-skills`；门控 3.32.2 通过/3.26.8 拒绝 |
| sillyhub-daemon | 测试新增 | NEW:sillyhub-daemon/tests/sillyspec-tool-mapping.test.ts | `mapDetectedToSillyspecTools` 白名单用例（zcode 放行+无关过滤+空数组） |
| backend | 逻辑变更 | backend/app/modules/daemon/lease/service.py | `complete_lease` init 回写段加 `result.get("status") != "failed"` 成败门：失败跳过回写 + warn 日志 `init_lease_failed_no_synced`（D-006@v1） |
| backend | 测试 | backend/app/modules/daemon/lease/tests/test_init_claim_tokens.py | 补失败不回写/成功对照两用例 |
| frontend | 逻辑变更 | frontend/src/components/workspace-scan-dialog.tsx | 创建弹窗两步状态机（creating→initializing→done/init_failed）：initDispatch 串行 + 2s 轮询 init_synced_at（5min 超时）+ 三态 UI + 失败不回滚 + 卸载清理 |
| frontend | 测试 | frontend/src/components/__tests__/workspace-scan-dialog.test.tsx | 新增四用例：全链路成功/失败不回滚/超时态/轮询清理 |
| frontend | 逻辑变更 | frontend/src/components/workspace-config-card.tsx | 未初始化时徽标下新增引导 Alert（已初始化态零改动） |
| frontend | 测试 | frontend/src/components/workspace-config-card.test.tsx | 六状态分支扩展：未初始化态 Alert 文案断言 |

## 未匹配文件

| 文件路径 | 说明 |
|----------|------|

## 更新结果

| 模块文档 | 操作 | 状态 |
|----------|------|------|
| modules/sillyhub-daemon.md | 变更索引头部新增 2026-10-09 条目（去 --no-skills/门控 3.32.2/白名单 7 值） | ✅ 已同步 |
| modules/backend.md | 变更索引头部新增 2026-10-09 条目（成败门/失败不回写语义修正） | ✅ 已同步 |
| modules/frontend.md | 变更索引头部新增 2026-10-09 条目（两步状态机/引导 Alert） | ✅ 已同步 |
