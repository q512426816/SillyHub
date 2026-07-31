---
author: qinyi
created_at: 2026-07-31 11:36:08
---

# skills-settings-p0-fixup 决策

- **D-001@v1**：frontmatter 在打包层（`skills_bundle_service._collect_custom_skills`）拼装，不在 `service.create/update`。理由：符合 `model.py:43`「DB 只存 body」原意；一次性修复全部历史技能、零数据迁移；version hash 自然反映 frontmatter 变化。trade-off：打包层拼装而非存储层 → DB 里看不到 frontmatter，但 DB 本就只存 body，一致。
- **D-002@v1**：frontmatter 格式 = `---\nname: {name}\ndescription: {description}\n---\n\n` + content。name/description 取自 DB 字段（管理员填的）。与 Claude SKILL.md 规范一致。
- **D-003@v1**：防双拼——`content.lstrip().startswith("---")` 则视为用户已手写 frontmatter，原样使用不再拼接。避免少数手写场景产生双重 `---`。
- **D-004@v1**：编辑器 content 只写 body，不写 frontmatter；后端自动拼头部。placeholder 换步骤骨架（`## 何时使用`/`## 步骤`/`## 注意事项`），不再误导用户写 markdown H1。
- **D-005@v1**：生效提示复用 `settings/mcp` 的 `useNotify` 与灰字文案，逐字对齐，不造新词。理由：同属「daemon 拉取型配置」，心智一致。
- **D-006@v1**：白话化只改文案不改逻辑；非管理员 amber banner 抄 MCP/api-keys 现有模式。
- **D-007@v1**：本次修复会让历史自定义技能首次真正被 AI 触发，属行为变化。FR-10 notify 文案补「历史技能也会在下次同步后生效」告知管理员。
- **D-008@v1**：前端头部预览格式串与后端拼装严格一致，单测覆盖防漂移。
