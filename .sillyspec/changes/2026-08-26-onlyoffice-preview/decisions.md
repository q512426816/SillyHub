---
author: WhaleFall
created_at: 2026-08-26 09:10:00
---
# 决策记录（Decisions）— OnlyOffice 高保真 Office 预览

## D-001@v1: 选型 OnlyOffice DS CE（方案 A）
- type: architecture
- status: accepted
- source: user
- question: 高保真 Office 预览的实现路线？
- answer: 用户在 A（OnlyOffice 容器）/B（纯前端样式增强）/C（维持现状）中选 A。调研依据：Univer 高保真导入导出为收费 Pro 功能（docs.univer.ai/guides/pro）；Luckysheet 停维护；FortuneSheet 样式导入有损；xlsx-js-style 仅 xlsx 且要自写渲染层；OnlyOffice CE 自托管免费、全格式（含 doc/xls/ppt 旧格式）、还原度最高。
- normalized_requirement: DS CE 单容器（内置 RabbitMQ/Redis，外连现有 PG）；只读模式；AGPL 内部使用合规（对外需法务复核 R-05）。
- impacts: [全设计]
- evidence: 2026-08-25 与用户确认（AskUserQuestion 方案选择 + 风险确认）
- priority: P0

## D-002@v1: 文件供给走 backend 一次性令牌端点（非 MinIO presigned）
- type: architecture
- status: accepted
- source: code
- question: DS 拉文件无法带 JWT，用 MinIO 预签名 URL 还是代理端点？
- answer: 代理端点 GET /api/preview/file/{token}：与存储后端解耦（storage/base.py 无 presign 抽象，session_attachments 与 file 两套对象都能覆盖）；HS256+5min TTL+redis jti 一次性。
- normalized_requirement: token 绑定 object_key；jti 消费后失效；端点无 JWT（DS 匿名拉取），仅流式读。
- impacts: [design §5 preview_office 模块]
- evidence: backend/app/modules/storage/base.py（无 presign 能力实测）
- priority: P0

## D-003@v1: 前端不引 @onlyoffice/documenteditor-react，动态 script + DocsAPI
- type: architecture
- status: accepted
- source: code
- question: DS 前端集成用官方 React 包还是裸 API？
- answer: 裸 API：官方包只是薄封装但引入常驻依赖与版本耦合；api.js 动态加载（仅 office 预览时）+ 自写最小类型声明，失败即降级。
- impacts: [design §5 onlyoffice-previewer]
- evidence: DS 官方集成文档（api.js 单脚本接入模式）
- priority: P1

## D-004@v1: doc_key 每次随机（不做 DS 侧缓存）
- type: boundary
- status: accepted
- source: code
- question: DS 用 document.key 做文档缓存，复用 key 可加速重复预览，做不做？
- answer: 不做。随机 key 每次重新拉文件，实现最简、无缓存失效/版本错乱问题；内部使用规模（CE 20 并发）流量可忽略。
- impacts: [preview_office service]
- evidence: 设计权衡（YAGNI）
- priority: P2

## D-005@v1: 部署前置检查内存（硬门）
- type: risk
- status: accepted
- source: user
- question: Docker VM 仅 3.8GB，DS 最低 4GB，如何防带病部署？
- answer: compose 部署文档/验证步骤强制 docker info Total Memory ≥6GB 检查；用户已确认部署时手动调 Docker Desktop 内存至 8GB。
- impacts: [R-01, tasks task-04]
- evidence: 2026-08-26 AskUserQuestion（用户选"先设计，部署时再调"）
- priority: P0
