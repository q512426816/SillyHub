---
author: qinyi
created_at: 2026-07-31 11:45:37
id: task-01
title: 后端拼装 SKILL.md frontmatter
goal: |
  修复真凶 bug——后端打包自定义技能时用 name+description 拼 SKILL.md frontmatter，让 AI 能识别并触发自定义技能。
implementation: |
  改 skills_bundle_service._collect_custom_skills：每个 CustomSkill 输出 (Path(name)/SKILL.md, frontmatter 加 body)。frontmatter 段为三根横线包裹的 name 与 description 两行，后接空行再接 content。防双拼：若 content 去前导空白后以三根横线开头，则视为已手写 frontmatter，原样使用 content 不再拼接。更新 model.py 第 43 行与 schema.py 第 27 行注释为「frontmatter 在打包层组装，已落地」。更新 test_skills_bundle.py 的 test_manifest_includes_custom_skills（约 233-234 行）与 test_bundle_includes_custom_skills（约 257-258 行）断言：由期望「原样 content」改为期望「frontmatter 段 加 body」。
acceptance: |
  - 自定义技能打包产物 SKILL.md 顶部含三根横线包裹的 name 与 description 两行
  - content 已以三根横线开头时不双拼（原样保留）
  - test_skills_bundle.py 两处断言更新为 frontmatter 加 body 且通过
  - model.py 与 schema.py 注释同步为打包层已组装
verify: |
  - cd backend 与 .venv/Scripts/python.exe -m pytest app/modules/daemon/tests/test_skills_bundle.py app/modules/skills/tests/test_router.py -q
constraints: |
  - 不动 DB schema、不改 service.create/update、frontmatter 只在打包层 _collect_custom_skills 拼
  - 纯 Python 字符串拼接，跨平台
  - 测试断言更新是修正固化的错误行为，非改测试凑通过
allowed_paths:
  - backend/app/modules/agent/skills_bundle_service.py
  - backend/app/modules/skills/model.py
  - backend/app/modules/skills/schema.py
  - backend/app/modules/daemon/tests/test_skills_bundle.py
depends_on: []
---
