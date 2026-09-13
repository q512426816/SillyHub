---
id: task-06
title: 'chain-limit 停跑补 error_detail.hint + auto_resume_stopped（FR-5.1/5.2）'
title_zh: 'chain-limit 停跑补 error_detail.hint + auto_resume_stopped（FR-5.1/5.2）'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-09-13 00:24:41
priority: P0
depends_on: []
blocks: []
requirement_ids: [FR-5.1, FR-5.2]
decision_ids: [D-004@v1]
allowed_paths:
  - backend/app/modules/daemon/session/service/auto_resume.py
  - backend/app/modules/daemon/tests/test_auto_resume_chain_limit_hint.py
target_files:
  - backend/app/modules/daemon/session/service/auto_resume.py
  - NEW:backend/app/modules/daemon/tests/test_auto_resume_chain_limit_hint.py
goal: >
  自动续跑链到上限（AUTO_RESUME_MAX_CHAIN=2）停跑时用户无感知：chain-limit 分支对刚终态 run 补写 error_detail.hint 接续指引 + auto_resume_stopped 标记，失败卡零前端改动即可呈现明确指引。
implementation:
  - auto_resume.py chain-limit 分支（auto_recover_nudge_chain_limit log 处，约 L513-521）：在 return 前对 agent_run 补写 error_detail——hint 置「上游连续中断，自动续跑已达上限（2 次）；请手动发送继续接续，或切换供应商后重发」，加键 auto_resume_stopped 置 true；type/code/raw/message 原值不动；error_detail 缺失时构造最小 dict（type 缺省 provider_error、raw 缺省原文摘要）。
  - 写入用既有 svc._session 短事务 commit；任何异常仅 log.warn（维持全程静默容错原则）。
  - 新建测试 test_auto_resume_chain_limit_hint.py：chain 达上限分支后 run.error_detail.hint 为指引文案且 auto_resume_stopped 为 true、type/code/raw 不动；未达上限路径不写标记。
acceptance:
  - chain-limit 后 error_detail 含指引 hint + 标记，原三键不动（用例绿）。
  - 未到上限路径零写入；写入失败不抛出。
verify:
  - cd backend && uv run pytest app/modules/daemon/tests/test_auto_resume_chain_limit_hint.py -q --no-cov
  - cd backend && uv run ruff check app/modules/daemon/session/service/auto_resume.py && uv run mypy app/modules/daemon/session/service/auto_resume.py
constraints:
  - 不动 quota 链上限分支（QUOTA_CHAIN_LIMIT，非目标）。
  - 不改 G0-G7 守卫判定序。
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
