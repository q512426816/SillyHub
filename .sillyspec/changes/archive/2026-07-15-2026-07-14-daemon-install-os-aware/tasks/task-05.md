---
id: task-05
title: backend tests for /install.ps1 endpoint
title_zh: backend test_daemon_dist.py 加 /install.ps1 端点测试
author: qinyi
created_at: 2026-07-14 23:08:31
priority: P0
depends_on: [task-03]
blocks: []
allowed_paths:
  - backend/tests/test_daemon_dist.py
expects_from:
  task-03:
    needs:
      - GET /daemon/install.ps1
      - body application/x-powershell
      - status_code 200 | 404
---

## goal
为 `GET /daemon/install.ps1` 端点写单测，覆盖 200/404/占位替换/scheme 推导/注入白名单（覆盖 FR-06, DG-01, DG-03）。

## implementation
- 在 `backend/tests/test_daemon_dist.py` 现有 `daemon_dist` fixture（造 fake daemon-dist + install.sh）基础上，加造 `install.ps1` 模板（含 `{{SERVER_URL}}` 占位）
- 新增用例：
  - `test_install_ps1`：GET /daemon/install.ps1 → 200 + `content-type` startswith `application/x-powershell` + body 含推导出的 server_url + 不含 `{{SERVER_URL}}`（占位已替换）
  - `test_install_ps1_server_url_derivation`：带 `X-Forwarded-Proto: https` + `X-Forwarded-Host: example.com` 请求 → body 含 `https://example.com`；带非法 host（如 `evil.com'; rm -rf`）→ 回退 base_url，不含非法串
  - `test_install_ps1_404`：monkeypatch daemon_dist_dir 到空目录 → 404
- 复用现有 `client` + `daemon_dist` fixture 风格（参考 test_install_script / test_daemon_bundle）

## 验收标准
- [ ] test_install_ps1 通过（200 + media_type + 占位替换）
- [ ] test_install_ps1_server_url_derivation 通过（X-Forwarded-Proto/Host + 白名单）
- [ ] test_install_ps1_404 通过
- [ ] 不破坏现有 test_install_script / test_latest_manifest / test_daemon_bundle

## verify
- `cd backend && uv run pytest tests/test_daemon_dist.py -q`（参考 local.yaml backend 测试命令）

## constraints
- 复用现有 fixture（daemon_dist monkeypatch settings.daemon_dist_dir）
- async client（现有风格）
- 不绑死 SQL 函数（无 DB）
