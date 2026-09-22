---
author: qinyi
created_at: 2026-09-17 01:56:34
generated_by: sillyspec-fourpiece-init
---
# 提案书（Proposal）

## 动机

平台知识库是所有 workspace 共享 SillySpec 知识的唯一网页入口，但当前只是 `.sillyspec/knowledge/` 顶层 `*.md` 的只读列表。用户要求知识库能"直接记录转换生成真实知识沉淀"（参考 sillyspec 工具的 propose/审核/合并能力），让平台里的会话记录、变更归档这些核心资产可以转成可复用的知识，而不是只存在于聊天记录里。

## 关键问题

1. **子目录知识不可见**：parser 非递归只读顶层 md，`decisions/`（决策库，防方案翻烧饼的关键资产）与 `generated/`（架构扫描自动抽取知识）共 52+ 文件在网页上永远不显示，与 sillyspec CLI 的 zone 口径分叉。
2. **知识只能靠会话跑 CLI 产生**：平台侧没有任何写入/审核入口——想补一条知识必须开 agent 会话让 CLI 代写，普通用户无法直接参与知识沉淀。
3. **记录资产与知识库断链**：会话结束后其中有价值的问题定位、方案取舍、踩坑结论随会话归档沉底，没有提炼转存的通路。

## 变更范围

- 读侧：知识库列表递归 + zone 分组展示（待审核/手册/决策库/自动生成），待审核置顶带计数。
- 写侧：平台直写底座（走 spec_workspace apply_ops 单写者语义）——手工录入候选、手册层与 generated 层条目编辑、候选审核合并（追加目标文件 `##` 小节 + INDEX 路由行，复刻 CLI classify）与拒绝；新增 KNOWLEDGE_WRITE 权限。
- 蒸馏：选会话记录/已归档变更派发 agent 后台任务提炼候选（agent 跑 `sillyspec knowledge propose`），任务进度反馈；产物经现有同步回流各端。
- 前端：知识库页 zone 树、沉淀弹层（双 tab）、合并预览、编辑态、蒸馏任务条；原型已定稿（prototype-knowledge-precipitation.html）。

## 不在范围内（显式清单）

- 不做事件复盘（incident postmortem）转知识（D-001）
- 不做 daemon 代写队列知识写路径（D-005 否决）
- 不做平台独立知识存储/新数据表（D-003）
- 不做决策库 decisions/ 网页编辑（D-006，由归档流程维护）
- 不做全文搜索/向量检索、知识评论协作、后端直调 LLM 蒸馏（D-002）

## 成功标准（可验证）

- workspace b97f8231 的知识库页可见 decisions/ 与 generated/ 全部条目并按 zone 分组（对照本地 `.sillyspec/knowledge/` 实际文件数）。
- 手工录入一条候选 → 出现在待审核区 → 合并到 known-issues.md → 文件出现新 `##` 小节且 INDEX.md 出现新路由行 → `sillyspec knowledge validate` 通过、CLI `knowledge search` 能命中新条目。
- 选一个已归档变更派发蒸馏 → 任务条出现 → agent 完成后待审核区出现候选。
- 未授权用户（无 KNOWLEDGE_WRITE）页面无任何写入口，行为与现状一致。
- 平台直写后：spec_version 递增；repo-native 客户端下次 lease 拉取后本地 `.sillyspec` 出现同样改动。
