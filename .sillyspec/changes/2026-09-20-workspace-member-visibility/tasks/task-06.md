---
id: task-06
title: '存量测试回归——扫描依赖平台级穿透的既有断言并同步修正（仅跑相关测试）'
title_zh: '存量测试回归——扫描依赖平台级穿透的既有断言并同步修正（仅跑相关测试）'
author: 'WhaleFall'
generated_by: sillyspec-taskcard
created_at: 2026-09-20 18:03:09
priority: P0
depends_on: ['task-01', 'task-02', 'task-03', 'task-04', 'task-05']
blocks: []
requirement_ids: [FR-01, FR-02, FR-03, FR-04, FR-05, FR-06]
decision_ids: [D-002@v1]
allowed_paths:
  - backend/app/modules/notification/tests/
  - backend/app/modules/agent/tests/
  - backend/app/modules/daemon/tests/
  - backend/app/modules/daemon/grants/tests/
  - backend/app/modules/file/tests/
  - backend/app/modules/change/tests/
  - backend/app/modules/workspace/tests/
  - backend/app/modules/knowledge/tests/
  - backend/app/core/tests/
  - backend/tests/
target_files: []
goal: >
  R-02 风险收口：全量扫描依赖「平台级权限穿透工作区」隐式行为的既有测试，
  区分「入口语义」（应保留）与「工作区穿透」（同步改断言为成员制口径），
  仅跑本变更相关测试（CLAUDE.md 规则 0，全量留 CI）。
implementation:
  - grep 扫描 has_permission / require_permission / user_roles / UserRole 相关测试（重点：backend/app/modules/agent/tests/test_borrow_resolver.py、test_execution_context.py、backend/app/modules/daemon/grants/tests/test_grants_authorization.py、backend/app/core/tests/test_auth_deps_db_release.py、backend/app/modules/notification/tests/test_service.py）
  - 逐个判定失败口径：平台级权限 + 非成员期望放行的 → 补工作区成员夹具或改断言为 403/False；纯入口路径（workspace_id=None）期望放行的 → 保留
  - 跑受影响测试文件至绿；记录修正清单进 verify-result（verify 阶段汇总）
acceptance:
  - 受影响测试文件全部绿；无「为过测改弱语义」的断言（对照 FR-01~06）
  - 修正清单有留痕（哪些文件改了夹具/断言及原因）
verify:
  - cd backend && .venv/Scripts/python -m pytest app/modules/workspace/tests app/modules/auth/tests app/modules/notification/tests app/core/tests -q
  - cd backend && .venv/Scripts/python -m ruff check app/modules && .venv/Scripts/python -m mypy app/modules/auth/rbac.py app/modules/workspace/router.py
constraints:
  - 禁止跑全量测试（规则 0）；只修测试断言/夹具，不反向改实现迁就旧断言
  - 不改三个触点源码文件（归 task-01/02/03）
  - 目标测试文件按扫描结果动态确定，未涉及的目录不碰
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
