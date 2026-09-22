---
author: qinyi
created_at: 2026-09-17 01:56:34
generated_by: sillyspec-fourpiece-init
---
# 需求规格（Requirements）

## 角色
| 角色 | 说明 |
|---|---|
| workspace 成员（KNOWLEDGE_READ） | 浏览全部 zone 的知识条目 |
| 知识管理员（KNOWLEDGE_READ + KNOWLEDGE_WRITE） | 手工录入、编辑、审核合并/拒绝候选、派发蒸馏任务 |
| agent（daemon 会话） | 蒸馏任务执行者：读源记录并执行 sillyspec knowledge propose |

## 功能需求

### FR-01: 会话蒸馏派发
Given 一个存在记录的 agent 会话
When 用户在知识库页「沉淀知识 → 从记录提炼」选择该会话（可附关注点提示词）并派发
Then 平台创建 knowledge-distill 类 AgentRun 后台执行，任务条显示进行中；完成后候选知识出现在待审核区（proposed/），失败时任务条给出失败态

### FR-02: 手工录入候选
Given 用户具有 KNOWLEDGE_WRITE
When 填写标题/分类/正文并保存
Then 生成 `knowledge/proposed/<slug>.md`（frontmatter 含 author/created_at/proposed_at/source=manual），列表待审核区立即可见

### FR-03: 变更蒸馏派发
Given 一个已归档变更
When 用户选择该变更并派发蒸馏
Then 行为同 FR-01（源为变更四件套与决策记录）

### FR-04: 平台直写底座
Given 任何知识写操作（录入/编辑/合并/拒绝）
When 后端执行落盘
Then 全部经 spec_workspace apply_ops 语义：manifest 行版本 +1、spec_version 递增、删除内容进 30 天备份区；与上行同步冲突时返回 conflict 语义而非静默覆盖

### FR-05: 审核合并与拒绝
Given 待审核区一条候选
When 用户执行合并（选目标文件 ∈ {known-issues.md, patterns.md, conventions.md} + 小节标题 + 路由关键词）
Then 预览展示将追加的 `##` 小节与 INDEX 路由行；确认后两段式落盘（先目标文件+INDEX 更新、无冲突后再移除候选）；目标文件追加小节、INDEX.md 对应分类段补路由行（格式与 CLI knowledge-match.js 解析兼容）；拒绝则仅移除候选（入备份区）

### FR-06: 递归 zone 展示
Given spec 树 knowledge/ 下存在子目录（decisions/、generated/、proposed/）
When 用户打开知识库页
Then 列表递归展示全部 `*.md` 条目并按 zone 分组（待审核置顶 + 计数徽标），子目录条目可点开查看正文

### FR-07: 全层编辑
Given 手册层或 generated 层一条条目
When 用户具有 KNOWLEDGE_WRITE 并编辑保存
Then 正文更新（frontmatter 保持不动，版本 +1、旧内容入备份区）；decisions/ 条目不提供编辑入口并标注"由归档流程维护"

## 非功能需求
- 兼容性：未授权用户行为与现状一致；GET /knowledge 响应只增不改字段；quicklog 端点与 spec 同步协议零改动；daemon 零改动
- UI 默认中文，遵循 AI-Native 双主题系统（brand-* 语义阶 + 主题 token）
- 代码实现兼容 Windows/Linux/macOS（路径一律 `/` 相对路径存储与传输）
- 前端接口类型经 `pnpm gen:types` 从 OpenAPI 生成并随变更提交

## 决策覆盖矩阵（如存在 decisions.md）
| 决策 ID | 覆盖的 FR | 说明 |
|---|---|---|
| D-001@v1 | FR-01/FR-02/FR-03 | 来源范围三选，事件复盘不做 |
| D-002@v1 | FR-01/FR-03 | 蒸馏引擎=派发 agent 会话 |
| D-003@v1 | FR-04/FR-05 | 入库=.sillyspec/knowledge 树，无新表 |
| D-004@v1 | FR-06 | 递归 zone 展示对齐 CLI |
| D-005@v1 | FR-04/FR-05 | 平台直写（方案A） |
| D-006@v1 | FR-07 | 手册+generated 可编辑，decisions 只读 |
| D-007@v1 | FR-05/FR-06 | merge 两段式 + 三类目标 + keywords 人工输入；path 前缀保留 |
