---
author: flow-machine-draft
created_at: 2026-09-26T08:19:43.796Z
---
# 提案书（Proposal）— 2026-09-26-change-asset-transparency

## 动机
<!-- MACHINE-DRAFT:proposal-motivation:dd4d7b869dd131908b054de622b4899a75170badf6f38ea547774f07bd7467e4:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-09-26-change-asset-transparency 留痕重锚 -->
任务原话转写：动机:变更消费了哪些项目资产目前只存在于 flow start 控制台输出——知识注入的现行 FR 在知识库条目上有「待复核:变更名」反向标记可反查,触达模块可由 patch 文件清单乘模块图算出;用户要求页面上可见可点击跳转,实现资产管理与数据透明。

成功标准:
- 后端 assets 聚合新增两组:知识触达(扫镜像 knowledge 的 fr 与 decisions 条目,节内含 待复核:变更名 行的条目收为 id/标题/file)与模块触达(归档 change-patch 的 file_list 对镜像 docs 各项目 modules/_module-map.yaml 的 paths glob 匹配,收为 模块 id/doc 路径/所属项目,中文名从 doc 文件 h1 提取失败回退 id);两组均 fail-open 缺源降空
- 前端资产卡渲染两组:知识触达行点击跳知识库页 file 与 anchor 深链(既有先例);模块触达 chip 点击打开 explorer 文件预览弹窗展示模块文档(仓库文件,路径确定不走搜索解析)
- 后端聚焦测试覆盖:待复核反查金样本、decisions 同构、无标记空组、模块 glob 匹配与中文名回退;前端组件测试覆盖两组渲染与跳转 href;聚焦测试全绿
- 规则 21:DTO 落 schema 后跑 pnpm gen:types 随提交 openapi.json 与 api-types.ts;frontend tsc 无错误
<!-- MACHINE-DRAFT:proposal-motivation:end -->

<!--AGENT:槽1 动机例外裁决——例外裁决书写面（机器段之外合法） -->

## 变更范围
<!-- MACHINE-DRAFT:proposal-scope:9d9b046e922443f796d186937b638220e7357877985bb1bc710455d0e4de7b19:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-09-26-change-asset-transparency 留痕重锚 -->
按成功标准机械推导，共 9 条验收面：
1. 后端 assets 聚合新增两组:知识触达(扫镜像 knowledge 的 fr 与 decisions 条目,节内含 待复核:变更名 行的条目收为 id/标题/file)与模块触达(归档 change-patch 的 file_list 对镜像 docs 各项目 modules/_module-map.yaml 的 paths glob 匹配,收为 模块 id/doc 路径/所属项目,中文名从 doc 文件 h1 提取失败回退 id)
2. 两组均 fail-open 缺源降空
3. 前端资产卡渲染两组:知识触达行点击跳知识库页 file 与 anchor 深链(既有先例)
4. 模块触达 chip 点击打开 explorer 文件预览弹窗展示模块文档(仓库文件,路径确定不走搜索解析)
5. 后端聚焦测试覆盖:待复核反查金样本、decisions 同构、无标记空组、模块 glob 匹配与中文名回退
6. 前端组件测试覆盖两组渲染与跳转 href
7. 聚焦测试全绿
8. 规则 21:DTO 落 schema 后跑 pnpm gen:types 随提交 openapi.json 与 api-types.ts
9. frontend tsc 无错误
<!-- MACHINE-DRAFT:proposal-scope:end -->


## 成功标准（可验证）
<!-- MACHINE-DRAFT:proposal-criteria:fbc2898a76f3051219317903988b3bbd6781669a4e4c224d975a6980a62953aa:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-09-26-change-asset-transparency 留痕重锚 -->
1. 后端 assets 聚合新增两组:知识触达(扫镜像 knowledge 的 fr 与 decisions 条目,节内含 待复核:变更名 行的条目收为 id/标题/file)与模块触达(归档 change-patch 的 file_list 对镜像 docs 各项目 modules/_module-map.yaml 的 paths glob 匹配,收为 模块 id/doc 路径/所属项目,中文名从 doc 文件 h1 提取失败回退 id)
2. 两组均 fail-open 缺源降空
3. 前端资产卡渲染两组:知识触达行点击跳知识库页 file 与 anchor 深链(既有先例)
4. 模块触达 chip 点击打开 explorer 文件预览弹窗展示模块文档(仓库文件,路径确定不走搜索解析)
5. 后端聚焦测试覆盖:待复核反查金样本、decisions 同构、无标记空组、模块 glob 匹配与中文名回退
6. 前端组件测试覆盖两组渲染与跳转 href
7. 聚焦测试全绿
8. 规则 21:DTO 落 schema 后跑 pnpm gen:types 随提交 openapi.json 与 api-types.ts
9. frontend tsc 无错误
<!-- MACHINE-DRAFT:proposal-criteria:end -->

<!--AGENT:槽2 成功标准例外裁决（增删条目在此书写）——例外裁决书写面（机器段之外合法） -->
