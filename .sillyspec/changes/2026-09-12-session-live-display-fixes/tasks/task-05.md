---
id: task-05
title: '纯切换轮跳过 user_input 落库与 turn_count（FR-3.1~3.4）'
title_zh: '纯切换轮跳过 user_input 落库与 turn_count（FR-3.1~3.4）'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-09-13 00:24:41
priority: P0
depends_on: []
blocks: []
requirement_ids: [FR-3.1, FR-3.2, FR-3.3, FR-3.4]
decision_ids: [D-002@v1]
allowed_paths:
  - backend/app/modules/daemon/session/service/inject.py
  - backend/app/modules/daemon/tests/test_inject_silent_switch.py
target_files:
  - backend/app/modules/daemon/session/service/inject.py
  - NEW:backend/app/modules/daemon/tests/test_inject_silent_switch.py
goal: >
  纯切换轮（config_switch 且空 prompt）不再落空 user_input 行、不再递增 turn_count，消除轮次虚高与注释（ql-20260817-010「无 user_input 日志」）和实现的矛盾；复用既有 silent_config_switch 变量收口三处判定。
implementation:
  - inject.py _inject_into_session：user_input AgentRunLog 构造段（约 L661-684）包进 if not silent_config_switch（附件标记行逻辑原样保留于分支内——纯切换轮 validated_attachments 亦为空）；turn_count 递增（约 L637）与 user_input 同分支收口；终态分支（约 L709-711）改用 silent_config_switch；last_active_at 刷新与 run 创建保持无条件。
  - 更新 ql-20260817-010 注释使其与实现对齐（三处共用单源变量）。
  - 新建测试 test_inject_silent_switch.py：纯切换轮（空 prompt + llm_provider_id）断言无 channel=user_input 行、turn_count 不变、run 状态 completed；带消息切换轮（prompt 非空）user_input 照写 + 计数照增；普通轮零回归。
acceptance:
  - 纯切换轮零 user_input 行 + turn_count 不增 + run completed（新用例绿）。
  - 带消息切换轮/普通轮行为不变（既有 inject 测试组零回归）。
verify:
  - cd backend && uv run pytest app/modules/daemon/tests/ -q --no-cov -k "inject or silent or switch"
  - cd backend && uv run ruff check app/modules/daemon/session/service/inject.py && uv run mypy app/modules/daemon/session/service/inject.py
constraints:
  - run 必须照建（前端紧凑配置行/孤儿轮补建消费链依赖）；last_active_at 照刷。
  - 不改 queue.py / scheduled_messages.py（空 prompt 轮必为切换轮，共享核心已覆盖）。
  - 存量空行不迁移。
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
     可选字段按需插进上方 frontmatter（规则见 taskcard-rules）：
     repo:          仅跨仓 task 填（local.yaml repos: 注册的仓 key；缺省=main。allowed_paths 相对该仓根写，
                    禁止带仓库名前缀/绝对路径——review 对账按仓根相对路径匹配，带前缀永不命中）
     provides:      仅当本 task 给其他 task 提供接口/DTO/响应时填
     expects_from:  仅当本 task 消费其他 task 的契约时填
     related_tests: 仅当本 task 改动导致既有测试断言失效时填（测试路径须同时进 allowed_paths） -->
