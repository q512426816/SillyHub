---
author: flow-machine-draft
created_at: 2026-09-28T13:37:18.188Z
---
# 需求规格（Requirements）— 2026-09-28-knowledge-inbox-clear

## 功能需求（GWT 骨架已机器预填——可编辑覆盖；FR 进知识索引）

<!--AGENT:FR区 agent 填写功能需求（GWT 骨架已预填——覆盖/修改/保留均可） -->
### FR-01: uncategorized.md 全部条目迁出，文件仅保留收件箱头注与清账说明
Given 系统就绪
When uncategorized.md 全部条目迁出，文件仅保留收件箱头注与清账说明
Then 行为符合本条标准描述

### FR-02: 每条按内容归入 known-issues / patterns / conventions / te
Given 系统就绪
When 每条按内容归入 known-issues / patterns / conventions / testing-gotchas / sillyspec-gotc
Then 行为符合本条标准描述

### FR-03: 已修复项按 known-issues 既有惯例标题带状态标记（已修复），未修复或现状认知项标记为待关
Given 系统就绪
When 已修复项按 known-issues 既有惯例标题带状态标记（已修复），未修复或现状认知项标记为待关注
Then 行为符合本条标准描述

### FR-04: 丢失标题的 SSE 路由条目补写标题后归入 FastAPI 路由顺序同族条目
Given api 相关模块就绪
When 丢失标题的 SSE 路由条目补写标题后归入 FastAPI 路由顺序同族条目
Then 行为符合本条标准描述

### FR-05: INDEX.md 五个分类节补齐迁移条目索引行，Uncategorized 节改为已清空说明，索引锚
Given 迁移 相关模块就绪
When INDEX.md 五个分类节补齐迁移条目索引行，Uncategorized 节改为已清空说明，索引锚点可解析
Then 行为符合本条标准描述

### FR-06: known-issues.md 内指向 uncategorized 旧条目的交叉引用改为指向新位置
Given 系统就绪
When known-issues.md 内指向 uncategorized 旧条目的交叉引用改为指向新位置
Then 行为符合本条标准描述

### FR-07: sillyspec knowledge validate 无 errors
Given 系统就绪
When sillyspec knowledge validate 无 errors
Then 行为符合本条标准描述

## 测试绑定（每条 FR 至少一行——空槽将在 flow done 时自动从测试结果补全）

<!--AGENT:测试绑定FR-01 不适用：纯知识库文档迁移，无代码测试面。验收证据=uncategorized.md 仅余头注与清账说明（提交 e723b484e 内 286 行删除），人工比对原文 41 条全部迁出 -->

<!--AGENT:测试绑定FR-02 不适用：同上，分类落位属文档内容判断。验收证据=五分类文件 ## 标题计数（known-issues 40 / patterns 16 / conventions 16 / testing-gotchas 14 / sillyspec-gotchas 14），41 = 18+6+5+8+4 增量核对 -->

<!--AGENT:测试绑定FR-03 不适用：同上，状态标记属标题文本。验收证据=known-issues 新增 18 条中 12 条 🟢（含「已修复」字样或 commit 号）、6 条 🟡，grep 可复核 -->

<!--AGENT:测试绑定FR-04 不适用：同上。验收证据=known-issues.md「daemon sessions /events 字面量路由被 /sessions/{session_id} 参数路由吞掉」条目标题与正文（commit 0c7860f7 经 git log 验证存在），并与 ppm export-excel 同族条目交叉引用 -->

<!--AGENT:测试绑定FR-05 不适用：锚点可解析性无 pytest/vitest 用例面。验收证据=一次性 node 脚本按 GitHub slug 规则（小写、去标点、空格转连字符）全量校验 INDEX 99 条链接 99/99 命中分类文件 ## 标题，0 断链 -->

<!--AGENT:测试绑定FR-06 不适用：同上，交叉引用属文档文本。验收证据=known-issues.md alembic 多 head 条目关联行现指向 conventions「2026-06-15 — Alembic migration 目录与 schema 领先版本号的处理」，grep uncategorized 关联字样为零 -->

<!--AGENT:测试绑定FR-07 不适用：验收命令本身即 CLI 工具 sillyspec knowledge validate，非项目测试套件用例。实测输出 ok=true、errors=[]、warnings=[]（2026-09-28 收口前最后一次运行） -->
