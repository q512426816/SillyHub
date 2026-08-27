# preview_office — Office 家族文件预览服务（休眠）

> 状态：**休眠**（2026-08-27）。OnlyOffice/LibreOffice 两条高保真管线先后上线又
> 经用户决策退役（Excel 改下载引导 ql-20260826-013、Word 回归本地 docxjs 渲染
> ql-20260827-003）。代码与降级链完整保留，`ONLYOFFICE_ENABLED=true` /
> `GOTENBERG_URL=http://gotenberg:3000` 两个 env 即可重启。

## 定位

backend 侧 Office 预览配置服务：归属校验 → 一次性文件令牌 → 渲染配置下发
（LibreOffice 转 PDF 或 OnlyOffice DS 编辑器三段 JWT 配置）。不承担渲染本身。

## 契约摘要

- `GET /api/preview/office-config?source=&id=`：JWT 鉴权，返回
  `{"mode": "pdf", "pdf_path"}`（Word→LO→PDF，MinIO 内容寻址缓存
  `preview-pdf/{object_key}.pdf`）或 `{"mode": "ds", "ds_url", "config"}`
  （DS 三段签名配置）。503 = 未启用（前端降级本地渲染器锚点）。
- `GET /api/preview/file/{token}`：匿名一次性回拉（HS256 + redis jti 防重放，
  5min TTL）；`preview-pdf/` 前缀键返回 `application/pdf`（ql-20260826-012）。

## 关键逻辑

- LO 分支不依赖 OnlyOffice 开关（ql-20260827-002 解耦）；两条管线均失败回落
  DS 路径，DS 未启用 503 → 前端本地渲染器兜底——预览永不断链。
- DS 9 严格 JWT：顶层 token + document.token + editorConfig.token 三段同 secret。

## 注意事项

- bsp-onlyoffice 为外部项目容器，平台复用需字体恢复（deploy/scripts/
  onlyoffice-restore-fonts.sh，方正内嵌子集解混淆 ql-20260826-010）。
- OnlyOffice 引擎不支持中文 docGrid 行网格（sdk-all.js 源码零命中）；LO 支持
  但正文页数与 Word 有偏差——重启任何高保真方案前先读
  `.sillyspec/changes/archive/2026-08-26-onlyoffice-preview/verify-result.md`。
