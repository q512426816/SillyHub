---
author: flow-machine-draft
created_at: 2026-10-12T01:40:38.181Z
---
# 提案书（Proposal）— 2026-10-12-duration-nan-guard

## 动机

任务原话转写：动机：24h 风险审查 P3——daemon.ts:4015 duration_api_ms 差分只做 typeof==='number' 门（NaN/Infinity 均通过），同函数上方 total_cost_usd（约 :3988）有 Number.isFinite 守卫，口径不对称；SDK 若报非有限值，NaN 参与差分比较恒 false、结果序列化为 null，backend duration_api_ms: int|None 静默吞掉，终态 tok/s 分母缺失且无日志痕迹。
成功标准：
- duration_api_ms 差分入口改 Number.isFinite 门控（对齐同函数 total_cost_usd 既有口径），非有限值不进基线读写、payload 不携带该键（或保持 undefined 语义与既有「SDK 未报」路径一致），零新日志面
- 新增用例先红后绿：duration_api_ms=NaN 时 payload 不含 duration_api_ms 键且基线 Map 不被污染（后续合法值差分仍正确）；既有 duration 差分用例全绿
- 仅跑本改动相关测试（规则 0）：sillyhub-daemon/tests/daemon-interactive-bridge.test.ts 全文件

## 变更范围

按成功标准机械推导，共 3 条验收面：
1. duration_api_ms 差分入口改 Number.isFinite 门控（对齐同函数 total_cost_usd 既有口径），非有限值不进基线读写、payload 不携带该键（或保持 undefined 语义与既有「SDK 未报」路径一致），零新日志面
2. 新增用例先红后绿：duration_api_ms=NaN 时 payload 不含 duration_api_ms 键且基线 Map 不被污染（后续合法值差分仍正确）；既有 duration 差分用例全绿
3. 仅跑本改动相关测试（规则 0）：sillyhub-daemon/tests/daemon-interactive-bridge.test.ts 全文件

## 成功标准（可验证）

1. duration_api_ms 差分入口改 Number.isFinite 门控（对齐同函数 total_cost_usd 既有口径），非有限值不进基线读写、payload 不携带该键（或保持 undefined 语义与既有「SDK 未报」路径一致），零新日志面
2. 新增用例先红后绿：duration_api_ms=NaN 时 payload 不含 duration_api_ms 键且基线 Map 不被污染（后续合法值差分仍正确）；既有 duration 差分用例全绿
3. 仅跑本改动相关测试（规则 0）：sillyhub-daemon/tests/daemon-interactive-bridge.test.ts 全文件
