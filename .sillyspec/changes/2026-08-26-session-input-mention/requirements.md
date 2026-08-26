---
author: qinyi
created_at: 2026-08-26 21:36:01
change: 2026-08-26-session-input-mention
status: brainstorm
---

# 需求（会话输入框智能联想）

## 功能需求

- FR-01（/ 触发与过滤）：输入框内，`/` 出现在词首（行首或空格之后）且光标位于
  其后的连续查询串内时，输入胶囊上方弹出联想浮层；浮层分组展示「内置指令」（/team）
  与「技能」（平台 + 当前用户自定义，来自 `/api/daemon/skills/latest/manifest`，
  含 description），按查询串对 name 做前缀/包含过滤；无匹配时展示空态引导。
- FR-02（键盘与 IME）：浮层激活时 ↑/↓ 移动高亮、Enter 或 Tab 确认选择、Esc 关闭；
  Enter 仅在浮层激活且高亮项存在时拦截（否则保持原发送语义）。中文输入法
  composition 期间（compositionstart → compositionend）不弹层、不拦截按键。
- FR-03（/ 选中回填与透传）：选中后把「触发字符 + 查询串」替换为
  `/<invoke_name ?? name> `（invoke_name 为 manifest 新增的 frontmatter 名字段）。
  发送时除 `/team`（维持既有拦截/剥离）外原样透传——技能已由 daemon 落盘到
  `<workdir>/.claude/skills/`，Claude Code 可按 slash command 识别调用。
- FR-04（@ 触发、过滤与回填）：`@` 词首触发，浮层分组「变更」「快速修复」（数据源
  `listChanges(location:"active")` + `listQuicklogEntries()`，对齐会话列表「关联」
  筛选下拉 X-009 的查询与过滤惯例，placeholder 快速修复条目过滤掉）；选中回填
  `@<change_key> ` 或 `@<ql_id> `，同时把选中对象回传父级（pendingMentions）。
- FR-05（预会话绑定）：预会话（首句 create）发送时，pendingMentions 中的变更/
  快速修复映射为 `SessionCreateRequest.change_id` / `quicklog_id` 上送（既有契约，
  零后端改动）；每类型以最后一次选择为准，文本中多个 @ 全部保留。
- FR-06（中途绑定，方案 B）：`SessionInjectRequest` 新增可选 `bind_change_key`
  （≤200 字符）与 `bind_quick_id`（≤40，`ql-*` 模式）；inject 处理中有值即调用
  `bind_session_to_change` / `bind_session_to_quicklog`（幂等，复用 2026-08-25
  session-spec-binding 既有 binder），不注入 prompt 前导、不改动消息渲染。
- FR-07（manifest invoke_name，方案 B）：`GET /api/daemon/skills/latest/manifest`
  的 `skills[]` 新增 `invoke_name: str | null`（SKILL.md frontmatter name 原值；
  自定义技能与目录名一致，平台技能为冒号名）；缺 frontmatter 时为 null。
- FR-08（可发现性）：输入框 placeholder 追加提示（如「/ 唤起技能 · @ 关联变更」），
  实际文案实现期定稿。

## 非功能需求

- NFR-01 性能：联想数据挂载时 prefetch 一次（TanStack Query staleTime ≥ 5 分钟），
  输入过程零网络请求；浮层渲染不阻塞输入（受控 value 更新路径不变）。
- NFR-02 无障碍：浮层容器 role="listbox"、选项 role="option" 与 aria-selected，
  Esc/Tab 行为可预期。
- NFR-03 兼容：Windows / Linux / macOS 三平台行为一致；codex 引擎会话 `/` `@`
  浮层照常可用（文本原样送达，无 Claude 专属副作用）。
- NFR-04 回归：`/team` 拦截、附件、草稿、team popover 既有行为零回归（现有测试
  全绿 + 新增用例覆盖交叉场景）。
