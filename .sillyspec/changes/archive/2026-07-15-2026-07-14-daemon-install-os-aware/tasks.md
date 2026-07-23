---
author: qinyi
created_at: 2026-07-14 23:03:19
---

# 任务清单（Tasks）

> brainstorm 阶段粗任务骨架，详细 Wave 分组 / 依赖 / 验收标准在 **plan 阶段**展开（`sillyspec run plan --change 2026-07-14-daemon-install-os-aware`）。

## 粗任务（对应 design.md §6 文件变更清单）

- [ ] **task-01** 新增 `sillyhub-daemon/scripts/install.ps1`（PowerShell 安装脚本，含 `{{SERVER_URL}}` 占位，CRLF；复刻 install.sh：node 检测/latest.json/下载 sillyhub-daemon.js+mcp-server.js/.cmd wrapper/config.json/setx PATH/--version，不自动 start）
- [ ] **task-02** `sillyhub-daemon/`（或仓库根）新增/更新 `.gitattributes`：`sillyhub-daemon/scripts/install.ps1 text eol=crlf`（DG-02）
- [ ] **task-03** `backend/app/modules/daemon/dist_router.py` 新增 `GET /install.ps1` 动态端点 + `_derive_server_url(request)`（scheme DG-01 + 白名单 DG-03）
- [ ] **task-04** `backend/Dockerfile` 加 `COPY --from=daemon scripts/install.ps1 /app/daemon-dist/install.ps1` + COPY 后 `sed 's/$/\r/'` 兜底 CRLF（不对 ps1 去 CR）
- [ ] **task-05** `backend/tests/test_daemon_dist.py` 加 `test_install_ps1`（200 + `{{SERVER_URL}}` 已替换 + `application/x-powershell`）+ `test_install_ps1_server_url_derivation`（X-Forwarded-Proto/Host + 白名单拒绝非法 host）+ 404
- [ ] **task-06** `frontend/src/app/(dashboard)/runtimes/page.tsx` `InstallDaemonBlock` 改造：`detectOs(ua)` 纯函数 + `os` state（mounted 设值）+ 「macOS/Linux ｜ Windows」切换 UI + Windows 命令 `irm <serverUrl>/daemon/install.ps1 | iex` + 琥珀提示 + 命令按 os 分支
- [ ] **task-07** frontend vitest：`detectOs` 默认值（Windows/unix UA）+ 手动切换覆盖 + 两 OS 命令正确性 + 复制当前命令
- [ ] **task-08**（verify 手动）真实 Windows PowerShell 跑 `irm <serverUrl>/daemon/install.ps1 | iex`，验证下载 + config + `sillyhub-daemon --version`（CI Linux 跑不了 ps1）

## 依赖关系（粗）

- task-03（后端端点）依赖 task-01（install.ps1 模板存在，测试时 monkeypatch daemon-dist）
- task-05 依赖 task-03
- task-06 依赖前端现状（无跨任务依赖）
- task-07 依赖 task-06
- task-04（Dockerfile）依赖 task-01
- task-08 依赖 task-01/03/04 全部完成且部署

## 待 plan 阶段展开

- Wave 分组（建议：W1 后端端点+脚本+Dockerfile+测试 / W2 前端组件+测试 / W3 verify 手动 Windows）
- 每任务验收标准（对照 FR-01~06）
- 执行顺序与门禁
