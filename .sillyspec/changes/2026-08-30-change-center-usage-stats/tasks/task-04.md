---
id: task-04
title: 'add change and quicklog usage endpoints'
title_zh: '后端两个 usage 端点（CHANGE_READ + 404 resource-hiding）'
author: 'qinyi'
created_at: 2026-08-30 17:00:35
priority: P0
depends_on: ['task-02']
blocks: [task-05]
requirement_ids: [FR-03]
decision_ids: [D-005@v1]
allowed_paths:
  - backend/app/modules/change/router.py
expects_from:
  task-01:
    - contract: ChangeUsageRead
      needs: [started_at, finished_at, duration_ms, totals, by_model]
  task-02:
    - contract: ChangeUsageQueryService
      needs: [get_change_usage, get_quicklog_usage]
provides:
  - contract: usage-endpoints
    fields: [GET_changes_usage, GET_quicklog_usage]
goal: >
  新增两个只读 usage 端点把聚合服务暴露给前端用量卡，权限与 404 语义对齐既有详情端点的 resource-hiding 口径。
implementation:
  - 新增 GET changes/{change_id}/usage 与 GET quicklog-entries/{ql_id}/usage（挂既有 workspace 路由前缀下），response_model 为 ChangeUsageRead，Depends(require_permission(Permission.CHANGE_READ))
  - 变更侧先经 ChangeService.get 归属校验——不存在、跨工作区、location 为 deleted 均抛 404（对齐读侧防复活口径）
  - quicklog 侧对齐 get_quicklog_entry 严格 404——条目不存在即 404，不像 sessions 姊妹端点容忍有 link 无条目竞态
  - 命中后委托 usage_service 的 get_change_usage 或 get_quicklog_usage 返回聚合结果
acceptance:
  - 缺权限 403；不存在、跨工作区、deleted 变更或不存在快速修复均 404
  - 两端点响应形状与 ChangeUsageRead 逐字段一致
verify:
  - cd backend && uv run pytest app/modules/change -q --no-cov -n auto
  - cd backend && uv run ruff check app/modules/change/router.py && uv run mypy app
constraints:
  - 零迁移不加表列；不改 daemon
  - 旧客户端兼容——纯新增端点，不动既有 API 既有字段
  - 不写测试（404 与聚合用例归 task-05）；openapi.json 生成物归 task-06 不手改
---

<!-- 骨架由 sillyspec taskcard 生成（LF 行尾 + frontmatter 已闭合 + 硬校验 9 字段齐全）。
     用 Edit tool 填充上方占位符（allowed_paths/goal/implementation/acceptance/verify/constraints 等），
     勿用 Write 整文件重写——会引入 CRLF 行尾/漏闭合 ---/漏字段回归。
     ⚠️ plan --done 硬校验会拦截未替换的占位符（FR-XX / D-XXX / src/example/file.ts /
     一句话说明这个 task / 具体步骤 1 / 可验证的验收条件 1 / 边界约束 1）——占位符视同缺字段。
     可选字段按需插进上方 frontmatter（规则见 taskcard-rules）：
     repo:          仅跨仓 task 填（local.yaml repos: 注册的仓 key；缺省=main。allowed_paths 相对该仓根写，
                    禁止带仓库名前缀/绝对路径——review 对账按仓根相对路径匹配，带前缀永不命中）
     provides:      仅当本 task 给其他 task 提供接口/DTO/响应时填
     expects_from:  仅当本 task 消费其他 task 的契约时填
     related_tests: 仅当本 task 改动导致既有测试断言失效时填（测试路径须同时进 allowed_paths） -->
