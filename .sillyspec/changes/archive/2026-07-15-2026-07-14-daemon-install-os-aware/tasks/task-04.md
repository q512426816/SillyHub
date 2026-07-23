---
id: task-04
title: Dockerfile COPY install.ps1 with CRLF
title_zh: Dockerfile 打包 install.ps1 并保证 CRLF
author: qinyi
created_at: 2026-07-14 23:08:31
priority: P0
depends_on: [task-01]
blocks: [task-08]
allowed_paths:
  - backend/Dockerfile
---

## goal
把 install.ps1 烤进 backend 镜像 `daemon-dist`，并保证 CRLF 换行（覆盖 FR-06, DG-02）。

## implementation
- 在 `backend/Dockerfile` 现有 `COPY --from=daemon scripts/install.sh /app/daemon-dist/install.sh`（约第 98 行）后新增：
  - `COPY --from=daemon scripts/install.ps1 /app/daemon-dist/install.ps1`
- 现有第 111 行 `sed -i 's/\r$//' /app/docker-entrypoint.sh /app/daemon-dist/install.sh` **只对 install.sh 去 CR（bash 要 LF），不能把 install.ps1 加进去**——PowerShell 偏好 CRLF
- 双保险：新增一行对 install.ps1 兜底转 CRLF：`&& sed -i 's/$/\r/' /app/daemon-dist/install.ps1`（若已是 CRLF 则幂等，若被 git 转 LF 则修复）。放在 RUN 块里（与现有 sed 同一 RUN，或新增 RUN）

## 验收标准
- [ ] 镜像含 `/app/daemon-dist/install.ps1`
- [ ] install.ps1 在镜像中为 CRLF
- [ ] install.sh 现有 `sed 's/\r$//'` 不受影响（仍只对 install.sh + entrypoint）
- [ ] 不破坏现有 daemon-dist 其他文件（sillyhub-daemon.js / mcp-server.js）

## verify
- `docker build` 成功
- `docker run --rm <img> sed -n '1p' /app/daemon-dist/install.ps1 | xxd | tail -1` 确认行尾 \r\n（或 task-08 部署后验证）

## constraints
- DG-02：PowerShell 偏好 CRLF，与 install.sh（LF）相反
- 不并入现有去 CR 的 sed（那行明确只列 install.sh + entrypoint）
