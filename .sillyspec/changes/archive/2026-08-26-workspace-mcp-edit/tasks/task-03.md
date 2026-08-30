---
author: qinyi
created_at: 2026-08-26 14:20:00
id: task-03
title_zh: "后端daemon接口扩展工作区维度"
title: "后端 daemon API 扩展 workspace 维度"
priority: P0
depends_on: []
allowed_paths:
  - backend/app/modules/daemon/router.py
  - backend/app/modules/daemon/tests/test_mcp_config_endpoint.py
goal: GET /api/daemon/mcp/config 支持可选 workspace_id，返回三件套；向后兼容
acceptance: |
  1. 不带 workspace_id：响应结构与现状字节级同构 {platform_default, whitelist}（既有 3 处断言不改动且通过）
  2. 带 workspace_id 且 .mcp.json 存在：响应追加 workspace: {mcpServers: {...}}（明文不脱敏，经新增 _read_mcp_config_raw 读法，不复用脱敏的 get_mcp_config）
  3. 带 workspace_id 但文件缺失/解析失败：workspace 返回空 {mcpServers:{}} 不报错
  4. workspace_id 非法 UUID → 422 中文报错
  5. daemon token 鉴权不变（get_current_principal 既有链）
verify: cd backend && uv run pytest app/modules/daemon/tests/test_mcp_config_endpoint.py -q --no-cov -n auto
implementation: get_daemon_mcp_config 加可选 workspace_id query + 新增 _read_mcp_config_raw 明文读法
constraints: ["不带参响应字节级同构（R-07）", "daemon token 鉴权不变", "文件缺失返回空不报错"]
provides:
  - contract: "GET /api/daemon/mcp/config?workspace_id="
    fields: [workspace_id 参数, platform_default, whitelist, workspace.mcpServers, 向后兼容]
---

# task-03: daemon API 扩展

## 实现要点

1. `get_daemon_mcp_config`（daemon/router.py:4027）加可选 query 参数 `workspace_id: uuid.UUID | None = None`；非 None 时经 SpecPathResolver 定位 specDir，新增 `_read_mcp_config_raw`（明文读，容错返回空）。
2. 响应模型只加字段不改字段（R-07 兼容）。
3. 测试补三类用例：带参有文件/带参无文件/不带参回归。

## 注意

- raw 读法与 `skills_view_service.get_mcp_config` 的区别：不脱敏、不构造 ViewResponse；JSON 解析失败返回空不抛（daemon 侧预净化兜底在 task-05）。
