---
id: task-03
title: 'scoped 定向删除 + 删除环/_apply_parsed deleted 三点豁免 + progress 联动删 + rename 限定 scope + 红测改写'
title_zh: 'scoped 定向删除 + 删除环/_apply_parsed deleted 三点豁免 + progress 联动删 + rename 限定 scope + 红测改写'
author: 'qinyi'
created_at: 2026-08-29 12:57:58
priority: P0
depends_on: ['task-01', 'task-02']
blocks: []
requirement_ids: [FR-01, FR-03a]
decision_ids: [D-005@v1, D-006@v1]
allowed_paths:
  - backend/app/modules/change/service.py
  - backend/app/modules/change/tests/test_reparse_scoped_zero_delete.py
  - backend/app/modules/change/tests/test_reparse_delete_closure.py
goal: >
  将 reparse 删除环从「仅全量」修订为 scoped 定向删除（R-08 收窄而非推翻）——scope 非空也进删除环但仅删 scope 集内磁盘确认消失的行；同时对 location='deleted' 墓碑行三点豁免（scoped 与全量删除环不删、_apply_parsed 不回翻 location）、删除点连带清 platform_change_progress、rename 检测限定 scope 集，使本地裸删后变更中心自动收敛（FR-01）且 progress 无残留（FR-03a），防复活锚点行不被误删（B-1/R-09）。
implementation:
  - '删除环闸门（service.py:1293 「if scope is None:」）改为 scope 非空也进删除环、循环体按模式分流——全量保持现语义（key 不在 seen_keys 即删）；scoped 仅删 key∈scope 集且不在 seen_keys 的行，scope 外行零动作（R-01 仅 scope∩磁盘确认消失才删）；同步更新 :1289-1292 注释与 reparse docstring（:1159-1167）为修订后语义'
  - '占位保护原样复用——_progress_reported_active_keys 与无文档条件（:1294-1309）在 scoped 与全量两模式同样生效，7 天窗 PLACEHOLDER_PROTECT_WINDOW_DAYS（:1351）不改'
  - 'B-1 三点豁免——① scoped 删除环跳过 location 为 deleted 的行；② 全量删除环同样跳过；③ _apply_parsed（:2166-2200）遇 row.location 为 deleted 时不执行 :2181 的 location 覆写（parser 即便产出同名 parsed 也不回翻；仅保护 location 字段，其余字段更新语义不变）——R-09 审计锚点行保活'
  - 'progress 联动删——删除环删 Change 行处（:1310）连带删 platform_change_progress 同 (workspace_id, change_name) 行（PlatformChangeProgressORM 函数级 import，照 :1331 范式；行不存在静默跳过；deleted 豁免行不触发联动删）'
  - 'rename 限定 scope（R-11）——调用点 :1202-1213 从「仅全量调用」改为始终调用 _detect_renames 并传 scope 集（None 即全量现语义）；_detect_renames（:1416-1467）scoped 模式下 orphaned 候选仅取 key∈scope 集的 existing 行（existing_by_key 仅取相关行，不做全量拉取误判），包裹路径 changes_dir（:1433）先做空判——目录不存在直接返回空 dict（防扁平布局或路径缺失把全部行误判 orphaned）'
  - '红测改写 test_reparse_scoped_zero_delete.py——test_scoped_reparse_does_not_delete_out_of_scope_changes（:87-113，断言点 :108）改为双断言「scope 外不删 + scope 内磁盘消失可删（stats["deleted"] 与行删除断言）」；test_scoped_reparse_does_not_delete_scope_in_disappeared_change（:116-134）反转为「scope 内消失即删 + platform_change_progress 行连带删」；test_full_reparse_still_deletes_disappeared_changes（:206-220）全量现状语义回归保留；test_scoped_reparse_skips_rename_detection（:223-244）改写为「scope 集内 rename 被识别（renamed 计数与 workflow 状态保留断言）+ scope 外不误判」；模块 docstring 同步修订语义'
  - '新增 test_reparse_delete_closure.py——三点豁免各一条（scoped 删除环不删 deleted 行／全量删除环不删 deleted 行／_apply_parsed 不回翻 location——parser 产出同名 parsed 时 location 保持 deleted）；progress 联动删断言；7 天占位保护回归（scoped 与全量两模式）'
acceptance:
  - 'scoped reparse 中 scope 内 key 磁盘确认消失 → Change 行删除且 platform_change_progress 对应行连带删除；scope 外行零动作（双断言，design §13）'
  - '全量 reparse（scope 为 None）语义不变——磁盘消失即删、7 天占位保护原样，既有回归全绿'
  - 'location 为 deleted 的行三点豁免生效——scoped 与全量删除环均不物理删、_apply_parsed 不回翻 location（R-09）'
  - 'scoped rename——scope 集内 old→new 目录改名被识别并保留 workflow 状态；scope 外变更不被误判 orphaned（R-11）'
  - 'test_reparse_scoped_zero_delete.py 改写后全绿，test_reparse_delete_closure.py 全绿'
verify:
  - 'cd backend && python -m pytest app/modules/change/tests/test_reparse_scoped_zero_delete.py app/modules/change/tests/test_reparse_delete_closure.py -q'
  - 'cd backend && python -m pytest app/modules/change/tests/test_reparse_guard.py -q'
constraints:
  - '不改全量 reparse 删除语义与 7 天占位保护（PLACEHOLDER_PROTECT_WINDOW_DAYS 与 _progress_reported_active_keys 逻辑原样，仅两模式共用）'
  - '不动 spec_workspace/service.py——_compute_reparse_scope（:1625-1717）scope 语义只读理解；该文件归其它波次任务，其 docstring 中「scoped 零 delete」表述漂移由后续归属任务或收尾 task-15 处理'
  - '不实现 soft_delete_change_dir／DELETE 端点／enrich 对 deleted 行处理（归 task-06）；不动前端；R-08 修订决策记录入本变更 decisions.md 归收尾 task-15'
  - '遵守 CLAUDE.md 规则 0——只跑 change 模块相关测试，全量留 CI'
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
