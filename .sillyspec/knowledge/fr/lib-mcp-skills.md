## FR-lib-mcp-skills-001 skill 级 CRUD
变更：2026-08-26-workspace-skill-edit
状态：active
摘要：默认场景
依据决策：D-001@v1
场景正文：
- 场景：默认场景 — Given 用户是工作区 Writer 且打开 skills 页 skill 名非法（非白名单字符/含 `..`/已存在） 用户删除 skill 并二次确认；When 提交新建 skill（合法名 + 可选描述） 提交新建 确认删除；Then 生成 `skills/<名>/SKILL.md`（frontmatter 含 name/description），列表刷新显示 422/409 中文报错，不落盘
全文：.sillyspec/changes/archive/2026-08-26-workspace-skill-edit/requirements.md#FR-01
最近确认：debd368dd

## FR-lib-mcp-skills-002 文件级 CRUD（双栏交互）
变更：2026-08-26-workspace-skill-edit
状态：active
摘要：默认场景
依据决策：D-001@v1、D-002@v1
场景正文：
- 场景：默认场景 — Given 用户选中某 skill 的某文本文件 用户新建文件（合法两层内路径）/删除文件（非 SKILL.md）；When 右栏编辑器修改并保存 确认操作；Then PUT 原子写入 specDir，成功提示「下次同步对新会话生效」 文件树刷新反映变化；SKILL.md 删除被 409 拒绝且前端按钮禁用
全文：.sillyspec/changes/archive/2026-08-26-workspace-skill-edit/requirements.md#FR-02
最近确认：debd368dd

## FR-lib-mcp-skills-003 安全约束
变更：2026-08-26-workspace-skill-edit
状态：active
摘要：默认场景
依据决策：D-003@v1
场景正文：
- 场景：默认场景 — Given 任意路径穿越尝试（`../`、绝对路径、盘符、编码变体） 二进制文件（UTF-8 解码失败）或 >512KB；When 调文件端点 读/写；Then 422 中文「文件路径不合法」，磁盘零接触 415/413 中文报错
全文：.sillyspec/changes/archive/2026-08-26-workspace-skill-edit/requirements.md#FR-03
最近确认：debd368dd

## FR-lib-mcp-skills-004 数据通道与生效
变更：2026-08-26-workspace-skill-edit
状态：active
摘要：默认场景
依据决策：D-004@v1、D-005@v1
场景正文：
- 场景：默认场景 — Given 文件成功写入 specDir/skills/；When daemon 下次 spec sync 经 manifest 增量同步到 worktree `.claude/skills/workspace/`（既有链路，本；Then 新会话可用更新后的 skill
全文：.sillyspec/changes/archive/2026-08-26-workspace-skill-edit/requirements.md#FR-04
最近确认：debd368dd

## FR-lib-mcp-skills-005 审计
变更：2026-08-26-workspace-skill-edit
状态：active
摘要：默认场景
依据决策：D-006@v1
场景正文：
- 场景：默认场景 — Given 任一写操作（建/删 skill、写/删文件）成功；When 提交完成；Then audit_logs 落行（action=workspace_skill.*，details 含 skill 名/文件路径，不含文件内容）
全文：.sillyspec/changes/archive/2026-08-26-workspace-skill-edit/requirements.md#FR-05
最近确认：debd368dd
