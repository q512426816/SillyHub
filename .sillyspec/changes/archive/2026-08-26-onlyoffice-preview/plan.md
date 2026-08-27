---
author: WhaleFall
created_at: 2026-08-26 09:15:00
plan_level: full
---
# 计划（Plan）— OnlyOffice 高保真 Office 预览

## Wave 1（无依赖）
- task-01
- task-02

## Wave 2（依赖 W1）
- task-03
- task-04

## 任务总表

| 编号 | 任务 | Wave | 优先级 | 依赖 | 覆盖 FR/D | 说明 |
|---|---|---|---|---|---|---|
| task-01 | backend preview_office 模块 | W1 | P0 | — | FR-03/04/05 | config 端点（归属校验+DS config 签名）+ file 令牌端点（一次性/TTL/流式）+ 单测 |
| task-02 | compose onlyoffice 服务 + .env | W1 | P0 | — | FR-06 | DS CE 9 镜像、外连 PG 新库、JWT、内存 limit、healthcheck、.env.example |
| task-03 | 前端 OnlyofficePreviewer + 降级链 | W2 | P0 | task-01 | FR-01/02 | api.js 动态加载、DocEditor 只读、三层降级、registry officeOnlyFormats、gen:types、测试 |
| task-04 | 端到端验证 + 部署 | W2 | P0 | task-02, task-03 | FR-06 | 内存门禁检查命令、DS 健康验证、真实 doc/xls/pptx 预览实测、降级演练（停 DS） |

## 关键路径
task-01 → task-03 → task-04

## 全局验收标准
1. backend/前端全量测试绿（含新增）；gen:types 成对提交
2. DS 启用：六种 office 格式高保真预览实测通过（含用户的绩效考核 xls）
3. 停 DS：预览自动降级、无白屏无报错（降级演练）
4. 默认关闭（.env 不配）：全站行为与现状一致
5. 部署文档含内存门禁（docker info ≥6GB）与 AGPL 对外边界提示
