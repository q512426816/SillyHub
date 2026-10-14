---
author: qinyi
created_at: 2026-10-14 09:50:00
---
# 任务清单（Tasks）— 2026-10-14-deploy-release-notes

<!-- 依据 design.md 文件变更清单拆分；实现+单测同卡，无仪式卡 -->

- [x] task-01: 后端权限地基——Permission 枚举新增 DEPLOY_RECORD_READ + 存量角色种子迁移 + pyyaml 显式依赖 + 权限对齐测试 (depends_on: -)
- [x] task-02: deploy_records 只读模块——service/schema/router + main.py 注册 + 单测（tmp_path 造假目录：正常/invalid/404/鉴权） (depends_on: task-01)
- [x] task-03: 契约同步——导出 backend openapi.json + pnpm gen:types 再生成 frontend api-types (depends_on: task-02)
- [x] task-04: 前端数据层与页面——lib/deploy-records.ts + queryKeys + /deploy-records 左列表右详情页（MarkdownText 渲染）+ 页面测试 (depends_on: task-03)
- [x] task-05: 菜单注册——menu-permissions.ts governance 组新增 deploy-records 项 + app-shell MENU_ICON_MAP（History 图标）+ admin/menus 测试断言锚重算 (depends_on: task-04)
- [x] task-06: skill 硬步骤——sillyhub-docker-deploy SKILL.md 增「发布记录」节（查起点→git log→写 md 模板→失败也记录→平台不可达回退） (depends_on: task-02)
