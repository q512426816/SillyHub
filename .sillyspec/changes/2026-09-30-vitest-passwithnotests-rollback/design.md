---
author: flow-machine-draft
created_at: 2026-09-30T08:51:56.126Z
---
# 设计记录（Design Record）— 2026-09-30-vitest-passwithnotests-rollback

> 四节的「问题」是机器段（指纹保护，勿改）；你的回答写在每节问题下方的 AGENT 槽里。
> 每节至少一行——小改动可写「不适用：<理由>」；flow done 空槽拒收。

## 做法概述
<!-- MACHINE-DRAFT:design-approach:4fa550e9aac26c5f5a3c89b853d9af0ad0749943358808fbc1196064a42c1173:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-09-30-vitest-passwithnotests-rollback 留痕重锚 -->
本变更怎么解决问题？改哪里、为什么选这个方案（一两段）。
<!-- MACHINE-DRAFT:design-approach:end -->

<!--AGENT:槽1 做法概述作答——例外裁决书写面（机器段之外合法） -->
sillyspec 仓依赖推断三缺陷已修复（用户授权，npm link 直连源码即时生效）：①依赖命中剥注释后匹配（字符串感知状态机——注释里的路径字面引用不再算依赖边）②isTestFilePath 正则补 jsx|tsx（自家 .test.tsx 进依赖面）③jsProject 批过滤 e2e/cypress 端到端目录（进 skip 批留痕不产命令）。三路验证：sillyspec 仓新 8 用例 + 受影响既有 31 用例全绿；原始失败面批组成复算（两路都不再产生 vitest run e2e/auth.spec.ts，真实测试入跑面）；门禁函数端到端（deps(auto-jsx) 实跑全绿 + e2e 走披露式 skip）。故本仓撤掉 passWithNoTests 兜底（恢复正常空收集报错语义），缺陷文档移 finished/ 附处置记录。

## 接口契约
<!-- MACHINE-DRAFT:design-contract:86ee80e3cad9ae1c299a0c54bf5503a112d318bb2e5490a32fcd5c1724293a0b:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-09-30-vitest-passwithnotests-rollback 留痕重锚 -->
动了哪些函数/端点/命令/文件格式？对外可见的签名或行为变化是什么（含「无」的说明）？
<!-- MACHINE-DRAFT:design-contract:end -->

<!--AGENT:槽2 接口契约作答——例外裁决书写面（机器段之外合法） -->
frontend/vitest.config.ts 移除 test.passWithNoTests（其余配置零改动）；docs/sillyspec/dynamic-deps-e2e-vitest-exclude-false-red.md → docs/sillyspec/finished/（追加处置记录）。无后端/接口/文件格式变化。

## 边界与并发（盲维四问——每问必答，答不了即设计缺口）
<!-- MACHINE-DRAFT:design-boundaries:98046ccf043ed9302175b492d297f70dfd943c39f2e8770e8a6039ea302cbb6a:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-09-30-vitest-passwithnotests-rollback 留痕重锚 -->
1. 乱序/迟到到达：输入或事件乱序时，本设计的假设还成立吗？
2. 并发写：两个执行体同时操作同一数据/文件会发生什么？
3. 切换/生命周期：会话、请求或变更中途切换/中断时状态是否安全？
4. 作用域：跨工作区/跨仓/多实例时数据会不会串台？
<!-- MACHINE-DRAFT:design-boundaries:end -->

<!--AGENT:槽3 盲维四问作答——例外裁决书写面（机器段之外合法） -->
1. 乱序/迟到：静态配置回滚 + 文档移动，无事件流，不适用。
2. 并发写：单仓单会话顺序编辑，不适用。
3. 切换/生命周期：vitest 配置为构建期静态读取，无运行态残留；文档移动为 git rename。
4. 作用域：配置回滚影响 frontend 包自身测试语义（恢复 vitest 默认——显式过滤无匹配时 exit 1），该语义恢复正是本变更目的；缺陷文档移 finished/ 只影响知识检索位置，docs/sillyspec/finished/ 为既有惯例目录。

## 风险与死路
<!-- MACHINE-DRAFT:design-risks:03ff22f024c81093b38d2bb78b9d095acf5be70d5c09b17c10da44e4655ddb72:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-09-30-vitest-passwithnotests-rollback 留痕重锚 -->
本方案最大的风险是什么？试过但放弃的方案及放弃理由？
<!-- MACHINE-DRAFT:design-risks:end -->

<!--AGENT:槽4 风险与死路作答——例外裁决书写面（机器段之外合法） -->
最大风险：若 sillyspec 修复未生效（CLI 未链接源码）而撤掉兜底会复现假红——已核实 npm ls -g sillyspec 指向 C:/Users/qinyi/IdeaProjects/sillyspec（npm link），且撤除前用原始失败面在修复后源码上复跑门禁函数确认全绿，风险已消除。试过放弃的方案：保留 passWithNoTests 作为双保险——放弃理由：它会掩盖未来真正错误的空收集（如过滤条件写错时 CI 静默通过），兜底价值低于语义保真。
