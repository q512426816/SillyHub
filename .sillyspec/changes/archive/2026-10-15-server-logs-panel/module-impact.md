# 模块影响分析（骨架由 plan --done CLI（design 声明清单 × module-map 前缀匹配） 生成）

> 文件×模块归属由 CLI 按 _module-map.yaml paths 前缀匹配预填；
> **影响类型**（逻辑变更/数据结构变更/接口变更/调用关系变更/配置变更/新增）与 review 标记是语义判断，
> 逐行把 <!--TODO--> 替换为真实结论——以 git diff 为准（真实 > 声明）。

## 模块影响矩阵

| 模块 | 变更文件 | 影响类型 | 需 review |
|---|---|---|---|
| app-admin-pages | `frontend/src/app/(dashboard)/admin/server-status/page.tsx` | 逻辑变更（删业务统计卡+集成 ServerLogPanel 满宽置底+副标题） | 否 |
| app-admin-pages | `frontend/src/app/(dashboard)/admin/server-status/__tests__/page.test.tsx` | 逻辑变更（全用例扫描：统计卡断言改日志卡在场） | 否 |
| backend | `backend/app/core/logging.py` | 逻辑变更+接口变更（FileWriter processor 链插入/常量/get_log_file_path 导出） | 否 |
| backend | `backend/app/core/config.py` | 配置变更（log_dir 字段） | 否 |
| backend | `backend/app/core/paths.py` | 逻辑变更（resolve_log_dir 新增） | 否 |
| backend | `backend/app/modules/health/log_reader.py` | 新增（读取/解析/白名单+Pydantic 响应模型） | 否 |
| backend | `backend/app/modules/health/router.py` | 接口变更（GET /api/server-logs + /download 两端点） | 否 |
| backend | `backend/openapi.json` | 接口变更（生成物再导出，含 ServerLogsResponse 族） | 否 |
| backend | `backend/tests/test_server_log_filer.py` | 新增（测试） | 否 |
| backend | `backend/tests/test_server_logs_api.py` | 新增（测试） | 否 |
| frontend | `frontend/src/components/server-log-panel.tsx` | 新增（ServerLogPanel 组件） | 否 |
| lib-api | `frontend/src/lib/api-types.ts` | 接口变更（gen:types 生成物，前端+daemon 双端） | 否 |
| lib-health | `frontend/src/lib/health.ts` | 接口变更（getServerLogs/downloadLogFile 新增导出） | 否 |
| test-utils | `frontend/src/components/__tests__/server-log-panel.test.tsx` | 新增（测试） | 否 |

## 未匹配文件

无（全部变更文件已归属到模块）。

## 影响类型说明

逻辑变更 / 数据结构变更 / 接口变更 / 调用关系变更 / 配置变更 / 新增；不确定的影响标 needs review。

## 更新结果

| 目标 | 操作 | 状态 |
|------|------|------|
| `modules/app-admin-pages.md` | 定位 3 页→5 页（补 menus/server-status）+契约摘要增两页条目 | done |
| `modules/backend.md` | changelog sidecar 追加 2026-10-15-server-logs-panel 行（正文粗卡不逐变更重写） | done |
| `modules/frontend.md` | changelog sidecar 追加 2026-10-15-server-logs-panel 行 | done |
| `modules/lib-api.md` | 注意事项追加 2026-10-15-server-logs-panel 再生成条目（双端 gen:types） | done |
| `modules/lib-health.md` | 卡面重写：四接口（getServerLogs/downloadLogFile 入契约/关键逻辑/注意事项） | done |
| `modules/test-utils.md` | skipped——本次仅新增 2 个测试文件，不改测试基础设施契约（setup.ts/vitest.config 零触碰）；定位段文件计数统计不为每次新增逐次重算 | skipped |
| `_module-map.yaml` | 无变化（未增删模块） | skipped |

规则：execute/verify 完成文档同步后把对应行回填 done；确定不同步的行改 skipped 并在操作列写明原因。
