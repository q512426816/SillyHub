---
author: flow-machine-draft
created_at: 2026-10-14T22:44:58.994Z
---
# 设计记录（Design Record）— 2026-10-15-deploy-records-unicode-tolerance

## 做法概述

把 `backend/app/modules/deploy_records/service.py` `_iter_files` 读文件的 `except OSError` 扩为 `except (OSError, UnicodeDecodeError)`。依据：Python 异常层级中 `UnicodeDecodeError` 继承 `ValueError` 而非 `OSError`，`read_text(encoding="utf-8")` 解码失败时现状穿透 except 直接把 `GET /api/deploy-records` 打成 500，而该行注释声称「权限/编码等按 invalid 容错」——注释与实现不一致（2026-10-15 24h 风险审查发现）。扩异常元组是最小改动：降级产物复用既有 invalid 分支（`parse_error="file read error"`），解析器、排序、schema、路由零改动。不选 `read_bytes` + 手动 try decode——双份解码逻辑复杂度不值；也不只在 skill 写入侧强制 utf-8——治不了存量坏文件与人工手写文件，服务端容错是 FR-04 的兜底承诺。

## 接口契约

无对外签名 / 端点 / 文件格式变化。行为变化仅一处：`DeployRecordService.list_records` / `get_record` 对含非 UTF-8 字节的 docs/releases/*.md 从抛未捕获异常（HTTP 500，整页不可用）降级为 `status=invalid`、`summary=记录文件格式异常（frontmatter 缺失或不合规）`、`deployed_at=None` 的条目，详情 `content=""`。schema / 路由 / 迁移零改动。

## 边界与并发（盲维四问——每问必答，答不了即设计缺口）

1. 乱序/迟到到达：输入或事件乱序时，本设计的假设还成立吗？
   答：不适用事件顺序——本变更只扩单文件读取的异常捕获面。文件在扫描瞬间被写入一半产生坏字节时，解码失败同样落入 invalid 降级（比现状抛 500 更安全），agent 写完后的下次刷新自愈。
2. 并发写：两个执行体同时操作同一数据/文件会发生什么？
   答：扫描是纯读快照语义（v1 每请求实时扫描不变）；并发写方产生的坏字节/截断文件走新增的 UnicodeDecodeError 或既有 OSError 容错，均降级为 invalid 条目，无新增竞态面。
3. 切换/生命周期：会话、请求或变更中途切换/中断时状态是否安全？
   答：服务无跨请求状态（无缓存 v1）；请求中途文件被删由 `is_file()` / `iterdir()` 的 OSError 路径覆盖，编码异常由本次新增捕获覆盖，任一路径都返回确定的列表/404，无中间态。
4. 作用域：跨工作区/跨仓/多实例时数据会不会串台？
   答：影响面限于各 workspace 自身 docs/releases/*.md 的读取容错；invalid 条目仍归属原 workspace（record_id 前缀 = workspace_id 不变），聚合排序口径不变，不串台。

## 风险与死路

最大风险：捕获面过宽掩盖真实文件系统问题——不会：仅新增 `UnicodeDecodeError` 一类，OSError 分支语义不变，`parse_error` 仍留原因供排查。试过放弃的方案：① `read_bytes` + 手动 decode 再走解析——双份解码逻辑，容错分支翻倍不值；② 只修 skill 写入侧（强制 utf-8 落盘）——治不了存量坏文件与本机 Windows 手写文件，且 FR-04 已承诺服务端兜底，属治标不治本。

## 文件变更清单

| 操作 | 路径 | 说明 |
| --- | --- | --- |
| 修改 | backend/app/modules/deploy_records/service.py | `_iter_files` except 扩为 `(OSError, UnicodeDecodeError)`，注释与实现对齐 |
| 修改 | backend/app/modules/deploy_records/tests/test_service.py | 新增 GBK 坏编码用例 `test_non_utf8_file_degrades_to_invalid`（先红后绿） |
