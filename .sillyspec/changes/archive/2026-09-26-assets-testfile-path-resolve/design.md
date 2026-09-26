---
author: flow-machine-draft
created_at: 2026-09-26T06:57:07.027Z
---
# 设计记录（Design Record）— 2026-09-26-assets-testfile-path-resolve

> 四节的「问题」是机器段（指纹保护，勿改）；你的回答写在每节问题下方的 AGENT 槽里。
> 每节至少一行——小改动可写「不适用：<理由>」；flow done 空槽拒收。

## 做法概述
<!-- MACHINE-DRAFT:design-approach:4fa550e9aac26c5f5a3c89b853d9af0ad0749943358808fbc1196064a42c1173:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-09-26-assets-testfile-path-resolve 留痕重锚 -->
本变更怎么解决问题？改哪里、为什么选这个方案（一两段）。
<!-- MACHINE-DRAFT:design-approach:end -->

<!--AGENT:槽1 做法概述作答——例外裁决书写面（机器段之外合法） -->
纯展示层修复，两个文件：①`change-assets-card.tsx`——参考知识库页 `normalizeKnowledgeFileParam` 先例，导出同款风格纯函数 `normalizeTestFilePath`（反斜杠→斜杠、去 `./` 前缀）与 `resolveTestFilePath`（归一路径 × search 命中路径集的解析决策：等值 → 唯一后缀 → 排除 `.sillyspec/.runtime/` 副本后再判 → 候选列表/未命中），测试文件弹窗打开时按文件名调既有 `fetchSearch`（explorer GET /search）取命中集，交给纯函数决策后渲染 FilePreview（真实路径）或候选列表/中性提示；路径救回时弹窗标题旁标注原记录路径。②`backend/app/modules/explorer/service.py`——not_found 文案由「工作区目录可能已被移动或删除」改为中性「路径可能不完整，或文件已被移动/删除」（旧文案按整目录被删场景设计，任何寻径失败都套用，误导用户）。选前端解析而非后端 assets 聚合改写：仓库文件在用户本机（daemon 管），后端容器看不到真实仓库，路径探测只能走 explorer RPC，前端两级解析零后端契约变化；且不改归档冻结件（test-trace.json 是审计件，手改路径数据破坏 sha256 锚定链）。

## 接口契约
<!-- MACHINE-DRAFT:design-contract:86ee80e3cad9ae1c299a0c54bf5503a112d318bb2e5490a32fcd5c1724293a0b:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-09-26-assets-testfile-path-resolve 留痕重锚 -->
动了哪些函数/端点/命令/文件格式？对外可见的签名或行为变化是什么（含「无」的说明）？
<!-- MACHINE-DRAFT:design-contract:end -->

<!--AGENT:槽2 接口契约作答——例外裁决书写面（机器段之外合法） -->
无端点/签名增删。前端 `change-assets-card.tsx` 新导出两个纯函数（`normalizeTestFilePath` / `resolveTestFilePath`，仅供测试与组件内用）；弹窗内新增对既有 `GET /api/workspaces/{wid}/explorer/search` 的调用（按文件名，既有端点零改动）。后端仅 explorer not_found 错误的 message 文案变化（code/details 结构不动）。

## 边界与并发（盲维四问——每问必答，答不了即设计缺口）
<!-- MACHINE-DRAFT:design-boundaries:98046ccf043ed9302175b492d297f70dfd943c39f2e8770e8a6039ea302cbb6a:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-09-26-assets-testfile-path-resolve 留痕重锚 -->
1. 乱序/迟到到达：输入或事件乱序时，本设计的假设还成立吗？
2. 并发写：两个执行体同时操作同一数据/文件会发生什么？
3. 切换/生命周期：会话、请求或变更中途切换/中断时状态是否安全？
4. 作用域：跨工作区/跨仓/多实例时数据会不会串台？
<!-- MACHINE-DRAFT:design-boundaries:end -->

<!--AGENT:槽3 盲维四问作答——例外裁决书写面（机器段之外合法） -->
1. 乱序/迟到：search 是一次性请求，解析决策是纯函数（归一路径 × 命中集快照），无时序假设；search 失败（daemon 离线/权限）兜底用原路径直开 FilePreview 呈现 explorer 侧真实错误（评审 P2② 收口：与槽4 及实现一致，不按零命中吞成中性文案）。
2. 并发写：只读消费（search + file 预览两个 GET），无共享可写状态；仓库文件在解析与预览之间被删/移动，FilePreview 自身错误面兜底（既有行为）。
3. 切换/生命周期：弹窗关闭清 testPath 态，react-query 缓存按 (workspaceId, 关键词) 键控，重复打开同文件不重复请求；变更删除/切换工作区时组件随页面卸载，无悬挂写。
4. 作用域：search 调用带 workspaceId（路由参数），命中路径相对该工作区根；后缀匹配在同一命中集内判定，无跨工作区串面。

## 风险与死路
<!-- MACHINE-DRAFT:design-risks:03ff22f024c81093b38d2bb78b9d095acf5be70d5c09b17c10da44e4655ddb72:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-09-26-assets-testfile-path-resolve 留痕重锚 -->
本方案最大的风险是什么？试过但放弃的方案及放弃理由？
<!-- MACHINE-DRAFT:design-risks:end -->

<!--AGENT:槽4 风险与死路作答——例外裁决书写面（机器段之外合法） -->
最大风险：短路径后缀匹配救错文件——同 basename 的测试文件在仓库多个模块存在且都非 `.sillyspec/.runtime/` 前缀时（如 frontend 与 backend 各一个同名测试），后缀匹配多命中已降级为候选列表由用户选，不自动猜；唯一后缀命中才自动救回，且救回时弹窗明示真实路径 + 原记录路径，用户可察觉错配。试过但放弃：①直接修归档件 test-trace.json 的路径数据——放弃，审计件 sha256 锚定链会被破坏，且同类短路径在其它归档变更可能重复出现，逐个修数据不如展示层统一兜底；②后端 assets 聚合时归一——放弃，后端容器无真实仓库文件系统，探测必须走 daemon RPC，等价于把解析搬到后端但多一跳契约变化，收益不成比例。搜索端点按文件名子串匹配（RPC 60s 超时）大仓性能由 explorer 既有实现承载，本变更只新增弹窗打开时的一次调用。
