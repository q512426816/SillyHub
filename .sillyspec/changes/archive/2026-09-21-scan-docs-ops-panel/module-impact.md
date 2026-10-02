# 模块影响分析（骨架由 plan --done CLI（design 声明清单 × module-map 前缀匹配） 生成）

> 文件×模块归属由 CLI 按 _module-map.yaml paths 前缀匹配预填；
> **影响类型**（逻辑变更/数据结构变更/接口变更/调用关系变更/配置变更/新增）与 review 标记是语义判断，
> 逐行把 <!--TODO--> 替换为真实结论——以 git diff 为准（真实 > 声明）。

## 模块影响矩阵

| 模块 | 变更文件 | 影响类型 | 需 review |
|---|---|---|---|

## 未匹配文件

以下变更文件未命中 _module-map.yaml 任何模块 paths——确认是模块索引过期（该跑 `sillyspec modules rebuild`）还是真的游离文件：

- `backend/app/modules/scan_docs/schema.py` → 归属 backend 项目 scan_docs 模块（.sillyspec/docs/backend/modules/scan_docs.md 已同步 stats DTO 口径）；接口变更（新增 DTO）
- `backend/app/modules/scan_docs/service.py` → 归属 backend 项目 scan_docs 模块；新增（stats 聚合方法，既有方法零改动）
- `backend/app/modules/scan_docs/router.py` → 归属 backend 项目 scan_docs 模块；接口变更（新增 GET /scan-docs/stats）
- `backend/app/modules/scan_docs/tests/test_stats.py` → 归属 backend 项目 scan_docs 模块；新增（测试）
- `backend/openapi.json` → 生成产物（gen:types dump），随类型链提交；配置变更
- `frontend/src/lib/api-types.ts` → 生成产物（openapi-typescript）；配置变更
- `frontend/src/lib/scan-docs.ts` → 归属 frontend 项目 lib-scan-docs 模块；新增（stats 客户端三导出）
- `frontend/src/components/scan-docs-stats-panel.tsx` → 归属 frontend 项目新组件（新模块卡 .sillyspec/docs/frontend/modules/scan-docs-stats-panel.md 已建）；新增
- `frontend/src/components/__tests__/scan-docs-stats-panel.test.tsx` → 同上新组件模块；新增（测试）
- `frontend/src/app/(dashboard)/workspaces/[id]/scan-docs/page.tsx` → 归属 frontend 项目 app-workspace-pages 模块（模块卡已同步面板挂载行为）；逻辑变更（仅加挂载）
- `frontend/src/app/(dashboard)/workspaces/[id]/__tests__/scan-docs-page.test.tsx` → 同上；逻辑变更（补 mock+冒烟用例+QueryClientProvider 基建）

## 影响类型说明

逻辑变更 / 数据结构变更 / 接口变更 / 调用关系变更 / 配置变更 / 新增；不确定的影响标 needs review。

## 更新结果

| 目标 | 操作 | 状态 |
|------|------|------|
| `_module-map.yaml` | 不需 rebuild：未匹配文件均属 backend/frontend 项目的模块域（scan_docs/lib-scan-docs/app-workspace-pages/新组件），本项目（multi-agent-platform）map 只覆盖 .sillyspec/**·docs/**·.github/** 属预期；对应模块卡已逐份人工同步（backend/scan_docs、app-workspace-pages、NEW scan-docs-stats-panel） | skipped |

规则：execute/verify 完成文档同步后把对应行回填 done；确定不同步的行改 skipped 并在操作列写明原因。
