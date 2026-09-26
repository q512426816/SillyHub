---
author: flow-machine-draft
created_at: 2026-09-26T07:26:45.050Z
---
# 设计记录（Design Record）— 2026-09-26-assets-test-binding-raw-text

> 四节的「问题」是机器段（指纹保护，勿改）；你的回答写在每节问题下方的 AGENT 槽里。
> 每节至少一行——小改动可写「不适用：<理由>」；flow done 空槽拒收。

## 做法概述
<!-- MACHINE-DRAFT:design-approach:4fa550e9aac26c5f5a3c89b853d9af0ad0749943358808fbc1196064a42c1173:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-09-26-assets-test-binding-raw-text 留痕重锚 -->
本变更怎么解决问题？改哪里、为什么选这个方案（一两段）。
<!-- MACHINE-DRAFT:design-approach:end -->

<!--AGENT:槽1 做法概述作答——例外裁决书写面（机器段之外合法） -->
只读展示增强，三件：①后端 ChangeTestRow 加 raw_binding: str | None（schema.py），assets.py 新增 _read_binding_raw_text(change_dir)——读归档 requirements.md，按正则匹配「AGENT:测试绑定(FR-XX)」槽注释行，取其后连续非空内容行拼为原文，返回 {锚点: 原文} 映射；_read_test_rows 增第二参数接收映射填充 raw_binding（锚点缺席 → None）。②规则 21：pnpm gen:types 重生成 api-types.ts + openapi.json 随提交。③前端资产卡测试绑定行下渲染原文小字（raw_binding 与 tests 列表等价时不渲染，避免纯文件级绑定的重复行）。选「读 requirements 原文」而非改摘录器：摘录在 sillyspec CLI（外部工具，已留坑待修），requirements.md 归档件只读解析零审计影响，且对全部存量归档立即生效。

## 接口契约
<!-- MACHINE-DRAFT:design-contract:86ee80e3cad9ae1c299a0c54bf5503a112d318bb2e5490a32fcd5c1724293a0b:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-09-26-assets-test-binding-raw-text 留痕重锚 -->
动了哪些函数/端点/命令/文件格式？对外可见的签名或行为变化是什么（含「无」的说明）？
<!-- MACHINE-DRAFT:design-contract:end -->

<!--AGENT:槽2 接口契约作答——例外裁决书写面（机器段之外合法） -->
GET /changes/{cid}/assets 响应的 test_rows[].raw_binding 新增（string | null，默认 null）；既有字段（row_id/anchor/tests/state）不动，端点签名/路径/鉴权零变化。前端消费新字段，api-types.ts 随 gen:types 再生成。

## 边界与并发（盲维四问——每问必答，答不了即设计缺口）
<!-- MACHINE-DRAFT:design-boundaries:98046ccf043ed9302175b492d297f70dfd943c39f2e8770e8a6039ea302cbb6a:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-09-26-assets-test-binding-raw-text 留痕重锚 -->
1. 乱序/迟到到达：输入或事件乱序时，本设计的假设还成立吗？
2. 并发写：两个执行体同时操作同一数据/文件会发生什么？
3. 切换/生命周期：会话、请求或变更中途切换/中断时状态是否安全？
4. 作用域：跨工作区/跨仓/多实例时数据会不会串台？
<!-- MACHINE-DRAFT:design-boundaries:end -->

<!--AGENT:槽3 盲维四问作答——例外裁决书写面（机器段之外合法） -->
1. 乱序/迟到：requirements.md 是归档冻结件（append-only），聚合每次整读快照，无时序假设；槽缺失/格式漂移 → 映射缺项 → raw_binding=None。
2. 并发写：归档目录 CLI 归档后不再写；assets 是只读聚合（asyncio.to_thread 内同步读文件），无共享可写状态。
3. 切换/生命周期：解析失败 fail-open（log info + None），不影响 test_rows 其余字段与整卡渲染；前端 raw_binding 为 None 行为与现状逐字节一致。
4. 作用域：change_dir 由 change_key 解析（既有逻辑），锚点匹配限定单变更目录内，无跨工作区串面。

## 风险与死路
<!-- MACHINE-DRAFT:design-risks:03ff22f024c81093b38d2bb78b9d095acf5be70d5c09b17c10da44e4655ddb72:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-09-26-assets-test-binding-raw-text 留痕重锚 -->
本方案最大的风险是什么？试过但放弃的方案及放弃理由？
<!-- MACHINE-DRAFT:design-risks:end -->

<!--AGENT:槽4 风险与死路作答——例外裁决书写面（机器段之外合法） -->
最大风险：requirements.md 槽格式是 sillyspec 工具约定（AGENT 注释 + 内容行），工具改版后格式漂移会让正则失配——表现为 raw_binding=None 静默降级（与现状等价，不劣化），且工具坑已留档（test-trace 截断坑里建议摘录保真，若工具侧修了截断，tests 数组本身带用例名，本原文行自然退居补充信息）。试过但放弃：①改摘录器保真——外部 CLI 工具，本项目侧改不了；②前端自行拉归档 requirements.md 展示——归档件在 spec 镜像树，无逐文件读取端点，为展示开新端点收益不成比例。正则锚点取 FR-[A-Za-z0-9-]+ 宽容匹配（含 FR-auto-xxx 等未来形态），内容行截止到下一 <!--AGENT: 或空行。
