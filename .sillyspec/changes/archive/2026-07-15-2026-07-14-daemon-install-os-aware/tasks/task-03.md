---
id: task-03
title: backend dist_router GET /install.ps1 dynamic endpoint
title_zh: 后端 dist_router 新增 GET /install.ps1 动态端点
author: qinyi
created_at: 2026-07-14 23:08:31
priority: P0
depends_on: [task-01]
blocks: [task-05]
allowed_paths:
  - backend/app/modules/daemon/dist_router.py
provides:
  GET /daemon/install.ps1:
    description: 动态生成 PowerShell 安装脚本（模板替换 {{SERVER_URL}}），公开端点无 /api 前缀
    fields:
      - body(string, application/x-powershell)
      - status_code(200 | 404)
---

## goal
backend dist_router 新增 `GET /daemon/install.ps1`，动态读模板替换 `{{SERVER_URL}}` 为推导地址返回（覆盖 FR-06, DG-01, DG-03）。

## implementation
- 在 `backend/app/modules/daemon/dist_router.py` 新增：
  - `_derive_server_url(request: Request) -> str`：scheme 取 `X-Forwarded-Proto` / `Forwarded: proto=` → 回退 `request.url.scheme`；host 取 `X-Forwarded-Host` / `Forwarded: host=` → 回退 `request.headers["host"]`；host 用正则白名单 `^[a-zA-Z0-9._:/-]+$` 校验，不合规回退 `str(request.base_url).rstrip("/")`；拼 `<scheme>://<host>`（DG-01 + DG-03）
  - `@router.get("/install.ps1")` `async def get_install_ps1(request: Request) -> Response`：读 `get_settings().daemon_dist_dir / "install.ps1"`，缺失 raise 404；`body = text.replace("{{SERVER_URL}}", _derive_server_url(request))`；返回 `Response(content=body, media_type="application/x-powershell", headers={"Content-Disposition": 'attachment; filename="install.ps1"'})`
- 沿用现有 router prefix `/daemon`（无 /api），与 `/install.sh` 一致

## 验收标准
- [ ] `GET /daemon/install.ps1` 返回 200 + `Content-Type: application/x-powershell`
- [ ] body 中 `{{SERVER_URL}}` 已替换为推导地址
- [ ] scheme 经 X-Forwarded-Proto 推导（DG-01）
- [ ] host 经白名单校验，非法 host 回退 base_url（DG-03）
- [ ] 模板缺失返回 404

## verify
- task-05 单测覆盖
- 手动：`curl -sS -o /dev/null -w "%{http_code} %{content_type}\n" http://127.0.0.1:8001/daemon/install.ps1`

## constraints
- 无 `/api` 前缀（与 install.sh 契约一致，dist_router.py:25 prefix）
- DG-01（scheme）+ DG-03（白名单）必须实现
- 不改 `/install.sh`、`/latest.json` 等现有端点
