"""preview_office 模块（2026-08-26-onlyoffice-preview）。

OnlyOffice DS 高保真预览的后端支撑：
- ``GET /api/preview/office-config``：JWT 鉴权，校验附件/文件归属，签一次性
  file token 并组装 DS 编辑器配置（HS256 = DS JWT_SECRET 签名）返回。
- ``GET /api/preview/file/{token}``：DS 容器匿名回拉（无 JWT——DS 无携带能力），
  一次性令牌（redis jti 防重放 + TTL）校验后流式返回对象。

DS 复用 bsp-onlyoffice 容器（D-006）；enabled=false → 503 → 前端降级本地渲染器。
"""
