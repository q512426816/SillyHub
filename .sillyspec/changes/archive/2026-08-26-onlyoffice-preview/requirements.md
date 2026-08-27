---
author: WhaleFall
created_at: 2026-08-26 09:15:00
---
# 需求规格（Requirements）— OnlyOffice 高保真 Office 预览

## 角色
| 角色 | 说明 |
|---|---|
| 平台用户 | 在会话/文件中心预览 Office 文件的所有内部用户 |
| 运维（用户本人） | 部署/维护 DS 容器与 .env 配置 |

## 功能需求

### FR-01: Office 高保真预览
覆盖决策：D-001
Given 预览的文件为 docx/xlsx/pptx/doc/xls/ppt 且 DS 已启用
When 打开预览窗
Then 经 DS 呈现高保真只读视图（样式/列宽/合并还原）；pdf/图片/md 走现有渲染器不变

### FR-02: 降级链
Given DS 未启用（config 503）、api.js 加载失败或 DocEditor 初始化出错
When office 文件预览
Then 自动回落本地渲染器（docx→docx-preview；xlsx/xls→SheetJS；ppt/pptx→fallback 下载），
用户看到的是朴素但完整的预览，无报错页面

### FR-03: 一次性文件令牌
覆盖决策：D-002
Given DS 需拉取文件（无 JWT 能力）
When backend 签发 file token
Then token HS256 签名、TTL 5 分钟、redis jti 一次性消费（重放 410）、绑定 object_key；
未签名/篡改访问 401

### FR-04: 归属校验
Given 用户请求 office-config（source=session_attachment|file, id）
When 附件/文件不属于该用户或不存在
Then 404（资源隐藏语义，与既有端点一致）

### FR-05: 前端零构建配置
Given 局域网 IP/端口变化
When 运维仅改 .env 的 ONLYOFFICE_PUBLIC_URL 并重启 backend
Then 前端无需重新构建即用新地址（config 端点下发 ds_url）

### FR-06: 部署门禁
覆盖决策：D-005
Given Docker VM Total Memory < 6GB
When 尝试部署 onlyoffice 服务
Then 验证步骤明确拒绝并提示先调 Docker Desktop 内存（文档+检查命令）

## 非功能需求
- 兼容：默认关闭 = 现状逐字节一致；既有六渲染器与三入口零改动
- 安全：DS JWT_ENABLED 强制开启（防未授权使用 DS）；file 端点仅流式读
- 可测试：backend 模块单测（token/config/归属/503）；前端渲染器两态测试

## 决策覆盖矩阵
| 决策 | FR |
|---|---|
| D-001 | FR-01/02 |
| D-002 | FR-03/04 |
| D-003 | FR-01（前端实现约束） |
| D-004 | FR-01（缓存边界） |
| D-005 | FR-06 |
