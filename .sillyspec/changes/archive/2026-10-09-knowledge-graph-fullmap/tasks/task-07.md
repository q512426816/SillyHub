---
id: task-07
title: '端到端验收：全图星空截图对照原型/下钻/回退/gzip 与 WS 大帧实测'
title_zh: '端到端验收：全图星空截图对照原型/下钻/回退/gzip 与 WS 大帧实测'
author: 'qinyi'
created_at: '2026-10-09 00:52:00'
priority: P1
depends_on: [task-06]
blocks: []
requirement_ids: [FR-01, FR-04, FR-05]
decision_ids: [D-001@v1, D-002@v1]
allowed_paths:
  - .sillyspec/changes/2026-10-09-knowledge-graph-fullmap/verify-e2e.md
target_files: []
goal: >
  本地栈（隔离 daemon+新 CLI）实测：全图星空视觉对照原型（截图并排）/点节点下钻/旧 CLI 模拟回退链/
  gzip 压缩比与 WS 大帧字节数实测留档（R-01/R-04 钉数据）。
implementation:
  - 重建本地镜像或 dev server；浏览器实测截图存变更目录
  - curl -H Accept-Encoding:gzip dump 端点：Content-Length 压缩前后对比
  - daemon 日志/backend 日志核对 WS 回包字节数（>1MB 无断裂）
  - 模拟旧 CLI（daemon 回 cli_feature_missing:dump 的 mock 或断开）验证胶囊隐藏+回退 orphans
  - verify-e2e.md 留档（对照原型的视觉差异说明：节点数/星系分布）
constraints: >
  真实环境实测留档；截图命名对照归档先例
acceptance:
  - verify-e2e.md 全项过或偏差有解释；浏览器 console 零红
verify:
  - 浏览器实测+curl 实测留档
---
# task-07

