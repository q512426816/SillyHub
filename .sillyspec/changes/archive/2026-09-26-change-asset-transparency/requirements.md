---
author: flow-machine-draft
created_at: 2026-09-26T08:19:43.797Z
---
# 需求规格（Requirements）— 2026-09-26-change-asset-transparency

## 功能需求（agent 填写——每条 FR 格式 ### FR-NN: 标题 + Given/When/Then；FR 进知识索引，写清行为语义）

<!--AGENT:FR区 agent 填写功能需求（直接书写，不走 amend） -->
<!-- 参考摘录按实现结构重组为 FR-01~04 -->

### FR-01: 知识触达组——变更消费的知识条目可跳转
Given 知识注入的现行 FR/决策在知识库条目内有「待复核：<变更名>」反向标记（flow done 对触达域打标），
When assets 聚合解析（GET /changes/{cid}/assets），
Then 新增 knowledge_touch 组收录镜像 knowledge 的 fr 与 decisions 中节内含该标记的条目（id/标题/file），fail-open 缺源降空；前端资产卡渲染该组，行点击跳知识库页 ?file=&anchor= 深链（沉淀资产 FR 行同款先例）。

### FR-02: 模块触达组——变更触达的模块可点开模块文档
Given 变更交付文件清单（归档 change-patch.json file_list）与镜像模块图（docs/<项目>/modules/_module-map.yaml 的 paths glob），
When assets 聚合解析，
Then 新增 touched_modules 组：file_list 对各项目模块图 paths 前缀/glob 匹配去重，收为 模块 id/所属项目/doc 路径，中文名从 doc 文件 h1 提取（失败回退 id）；前端渲染 chip 行，点击打开 explorer 文件预览弹窗展示模块文档（路径确定，不走搜索解析）。

### FR-03: 两组展示语义与既有组一致
Given 两组新数据挂入沉淀资产卡，
When 卡片渲染，
Then 逐组「有数据才渲染」（fail-open 同款）、计数徽标并入卡头统计、空组不出现；既有四组零回归。

### FR-04: 测试与类型门禁全绿
Given 改动落盘，
When 运行后端聚焦测试（待复核反查金样本含 fr 与 decisions、无标记空组、模块 glob 匹配与中文名 h1 提取/回退）与前端组件测试（两组渲染、知识触达 href 深链、模块 chip 弹窗）及 gen:types 后 tsc，
Then 全部通过、openapi.json 与 api-types.ts 随提交同步、0 类型错误。


## 测试绑定（每条 FR 至少一行——test 文件路径或用例名；不适用要写理由；flow done 空槽拒收）

<!--AGENT:测试绑定FR-01 哪个测试文件/用例覆盖这条 FR（无测试面写「不适用：理由」）——例外裁决书写面（机器段之外合法） -->
backend/app/modules/change/tests/test_assets.py::待复核反查金样本（fr+decisions 双域） 与 ::无标记空组 用例；前端 __tests__/change-assets-card.test.tsx::知识触达组渲染与 href 深链 用例

<!--AGENT:测试绑定FR-02 哪个测试文件/用例覆盖这条 FR（无测试面写「不适用：理由」）——例外裁决书写面（机器段之外合法） -->
backend/app/modules/change/tests/test_assets.py::模块触达 glob 匹配与中文名提取/回退 用例；前端::模块 chip 渲染与文档预览弹窗 用例

<!--AGENT:测试绑定FR-03 哪个测试文件/用例覆盖这条 FR（无测试面写「不适用：理由」）——例外裁决书写面（机器段之外合法） -->
既有 16 用例 + 新增用例一次跑过（change-assets-card 全套回归承担）

<!--AGENT:测试绑定FR-04 哪个测试文件/用例覆盖这条 FR（无测试面写「不适用：理由」）——例外裁决书写面（机器段之外合法） -->
backend uv run pytest app/modules/change/tests/test_assets.py 全绿 + pnpm gen:types 幂等 + pnpm exec tsc exit 0（2026-09-26 实测）

