---
author: flow-machine-draft
created_at: 2026-10-09T20:10:00.000Z
---
# 设计记录（Design Record）— 2026-10-09-graph-text-backslash

## 做法概述

本变更怎么解决问题？改哪里、为什么选这个方案（一两段）。

单字符集补丁：GRAPH_TEXT_BLACKLIST_RE 在既有元字符全集外补 `\`，并新增 ②b 测试用例（反斜杠三形态 × 三参数位，全部断言 validation_rejected + 零 spawn）。机理：graph 拼串把锚点包进双引号，尾反斜杠会转义闭合引号，POSIX shell 把后续旗标吞进锚点参数——命令分隔符（;|&`$() 等）均已在黑名单内故无命令注入面，后果限于 CLI 收到粘连参数报错 → 回 internal（stderr 截 500），属消毒面完整性加固。选字符级拒绝而非引号转义处理：正常节点 id 字符集（/ # : @ - _ . 中文）不含反斜杠（实测样本），字符级拒绝与既有 9 类元字符消毒语义同构，不引入「哪些位置的反斜杠才危险」的判定复杂度。

## 接口契约

动了哪些函数/端点/命令/文件格式？对外可见的签名或行为变化是什么（含「无」的说明）？

- `sillyhub-daemon/src/runtime-handler.ts`：GRAPH_TEXT_BLACKLIST_RE 常量字符集 +1 字符（\）；sanitizeGraphText 行为变化=含反斜杠的 anchor/anchor2/search 从放行变 validation_rejected。函数签名零变化。
- 测试文件新增 ②b 用例。
- 后端 / 前端 / RPC schema：零变化（validation_rejected 是既有回码形态，backend 信封已按 reason 翻译）。

## 边界与并发（盲维四问——每问必答，答不了即设计缺口）

1. 乱序/迟到到达：输入或事件乱序时，本设计的假设还成立吗？

不适用：消毒是同步纯判定（regex test），发生在拼串/spawn 之前，无时序面。

2. 并发写：两个执行体同时操作同一数据/文件会发生什么？

不适用：模块级只读正则常量，无共享可变态。

3. 切换/生命周期：会话、请求或变更中途切换/中断时状态是否安全？

安全：拒绝路径抛 RpcError 走既有 _dispatchRpc 回码链，无半态。

4. 作用域：跨工作区/跨仓/多实例时数据会不会串台？

不适用：字符级判定与工作区/路径无关；root containment 二道校验保持独立。

## 风险与死路

本方案最大的风险是什么？试过但放弃的方案及放弃理由？

最大风险：合法锚点若含反斜杠会被误拒——已核正常节点 id 字符集（/ # : @ - _ . 与中文，实测样本 decision:decisions/x.md#D-1@v1、src/foo.js、FR-core-engine-001）零含反斜杠，Windows 路径形态锚点本就带 : 与 \ 会被拒，但该形态从不在合法锚点域（用例 ③ 钉住放行面）。试过放弃：(a) 拼串侧对反斜杠做 shell 转义——放弃，黑名单字符级拒绝是与既有 9 类元字符同构的消毒语义，混入转义逻辑引入「部分放行」面；(b) 只拒尾反斜杠——放弃，字符级黑名单无法表达位置语义且中缀形态同样可疑，全拒更保守一致。

## 文件变更清单

| 操作 | 路径 | 说明 |
| --- | --- | --- |
| 修改 | sillyhub-daemon/src/runtime-handler.ts | GRAPH_TEXT_BLACKLIST_RE 补 \ + 注释 |
| 修改 | sillyhub-daemon/tests/knowledge-governance-handler.test.ts | ②b 反斜杠样本矩阵用例 |
