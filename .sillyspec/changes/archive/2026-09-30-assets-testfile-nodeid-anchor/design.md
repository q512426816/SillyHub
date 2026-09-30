---
author: flow-machine-draft
created_at: 2026-09-30T01:41:27.826Z
---
# 设计记录（Design Record）— 2026-09-30-assets-testfile-nodeid-anchor

> 四节的「问题」是机器段（指纹保护，勿改）；你的回答写在每节问题下方的 AGENT 槽里。
> 每节至少一行——小改动可写「不适用：<理由>」；flow done 空槽拒收。

## 做法概述
<!-- MACHINE-DRAFT:design-approach:4fa550e9aac26c5f5a3c89b853d9af0ad0749943358808fbc1196064a42c1173:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-09-30-assets-testfile-nodeid-anchor 留痕重锚 -->
本变更怎么解决问题？改哪里、为什么选这个方案（一两段）。
<!-- MACHINE-DRAFT:design-approach:end -->

<!--AGENT:槽1 做法概述作答——例外裁决书写面（机器段之外合法） -->
只改前端读侧归一纯函数 `normalizeTestFilePath`（frontend/src/components/changes/detail/change-assets-card.tsx，2026-09-26-assets-testfile-path-resolve / 2026-09-27-assets-testfile-bracket-note 同一函数的续修）：在既有「」注解剥离之后新增两步——取首个用例锚界符（:: / # / >）之前的路径段，再剥尾部粘联的全角括号注解残段（未闭合截断形与闭合形）。选这个方案因为它就是 2026-09-26-binding-anchor-fidelity 落定契约（tests[] 带锚原样收录、文件面剥锚、展示面保持完整锚点）的读侧补齐——CLI 侧 testAnchorFile 已统一剥锚，平台读侧此前只落了「」一种形态，:: 形整串进 basename 必零命中。TestFileBody 的 basename 派生与 resolveTestFilePath 的等值/后缀比较均消费同一归一结果，一处修改两处生效；不改数据侧（归档 test-trace 是冻结审计件，先例 2026-09-26 摘录保真坑同判不可补）。

## 接口契约
<!-- MACHINE-DRAFT:design-contract:86ee80e3cad9ae1c299a0c54bf5503a112d318bb2e5490a32fcd5c1724293a0b:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-09-30-assets-testfile-nodeid-anchor 留痕重锚 -->
动了哪些函数/端点/命令/文件格式？对外可见的签名或行为变化是什么（含「无」的说明）？
<!-- MACHINE-DRAFT:design-contract:end -->

<!--AGENT:槽2 接口契约作答——例外裁决书写面（机器段之外合法） -->
导出纯函数 normalizeTestFilePath(raw: string): string 行为扩展（签名不变；无 HTTP 端点 / 后端 / 文件格式改动）：输入新增三类可剥形态——:: 起的用例锚段（pytest 节点 ID）、# / > 起的锚段、尾部粘联的全角括号注解残段。对既有输入（纯路径、「」注解、反斜杠与 ./ 写法）输出不变。组件展示面（测试绑定行按钮 label、弹窗标题）仍原样投影完整锚点串，不变。

## 边界与并发（盲维四问——每问必答，答不了即设计缺口）
<!-- MACHINE-DRAFT:design-boundaries:98046ccf043ed9302175b492d297f70dfd943c39f2e8770e8a6039ea302cbb6a:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-09-30-assets-testfile-nodeid-anchor 留痕重锚 -->
1. 乱序/迟到到达：输入或事件乱序时，本设计的假设还成立吗？
2. 并发写：两个执行体同时操作同一数据/文件会发生什么？
3. 切换/生命周期：会话、请求或变更中途切换/中断时状态是否安全？
4. 作用域：跨工作区/跨仓/多实例时数据会不会串台？
<!-- MACHINE-DRAFT:design-boundaries:end -->

<!--AGENT:槽3 盲维四问作答——例外裁决书写面（机器段之外合法） -->
1. 乱序/迟到：不适用事件序——纯字符串归一函数，同一输入恒同一输出。
2. 并发写：无共享可变状态（纯函数）；消费的 test-trace.json 是归档冻结件，读侧从不改写，弹窗每次打开按当前记录串现算。
3. 切换/生命周期：弹窗关闭即弃解析结果，无缓存态残留；explorer search 走 react-query 既有 queryKey（workspaceId+basename），不引入新生命周期。
4. 作用域：按 workspaceId 调 explorer search，与既有实现同域不串台；剥锚只发生在展示归一层，不回写任何持久化数据。

## 风险与死路
<!-- MACHINE-DRAFT:design-risks:03ff22f024c81093b38d2bb78b9d095acf5be70d5c09b17c10da44e4655ddb72:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-09-30-assets-testfile-nodeid-anchor 留痕重锚 -->
本方案最大的风险是什么？试过但放弃的方案及放弃理由？
<!-- MACHINE-DRAFT:design-risks:end -->

<!--AGENT:槽4 风险与死路作答——例外裁决书写面（机器段之外合法） -->
最大风险：锚界符（::/#/>）误伤真实路径片段——若测试文件名本身含这些字符会被截短，但本仓测试文件命名无此形态，且截短后仍有 basename 同名搜索 + 唯一后缀救回兜底，最坏退化为多候选点选而非误报未找到。半角 ( 出现在合法文件名中（如 file(1).py），为降误伤面只剥全角（，半角不剥（本轮实证数据全部为全角）。试过放弃的方案：① 改 test-trace.json 存量数据剥锚——归档件是冻结审计件不可补（先例 2026-09-26 摘录保真坑同判）；② 收紧 CLI 书写约定禁止锚后粘注解——书写契约已由 binding-anchor-fidelity 落定且 CLI 侧已有单源剥锚，重定契约属设计反转，不采纳。
