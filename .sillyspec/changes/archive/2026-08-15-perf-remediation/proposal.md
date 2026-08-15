---
author: qinyi
created_at: 2026-08-15 06:11:00
---

# 提案（Proposal）— perf-remediation

## 一句话

修复性能审查确认的 10 项高危/中危性能问题：事件循环解放（reparse/spec 写入 to_thread）、批量化（进度回写/IN 预取）、查询收窄（content 大列/key_prefix 索引）、FS 惯性（scandir/stat 复用/缓存）、前端 daemon 增量化与门控。

## 动机

- reparse ~8s 同步 IO 阻塞事件循环，期间所有并发请求（含 daemon WS 心跳）卡死。
- 1545 文件 spec 树同步 = 1545 次独立 session+commit（PG WAL 放大）。
- api_key 认证 miss 时 O(n×bcrypt cost12) 全表扫描（key_prefix 索引闲置）。
- scan_docs 列表页全量加载文档全文 TEXT 列。

## 方案概要

方案 A 逐项直修，全部复用项目已有正确范式（Wave C to_thread / 批量 IN 预取 / ql-008 scandir / ix_api_keys_prefix）。行为零变更。

## 不在范围内（Non-Goals）

前端组件拆分/虚拟化/bundle、PPM 导入 N+1、JSON 列瘦身、bundle 流式化、新增索引。

## 验收口径

每项修复：行为保持测试（优化前后结果等价）先行；命中模块 pytest 全绿；reparse 事件循环阻塞消除可观测（慢请求日志不再出现 reparse 期间的全接口 slow.request 尖峰）。
