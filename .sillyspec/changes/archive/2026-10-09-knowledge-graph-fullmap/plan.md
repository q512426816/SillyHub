---
plan_level: full
change: 2026-10-09-knowledge-graph-fullmap
created_at: 2026-10-09 00:50:00
author: qinyi
---

# 实现计划（Plan）— 2026-10-09-knowledge-graph-fullmap

> 承接 brainstorm 四件套（design.md 为权威蓝图，Grill 三轮 PASS）；Phase 0（sillyspec 仓 dump 子命令）
> 由该仓独立轻量 flow 交付，本计划为平台仓主体。

## Waves（依赖拓扑分层）

### Wave 1

- task-02
- task-03

### Wave 2

- task-04

### Wave 3

- task-05

### Wave 4

- task-06

### Wave 5

- task-07

## Wave 语义与依赖说明

- **跨仓前置（非平台任务面，先例同 2026-10-08）**：sillyspec 仓另立轻量 flow 交付 dump 子命令（layoutFullGraph 契约见 design Phase 0）——execute 启动前先行完成。
- W1 task-02（daemon 白名单）+ task-03（backend 端点，零交集并行，前提=跨仓前置已交付）→ W2 task-04（gen:types）→ W3 task-05（画布）→ W4 task-06（页面）→ W5 task-07（验收）。
- 相邻波均有依赖边（03→04、04→05、05→06、06→07）无伪并行。

## 测试策略

聚焦面：CLI 图测试（另仓）/ daemon handler 用例 / backend test_graph.py 扩展（dump+压缩断言+SSE 零回归）/ 前端 graph-canvas+page 用例更新；回归=既有 knowledge 全域；lint 三段式；禁全量（规则 0）。

## 风险与缓解（承接 design R-01~R-05）

R-01 WS 大帧：task-07 实测 5800 节点真图钉数据；R-02 渲染性能：k<0.5 护栏谓词入 task-05 测试；R-03 确定性：两次调用同坐标单测（task-01）；R-04 压缩外溢：task-03 断言既有端点无压缩头。

## 全局硬约束

1. 压缩面仅 dump 端点手动 gzip——**禁止**引入全站 GZipMiddleware（SSE 流风险，Grill F-00）。
2. 布局分组=原型 comm() 粗分组逐行移植——**禁止**用 summary 883 细簇（Grill F-01）；常量固化（sqrt(gi+1)*300 / 16*sqrt(j+1) / 2.39999 / +gi / Math.round）。
3. cli_feature_missing:dump → upgrade_required（区别于 rpc_error）。
4. dump 回包 daemon 不裁剪；确定性为硬约束、与原型逐位等价非约束。
5. 三主题零硬编码 hex；全中文；禁全量测试。
6. 既有五查询/图卡/补全/SSE 面零回归。

## FR/决策覆盖对照

FR-01（跨仓前置/07）、FR-02（task-02/07）、FR-03（task-03/07）、FR-04（task-05/06/07）、FR-05（task-05/07）。D-001@v1（task-06）、D-002@v1（task-01~07）、D-003@v1（跨仓前置）。
