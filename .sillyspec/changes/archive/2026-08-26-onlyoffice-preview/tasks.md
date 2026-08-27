---
author: WhaleFall
created_at: 2026-08-26 09:15:00
updated_at: 2026-08-27 11:10:00
---
# 任务清单（Tasks）— OnlyOffice 高保真 Office 预览

> 归档终态注记（ql-20260827-003）：四个任务在 2026-08-26 均已实现并部署上线，
> 后经用户决策整体退役（Excel 改下载引导 ql-20260826-013、Word 回归本地渲染
> ql-20260827-003）。**代码路径保留休眠**：ONLYOFFICE_ENABLED/GOTENBERG_URL
> env 开关关闭即回退，模块与降级链完整可随时重启。

- [x] task-01: backend preview_office 模块（office-config 端点 + 一次性 file 令牌端点）+ 单测
  - 终态：已完成并部署（提交 0bd08e88 等）；后经三轮端到端调试（DS 9 严格 JWT 三段签名 55d8e198/81c3e61b、误降级修复 db6b2b01、LO 管线扩展与解耦 3d1ebd2d/0bec31e2）；现况 env 关闭 → 端点 503，测试 16/16 绿（含 LO 分支与 DS 禁用语义）
- [x] task-02: compose onlyoffice 服务 + .env 配置（PG 外连/JWT/内存 limit/healthcheck）
  - 终态：形态变更（D-006）——未新增 DS 实例，复用既有 bsp-onlyoffice 容器（跨 compose 走宿主机地址）；.env 四项配置就位；后追加 gotenberg 服务（又随 ql-20260827-003 移除）
- [x] task-03: 前端 OnlyofficePreviewer + 降级链 + gen:types + 单测
  - 终态：已完成（替换式挂载 60s 兜底 + onDocumentReady 取消、type=desktop、mode=pdf 分支）；现况 OFFICE_EXTS 不含 xls/xlsx，docx 因 office-config 503 自动降级本地 docxjs 渲染；files 测试套 70/70 绿
- [x] task-04: 端到端验证（六格式实测/降级演练/内存门禁）+ 部署
  - 终态：已完成——三轮真实浏览器验证 + DS 容器内一次性令牌回拉（38912B OLE2 魔数 + 410 重放验证）+ 字体解混淆修复（方正内嵌子集，ql-20260826-010）；最终验收口径：docGrid 行网格引擎不支持（sdk-all.js 源码零命中）+ Word 排版差异 + LO 管线页数偏差（46 v 42），用户决策退役（ql-20260826-013 / ql-20260827-003）
