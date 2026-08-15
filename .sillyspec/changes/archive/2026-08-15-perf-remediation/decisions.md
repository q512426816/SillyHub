---
author: qinyi
created_at: 2026-08-15 06:12:00
---

# 决策台账（Decisions）— perf-remediation

## D-001@v1

- type: scope
- status: accepted
- source: brainstorm step4（方案 A）
- question: 是否涉及 schema/索引变更？
- answer: 不动 schema 不加迁移不加索引——全部利用已有索引（ix_api_keys_prefix）与已有范式，纯读路径优化+批量化。
- normalized_requirement: NFR-04。
- impacts: 全部 FR。
- evidence: api_key_service.py 候选查询未用已存在的 key_prefix 索引（审查 F-04）。
- priority: P0

## D-002@v1

- type: implementation-pattern
- status: accepted
- source: brainstorm step4
- question: FS IO 线程化与批量的统一模式？
- answer: FS IO 一律 to_thread（parser 纯读线程安全）；写路径批量提交（进度回写 ≤50 文件/500ms；SELECT 循环前 IN 预取）。
- normalized_requirement: FR-01~04。
- impacts: change/scan_docs/spec_workspace/change_writer。
- evidence: Wave C 范式（tool_gateway:322）与 _write_spec_root:610 IN 预取已是项目内验证过的写法。
- priority: P0

## D-003@v1

- type: observability
- status: accepted
- source: brainstorm step4（方案 B 否决理由）
- question: 是否为本次优化新建 metrics？
- answer: 不建。复用已上线 monitoring 三件套（慢请求/事件循环堵塞/慢查询日志），优化效果用 slow.request 尖峰消失来验证。
- normalized_requirement: NFR-02/验收口径。
- impacts: verify 阶段观测方法。
- evidence: monitoring.py 三件套已部署（3a181291 + 并行会话增强）。
- priority: P1
