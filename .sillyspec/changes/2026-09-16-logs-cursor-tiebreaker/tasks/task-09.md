---
id: task-09
title: '门面透传缺口补——DaemonService.get_agent_session_logs（service.py:1085-1104）与 SessionService.get_agent_session_logs（session/service/__init__.py:1105-1123）两层显式签名各加 before_id 可选参数并转发（execute 发现：mypy call-arg 被禁不报，缺透传会 TypeError 500）'
title_zh: '门面透传缺口补——DaemonService.get_agent_session_logs（service.py:1085-1104）与 SessionService.get_agent_session_logs（session/service/__init__.py:1105-1123）两层显式签名各加 before_id 可选参数并转发（execute 发现：mypy call-arg 被禁不报，缺透传会 TypeError 500）'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-09-16 08:29:24
priority: P0
depends_on: ['task-01']
blocks: []
requirement_ids: [FR-01, FR-03]
decision_ids: [D-001@v1]
allowed_paths:
  - backend/app/modules/daemon/service.py
  - backend/app/modules/daemon/session/service/__init__.py
target_files:
  - backend/app/modules/daemon/service.py
  - backend/app/modules/daemon/session/service/__init__.py
depends_on: [task-01]
goal: >
  补齐 router→service 两层门面的 before_id 透传（execute 阶段发现的计划缺口：显式
  签名无 **kwargs，缺透传会 TypeError 500；mypy call-arg 被禁不报）。
implementation:
  - DaemonService.get_agent_session_logs（service.py:1085-1104）签名加 before_id: uuid.UUID | None = None 并透传给 SessionService 调用
  - SessionService.get_agent_session_logs（session/service/__init__.py:1105-1123）签名同样加参并转发给 read_model 实现
  - 参数位置与 docstring 风格对齐既有 before 参数行
acceptance:
  - GET 带 before+before_id 经两层门面到达 read_model 复合过滤（由 task-03 集成用例端到端验证）
  - 不传 before_id 时两层门面行为与现状一致（默认 None 直通）
verify:
  - cd backend && uv run ruff check app/modules/daemon/service.py app/modules/daemon/session/service/__init__.py && uv run mypy app
constraints:
  - 只加透传不改任何过滤逻辑
  - 不动两门面其他参数
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
