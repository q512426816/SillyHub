---
id: task-04
title: '反转 test_platform_grant_list.py 断言为新技术义 + 三口径一致性断言'
title_zh: '反转 test_platform_grant_list.py 断言为新技术义 + 三口径一致性断言'
author: 'WhaleFall'
generated_by: sillyspec-taskcard
created_at: 2026-09-20 18:03:09
priority: P0
depends_on: ['task-01', 'task-02', 'task-03']
blocks: []
requirement_ids: [FR-01, FR-02, FR-03, FR-04]
decision_ids: [D-003@v1]
allowed_paths:
  - backend/app/modules/workspace/tests/test_platform_grant_list.py
target_files:
  - backend/app/modules/workspace/tests/test_platform_grant_list.py
goal: >
  把 ql-20260917-007 留下的 test_platform_grant_list.py 断言反转为新技术义
  （平台级 workspace:read 非成员 → 空列表/403/不收通知），并补三口径一致性断言
  （列表 ⊆ 可访问 ⊆ 通知收件人同源判定），守住 R-01 风险。
implementation:
  - 读 backend/app/modules/workspace/tests/test_platform_grant_list.py 现有夹具（_grant_platform_role 等），保留可复用部分
  - 断言反转：平台级 workspace:read 非成员 → list 为空、GET 详情 403、list_user_ids_with_permission 收件人不含该用户
  - 保留/补强：platform:admin 持有者与 is_platform_admin 全量可见 + 正常收件
  - 新增三口径一致性测试：同一夹具下断言「列表可见集 == has_permission 可访问集 == 通知收件集」的成员制口径
acceptance:
  - 全文件测试绿（新技术义）
  - 三口径一致性断言存在且通过（AC-07）
verify:
  - cd backend && .venv/Scripts/python -m pytest app/modules/workspace/tests/test_platform_grant_list.py -x -q
constraints:
  - 只改本文件；不迁夹具到共享 conftest（避免扩面）
  - 测试语义必须对齐 requirements.md FR-01~04，不得为过测改弱断言
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
