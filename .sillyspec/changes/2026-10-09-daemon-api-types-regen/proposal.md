---
author: flow-machine-draft
created_at: 2026-10-08T17:54:21.610Z
---
# 提案书（Proposal）— 2026-10-09-daemon-api-types-regen

## 动机

任务原话转写：动机：24 小时风险审查发现 sillyhub-daemon/src/api-types.ts 仍是旧 72 项 Permission 联合（含 2026-10-08 rbac 清理已删的 16 个死键），backend/openapi.json 已是 58 项——该副本落后多轮后端契约（含知识图谱端点），且 CI 无 gen:types 守门兜底，违反规则 21「生成物不落后后端」精神。

成功标准：
- sillyhub-daemon/src/api-types.ts 从仓库 backend/openapi.json 重生成，被删的 16 个死权限字符串零残留
- daemon tsc --noEmit 0 error（生成物为纯类型面，编译门即验证门）
- 除生成文件外零手写代码改动

## 变更范围

按成功标准机械推导，共 3 条验收面：
1. sillyhub-daemon/src/api-types.ts 从仓库 backend/openapi.json 重生成，被删的 16 个死权限字符串零残留
2. daemon tsc --noEmit 0 error（生成物为纯类型面，编译门即验证门）
3. 除生成文件外零手写代码改动

## 成功标准（可验证）

1. sillyhub-daemon/src/api-types.ts 从仓库 backend/openapi.json 重生成，被删的 16 个死权限字符串零残留
2. daemon tsc --noEmit 0 error（生成物为纯类型面，编译门即验证门）
3. 除生成文件外零手写代码改动
