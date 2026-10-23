---
author: flow-machine-draft
created_at: 2026-10-23T08:07:18.411Z
---
# 任务注册表（Tasks）— 2026-10-23-knowledge-scope-maintenance

- [x] task-01: 后端：GET /knowledge 每条目新增 sections 数组（有标记的节：heading+scope+domains；无标记空数组，零标记文件行为与现状一致）；PATCH /knowledge/scope 按 filename+heading 精确定位节内标记做增/改/删（keyword=移除标记），module 档 domains 非空且格式合法（小写域 id），heading 不存在/多义/坏 scope/坏 domain → 422；写入走既有 KnowledgeWriterService.apply_ops 单写者（版本锁+备份），不改其它节内容
- [x] task-02: 前端：知识库页面新增作用域筛选（全部/always/repo/module/关键词）与条目/节级徽标；条目卡提供「维护作用域」入口：对话框选择档位（含 module 域输入，逗号分隔）保存后列表刷新，错误可见；页面不回归（既有 zone 分组/搜索/统计面不变）
- [x] task-03: 测试：后端 knowledge 模块 pytest 新增用例（sections 解析/scope 增改删/422 矩阵）；前端 vitest 新增用例（筛选与对话框逻辑）；scoped 跑绿
