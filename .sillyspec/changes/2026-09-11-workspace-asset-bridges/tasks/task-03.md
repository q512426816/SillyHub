---
id: task-03
title: 'adoptable/adopt endpoints for specDir skills reverse adoption'
title_zh: 'adoptable/adopt 两端点（D-008 归一化+差集三源排除）'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-09-11 21:39:17
priority: P0
depends_on: ['task-01']
blocks: []
requirement_ids: [FR-03]
decision_ids: [D-005@v1, D-008@v1]
allowed_paths:
  - backend/app/modules/skill_source/
  - backend/app/modules/workspace/
target_files:
  - backend/app/modules/skill_source/service.py
  - backend/app/modules/workspace/skills_view_service.py
  - NEW:backend/app/modules/workspace/tests/test_skills_adopt.py
provides:
  - GET /api/workspaces/{id}/skills/adoptable 与 POST /api/workspaces/{id}/skills/adopt 两端点契约（候选含 invalid 标记；adopt 响应为逐名结果）
expects_from:
  - task-01 提供 toggle_enable 双 scope 签名已稳定（本卡同文件追加 adopt 两方法零冲突）
goal: >
  specDir/skills 反向收编——adoptable 差集扫描（平台库名三源排除）与 adopt 落库（名归一化+frontmatter 原样+不删源），打通桥④（FR-03 / D-005 / D-008）。
implementation:
  - workspace/skills_view_service.py 增 adoptable 扫描——复用 list_skills 同源 resolver 与防穿越（skills_view_service.py:278-290 锚点）列 specDir/skills 目录并读各 SKILL.md frontmatter（缺失或损坏按容错降级）
  - skill_source/service.py 增平台库名集合 helper——CustomSkill 全体名（DB 不限 owner）并 sillyspec-* 目录扫描并 git 源 discover 全部 enabled 源（管理员视角不带 user，D-008）；差集为 specDir 目录名减去集合内名与 sillyspec-* 前缀
  - skill_source/service.py 增名归一化函数（D-008）——小写、非 [a-z0-9-] 字符转连字符、压连续连字符、去首尾、超 40 截断、仍不合规或空标 invalid 跳过不炸整批；description 取 frontmatter 截 200（缺省中文兜底）
  - workspace/router.py 两端点（WORKSPACE_WRITE）——GET adoptable 只读列表；POST adopt（body names 数组）逐个读 SKILL.md 原文写 CustomSkill（归属操作者）；adopt 落库语义（D-005）——frontmatter 原样、缺失时按 bundle 层解析口径拼装防双拼；不删源文件；重名走既有 409；多文件技能只收 SKILL.md 主文件（响应提示手动合并）
  - 测试——归一化单测（非法字符/截断/空名 invalid）；差集三源排除；重名 409；不删源断言；NEW test_skills_adopt.py 覆盖端点权限与两阶段契约
acceptance:
  - adoptable 只列差集技能（三源名与 sillyspec-* 前缀不出现）
  - invalid 名跳过且整批其余成功（响应逐名结果含跳过原因）；重名 409（既有语义）；非成员 403
  - adopt 后 CustomSkill 内容与 SKILL.md 原文一致（frontmatter 原样）；specDir 源文件仍存在
verify:
  - cd backend && uv run pytest app/modules/skill_source -q --no-cov
  - cd backend && uv run pytest app/modules/workspace/tests/test_skills_adopt.py -q --no-cov
constraints:
  - specDir 只读扫描（不写不删源文件）；不改 list_skills 与技能文件编辑既有行为；多文件辅助文件不收编（文案引导手动合并）
  - CustomSkill 归属操作者本人；整批逐名独立结果（单名失败不炸整批）
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
