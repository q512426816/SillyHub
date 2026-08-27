---
author: WhaleFall
created_at: 2026-08-27 11:10:00
---

# 模块影响分析（Module Impact）— OnlyOffice 高保真 Office 预览（已退役）

> 归档期补齐（变更期内 CLI 崩溃手工产出，未及生成）。终态口径：方案已于
> 2026-08-27 整体退役（ql-20260826-013 / ql-20260827-003），代码保留休眠。

## 模块影响矩阵

| 模块 | 影响类型 | 终态说明 |
|---|---|---|
| backend_modules | 新增 | `app/modules/preview_office/`（service/router/tests）：build_preview 双模式入口（LO→PDF / DS 配置三段 JWT 签名）+ 一次性文件令牌（HS256+redis jti 防重放）。现况：ONLYOFFICE_ENABLED=false/GOTENBERG_URL 空 → 503，休眠保留 |
| frontend_components | 新增 | `components/files/previewers/onlyoffice-previewer.tsx`（api.js 动态加载 + 替换式挂载 60s 兜底 + onError 降级）；现况随 office-config 503 不触发，休眠保留 |
| frontend_components | 修改 | `file-preview-modal.tsx`（office 前置尝试层 + mode=pdf/ds 分支 + 降级链）；现况 docx 因 503 直接走本地链 |
| deploy | 修改 | docker-compose.yml/.env（DS 复用 bsp 容器四项配置；gotenberg 服务上线又移除）；`scripts/onlyoffice-restore-fonts.sh`（DS 容器字体恢复）；`deploy/onlyoffice-fonts/`（gitignore，商用许可） |

## 未匹配文件

| 文件 | 处置说明 |
|---|---|
| backend/app/core/config.py | onlyoffice_* / gotenberg_* 配置项新增，core 配置不归属单一模块 |

## 更新结果

| 目标 | 操作 | 状态 |
|------|------|------|
| `modules/backend.md` | preview_office 模块条目（休眠态标注） | done（归档期补） |
| `modules/frontend_components.md` | onlyoffice-previewer 休眠态标注 | done（归档期补） |
