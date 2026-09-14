---
author: qinyi
created_at: 2026-09-14 14:12:30
---

# 模块影响分析 — 2026-09-14-session-export

> 依据 design.md 文件变更清单 × _module-map.yaml 前缀匹配;影响类型为语义判断,以最终 git diff 为准(真实 > 声明)。

## 模块影响矩阵

| 模块 | 变更文件 | 影响类型 | 需 review |
|---|---|---|---|
| backend | backend/app/modules/daemon/schema.py | 接口变更(新增 SessionExportRequest DTO,OpenAPI 只增) | 否 |
| backend | backend/app/modules/daemon/session/service/export.py(NEW) | 新增(导出组装:权限复用/双档渲染/zip/附件) | 否 |
| backend | backend/app/modules/daemon/session/service/__init__.py | 调用关系变更(SessionService 类壳一行委托) | 否 |
| backend | backend/app/modules/daemon/router/session_export.py(NEW) | 新增(POST /sessions/export 端点) | 是(路由挂载顺序 R-01) |
| backend | backend/app/modules/daemon/router/__init__.py | 调用关系变更(_ENDPOINT_ORDER 插入字面量前置) | 是(挂载顺序错则 404/误匹配) |
| backend | backend/app/modules/daemon/service.py | 调用关系变更(DaemonService facade 透传 storage) | 否 |
| backend | backend/tests/modules/daemon/test_session_export.py(NEW) | 新增(测试) | 否 |
| frontend | frontend/src/lib/daemon/session-export.ts(NEW) | 新增(认证下载通道) | 否 |
| frontend | frontend/src/components/sessions/session-list-panel.tsx | 逻辑变更(批量栏+行级导出入口,不改既有操作) | 否 |
| frontend | frontend/src/components/sessions/sessions-portal.tsx | 逻辑变更(回调接线) | 否 |
| frontend | frontend/src/components/sessions/__tests__/session-list-panel.test.tsx | 逻辑变更(追加用例,不改既有断言) | 否 |
| frontend | frontend/src/lib/api-types.ts | 接口变更(gen:types 再生成,预期仅新增) | 否 |
| backend | backend/openapi.json | 接口变更(新端点入 OpenAPI) | 否 |

## 未匹配文件

无——全部文件命中 _module-map.yaml backend/** 与 frontend/** paths。

## 影响类型说明

逻辑变更 / 数据结构变更 / 接口变更 / 调用关系变更 / 配置变更 / 新增;不确定的影响标 needs review。

## 更新结果

| 目标 | 操作 | 状态 |
|------|------|------|
| `_module-map.yaml` | 不增改(skipped):无新模块/新路径形态,daemon 会话子域粒度沿用既有索引粒度;多并行活跃变更共享索引,rebuild 留待统一操作 | skipped |
| `modules/backend.md` | execute/verify 后按归档流程同步(新增导出端点一句话) | pending |
| `modules/frontend.md` | execute/verify 后按归档流程同步(会话列表导出入口一句话) | pending |

规则:execute/verify 完成文档同步后把对应行回填 done;确定不同步的行改 skipped 并在操作列写明原因。
