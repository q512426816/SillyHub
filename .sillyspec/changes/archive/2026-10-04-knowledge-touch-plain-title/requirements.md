---
author: flow-machine-draft
created_at: 2026-10-04T07:59:55.043Z
---
# 需求规格（Requirements）— 2026-10-04-knowledge-touch-plain-title

## 功能需求（GWT 骨架已机器预填——可编辑覆盖；FR 进知识索引）

<!--AGENT:FR区 agent 填写功能需求（GWT 骨架已预填——覆盖/修改/保留均可） -->
### FR-01: 归档态与在途态的知识触达区块标题均使用用户语言（「知识触达（本变更参考过的知识）」形态），标题正文不再出现「待复核标记反查」「注入命中」等机制黑话
Given 系统就绪
When 归档态与在途态的知识触达区块标题均使用用户语言（「知识触达（本变更参考过的知识）」形态），标题正文不再出现「待复核标记反查」「注入命中」等机制黑话
Then 行为符合本条标准描述

### FR-02: 数据口径（在途=执行期注入命中实时记录
Given 系统就绪
When 数据口径（在途=执行期注入命中实时记录
Then 行为符合本条标准描述

### FR-03: 归档=条目内「待复核」标记反查为权威、与实时命中合并去重）以悬停提示（title 属性）形式保留，表述准确
Given 系统就绪
When 归档=条目内「待复核」标记反查为权威、与实时命中合并去重）以悬停提示（title 属性）形式保留，表述准确
Then 行为符合本条标准描述

### FR-04: change-assets-card 组件测试断言同步更新并通过
Given 组件 / 测试 相关模块就绪
When change-assets-card 组件测试断言同步更新并通过
Then 行为符合本条标准描述

### FR-05: 知识库 FR-auto-frontend-093 条目（引用了旧标签文案）做内容过时最小修正
Given 系统就绪
When 知识库 FR-auto-frontend-093 条目（引用了旧标签文案）做内容过时最小修正
Then 行为符合本条标准描述

## 测试绑定（每条 FR 至少一行——空槽将在 flow done 时自动从测试结果补全）

<!--AGENT:测试绑定FR-01 哪个测试文件/用例覆盖这条 FR（项目相对全路径＋用例名；空槽将在 flow done 自动从测试结果补全——预填可加速）——例外裁决书写面（机器段之外合法） -->
frontend/src/components/changes/detail/__tests__/change-assets-card.test.tsx::知识触达组：待复核条目渲染并带知识库 file+anchor 深链 href（归档态标题）；同文件::在途变更知识触达：实时命中渲染（标题带「实时」尾标区分归档定稿口径）（在途态标题）

<!--AGENT:测试绑定FR-02 哪个测试文件/用例覆盖这条 FR（项目相对全路径＋用例名；空槽将在 flow done 自动从测试结果补全——预填可加速）——例外裁决书写面（机器段之外合法） -->
frontend/src/components/changes/detail/__tests__/change-assets-card.test.tsx::在途变更知识触达：实时命中渲染（标题带「实时」尾标区分归档定稿口径）（span[title] 含「实时记录」）

<!--AGENT:测试绑定FR-03 哪个测试文件/用例覆盖这条 FR（项目相对全路径＋用例名；空槽将在 flow done 自动从测试结果补全——预填可加速）——例外裁决书写面（机器段之外合法） -->
frontend/src/components/changes/detail/__tests__/change-assets-card.test.tsx::知识触达组：待复核条目渲染并带知识库 file+anchor 深链 href（span[title] 含「标记反查」）

<!--AGENT:测试绑定FR-04 哪个测试文件/用例覆盖这条 FR（项目相对全路径＋用例名；空槽将在 flow done 自动从测试结果补全——预填可加速）——例外裁决书写面（机器段之外合法） -->
frontend/src/components/changes/detail/__tests__/change-assets-card.test.tsx（全文件 28 用例，含上述两态标题与 tooltip 断言）

<!--AGENT:测试绑定FR-05 哪个测试文件/用例覆盖这条 FR（项目相对全路径＋用例名；空槽将在 flow done 自动从测试结果补全——预填可加速）——例外裁决书写面（机器段之外合法） -->
不适用：知识库 FR 条目为镜像文本修正，无运行时行为测试面；格式健康由 sillyspec knowledge validate 覆盖（本次实测无 errors）
