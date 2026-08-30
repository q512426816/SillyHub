---
author: qinyi
created_at: 2026-08-26 21:36:01
change: 2026-08-26-session-input-mention
status: brainstorm
scale: large
tier: independent
---

# 会话输入框智能联想（/ 技能指令 + @ 关联变更/快速修复）

## 背景与问题

会话输入框（`frontend/src/components/daemon/session-input-bar.tsx`）目前是纯 textarea：

1. 平台已有完整的技能体系（用户自定义技能 + 平台技能，经 daemon 落盘到
   `<workdir>/.claude/skills/` 供 Claude Code 加载），但用户在会话里只能凭记忆手打
   `/技能名`，无任何回显/提示，拼错即收到 Claude Code 的 `Unknown command` 报错
   （ql-20260826-013 已实证该报错路径存在）。
2. 平台已有变更（change）与快速修复（quicklog）实体及会话 M:N 绑定表
   （`ChangeSessionLink` / `QuicklogSessionLink`），但绑定只发生在「会话创建时」或
   「系统自动检测」，用户无法在输入框里主动、显式地声明「这条消息/这个会话是关于
   某个变更/快速修复的」。
3. 输入体验仍有可优化点：中文 IME 拼音组合期无保护、占位文案未暴露任何快捷能力。

## 目标

- 输入 `/`（词首）→ 上方浮层回显平台可用技能/指令，支持过滤、键盘选择；选中后
  以 Claude Code 可识别的形式回填，直达技能调用。
- 输入 `@`（词首）→ 上方浮层回显当前工作区的变更与快速修复，选中后回填自然键
  （change_key / ql_id），并在发送时建立会话↔变更/快速修复绑定（复用既有幂等
  binder）。
- 顺带优化：IME 组合输入保护、placeholder 可发现性。

## 方案对比

| 维度 | 方案 A：纯前端联想 | 方案 B：前端联想 + 后端最小扩展（推荐） | 方案 C：消息级 mention 实体化 |
|---|---|---|---|
| 核心思路 | 只做浮层 UI；`@` 仅预会话生效（create 已有 change_id/quicklog_id 契约）；`/` 用 manifest 目录名回填 | A 的全部 + manifest 补 `invoke_name`（frontmatter 名）+ SessionInjectRequest 增加 bind 字段实现中途绑定 | AgentRunLog 加 metadata 列、消息 chip 渲染、完整 Slack 式 mention |
| / 技能可靠性 | 目录名 ≠ Claude Code 注册名（平台技能 frontmatter 是冒号名如 `sillyspec:archive`），透传有 Unknown command 风险 | invoke_name 消除名不一致风险 | 同 B（也需 invoke_name） |
| @ 中途关联 | 不支持（只有首句 create 能绑定） | 支持（inject 幂等 bind，复用 binding.py） | 支持 |
| 后端改动 | 零 | schema + 2 处小扩展 + 测试 + api-types 重生成 | 消息表迁移 + 新渲染协议，改动大 |
| 风险 | 低但留隐患 | 中（可控，逐点验证） | 高（消息链路全动） |
| 结论 | 备选（快速上线） | **推荐** | 否决（过重） |

推荐理由：方案 B 用两个「同构先例级」的小扩展（manifest 透传一个已解析字段；
inject 仿 `page_context`/`attachment_ids` 模式加可选字段）就同时解决了 A 的两个
硬伤（冒号名风险、中途不能关联），不触碰消息模型与渲染协议，回滚面小。

## 非目标（不在范围内）

- 不做消息级 metadata / mention chip 富渲染（方案 C 的部分，明确不做）。
- 不做 @ 其他实体联想（智能体档案、文件、成员）——架构上留扩展位，本期不开。
- 不做 ↑ 历史回溯（发送历史复用）。
- 不纳入工作区（workspace 级）技能到 `/` 联想：其 daemon 落盘接线存疑
  （`syncWorkspaceSkills` 主仓仅见定义与测试，无调用点），待接线确认后二期再入。
- 不做手动解绑 UI（延续 2026-08-25-session-spec-binding 的非目标）。
- 不改动 `/team` 现有拦截/剥离语义，仅把它纳入 `/` 联想列表作为内置指令展示。

## 决策记录

1. 方案选择：**用户已确认方案 B**（brainstorm Step 4 记录于进度库，2026-08-26）。
2. 设计确认：**用户已确认**（brainstorm Step 5，含交互原型，2026-08-26）。
3. 优化项范围：IME 保护 + placeholder 必做；历史回溯已列非目标。
