---
author: flow-machine-draft
created_at: 2026-09-28T08:46:09.452Z
---
# 需求规格（Requirements）— 2026-09-28-knowledge-gov-ux-detail

## 功能需求（GWT 骨架已机器预填——可编辑覆盖；FR 进知识索引）

<!--AGENT:FR区 agent 填写功能需求（GWT 骨架已预填——覆盖/修改/保留均可） -->
### FR-01: 每池/每域/收件箱加「查看明细」深链（?file=fr/<domain>.md / uncatego
Given 系统就绪
When 每池/每域/收件箱加「查看明细」深链（?file=fr/<domain>.md / uncategorized.md，复用页面既有深链消费能力，同页软导航）
Then 行为符合本条标准描述

### FR-02: rot/收件箱卡加「复制 AI 处理指令」按钮（clipboard 复制即用提示词，含分布/计数；失
Given 系统就绪
When rot/收件箱卡加「复制 AI 处理指令」按钮（clipboard 复制即用提示词，含分布/计数；失败降级为内联展示提示词文本）
Then 行为符合本条标准描述

### FR-03: binding-unresolved 卡正文补明细（锚点 id 列表）
Given 系统就绪
When binding-unresolved 卡正文补明细（锚点 id 列表）
Then 行为符合本条标准描述

### FR-04: 伪域未知池（如 auto-round5）也给查看链接
Given 系统就绪
When 伪域未知池（如 auto-round5）也给查看链接
Then 行为符合本条标准描述

### FR-05: 四类卡都能看到具体数据入口（深链到本页对应知识文件）
Given 系统就绪
When 四类卡都能看到具体数据入口（深链到本页对应知识文件）
Then 行为符合本条标准描述

### FR-06: rot
Given 系统就绪
When rot
Then 行为符合本条标准描述

### FR-07: inbox 有一键复制处理指令入口（复制成功有反馈
Given 系统就绪
When inbox 有一键复制处理指令入口（复制成功有反馈
Then 行为符合本条标准描述

### FR-08: clipboard 不可用时内联显示可手动复制）
Given 系统就绪
When clipboard 不可用时内联显示可手动复制）
Then 行为符合本条标准描述

### FR-09: 分池行查看链接跳转参数正确（?file=fr/<domain>.md）
Given 系统就绪
When 分池行查看链接跳转参数正确（?file=fr/<domain>.md）
Then 行为符合本条标准描述

### FR-10: 既有测试同步更新全绿，tsc
Given 测试 相关模块就绪
When 既有测试同步更新全绿，tsc
Then 行为符合本条标准描述

### FR-11: eslint 0 错
Given 系统就绪
When eslint 0 错
Then 行为符合本条标准描述

## 测试绑定（每条 FR 至少一行——空槽将在 flow done 时自动从测试结果补全）

<!--AGENT:测试绑定FR-01 哪个测试文件/用例覆盖这条 FR（项目相对全路径＋用例名；空槽将在 flow done 自动从测试结果补全——预填可加速）——例外裁决书写面（机器段之外合法） --
frontend/src/components/knowledge/__tests__/governance-cards.test.tsx › 伪域分池查看明细（view-fr-auto-backend/auto-round5/unmapped 三链断言 router.push 参数）
>

<!--AGENT:测试绑定FR-02 哪个测试文件/用例覆盖这条 FR（项目相对全路径＋用例名；空槽将在 flow done 自动从测试结果补全——预填可加速）——例外裁决书写面（机器段之外合法） --
同上 › rot：分域查看链接（view-fr-lib-api）+ 复制 AI 指令（writeText 内容含计数与分布 + copy-ai-prompt-result 已复制反馈）；inbox：查看明细深链 + 复制 AI 指令；clipboard 失败内联降级
>

<!--AGENT:测试绑定FR-03 哪个测试文件/用例覆盖这条 FR（项目相对全路径＋用例名；空槽将在 flow done 自动从测试结果补全——预填可加速）——例外裁决书写面（机器段之外合法） --
同上 › binding-unresolved：锚点明细可见（governance-binding-detail 含 FR-cli-091）
>

<!--AGENT:测试绑定FR-04 哪个测试文件/用例覆盖这条 FR（项目相对全路径＋用例名；空槽将在 flow done 自动从测试结果补全——预填可加速）——例外裁决书写面（机器段之外合法） --
同上 › 伪域分池查看明细 用例（?file=fr%2F<域>.md 编码断言）
>

<!--AGENT:测试绑定FR-05 哪个测试文件/用例覆盖这条 FR（项目相对全路径＋用例名；空槽将在 flow done 自动从测试结果补全——预填可加速）——例外裁决书写面（机器段之外合法） --
同上 › rot/inbox 两用例 + local 模式用例（查看链接不依赖 daemon 在线仍可用断言）
>

<!--AGENT:测试绑定FR-06 哪个测试文件/用例覆盖这条 FR（项目相对全路径＋用例名；空槽将在 flow done 自动从测试结果补全——预填可加速）——例外裁决书写面（机器段之外合法） --
frontend/src/components/knowledge/__tests__/governance-cards.test.tsx 全文件 10 用例（本地实测 10 passed）+ npx tsc --noEmit 0 错
>

<!--AGENT:测试绑定FR-07 哪个测试文件/用例覆盖这条 FR（项目相对全路径＋用例名；空槽将在 flow done 自动从测试结果补全——预填可加速）——例外裁决书写面（机器段之外合法） --
不适用：静态门禁项——npx eslint 两文件实测 0 error 0 warning
>

<!--AGENT:测试绑定FR-08 哪个测试文件/用例覆盖这条 FR（项目相对全路径＋用例名；空槽将在 flow done 自动从测试结果补全——预填可加速）——例外裁决书写面（机器段之外合法） --
不适用：机械动作为既有端点（一轮 FR-02 已钉 redomain/repair-paths 调用契约，本轮未改通道）——同文件 一键归位/binding 用例回归覆盖
>

<!--AGENT:测试绑定FR-09 哪个测试文件/用例覆盖这条 FR（项目相对全路径＋用例名；空槽将在 flow done 自动从测试结果补全——预填可加速）——例外裁决书写面（机器段之外合法） --
同上 › 伪域分池查看明细 用例（auto-round5 未知池 view 链断言）
>

<!--AGENT:测试绑定FR-10 哪个测试文件/用例覆盖这条 FR（项目相对全路径＋用例名；空槽将在 flow done 自动从测试结果补全——预填可加速）——例外裁决书写面（机器段之外合法） --
同上 › local 模式用例（无归位按钮但查看明细在）
>

<!--AGENT:测试绑定FR-11 哪个测试文件/用例覆盖这条 FR（项目相对全路径＋用例名；空槽将在 flow done 自动从测试结果补全——预填可加速）——例外裁决书写面（机器段之外合法） --
不适用：无视觉规格变化（新增均为既有样式体系内的小号文字链/按钮，visual-evidence.md 留痕无视觉降级）
>
