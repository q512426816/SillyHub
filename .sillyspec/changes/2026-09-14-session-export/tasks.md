---
author: qinyi
created_at: 2026-09-14 13:58:17
---
# 任务清单（Tasks）— 会话一键导出

<!-- 骨架：plan 阶段展开细节（Wave 分组/依赖/allowed_paths）并写回本文件 -->

- [ ] task-01: 后端 schema——daemon/schema.py 新增 SessionExportRequest（ids 1~50 + tier Literal）(depends_on: 无)
- [ ] task-02: 后端导出服务——session/service/export.py 模块函数（权限复用/chat md/full json/噪声排除纯函数/zip/附件取流降级/413 预检/保最早 20000 行截断）+ __init__.py 类壳委托 (depends_on: 无)
- [ ] task-03: 后端路由——router/session_export.py 端点（TaskRunAgentUser）+ router/__init__.py 有序挂载字面量前置 + DaemonService facade 透传 storage (depends_on: task-01,task-02)
- [ ] task-04: 后端测试——test_session_export.py（内容断言/噪声排除表驱动/zip 结构/权限 404/降级/截断/413/路由顺序）(depends_on: task-03)
- [ ] task-05: 前端下载通道——lib/daemon/session-export.ts（POST + Bearer + 401 刷新重试 + Content-Disposition 解析 + blob 下载）(depends_on: 无)
- [ ] task-06: 前端入口——session-list-panel.tsx 批量栏「导出选中」Dropdown + 行 hover 下载图标 + exporting state；sessions-portal.tsx 接线 (depends_on: task-05)
- [ ] task-07: 前端测试——__tests__/session-list-panel.test.tsx 追加导出入口用例 (depends_on: task-06)
- [ ] task-08: 类型同步——pnpm gen:types + api-types.ts/openapi.json 提交 + ruff/mypy/eslint 聚焦收口 (depends_on: task-03,task-04,task-06,task-07)
