---
id: task-06
title: expose-manifest-invoke-name
title_zh: manifest 聚合透传 invoke_name 字段
author: qinyi
created_at: 2026-08-26 23:43:50
priority: P0
depends_on: []
blocks: [task-08]
requirement_ids: [FR-07]
decision_ids: [D-002]
allowed_paths:
  - backend/app/modules/agent/skills_bundle_service.py
  - backend/app/modules/daemon/tests/test_skills_bundle.py
provides:
  - contract: ManifestInvokeName
    fields: [invoke_name]
goal: >
  _summarize_skills 聚合结果每项新增 invoke_name 键，透传 SKILL.md
  frontmatter name 原值（缺失为 None），供前端 / 联想回填 slash 调用名；
  端点返回 dict 无响应模型可改，schema 层零改动。
implementation:
  - 改 skills_bundle_service.py 的 _summarize_skills，分组初始化 dict 增加 invoke_name 为 None，解析 SKILL.md 时除 description 外同时取 frontmatter name 原值存入（冒号名原样保留）
  - 输出列表每项新增 invoke_name 键，无 SKILL.md 或 frontmatter 缺 name 时为 None（目录名兜底由前端 invoke_name 空值时回退 name 完成）
  - 更新既有 test_summarize_skills_aggregates_by_top_dir 精确相等断言补 invoke_name 键
  - 在 test_skills_bundle.py 并入新用例——有 frontmatter name 的技能 invoke_name 等于冒号名原值，无 frontmatter 技能为 None，manifest 端点透传可见
  - 核对 _compute_version 哈希输入不含聚合摘要，加键不触发 daemon 重同步
acceptance:
  - manifest 端点 skills 数组每项含 invoke_name，取值为 str 或 None
  - 端点返回 dict 无 Pydantic 响应模型，daemon/schema.py 零改动
  - version 哈希与 daemon 侧版本比对零行为变化
verify:
  - cd backend && uv run pytest app/modules/daemon/tests/test_skills_bundle.py -q
constraints:
  - 不改 _parse_skill_frontmatter 返回键集合与容错行为（继续仅 name 与 description）
  - 前端 PlatformSkillSummary 类型同步归 task-08，本任务不碰前端文件
related_tests:
  - path: backend/app/modules/daemon/tests/test_skills_bundle.py
    reason: test_summarize_skills_aggregates_by_top_dir 精确相等断言需补 invoke_name 键
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
