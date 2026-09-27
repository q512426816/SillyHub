---
author: flow-machine-draft
created_at: 2026-09-27T14:11:35.879Z
---
# 任务注册表（Tasks）— 2026-09-27-thin-affected-modules-from-patch-manifest

> 机器预填草稿（成功标准逐条镜像）——任务面归 agent：按实际实现路径覆写本文件（保持 checkbox 行形态），验收锚在 requirements；
> 默认 thin：无任务卡文件，收口=flow done 唯一裁决。
> ✅ 边干边勾（2026-09-26-tick-loop-nudge，OS Guardrails 同款纪律）：完成一条 = 实现到位 + 相关测试跑绿 → 立即勾 `[x]`，勿攒到收口一把勾（勾选是进度锚与哨兵证据面）。本文件收口前随交付显式 pathspec 提交。

- [x] task-01: parser.py 新增 `_extract_manifest_code_paths(change_dir)`——读 change-patch.json 的 files 数组，滤除 `.sillyspec/changes/` 治理前缀，缺失/JSON 损坏/files 非 list/成员非 str 一律空集降级；`_infer_affected_components` Path 2b 并入该来源（module-impact.md 矩阵优先级不变）
- [x] task-02: 修复 `_find_module_map_file` 单图选择缺陷——Windows PurePath 排序大小写不敏感致 SillyHub 图排 backend 图之后被漏读，且 backend 图 paths 以 app/ 开头与交付路径永不匹配；改为 `_find_module_map_files` 跨全部项目目录收集（`key=str` 确定性排序，包裹布局优先语义保留），`_load_module_map` 多图合并、同名模块前缀并集、缓存键升级为（路径元组, mtime 元组）复合指纹
- [x] task-03: test_parser.py 新增 `TestInferAffectedComponentsFromManifest` 6 用例（files 推断命中 / 治理件滤除 / 畸形 JSON / files 非 list / tasks 并集 / module-impact 优先）+ `TestLoadModuleMapMultiProjectMerge` 4 用例（全收合并 / 同名并集 / 任一图 mtime 变化失效 / 端到端 frontend 命中）
- [x] task-04: 测试全绿——test_parser.py 39/39；change 模块全量 607 passed + 2 skipped（既有跳过标记，非本变更引入）
- [x] task-05: 本仓真实数据冒烟——38 个存量 thin 归档件影响模块推断 0 命中 → 29 命中；9 个未命中经查冻结面 files 仅含治理件（源数据无代码交付，CLI 侧采集缺失，平台侧无解）；合并图 182 模块、89 个含 frontend 前缀
