---
id: task-01
title: 后端 dump 脚本（静态导出 openapi.json）
author: qinyi
created_at: 2026-07-04T00:51:06
priority: high
depends_on: []
blocks: [task-02, task-03]
allowed_paths:
  - backend/scripts/dump_openapi.py
  - backend/openapi.json
---

## 目标
静态导出 FastAPI OpenAPI schema 到 `backend/openapi.json`，作为前端类型生成的唯一输入源。

## 实现步骤
- 创建 `backend/scripts/` 目录（如不存在）
- 新增 `backend/scripts/dump_openapi.py`：`from app.main import app` → `app.openapi()` → `json.dumps` 写入 `backend/openapi.json`
- 跑 `cd backend && uv run python scripts/dump_openapi.py`

## 验收标准
- `backend/openapi.json` 生成且 JSON 合法
- 含 `paths`，path 数量 > 0
- 不连 DB、不跑 lifespan（`app.openapi()` 是构建期纯函数）

## 验证方式
`python -c "import json; d=json.load(open('backend/openapi.json')); assert 'paths' in d and len(d['paths'])>0"`

## 约束
- 路径用 pathlib（跨平台 Win/Linux/macOS）
- 不修改 main.py（openapi 已在 main.py:96 暴露）
- 不依赖 uvicorn 启动、不依赖环境变量 DB 连接
