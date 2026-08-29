---
id: task-05
title: 'Quicklog apply-time reconciliation (hidden) + merge_entries filter'
title_zh: 'quicklog apply 期对账（缺失 ql_id 置 hidden）+ merge_entries 过滤'
author: 'qinyi'
created_at: 2026-08-29 12:57:58
priority: P1
depends_on: ['task-01']
blocks: []
requirement_ids: [FR-03b]
decision_ids: []
allowed_paths:
  - backend/app/modules/spec_workspace/service.py
  - backend/app/modules/change/quicklog_service.py
  - backend/app/modules/spec_workspace/tests/test_quicklog_reconcile.py
  - backend/app/modules/change/tests/test_quicklog_service.py
goal: >
  apply_ops 落完 quicklog/ 文件 ops 后重解析镜像 quicklog/ 目录，把文件集合中缺失
  ql_id 的 pushed 行软隐藏（hidden=True），并在 merge_entries 过滤 hidden 行，使本地
  删除的 QUICKLOG 条目不再显示、推送留底可回滚（FR-03b，design §5.3）。
implementation:
  - apply_ops（service.py）在 ops 统一 commit 后（:1601 之后、_trigger_change_reparse :1610-1617 旁的 best-effort 段）：本次 ops 含 quicklog/ 前缀路径时触发对账——复用 parse_quicklog_directory（backend/app/modules/change/quicklog_parser.py:91）重解析 spec_root/quicklog 取文件侧 ql_id 集合；查该 workspace 的 QuicklogEntryORM pushed 行，ql_id 不在文件集合 → hidden=True，仍在集合且当前 hidden=True 的行回翻 hidden=False（文件重新出现即恢复，软隐藏可回滚）；异常仅 log.warning 不阻断同步主流程（对齐 reparse 触发容错范式）
  - 对账仅重解析 quicklog/ 目录（parse_quicklog_directory 自带 name+mtime 指纹缓存）；ops 不含 quicklog/ 时零触发零额外查询（R-03：不新增整树扫描）
  - merge_entries（backend/app/modules/change/quicklog_service.py:285-323）：pushed_rows 查询（:289-299）追加 hidden 为 False 的过滤条件，hidden 行不进合并；_prefer_pushed/排序/文件侧解析逻辑零改动
  - 新建 backend/app/modules/spec_workspace/tests/test_quicklog_reconcile.py：① apply_ops 落含 quicklog/ 的 ops 后，文件中已删条目对应 pushed 行 hidden=True、文件仍存在条目不受影响（apply 时点文件刚落镜像，无文件同步滞后误杀）；② ops 不含 quicklog/ 时对账零触发；③ 对账异常不阻断 apply_ops 返回
  - 扩写 backend/app/modules/change/tests/test_quicklog_service.py：merge_entries 对 hidden=True 的 pushed 行不出现、hidden=False 行照常合并、文件侧条目不受影响
acceptance:
  - apply_ops 处理含 quicklog/ 的 ops 并提交后，文件集合中缺失 ql_id 的 pushed 行 hidden=True；文件中仍存在的 ql_id 行不被误隐藏
  - ops 不涉及 quicklog/ 时对账零触发（无额外查询/目录解析）
  - merge_entries 合并结果不含 hidden=True 的 pushed 行，hidden=False 行与文件侧条目行为不变
  - 不物理删除任何 QuicklogEntryORM 行（软隐藏留底，design §15 Non-Goal）
  - 对账抛异常仅告警，apply_ops 正常返回 new_versions/conflict（best-effort）
verify:
  - cd backend && uv run pytest app/modules/spec_workspace/tests/test_quicklog_reconcile.py -q
  - cd backend && uv run pytest app/modules/change/tests/test_quicklog_service.py -q
constraints:
  - 仅重解析镜像 quicklog/ 目录，禁止整树扫描（R-03）；对账在事务提交后 best-effort 执行，异常不阻断同步主流程
  - 软隐藏不硬删；不做变更级 quicklog 联动清理（design §16 开放问题，倾向不做，YAGNI）
  - 不动 merge_entries 的 _prefer_pushed/排序/分页逻辑，仅过滤 hidden
  - spec_workspace/service.py 与 task-02/task-06/task-08 同文件分 Wave 隔离——本任务只加对账钩子，不改 apply_ops 拦截/空目录清理区域与 _write_spec_root
  - 遵守 CLAUDE.md 规则 0：只跑 change/spec_workspace 相关测试，全量留 CI
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
