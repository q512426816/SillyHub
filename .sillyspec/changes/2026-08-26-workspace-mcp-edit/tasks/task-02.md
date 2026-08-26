---
author: qinyi
created_at: 2026-08-26 14:20:00
id: task-02
title_zh: "后端写接口pytest"
title: "后端写接口 pytest"
priority: P0
depends_on: [task-01]
allowed_paths:
  - backend/app/modules/workspace/tests/test_mcp_config_write.py
goal: 写接口全分支测试（权限/校验/secret 还原/原子写/审计/中文文案）
acceptance: |
  1. 无权限用户 PUT → 403；非成员 → 403
  2. type 非 stdio → 422 HTTP_422_MCP_TYPE_NOT_STDIO；command 缺失 → 422；未知顶层键 → 422；文件不落盘
  3. <set> 还原成功：磁盘现有真值被写入、响应仍显示 <set>
  4. <set> 还原失败（server 改名/键新增）→ 422 HTTP_422_MCP_SECRET_UNRESOLVABLE；磁盘文件内容不变（<set> 未写盘）
  5. 原子写：写入后文件是合法 JSON、indent=2、末尾换行；错误路径不产生残留临时文件
  6. 审计行落 audit_logs（actor/workspace 正确）
  7. 错误 message 含中文（对齐 tests/core/test_error_message_l10n.py 守护口径）
verify: cd backend && uv run pytest app/modules/workspace/tests/test_mcp_config_write.py -q --no-cov -n auto
implementation: test_mcp_config_write.py GWT 用例矩阵（权限/校验/还原/原子写/审计/中文）
constraints: ["conftest 全模型 import 惯例", "in-memory sqlite", "错误文案中文守护口径"]
expects_from:
  task-01:
    - contract: "PUT /api/workspaces/{workspace_id}/mcp-config"
      needs: [mcpServers 请求模型, HTTP_422 错误码, set 占位符还原, 原子写, 审计上下文]
---

# task-02: 写接口测试

## 用例清单（GWT 对照 requirements FR-01/02/03）

- 权限：非成员/只读成员/Writer 三态
- 校验：type、command、args、env、extra forbid 各一
- 还原：成功、server 改名失败、env 键新增失败、现有文件损坏
- 落盘：格式断言（json.load + 文本形态）、临时文件无残留（monkeypatch os.replace 抛错验证清理）
- 审计：audit_logs 查询断言
- conftest 复用 workspace 模块既有 fixture（in-memory sqlite + conftest 全模型 import 惯例）
