---
author: flow-machine-draft
created_at: 2026-09-27T14:11:35.878Z
---
# 设计记录（Design Record）— 2026-09-27-thin-affected-modules-from-patch-manifest

> 四节的「问题」是机器段（指纹保护，勿改）；你的回答写在每节问题下方的 AGENT 槽里。
> 每节至少一行——小改动可写「不适用：<理由>」；flow done 空槽拒收。

## 做法概述
<!-- MACHINE-DRAFT:design-approach:4fa550e9aac26c5f5a3c89b853d9af0ad0749943358808fbc1196064a42c1173:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-09-27-thin-affected-modules-from-patch-manifest 留痕重锚 -->
本变更怎么解决问题？改哪里、为什么选这个方案（一两段）。
<!-- MACHINE-DRAFT:design-approach:end -->

<!--AGENT:槽1 做法概述作答——例外裁决书写面（机器段之外合法） -->
改 `backend/app/modules/change/parser.py` 的 `_infer_affected_components`：在既有两来源（module-impact.md 矩阵、tasks.md/tasks/*.md 代码路径）之外，新增第三来源——读同目录 `change-patch.json` 的 `files` 数组（flow done 冻结的真实改动文件清单，CLI 新旧格式均携带），滤除 `.sillyspec/changes/` 治理面前缀后并入文件路径集合，统一走既有 `_match_paths_to_modules` 前缀匹配。选这个方案而非直接信 CLI 新三键 `modules[].id`，是因为该 id 是 flow 运行仓自己项目图的模块名，对本仓 module-map 无意义；`files` 是与仓无关的通用真相，且存量 38 个 thin 归档件全部携带，可一次性回填。`_load_module_map` 单图口径不动：SillyHub 主图（字母序第一）36 模块已覆盖 backend/frontend/daemon 三面前缀，多图合并反而引入 multi-agent-platform 粗粒度图的冗余命中。

## 接口契约
<!-- MACHINE-DRAFT:design-contract:86ee80e3cad9ae1c299a0c54bf5503a112d318bb2e5490a32fcd5c1724293a0b:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-09-27-thin-affected-modules-from-patch-manifest 留痕重锚 -->
动了哪些函数/端点/命令/文件格式？对外可见的签名或行为变化是什么（含「无」的说明）？
<!-- MACHINE-DRAFT:design-contract:end -->

<!--AGENT:槽2 接口契约作答——例外裁决书写面（机器段之外合法） -->
对外 API/schema 零变化：`_infer_affected_components` 是 parser 内部静态方法，签名不变，仅返回值来源增多（change-patch.json 命中的模块并入）。新增私有静态 helper `_extract_manifest_code_paths(change_dir) -> set[str]`（读 JSON、防御式解析）。下游 `affected_components` 字段（列表/详情投影、前端胶囊）数据变丰满，展示端零改动。

## 边界与并发（盲维四问——每问必答，答不了即设计缺口）
<!-- MACHINE-DRAFT:design-boundaries:98046ccf043ed9302175b492d297f70dfd943c39f2e8770e8a6039ea302cbb6a:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-09-27-thin-affected-modules-from-patch-manifest 留痕重锚 -->
1. 乱序/迟到到达：输入或事件乱序时，本设计的假设还成立吗？
2. 并发写：两个执行体同时操作同一数据/文件会发生什么？
3. 切换/生命周期：会话、请求或变更中途切换/中断时状态是否安全？
4. 作用域：跨工作区/跨仓/多实例时数据会不会串台？
<!-- MACHINE-DRAFT:design-boundaries:end -->

<!--AGENT:槽3 盲维四问作答——例外裁决书写面（机器段之外合法） -->
1. 乱序/迟到：change-patch.json 在 flow done 时点冻结，reparse 任何时候读到都是同一份清单；文件晚于 tasks.md 出现不影响（每次解析都重新读全部来源，无跨次状态）。
2. 并发写：只读路径，`json.load` 期间文件被写坏最坏抛 JSONDecodeError → 被 OSError/解析防御捕获按空集处理；与既有 `_MODULE_MAP_CACHE` 的 mtime 复合键缓存无交互（manifest 不进缓存）。
3. 切换/中断：无状态写入，解析失败静默降级为「该来源贡献空集」，不阻塞 reparse 主流程。
4. 作用域：change_dir 是 per-change 独立目录，manifest 天然按变更隔离；workspace 维度的 module-map 已有 (resolved path, mtime) 缓存键防跨工作区串台（既有机制，未动）。

## 风险与死路
<!-- MACHINE-DRAFT:design-risks:03ff22f024c81093b38d2bb78b9d095acf5be70d5c09b17c10da44e4655ddb72:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-09-27-thin-affected-modules-from-patch-manifest 留痕重锚 -->
本方案最大的风险是什么？试过但放弃的方案及放弃理由？
<!-- MACHINE-DRAFT:design-risks:end -->

<!--AGENT:槽4 风险与死路作答——例外裁决书写面（机器段之外合法） -->
最大风险：files 含 CLI 侧冻结的 `.sillyspec/docs/` 交付文档路径（note 声明保留），可能命中文档类模块产生轻微噪声——实测本仓 SillyHub 图无 docs/ 前缀模块，噪声为零，故只滤 `.sillyspec/changes/` 而不扩大滤除面。放弃的方案：①直接读 CLI 新三键 `modules[].id`——id 语义绑定 flow 运行仓的项目图，跨仓无意义，且存量件无此键；②`_load_module_map` 改多图合并——与 CLI 侧 collectModuleMaps 对齐会引入 multi-agent-platform 粗粒度图（`backend/**` 全命中），细粒度结果被粗模块稀释，展示变差。
