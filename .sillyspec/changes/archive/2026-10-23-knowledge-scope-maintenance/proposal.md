---
author: flow-machine-draft
created_at: 2026-10-23T08:07:18.411Z
---
# 提案书（Proposal）— 2026-10-23-knowledge-scope-maintenance

## 动机

任务原话转写：知识注入作用域维护面板

动机与背景：用户指令（2026-10-23 原话）：「平台仓，在知识库页面中新增个这几个维度的维护功能吧」——SillySpec CLI 侧已落知识注入四档作用域（always/repo/module:域/关键词，knowledge/*.md 节级 HTML 注释标记，2026-10-23-knowledge-scope-inject），但平台知识库页面只能看正文、无法查看/维护作用域；平台知识服务直接读工作区仓 .sillyspec/knowledge/ 文件（写入走既有单写者 apply_ops），标记天然在场只是未解析未暴露。交付：①后端 GET /knowledge 列表透传节级 sections（heading/scope/domains）②新 PATCH /knowledge/scope 节级维护端点（走单写者语义，精确 heading 定位，scope∈always|repo|module|keyword，module 须 domains）③前端知识页作用域筛选+条目徽标+维护对话框。autopilot 直跑到底，--no-prestage 声明需求已含决策（作用域语义由 CLI 侧定稿）。

成功标准：
- 后端：GET /knowledge 每条目新增 sections 数组（有标记的节：heading+scope+domains；无标记空数组，零标记文件行为与现状一致）；PATCH /knowledge/scope 按 filename+heading 精确定位节内标记做增/改/删（keyword=移除标记），module 档 domains 非空且格式合法（小写域 id），heading 不存在/多义/坏 scope/坏 domain → 422；写入走既有 KnowledgeWriterService.apply_ops 单写者（版本锁+备份），不改其它节内容
- 前端：知识库页面新增作用域筛选（全部/always/repo/module/关键词）与条目/节级徽标；条目卡提供「维护作用域」入口：对话框选择档位（含 module 域输入，逗号分隔）保存后列表刷新，错误可见；页面不回归（既有 zone 分组/搜索/统计面不变）
- 测试：后端 knowledge 模块 pytest 新增用例（sections 解析/scope 增改删/422 矩阵）；前端 vitest 新增用例（筛选与对话框逻辑）；scoped 跑绿

## 变更范围

按成功标准机械推导，共 3 条验收面：
1. 后端：GET /knowledge 每条目新增 sections 数组（有标记的节：heading+scope+domains；无标记空数组，零标记文件行为与现状一致）；PATCH /knowledge/scope 按 filename+heading 精确定位节内标记做增/改/删（keyword=移除标记），module 档 domains 非空且格式合法（小写域 id），heading 不存在/多义/坏 scope/坏 domain → 422；写入走既有 KnowledgeWriterService.apply_ops 单写者（版本锁+备份），不改其它节内容
2. 前端：知识库页面新增作用域筛选（全部/always/repo/module/关键词）与条目/节级徽标；条目卡提供「维护作用域」入口：对话框选择档位（含 module 域输入，逗号分隔）保存后列表刷新，错误可见；页面不回归（既有 zone 分组/搜索/统计面不变）
3. 测试：后端 knowledge 模块 pytest 新增用例（sections 解析/scope 增改删/422 矩阵）；前端 vitest 新增用例（筛选与对话框逻辑）；scoped 跑绿

## 成功标准（可验证）

1. 后端：GET /knowledge 每条目新增 sections 数组（有标记的节：heading+scope+domains；无标记空数组，零标记文件行为与现状一致）；PATCH /knowledge/scope 按 filename+heading 精确定位节内标记做增/改/删（keyword=移除标记），module 档 domains 非空且格式合法（小写域 id），heading 不存在/多义/坏 scope/坏 domain → 422；写入走既有 KnowledgeWriterService.apply_ops 单写者（版本锁+备份），不改其它节内容
2. 前端：知识库页面新增作用域筛选（全部/always/repo/module/关键词）与条目/节级徽标；条目卡提供「维护作用域」入口：对话框选择档位（含 module 域输入，逗号分隔）保存后列表刷新，错误可见；页面不回归（既有 zone 分组/搜索/统计面不变）
3. 测试：后端 knowledge 模块 pytest 新增用例（sections 解析/scope 增改删/422 矩阵）；前端 vitest 新增用例（筛选与对话框逻辑）；scoped 跑绿
