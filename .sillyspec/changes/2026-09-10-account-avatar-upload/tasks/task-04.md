---
id: task-04
title: 'Group member user-side avatar fallback + tests'
title_zh: '群成员 user 侧 avatar 回落解析 + 测试'
author: 'qinyi'
created_at: 2026-09-10 19:10:51
priority: P1
depends_on: [task-01]
blocks: []
requirement_ids: [FR-05]
decision_ids: [D-002@v1]
allowed_paths:
  - backend/app/modules/daemon/group/service/helpers.py
  - backend/app/modules/daemon/group/service/members.py
  - backend/app/modules/daemon/group/service/crud.py
  - backend/app/modules/daemon/group/service/__init__.py
  - NEW:backend/tests/modules/daemon/test_group_member_avatar_fallback.py
target_files:
  - backend/app/modules/daemon/group/service/helpers.py
  - backend/app/modules/daemon/group/service/members.py
  - backend/app/modules/daemon/group/service/crud.py
  - NEW:backend/tests/modules/daemon/test_group_member_avatar_fallback.py
goal: >
  GroupMemberRead 读取路径对 user 成员做平台头像回落（D-002@v1），avatar 取
  member.avatar or user.avatar，群内自定义优先，NULL/空串回落 users.avatar。
implementation:
  - helpers.py:701 _to_read 是同步函数不能直查 users 表，新增异步预取 helper（select User.id/User.avatar，where id in 群内 user 成员 id 集，一次查询），在异步调用侧（crud.py 各 svc._to_read 调用点，或 __init__.py:469 包装层改 async）对 read.members 后处理 user 成员空值回落
  - members.py:203/219 加用户成员返回（GroupMemberAddRead），target User 行已加载，构造返回前直接回落 member.avatar or target.avatar，无需额外查询
  - members.py:512 改成员返回（GroupMemberRead），member_type 为 user 且 member.avatar 空值时按 member.user_id 单查目标 user 取 avatar；members.py:673 重置记忆仅 agent 成员不动
  - 新建 tests/modules/daemon/test_group_member_avatar_fallback.py（daemon 测试目录平铺惯例），群读主路径（自定义优先/NULL 回落/空串回落/agent 成员不变）+ 加/改成员返回回落
acceptance:
  - 群读（列表/详情）——user 成员 member.avatar 有值 → 原样；NULL/'' → users.avatar；两者皆空 → None；agent 成员 avatar 不变
  - 加用户成员（203/219）与改成员（512）返回体同样回落；群读回落仅增一次 users select in 查询（无 N+1）
  - 群成员 PATCH 语义不变（members.py:348 None=不改/空串=清除原样），既有测试零回归
verify:
  - cd backend && uv run pytest tests/modules/daemon/test_group_member_avatar_fallback.py -q --no-cov
constraints:
  - _to_read 保持同步、不直查 DB（预取映射由异步调用方传入或后处理，R-03）；执行期 grep GroupMemberRead 复核构造点防遗漏
  - 仅读取端回落，不写 agent_group_members.avatar、不改 router.py 与 GroupMemberRead schema
  - CLAUDE.md 规则 0 仅跑相关测试；规则 13 三平台兼容
expects_from:
  task-01: [{contract: users.avatar, needs: [users.avatar]}]
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
