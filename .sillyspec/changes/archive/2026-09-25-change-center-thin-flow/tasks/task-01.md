---
id: task-01
title: 'Add THIN auxiliary stage enum with dispatch config entry'
title_zh: '阶段模型：THIN 辅助阶段入枚举与派发配置'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-09-25 07:14:58
priority: P0
depends_on: []
blocks: []
requirement_ids: [FR-01]
decision_ids: [D-001@v1]
allowed_paths:
  - backend/app/modules/change/model.py
  - backend/app/modules/change/dispatch.py
  - backend/app/modules/change/service.py
  - backend/tests/modules/change/test_dispatch_stage_config.py
  - backend/app/modules/change/tests/test_dispatch.py
target_files:
  - backend/app/modules/change/model.py
  - backend/app/modules/change/dispatch.py
  - backend/app/modules/change/service.py
  - backend/tests/modules/change/test_dispatch_stage_config.py
  - backend/app/modules/change/tests/test_dispatch.py
goal: >
  StageEnum 新增 THIN="thin" 辅助阶段并同批落 STAGE_AGENT_CONFIG 占位条目（键集精确相等测试要求枚举与配置同批，防跨任务红窗），排序位与配置计数/键集断言一并更新，为分流/派发 prompt/守卫任务提供阶段值基础。
implementation:
  - backend/app/modules/change/model.py:32-72 StageEnum 加 THIN = "thin"；spec_auxiliary_stages() 返回 [QUICK, THIN]；TRANSITIONS/spec_stages()/STAGE_ORDER 不动
  - backend/app/modules/change/dispatch.py:81-136 STAGE_AGENT_CONFIG 加 StageEnum.THIN 条目（enabled=True、prompt_template="thin.md"（文件内容由 task-02 落，配置测试只断言非空字符串）、phase="Thin"、requires_worktree=False、read_only=False；注释对齐 quick 先例 :122-127 说明 manual_dispatch 泛化路径）
  - backend/app/modules/change/service.py:2556-2598 _stage_group_order 把 "thin" 排进已知序（quick 之后、未知阶段之前）
  - backend/tests/modules/change/test_dispatch_stage_config.py:14-16 计数 6→7；:19-24 键集断言经枚举并集自动覆盖；docstring 7 键说明同步
  - backend/app/modules/change/tests/test_dispatch.py test_all_expected_stages_present 期望集加 "thin"；对齐 quick 断言形态（:52-59 附近）补 thin config values 断言
acceptance:
  - StageEnum.spec_auxiliary_stages() == [StageEnum.QUICK, StageEnum.THIN]
  - STAGE_AGENT_CONFIG 键集 == spec_stages ∪ spec_auxiliary_stages（7 键）；thin 条目 enabled=True/read_only=False/prompt_template 非空
  - THIN 无 TRANSITIONS 出边、不进 STAGE_ORDER；_stage_group_order("thin") 排 quick 后
verify:
  - cd backend && uv run pytest tests/modules/change/test_dispatch_stage_config.py app/modules/change/tests/test_dispatch.py app/modules/change/tests/test_gate_transitions.py app/modules/change/tests/test_step_progress.py -q --no-cov
constraints:
  - 枚举与配置条目必须同批落（test_config_keys_match_spec_stages 键集精确相等，分开即红窗）
  - 存量 QUICK 语义一行不动（CLAUDE.md 规则 19）；禁止把 THIN 加进 TRANSITIONS/STAGE_ORDER
  - 本任务不创建 thin.md 文件、不写白名单与守卫（task-02/task-05 范围）
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
