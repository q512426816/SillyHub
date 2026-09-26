---
author: flow-machine-draft
created_at: 2026-09-26T08:19:43.797Z
---
# 任务注册表（Tasks）— 2026-09-26-change-asset-transparency

> 机器预填草稿（成功标准逐条镜像）——任务面归 agent：按实际实现路径覆写本文件（保持 checkbox 行形态），验收锚在 requirements；
> 默认 thin：无任务卡文件，收口=flow done 唯一裁决。
> ✅ 边干边勾（2026-09-26-tick-loop-nudge，OS Guardrails 同款纪律）：完成一条 = 实现到位 + 相关测试跑绿 → 立即勾 `[x]`，勿攒到收口一把勾（勾选是进度锚与哨兵证据面）。本文件收口前随交付显式 pathspec 提交。
- [x] task-01: 后端 _parse_entries_owned_by/_scan_domain_files 归属行参数化（owner_line_re，默认「变更：」零回归）；get_change_assets 聚合知识触达——「待复核：」标记反查 fr+decisions 双域 → knowledge_touch 组（id/标题/file，fail-open）
- [x] task-02: 后端 _read_touched_modules——镜像 docs/*/modules/_module-map.yaml（yaml 安全解析逐图容错）× 归档 change-patch file_list 前缀匹配（文件剥项目顶层段），中文名 doc 首行 h1 提取失败回退 id，doc 相对路径按模块图 schema 惯例（docs/<项目>/…）→ touched_modules 组
- [x] task-03: 前端资产卡两组渲染——知识触达行 Link 跳知识库 ?file=&anchor= 深链（FR 行同款）；模块触达 chip 点击开模块文档预览弹窗（explorer FilePreview 直挂，镜像相对路径补 .sillyspec/ 前缀）；计数并入卡头；逐组有数据才渲染
- [x] task-04: schema DTO（ChangeKnowledgeTouch/ChangeTouchedModule + ChangeAssetsRead 两组）+ 规则 21 gen:types 同步 openapi.json 与 api-types.ts 随提交
- [x] task-05: 后端 test_assets 补四面——金样本待复核反查双域断言、模块 glob 匹配与 h1 中文名（test_touched_modules_glob_and_name）、doc 无 h1 回退与无 doc 模块（name_fallback 纯函数）、无标记空组（empty_without_marker）= 21 passed
- [x] task-06: 前端组件补三用例——知识触达渲染与 href 深链、模块 chip 中文名与 .sillyspec 前缀弹窗、两组无数据不渲染 = 19 passed；后端 change 模块 589 passed + 2 skipped；聚焦面 46 passed；tsc exit 0
