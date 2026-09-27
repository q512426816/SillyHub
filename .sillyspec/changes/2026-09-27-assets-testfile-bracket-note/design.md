---
author: flow-machine-draft
created_at: 2026-09-27T10:06:59.928Z
---
# 设计记录（Design Record）— 2026-09-27-assets-testfile-bracket-note

> 四节的「问题」是机器段（指纹保护，勿改）；你的回答写在每节问题下方的 AGENT 槽里。
> 每节至少一行——小改动可写「不适用：<理由>」；flow done 空槽拒收。

## 做法概述
<!-- MACHINE-DRAFT:design-approach:4fa550e9aac26c5f5a3c89b853d9af0ad0749943358808fbc1196064a42c1173:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-09-27-assets-testfile-bracket-note 留痕重锚 -->
本变更怎么解决问题？改哪里、为什么选这个方案（一两段）。
<!-- MACHINE-DRAFT:design-approach:end -->

<!--AGENT:槽1 做法概述作答——例外裁决书写面（机器段之外合法） -->
在 frontend/src/components/changes/detail/change-assets-card.tsx 的 normalizeTestFilePath 追加一步「」注解段剥离（/「[^」]*」/g 全局移除后再 trim）。该函数是测试文件路径解析的唯一归一入口：resolveTestFilePath 的等值/后缀比较与 TestFileBody 的 basename→explorer search 查询串都取自它的输出，一处剥离即同时修正搜索入参与比较基准。选前端归一而非改 sillyspec CLI 的 test-trace 产物：CLI 修复只能救未来记录，存量已冻结数据（如 sillyspec 仓 2026-09-27-ui-visual-guidance 归档件）里「路径「用例描述」」粘联只能靠读侧容错救回，与既有短路径/反斜杠归一同层同性质。

## 接口契约
<!-- MACHINE-DRAFT:design-contract:86ee80e3cad9ae1c299a0c54bf5503a112d318bb2e5490a32fcd5c1724293a0b:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-09-27-assets-testfile-bracket-note 留痕重锚 -->
动了哪些函数/端点/命令/文件格式？对外可见的签名或行为变化是什么（含「无」的说明）？
<!-- MACHINE-DRAFT:design-contract:end -->

<!--AGENT:槽2 接口契约作答——例外裁决书写面（机器段之外合法） -->
导出纯函数 normalizeTestFilePath(raw) 行为变化：输出额外剥离「…」注解段（一段或多段，含全串皆注解时输出空串——空串在 resolveTestFilePath 既有分支按 notfound 处理）。无端点/文件格式/后端改动；explorer search 请求的查询串从「文件名+注解」变为干净文件名。导出签名不变。

## 边界与并发（盲维四问——每问必答，答不了即设计缺口）
<!-- MACHINE-DRAFT:design-boundaries:98046ccf043ed9302175b492d297f70dfd943c39f2e8770e8a6039ea302cbb6a:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-09-27-assets-testfile-bracket-note 留痕重锚 -->
1. 乱序/迟到到达：输入或事件乱序时，本设计的假设还成立吗？
2. 并发写：两个执行体同时操作同一数据/文件会发生什么？
3. 切换/生命周期：会话、请求或变更中途切换/中断时状态是否安全？
4. 作用域：跨工作区/跨仓/多实例时数据会不会串台？
<!-- MACHINE-DRAFT:design-boundaries:end -->

<!--AGENT:槽3 盲维四问作答——例外裁决书写面（机器段之外合法） -->
1. 乱序/迟到：不适用——纯同步字符串归一，无事件序。2. 并发写：不适用——只读输入串，无共享可变状态。3. 切换/生命周期：弹窗每次打开用当次 rawPath 现算，无跨打开缓存（queryKey 含 basename，归一后 key 稳定）。4. 作用域：归一同时应用于记录路径与 explorer 命中集两侧，比较口径一致，不因工作区不同而串台；「」在测试文件真实路径中出现的概率可忽略（项目测试绑定约定用「」作用例名注解）。

## 风险与死路
<!-- MACHINE-DRAFT:design-risks:03ff22f024c81093b38d2bb78b9d095acf5be70d5c09b17c10da44e4655ddb72:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-09-27-assets-testfile-bracket-note 留痕重锚 -->
本方案最大的风险是什么？试过但放弃的方案及放弃理由？
<!-- MACHINE-DRAFT:design-risks:end -->

<!--AGENT:槽4 风险与死路作答——例外裁决书写面（机器段之外合法） -->
最大风险：真实文件名含「」字符会被误剥——测试绑定约定「」为用例名注解语法，且仓库实测无此类测试文件名，接受该权衡并在函数注释言明。放弃方案 a：改 sillyspec CLI 的 flow done 补全解析（tests[] 只存纯路径）——治本但属另一仓库存量数据救不回，已按规则 15 记 docs/sillyspec/ 活跃坑；放弃方案 b：只在 TestFileBody 局部剥——resolveTestFilePath 的 norm 与搜索入参两处口径会分裂，故统一在归一函数做。
