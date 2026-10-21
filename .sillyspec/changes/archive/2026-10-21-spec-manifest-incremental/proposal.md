---
author: flow-machine-draft
created_at: 2026-10-21T12:57:03.654Z
---
# 提案书（Proposal）— 2026-10-21-spec-manifest-incremental

## 动机

任务原话转写：spec-manifest 增量游标同步
动机：CLI 每条命令全量拉 spec-manifest（实测 2.2MB/13145 行、5.5s@400KBps 链路），单请求吃掉 sillyspec 同步 8s 总预算七成，导致熔断告警与 409 自回声连锁；清单随变更历史无界增长。方案：spec-manifest 加 since 游标增量返回变化行（用户批准的 A 方案）。

成功标准：
- GET /api/changes/-/spec-manifest?since=<spec_version> 只返回该版本之后变化的清单行，响应含当前 spec_version
- 无 since 参数时行为与现状一致（响应仅新增 spec_version 字段，向后兼容）
- apply_ops 落地/软删的清单行携带可游标过滤的版本印记
- 既有相关测试全绿，新增用例覆盖增量/全量/软删/边界
- 稳态清单请求 <1s（配 CLI 侧缓存后达成，本变更提供服务端能力）

## 变更范围

按成功标准机械推导，共 5 条验收面：
1. GET /api/changes/-/spec-manifest?since=<spec_version> 只返回该版本之后变化的清单行，响应含当前 spec_version
2. 无 since 参数时行为与现状一致（响应仅新增 spec_version 字段，向后兼容）
3. apply_ops 落地/软删的清单行携带可游标过滤的版本印记
4. 既有相关测试全绿，新增用例覆盖增量/全量/软删/边界
5. 稳态清单请求 <1s（配 CLI 侧缓存后达成，本变更提供服务端能力）

## 成功标准（可验证）

1. GET /api/changes/-/spec-manifest?since=<spec_version> 只返回该版本之后变化的清单行，响应含当前 spec_version
2. 无 since 参数时行为与现状一致（响应仅新增 spec_version 字段，向后兼容）
3. apply_ops 落地/软删的清单行携带可游标过滤的版本印记
4. 既有相关测试全绿，新增用例覆盖增量/全量/软删/边界
5. 稳态清单请求 <1s（配 CLI 侧缓存后达成，本变更提供服务端能力）
