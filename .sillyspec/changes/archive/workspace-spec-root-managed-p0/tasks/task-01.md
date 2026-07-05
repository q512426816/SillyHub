---
author: hermes
created_at: 2026-06-04T15:45:00
wave: 1
depends_on: []
files:
  - backend/.env
---

# Task-01: 配置 SPEC_DATA_ROOT 环境变量

## 目标
在 backend/.env 中添加 SPEC_DATA_ROOT 配置，使 spec_data_root 指向项目内 `./data/spec-storage`。

## 操作步骤
1. 打开 `backend/.env`
2. 在末尾添加: `SPEC_DATA_ROOT=./data/spec-storage`
3. 同时在项目根 `.gitignore` 中添加 `data/spec-storage/` 避免误提交

## 验证
- 启动后端确认 `get_settings().spec_data_root` 返回正确路径
