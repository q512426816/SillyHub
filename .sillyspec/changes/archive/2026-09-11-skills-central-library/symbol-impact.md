# 符号影响面报告（2026-09-11-skills-central-library）

- task-01: 无既有签名变更——全新符号（SkillSource/UserSkillEnable 模型/CRUD/迁移）；main.py 仅注册行。
- task-02: 全新符号（git_fetcher 三函数）；service.py 扩展新方法（不动既有）。
- task-03: skills_bundle_service.py **新增私有函数** _collect_enabled_git_skills + **_gather_all_files 内部扩展**（追加第三源段，函数签名不变）；router/service 新端点。
- task-04: 前端页面区块新增+生成物重生成；无签名变更。
