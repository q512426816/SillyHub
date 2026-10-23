---
author: flow-machine-draft
created_at: 2026-10-23T08:07:18.411Z
---
# 需求规格（Requirements）— 2026-10-23-knowledge-scope-maintenance

## 功能需求

### FR-01: 后端：GET /knowledge 每条目新增 sections 数组（有标记的节：heading+scope+domains；无标记空数组，零标记文件行为与现状一致）；PATCH /knowledge/scope 按 filename+heading 精确定位节内标记做增/改/删（keyword=移除标记），module 档 domains 非空且格式合法（小写域 id），heading 不存在/多义/坏 scope/坏 domain → 422；写入走既有 KnowledgeWriterService.apply_ops 单写者（版本锁+备份），不改其它节内容

- - 后端 GET /knowledge 的每条目 MUST 透传 sections 数组（节级作用域：heading+scope∈always|repo|module+domains；无标记节/文件零条目=空数组，零回归）；解析 MUST 与 CLI 标记语法同源（HTML 注释 scope: 行、section heading 后一节内有效）。

#### 场景：主路径

（按需保留或改写：Given 前提 / When 触发 / Then 可判定预期——每边界情形一个场景块，归档索引用场景名作摘要）

### FR-02: 前端：知识库页面新增作用域筛选（全部/always/repo/module/关键词）与条目/节级徽标；条目卡提供「维护作用域」入口：对话框选择档位（含 module 域输入，逗号分隔）保存后列表刷新，错误可见；页面不回归（既有 zone 分组/搜索/统计面不变）

- - 新端点 PATCH /knowledge/scope MUST 按 filename+heading 精确定位节内标记做增/改/删（scope=keyword 即移除标记）：仅 top zone 顶层知识文件（INDEX.md/decisions/generated/proposed 拒 422）；heading 不存在（422 not found）/多义（422 ambiguous）/坏 scope/坏 domains（422）MUST 逐项给可读错误；写入 MUST 走既有 KnowledgeWriterService.apply_ops 单写者（版本锁+坏编码守卫），MUST NOT 改动同一文件其他节内容；成功返回刷新后的 KnowledgeEntry。

#### 场景：主路径

（按需保留或改写：Given 前提 / When 触发 / Then 可判定预期——每边界情形一个场景块，归档索引用场景名作摘要）

### FR-03: 测试：后端 knowledge 模块 pytest 新增用例（sections 解析/scope 增改删/422 矩阵）；前端 vitest 新增用例（筛选与对话框逻辑）；scoped 跑绿

- - 前端知识库页面 MUST 新增作用域筛选（全部/always/repo/module/关键词）与徽标（条目级=其节作用域集合，节级徽标在场）；条目卡 MUST 提供「维护作用域」入口（对话框：档位选择+module 域输入，逗号分隔）——保存成功刷新列表、失败错误可见；既有 zone 分组/搜索/统计/图谱面 MUST 零回归。

#### 场景：主路径

（按需保留或改写：Given 前提 / When 触发 / Then 可判定预期——每边界情形一个场景块，归档索引用场景名作摘要）

## 测试绑定（每条 FR 至少一行——`FR-NN: test/路径「用例名」`；空行/待填在 flow done 拒收）

FR-01: 不适用：面级功能（后端解析/端点+前端交互），由本变更新增的 pytest/vitest 用例覆盖
FR-02: 不适用：面级功能（后端解析/端点+前端交互），由本变更新增的 pytest/vitest 用例覆盖
FR-03: 不适用：面级功能（后端解析/端点+前端交互），由本变更新增的 pytest/vitest 用例覆盖
