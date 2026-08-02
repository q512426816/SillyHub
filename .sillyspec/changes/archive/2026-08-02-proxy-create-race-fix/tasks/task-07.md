---
id: task-07
title: 真实 daemon-client 工作区 e2e 验收中文标题变更创建与失败回滚
title_zh: e2e 部署后验收
author: qinyi
created_at: 2026-08-02 00:35:50
priority: P1
depends_on: [task-01, task-02, task-03, task-04, task-05, task-06]
blocks: []
requirement_ids: [FR-01, FR-02, FR-05, FR-06]
decision_ids: [D-001@v2, D-005@v1]
allowed_paths:
  - backend/app/modules/change_writer/proxy.py
provides: []
expect_from: []
related_tests: []
goal: >
  真实 daemon-client 工作区 e2e 验收，中文标题变更创建不 500 docs 显示 失败回滚无孤儿。
implementation:
  - 部署后 local 或 Aliyun 建一个或选一个绑定在线 daemon 的真实 daemon-client 工作区 确认 daemon 心跳在线能响应 change-write claim 与 complete
  - curl POST proxy-create 创建中文标题变更如标题取测试变更四字 断言返回 201 不 500 change_key 保留中文形如 changes/2026-08-02-测试变更-xxxxxx/ 纯标点标题兜底走 untitled
  - 调详情页 docs 接口 GET changes 文档端点或前端详情页 断言返回 MASTER proposal request 三类 docs 不空 验证 AC-04 占坑 docs 已落库
  - 模拟 daemon 写失败或等回执超时 人为停 daemon 或让 daemon 回执 failed 或触发 60 秒超时 独立 session 查 DB 断言占坑 changes 行已 DELETE change_documents 经 FK CASCADE 级联删除 daemon_change_writes 无残留 done 关联 无孤儿 draft 行
acceptance:
  - AC-01 daemon-client 工作区创建中文标题变更返回 201 不 500 change_key 保留中文字如测试变更到 changes/2026-08-02-测试变更-xxx/ 纯标点兜底 untitled
  - AC-04 proxy 返回时 DB 已有 Change 加 docs 详情页或 docs 接口返回 MASTER proposal request 三类 docs 不空
  - AC-05 daemon 写 failed 或 proxy 等回执超时 60 秒 占坑 Change 加 docs 回滚 DB 无孤儿行 无残留 draft 行加无 daemon_change_write done 关联
verify:
  - 部署后 e2e 联调依赖 live daemon 加真实 daemon-client 工作区非单测命令 curl POST proxy-create 断言 201 加中文 change_key
  - curl GET changes 文档端点断言 docs 列表非空
  - 模拟 daemon 失败后用 docker compose exec backend python 或直连 PG 查 changes 与 change_documents 与 daemon_change_writes 表断言无孤儿
constraints:
  - 依赖 live daemon 加真实 daemon-client 工作区 非 mock 非 server-local 工作区
  - 不改代码只验收 allowed_paths 填 proxy.py 仅作被验收的 proxy_create_change 入口标识 回归类 task 无源码改动
  - 部署后执行 本地无 daemon 时降级为部署后补验 先记录待验项不阻断主流程收尾
---
