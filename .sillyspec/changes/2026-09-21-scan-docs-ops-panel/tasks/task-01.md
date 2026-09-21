---
id: task-01
title: 'backend stats data foundation (DTOs + service aggregation + endpoint + tests)'
title_zh: '后端 stats 数据底座（DTO 族 + 聚合服务 + 端点 + 测试）'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-09-21 09:58:52
priority: P0
depends_on: []
blocks: []
requirement_ids: [FR-01, FR-02, FR-06]
decision_ids: [D-001@v1, D-002@v1, D-003@v1]
allowed_paths:
  - backend/app/modules/scan_docs/schema.py
  - backend/app/modules/scan_docs/service.py
  - backend/app/modules/scan_docs/router.py
  - NEW:backend/app/modules/scan_docs/tests/test_stats.py
target_files:
  - backend/app/modules/scan_docs/schema.py
  - backend/app/modules/scan_docs/service.py
  - backend/app/modules/scan_docs/router.py
  - NEW:backend/app/modules/scan_docs/tests/test_stats.py
provides:
  - ScanDocsStatsOut DTO 族 9 类（backend/app/modules/scan_docs/schema.py，含 coverage/stale_docs/density/freshness/recent_board/injection 字段）
  - GET /workspaces/{ws}/scan-docs/stats 响应（ScanDocsStatsOut，SCAN_DOCS_READ）
goal: >
  扫描文档运营指标的 backend 数据底座：新增 stats 聚合服务与只读端点，把
  scan_documents 单表聚合成覆盖率（两级口径）/陈旧/密度/新鲜/趋势/最近更新榜，
  并聚合 knowledge_hits 的 docs-inject 行出注入频次，配套口径测试。
implementation:
  - backend/app/modules/scan_docs/schema.py 新增 ScanDocs 前缀 DTO 9 类（ScanDocsTrendPoint/ScanDocsCoverageOut/ScanDocsStaleDocOut/ScanDocsDensityOut/ScanDocsFreshnessOut/ScanDocsRecentBoardItem/ScanDocsInjectionBoardItem/ScanDocsInjectionOut/ScanDocsStatsOut），字段按 design.md 接口定义节
  - backend/app/modules/scan_docs/service.py 新增 async def stats(workspace_id)：一次 load_only 轻列查询取全部 exists 行（排除 content），path 剥 .sillyspec/docs 前导段按第一段分组；_module-map.yaml 行单独 SELECT content 用 yaml.safe_load 解析 modules 条目数（失败按无 map 退化）；按 design 口径计算五组指标；再 SELECT knowledge_hits WHERE type='docs-inject' AND occurred_at>=now-30d 聚合 injection（matched_anchors 剥前缀对齐，board 按路径计数降序 Top10）
  - backend/app/modules/scan_docs/router.py 新增 GET /scan-docs/stats（require_permission(Permission.SCAN_DOCS_READ)），声明在 GET /scan-docs/{doc_id} 之前并留路由序铁律注释（对齐 backend/app/modules/knowledge/router.py:215 先例）
  - NEW:backend/app/modules/scan_docs/tests/test_stats.py：fixture 双项目（A 七件套齐+map 登记 3 实有 3；B 缺 2 件+无 map 有 2 篇模块文档）+ mtime 边界（91 天前/10 天前）+ 直插 KnowledgeHit type='docs-inject' 行断言 injection 三值与知识 stats（HitsService.stats）数值不变
acceptance:
  - GET /scan-docs/stats 返回 200 且响应含 coverage 两级计数（std_have/std_expected/module_have/module_expected）、stale_docs、density.per_project_avg、freshness、recent_board、injection
  - 覆盖率可复算：fixture A 七件套 7/7、B 5/7；模块层 A 3/3、B 2/2（无 map 退化）；综合分子分母正确
  - 陈旧=91 天前 mtime 的文档计入、10 天前不计；last_modified_at 为空计入且清单可含
  - 插入 docs-inject 行后 injection.total_30d/docs_hit_30d/board 正确，且知识库 stats（backend/app/modules/knowledge/hits.py stats）各指标不变
  - stats 端点请求不被 /scan-docs/{doc_id} 通配吞掉（路由序生效）
verify:
  - cd backend && .venv/Scripts/python.exe -m pytest app/modules/scan_docs/tests/test_stats.py -q
  - cd backend && .venv/Scripts/python.exe -m pytest app/modules/scan_docs/ app/modules/knowledge/tests -q
  - cd backend && .venv/Scripts/python.exe -m ruff check app/modules/scan_docs/ && .venv/Scripts/python.exe -m ruff format --check app/modules/scan_docs/
constraints:
  - 不改既有 list/get/reparse/conflicts 四端点行为与 DTO
  - 不改 knowledge 模块任何代码（docs-inject 宽容落库是既有行为）
  - DTO 命名统一 ScanDocs 前缀（防 OpenAPI 去重后缀）
  - _module-map.yaml 解析失败按无 map 退化，不抛 500
  - stale_docs 上限 200 条、recent_board/injection board 上限 10 条
---

<!-- 骨架由 sillyspec taskcard 生成（LF 行尾 + frontmatter 已闭合 + 硬校验 9 字段齐全）。
     用 Edit tool 填充上方占位符（allowed_paths/goal/implementation/acceptance/verify/constraints 等），
     勿用 Write 整文件重写——会引入 CRLF 行尾/漏闭合 ---/漏字段回归。
     ⚠️ plan --done 硬校验会拦截未替换的占位符（FR-XX / D-XXX / src/example/file.ts /
     一句话说明这个 task / 具体步骤 1 / 可验证的验收条件 1 / 边界约束 1）——占位符视同缺字段。
     target_files 格式（可选，对账用精确文件级意图声明，与 allowed_paths 语义不同）：
                    精确文件路径（仓根相对、正斜杠），当前不存在、将由本 task 新建的文件加
                    NEW: 前缀（如 NEW:src/foo.js）；禁 glob（src/**）、禁目录前缀（src/dir/）、
                    禁绝对路径；无明确文件级意图时保留 [] 占位行不动。
     implementation/acceptance 里的源码位置同样写仓根相对全路径+行号（src/foo.js:123）——
                    裸文件名在 docs-check 层1 靠 basename 全仓扫描找候选，找不到候选或关键词
                    窗口不匹配即失效，到 pre-push 才拦（2026-09-19 实证 64 处返工）。
     可选字段按需插进上方 frontmatter（规则见 taskcard-rules）：
     repo:          仅跨仓 task 填（local.yaml repos: 注册的仓 key；缺省=main。allowed_paths 相对该仓根写，
                    禁止带仓库名前缀/绝对路径——review 对账按仓根相对路径匹配，带前缀永不命中）
     provides:      仅当本 task 给其他 task 提供接口/DTO/响应时填
     expects_from:  仅当本 task 消费其他 task 的契约时填
     related_tests: 仅当本 task 改动导致既有测试断言失效时填（测试路径须同时进 allowed_paths） -->
