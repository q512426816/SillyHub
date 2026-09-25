---
author: flow-machine-draft
created_at: 2026-09-25T09:50:43.826Z
---
# 设计记录（Design Record）— 2026-09-25-daemon-hits-upload-fingerprint

> 四节的「问题」是机器段（指纹保护，勿改）；你的回答写在每节问题下方的 AGENT 槽里。
> 每节至少一行——小改动可写「不适用：<理由>」；flow done 空槽拒收。

## 做法概述
<!-- MACHINE-DRAFT:design-approach:4fa550e9aac26c5f5a3c89b853d9af0ad0749943358808fbc1196064a42c1173:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-09-25-daemon-hits-upload-fingerprint 留痕重锚 -->
本变更怎么解决问题？改哪里、为什么选这个方案（一两段）。
<!-- MACHINE-DRAFT:design-approach:end -->

<!--AGENT:槽1 做法概述作答——例外裁决书写面（机器段之外合法） -->
在 `sillyhub-daemon/src/knowledge-hits-upload.ts` 落「行数 + 行指纹」双断点：状态文件
`~/.sillyhub/daemon/.hits-upload-state-{wsId}.json` 在 `uploadedLines` 之外新增 `tailHash`
（已上行最后一行的 sha256，`node:crypto` 本地计算，与服务端行级唯一约束的 line_hash 同源算法）；
每批上行成功后随行数一起 `writeFileAtomic` 落盘。每轮上报前先比对：行数未超前、但
`completeLines[uploadedLines-1]` 的指纹 ≠ 记录值 → 判定「文件被重置/替换后又长回旧行数」，
回退 offset=0 从头重报（服务端 (workspace_id, line_hash) 唯一约束幂等，旧行重报零重复入库）。

选这个方案的原因：纯行数 offset 的盲区在「替换后长过旧 offset」——钳位分支只在文件**短于**
offset 时触发，重置文件重新长过 3389 行后新文件前 3389 行被静默跳过、永久丢报；而服务端
本来就是行级 hash 去重，重报免费，行数口径没有理由拒绝指纹自愈。指纹只存本地状态文件、
不进 hits 载荷，协议面零变化。


## 接口契约
<!-- MACHINE-DRAFT:design-contract:86ee80e3cad9ae1c299a0c54bf5503a112d318bb2e5490a32fcd5c1724293a0b:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-09-25-daemon-hits-upload-fingerprint 留痕重锚 -->
动了哪些函数/端点/命令/文件格式？对外可见的签名或行为变化是什么（含「无」的说明）？
<!-- MACHINE-DRAFT:design-contract:end -->

<!--AGENT:槽2 接口契约作答——例外裁决书写面（机器段之外合法） -->
改动文件：`sillyhub-daemon/src/knowledge-hits-upload.ts`（状态结构 + 读写 helper + 主循环）、
`sillyhub-daemon/tests/knowledge-hits-upload.test.ts`（新增 3 用例）。

对外可见：**协议零变化**——`postKnowledgeHitsBatch(wsId, lines)` 的请求/响应、批大小上限、
best-effort 语义（失败不抛、不动断点、不阻塞 postSpecSync）全部不变；变的是**本地断点状态文件
多一个 `tailHash` 键**（旧 daemon 升级后读到无键状态按 legacy 处理，见下）与两个新行为：
① 文件被替换后自动全量重报（此前静默丢报）；② 状态文件形状从 `{uploadedLines, updated_at}`
变为 `{uploadedLines, tailHash, updated_at}`（向后兼容读）。


## 边界与并发（盲维四问——每问必答，答不了即设计缺口）
<!-- MACHINE-DRAFT:design-boundaries:98046ccf043ed9302175b492d297f70dfd943c39f2e8770e8a6039ea302cbb6a:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-09-25-daemon-hits-upload-fingerprint 留痕重锚 -->
1. 乱序/迟到到达：输入或事件乱序时，本设计的假设还成立吗？
2. 并发写：两个执行体同时操作同一数据/文件会发生什么？
3. 切换/生命周期：会话、请求或变更中途切换/中断时状态是否安全？
4. 作用域：跨工作区/跨仓/多实例时数据会不会串台？
<!-- MACHINE-DRAFT:design-boundaries:end -->

<!--AGENT:槽3 盲维四问作答——例外裁决书写面（机器段之外合法） -->
1. **乱序/迟到到达**：断点只由「批成功」推进且每批原子写；指纹比对在每轮读文件后独立执行，与行到达顺序无关。半行（无换行尾行）仍留下轮，语义不变。
2. **并发写**：上传钩子挂在 postSpecSync 汇聚点、单 daemon 进程内串行（与既有设计一致）；CLI append 与 daemon 读是 append-only 文件 + 「只报完整行」断言，指纹不改变该并发模型。两个 daemon 实例并发上行同一工作区时，服务端行级唯一约束仍是最终幂等防线（既有 D-007，本变更不扩大该面——两实例状态文件同路径本就是既有前提）。
3. **切换/生命周期**：状态文件原子写（tmp+rename），批成功与断点推进之间进程被杀 → 断点停在上一批，下轮重报该批由服务端去重吸收（既有语义，指纹同此）；替换检测回退 0 后被杀 → 状态未写、下轮重新检测（幂等）。
4. **作用域**：状态文件按 wsId 隔离（既有）；指纹只比对本地文件内容，不跨工作区；`tailHash` 不进网络载荷，无跨端串台面。


## 风险与死路
<!-- MACHINE-DRAFT:design-risks:03ff22f024c81093b38d2bb78b9d095acf5be70d5c09b17c10da44e4655ddb72:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-09-25-daemon-hits-upload-fingerprint 留痕重锚 -->
本方案最大的风险是什么？试过但放弃的方案及放弃理由？
<!-- MACHINE-DRAFT:design-risks:end -->

<!--AGENT:槽4 风险与死路作答——例外裁决书写面（机器段之外合法） -->
**最大风险**：指纹误判（append-only 正常路径被误判为「替换」）触发整文件重报——最坏代价是
一次全量重报被服务端 hash 去重吸收（duplicates 计数升高，无数据错误）；「已上行最后一行」
在 append-only 语义下永不变内容，误判面只在文件被外部改写时出现，而那正是要检测的场景。

**次生风险**：legacy 状态（存量 daemon 的 `{uploadedLines}` 无 tailHash）升级后首轮不识别替换
——设计上明确**不误重报**（tailHash=null 跳过比对，维持行数口径），首轮成功后指纹落盘、
次轮起具备替换检测能力；这是一次性、可接受的过渡窗口。

**试过但放弃的方案**：
1. 行数超钳位（现有分支）扩成「钳位即回退 0 全量重报」——只覆盖文件变短的形态，长回旧 offset 的形态仍漏；且改变既有钳位测试钉住的「钳位轮零上行」语义。
2. 状态文件存全量行 hash 清单（每行都记）——断点文件随 hits 无界增长，违背「轻量本地断点」定位；只记尾行指纹即可覆盖「替换后长回」的判别需求。
3. 服务端把 duplicates 从 warn 升格为错误防止重报风暴——重报本来就是设计内的幂等路径，升格会让正常自愈失败；不动。

## 文件变更清单

- sillyhub-daemon/src/knowledge-hits-upload.ts
- sillyhub-daemon/tests/knowledge-hits-upload.test.ts
