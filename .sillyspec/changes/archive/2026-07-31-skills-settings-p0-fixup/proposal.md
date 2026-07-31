---
author: qinyi
created_at: 2026-07-31 11:36:08
---

# skills-settings-p0-fixup 提案

## 背景

技能管理页 `/settings/skills` 让平台管理员管理「分发给所有守护进程、最终给 Claude AI 用的自定义技能」。一个自定义技能 = 一份 SKILL.md 说明书，AI 靠文件开头的 YAML frontmatter（三根横线包裹的 `name` + `description`）识别技能，尤其靠 `description` 判断何时触发。

代码核实发现一个真凶级缺陷：`backend/app/modules/skills/model.py:43` 与 `schema.py:27` 的注释都承诺「YAML frontmatter 由业务层组装，DB 只存 body」，但 `service.py` 的 create/update 与 `skills_bundle_service.py:71` 的 `_collect_custom_skills` 从未组装 frontmatter——直接把 DB content 原样写成 `<name>/SKILL.md`。结果：所有自定义技能下发给 AI 的 SKILL.md 都没有 frontmatter，AI 无法识别、不会自动触发；管理员填的 name/description 只进 DB 给平台 UI 看，从未到达 AI。`test_router.py:55` 用例 content 即 `# My Skill\n\ndoes things`（无 frontmatter），`test_skills_bundle.py:233/257` 断言「原样存回」，把这个错误行为固化进了测试。

此外页面有三个「不会用 / 不知道生效」问题：
1. daemon 只在启动时同步一次技能（`daemon.ts:859` syncSkills 仅启动调用、无轮询），但保存后页面零反馈，管理员误以为「保存=生效」。
2. 编辑弹窗 placeholder 引导写 `# 技能标题`（markdown H1），不教 frontmatter；术语全是黑话（SKILL.md 正文、`[a-z0-9-]{2,40}`、守护进程、bundle）。
3. 非管理员进页面只在每行操作列默默显示灰字「只读」，姊妹页 MCP/api-keys 有顶部 amber banner。

## 目标（P0 四条）

1. **P0-1 真凶修复**：后端打包时用 name+description 拼 frontmatter，一次性修复全部历史/新建自定义技能，不动 DB。
2. **P0-2 编辑器适配**：正文给步骤模板、描述框加触发场景提示与过短警告、新增头部预览、保存前校验 + 脏检测。
3. **P0-3 生效提示**：保存/编辑/删除后 notify「需重启守护进程生效」（复用 MCP 现成方案）。
4. **P0-4 白话化**：新手引导卡 + 全页术语白话化 + 非管理员 amber banner。

## 不在范围内（Non-Goals）

本次只做 P0 四条。以下明确不做（留待后续 P1/P2 变更）：

- 启用/禁用软开关（需加 DB 字段，P1）
- 同步状态可见 / 每台 daemon 同步版本（P1）
- 平台技能「用途」列 + 行展开看正文（P1）
- 搜索 / 排序 / 复制 / 从示例创建（P1）
- 批量操作 / 标签筛选 / 导入导出（P2）
- 使用统计（P2）
- 变更历史快照 + 回滚（P2）
- daemon 运行时自愈同步 / 一键重同步 / 诊断抽屉（P2，需改 daemon）
- 多文件技能、per-workspace 绑定、技能市场（维持 YAGNI）
- 不改 daemon 端代码
- 不改 DB schema（不加 enabled/tags 等字段）
- 不改 CustomSkill 的 schema.py 字段定义（frontmatter 拼装只在打包层）
