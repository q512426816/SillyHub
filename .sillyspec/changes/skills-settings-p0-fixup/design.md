---
author: qinyi
created_at: 2026-07-31 11:36:08
---

# skills-settings-p0-fixup 设计

## 背景、目标与问题描述

**背景**：技能管理页 `/settings/skills` 让平台管理员管理分发给所有守护进程、最终给 Claude AI 用的自定义技能。一个自定义技能 = 一份 SKILL.md 说明书，AI 靠文件开头的 YAML frontmatter（`name` + `description`）识别技能，尤其靠 `description` 判断何时触发。

**问题描述**：代码核实 `model.py:43` / `schema.py:27` 注释承诺「frontmatter 由业务层组装」，但 `service.py` 与 `skills_bundle_service.py:71` 从未组装，直接把 DB content 原样写成 `<name>/SKILL.md`。结果所有自定义技能下发给 AI 的 SKILL.md 都没有 frontmatter，AI 无法识别、不会触发——管理员填的 name/description 从未到达 AI。叠加三个体验问题：保存后无生效反馈（daemon 仅启动同步、页面零提示）、术语全是黑话、非管理员无只读提示。

**目标**（P0 四条）：①后端打包拼 frontmatter 修真凶；②编辑器适配（模板/提示/预览/校验）；③保存后生效提示；④白话化 + 只读 banner。不改 daemon、不改 DB schema、不改 CustomSkill 字段定义。

## 方案选择与关键决策

**方案选择**：frontmatter 拼装点选在打包层 `_collect_custom_skills`（方案 A）。
- 方案 A（采用）：打包层拼，不动 DB，符合 model 注释「DB 只存 body」，一次性修复全部历史技能，零数据迁移。
- 方案 B（否决）：在 `service.create/update` 拼——违背「DB 只存 body」原意，DB 里混入 frontmatter。
- 方案 C（否决）：让用户手写 frontmatter——负担重，且与已有 name/description 表单字段重复。

**关键决策**：见 decisions.md D-001~D-008——打包层拼装（D-001）、frontmatter 格式（D-002）、防双拼（D-003）、编辑器只写 body（D-004）、生效提示复用 MCP useNotify（D-005）、白话化不改逻辑（D-006）、历史技能行为变化告知（D-007）、预览与后端拼装一致（D-008）。

## 总体方案

四条 P0 修复，分后端 1 处 + 前端 2 文件 + 测试。

**P0-1 后端 frontmatter 组装（真凶修复）**：在 `skills_bundle_service._collect_custom_skills` 打包处拼装 frontmatter，不动 DB（符合 `model.py` 注释「DB 只存 body」原意），一次性修复全部历史技能、零数据迁移。每个 CustomSkill 输出 `(Path(row.name)/"SKILL.md", frontmatter + body)`。防双拼：content 已以 `---` 开头则原样用。frontmatter 拼装格式（D-001/D-002）：

```
---
name: {row.name}
description: {row.description}
---

{row.content}
```

**P0-2 编辑器适配**：`custom-skill-edit-dialog.tsx` 纯前端改造。content 只写 body（后端拼头部）。placeholder 换步骤骨架 + 「插入步骤模板」按钮；描述框触发场景提示 + 过短警告；新增「头部预览」实时渲染拼出的 frontmatter；保存前校验 + 脏检测/撤销。

**P0-3 生效提示**：复用 `settings/mcp` 的 `useNotify`（`lib/errors`），创建/编辑/删除成功 notify；弹窗按钮上方 + 页卡灰字提示，文案抄 MCP。

**P0-4 白话化**：`skills/page.tsx` 加新手引导卡 + 逐处白话化 + 非管理员 amber banner（抄 MCP）。

## 2. 文件变更清单（File Changes）

| 操作 | 文件 | 说明 |
|---|---|---|
| 修改 | backend/app/modules/agent/skills_bundle_service.py | `_collect_custom_skills` 拼 frontmatter + 防双拼 |
| 修改 | backend/app/modules/skills/model.py | 注释更新为「frontmatter 在打包层组装，已落地」 |
| 修改 | backend/app/modules/skills/schema.py | 注释同步更新 |
| 修改 | backend/app/modules/daemon/tests/test_skills_bundle.py | 两处断言由「原样 content」改为「frontmatter+body」 |
| 修改 | frontend/src/components/custom-skill-edit-dialog.tsx | 步骤模板/描述提示/头部预览/校验/脏检测/notify |
| 修改 | frontend/src/app/(dashboard)/settings/skills/page.tsx | 引导卡/白话化/amber banner/灰字 |
| 新增 | frontend/src/app/(dashboard)/settings/skills/__tests__/edit-dialog.test.tsx | 编辑弹窗 frontmatter 预览/校验/模板单测 |

## 3. 关键实现点

- frontmatter 必须在打包层（`_collect_custom_skills`）拼，不在 `service.create/update`——这样 DB 维持「只存 body」，且一次性修好全部历史数据，无需 data migration。
- 防双拼判定：`row.content.lstrip().startswith("---")` → 已含 frontmatter，原样用；否则拼接。
- 头部预览前端格式串必须与后端拼装严格一致（`---\nname: {name}\ndescription: {description}\n---`），单测覆盖防漂移（D-008）。
- 校验复用现有 name 正则 `/^[a-z0-9-]{2,40}$/` + `sillyspec-` 前缀检查（弹窗已有，整合进统一 validation useMemo）。

## 4. 风险登记（Risk）

- **R1【测试固化错误行为】** `test_skills_bundle.py:233-234` / `257-258` 断言 custom SKILL.md 内容 == 原始 content。修复后内容变 frontmatter+body，断言必失败。缓解：同步更新这两处断言为期望 frontmatter+body（合规：测试断言的本就是 bug 行为，非改测试凑通过）。
- **R2【历史技能行为变化】** 修复后，历史上「以为生效其实没生效」的自定义技能会首次真正被 AI 触发。缓解：FR-10 notify 文案补一句「历史技能也会在下次同步后生效」。
- **R3【双拼】** 用户曾在 content 手写 frontmatter 会重复。缓解：FR-02 `startswith("---")` 检测。
- **R4【预览/后端不一致】** 缓解：前后端共用同一格式约定，单测覆盖。
- **R5【useNotify 存在性】** 缓解：实现前先读 `settings/mcp/page.tsx` 确认 `useNotify` 来源与文案。

## 5. 自审（Self-Review）

- **完整性**：P0 四条全覆盖（后端 frontmatter + 编辑器适配 + 生效提示 + 白话化），Non-Goals 明确排除 P1/P2。
- **正确性**：基于源码核实（`model.py:43` / `schema.py:27` / `service.py` / `skills_bundle_service.py:71` / `test_router.py:55` / `test_skills_bundle.py:233/257`），非推测。
- **风险**：R1~R5 已列缓解。
- **遗漏检查**：确认不动 daemon、不动 DB schema、不改 CustomSkill schema 字段；frontmatter 拼装点选在打包层而非 service，与注释原意一致。

## 6. 生命周期契约

本变更不涉及生命周期契约（lifecycle contract: N/A）。仅改技能打包内容与前端展示，不改 session/lease/agent_run/daemon 状态机或状态流转。
