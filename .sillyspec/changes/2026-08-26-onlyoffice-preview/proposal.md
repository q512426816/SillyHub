---
author: WhaleFall
created_at: 2026-08-26 09:15:00
---
# 提案书（Proposal）— OnlyOffice 高保真 Office 预览

## 动机
纯前端渲染（SheetJS/docx-preview）只提供数据级预览，用户实测报表 xls 后要求样式还原；
调研确认自托管 OnlyOffice DS CE 是唯一免费高保真方案，用户已拍板（方案 A）并知悉风险。

## 关键问题
1. Word/Excel/PPT（含 doc/xls/ppt 旧格式）预览需还原列宽/颜色/合并/图表等原文件样式；
2. DS 拉文件无法携带平台 JWT（需安全的一次性文件访问通道）；
3. DS 是新依赖，故障不能拖垮既有预览能力。

## 变更范围
- deploy：compose + onlyoffice 服务（外连现有 PG、内置 MQ、JWT 签名、内存限制）
- backend：preview_office 模块（office-config 端点 + 一次性 file 令牌端点）
- frontend：OnlyofficePreviewer 渲染器 + office 家族前置尝试与三层降级链
- OpenAPI 变更 → gen:types 成对提交

## 不在范围内
在线编辑/协同、PDF/图片/md 换渲染器、移动端、DS 文档缓存、对外开放（AGPL 复核另议）

## 成功标准（可验证）
- DS 启用后：docx/xlsx/pptx/doc/xls 在预览窗呈现高保真样式视图（含旧格式）
- ONLYOFFICE_ENABLED=false 或 DS 停机：预览自动降级为现有渲染器，功能不中断
- file 令牌：5 分钟过期、一次性（重复访问 410）、未签名访问 401
- 全量测试绿（backend 新模块测试 + frontend 2179+ 基线）
