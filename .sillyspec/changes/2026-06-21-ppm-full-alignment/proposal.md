---
author: qinyi
created_at: 2026-06-21T02:30:40+0800
change: 2026-06-21-ppm-full-alignment
---
# Proposal
## 动机
ppm 后端/前端基础已就绪,但源有更多功能(看板工作站/变更流4节点/projectplan三联表+成本/审批6态/图表)未对齐。
## 范围
W1-W6 全量对齐源功能,除文件上传/工作流。
## 非目标
文件上传(D-007/010)、工作流 silly(D-002)。
## 成功标准
看板任务CRUD+评论/子任务;变更流4节点;projectplan三联表+成本17字段;psplannode审批6态;echarts图表;对照源逐项verify。
