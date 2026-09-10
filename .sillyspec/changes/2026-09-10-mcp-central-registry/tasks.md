---
author: qinyi
created_at: 2026-09-10 10:50:06
---
# 任务清单（Tasks）

> 任务名清单 + Wave 分组；细节（依赖/验收/文件级步骤）在 plan 阶段展开。

## Wave 1：数据模型 + CRUD（backend 纵向切片）

- task-01: Alembic 迁移——三表 + partial unique index（含 downgrade）
- task-02: model.py 三表 ORM + schema.py DTO（脱敏/输入/绑定/导入/诊断/模板）
- task-03: service.py CRUD + 可见性/归属校验 + binding 约束 + encrypted_env 加密读写
- task-04: router.py 端点 + 权限矩阵（FR-01/02/03）

## Wave 2：渲染 + daemon 端点换源 + user_id 链

- task-05: render.py 注入集渲染 + 解密 + 诊断预检五项（FR-04/08）
- task-06: daemon_rpc.py 端点换源 + user_id 参数 + lease 归属双校验（FR-03/04）
- task-07: lease/context.py claim payload 加 user_id 下发（FR-05）
- task-08: daemon.ts execPayload 透传 + 会话创建拉取带参；mcp-config.ts 请求 URL 加参（FR-05）
- task-09: 契约测试——无 user_id golden 对照 + 授权三态 + 空库/渲染错误回落（FR-03/04）

## Wave 3：导入 + 模板 + 归一化

- task-10: importer.py JSON 三种包装解析 + 逐条容错（FR-06）
- task-11: workspace 扫描（复用共享读取逻辑）+ 同名去重 skip-or-rename + dedup_key（FR-07）
- task-12: cmd 归一化（剥 cmd /c 包装，用于去重比对与展示）（FR-07）
- task-13: 模板表 + seed 预置 + 存为模板（secret 丢弃提示）（FR-09）

## Wave 4：前端管理页

- task-14: api 层 + pnpm gen:types（api-types.ts + openapi.json 提交）
- task-15: settings/mcp 页升级——双 tab/搜索标签/binding 开关/卡片（FR-01/03）
- task-16: 三个导入入口（JSON 粘贴/workspace 扫描/模板库）+ 诊断面板（FR-06/07/08/09）

## Wave 5：收尾

- task-17: 旧 GET/PUT /api/platform-settings/mcp 移除 + frontend mcp-settings.ts 切新端点（D-003）
- task-18: 模块文档（mcp_registry.md 模块卡片）+ settings/daemon 模块文档更新
