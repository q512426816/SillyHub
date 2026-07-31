---
author: qinyi
created_at: 2026-07-31 11:36:08
---

# skills-settings-p0-fixup 需求

## 后端 frontmatter 组装

- **FR-01**：`build_skills_manifest` / `build_skills_bundle` 打包自定义技能时，每个 `<name>/SKILL.md` 顶部自动拼接 frontmatter，形如 `---\nname: {name}\ndescription: {description}\n---\n\n`，DB content 作为 body 跟在其后。
- **FR-02**：防双拼——若 `CustomSkill.content` 已以 `---` 开头（少数手写过 frontmatter 的），则不再重复拼接，原样使用 content。

## 编辑器适配（custom-skill-edit-dialog）

- **FR-03**：正文 textarea placeholder 改为步骤骨架（`## 何时使用` / `## 步骤` / `## 注意事项`），并明确提示「头部 name/description 由系统用左侧名称和描述自动拼成，你只需写正文」。
- **FR-04**：提供「插入步骤模板」按钮，一键把步骤骨架填入正文。
- **FR-05**：「描述」输入框下方灰字提示「这段会作为技能说明给 AI 看，决定 AI 何时调用本技能，建议写清触发场景，例：用户要部署到服务器时按本技能打包镜像」。
- **FR-06**：描述长度 < 10 字时给黄字软警告「描述太短，AI 可能判断不出何时调用」。
- **FR-07**：新增「头部预览」固定区，实时渲染系统将拼出的 frontmatter（`---\nname: {name}\ndescription: {description}\n---`），让用户看到 AI 实际读到的内容。
- **FR-08**：保存前校验：name 合法（`[a-z0-9-]{2,40}` 且非 `sillyspec-` 前缀）、description 非空、content 非空；不通过时禁用「保存」按钮并提示原因。
- **FR-09**：脏检测——编辑过程中与初始值比对，未改动时禁用保存；提供「撤销改动」恢复初始值。

## 生效提示

- **FR-10**：创建/编辑/删除成功后弹出 notify「已保存，需重启守护进程才生效」（文案与 settings/mcp 对齐），并补「历史技能也会在下次同步后生效」。
- **FR-11**：编辑弹窗「保存」按钮正上方加灰字「保存后需守护进程重启才会生效」。
- **FR-12**：`/settings/skills` 上区 SectionCard 内加灰字「技能变更不会热推送，守护进程下次启动时从平台拉取最新技能包」。

## 白话化与只读反馈

- **FR-13**：页面顶部加可折叠「新手引导」卡，白话解释「技能 = 给 AI 看的操作说明书」，区分平台技能（自带只读）/ 自定义技能（你创建）。
- **FR-14**：全页术语白话化：副标题「分发给所有守护进程」→「发给本机所有 AI 助手使用」；正文标签「SKILL.md 正文」→「技能说明书正文」；名称提示由正则改为「只能用英文小写字母、数字、连字符，2-40 位（例如 my-helper）」；sillyspec- 报错→「sillyspec- 开头是系统保留名，会和自带技能撞名，请换一个开头」；空状态文案白话化。
- **FR-15**：非管理员（`!is_platform_admin`）进入页面，PageHeader 下显示 amber banner「仅平台管理员可编辑，当前为只读视图」（与 MCP 页逐字一致）。
