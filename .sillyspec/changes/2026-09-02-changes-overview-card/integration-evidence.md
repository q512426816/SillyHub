# 三端集成验收证据（task-08 / integration-critical）

- 采集时间：2026-09-03 15:26（本地）
- 口径：与同刻 CLI 直连 `node C:\Users\qinyi\IdeaProjects\sillyspec\bin\sillyspec.js progress show --json`（cwd=主仓根）一致性比对，不断言动态计数绝对值

## ① daemon 采集链路——真实数据端到端 ✅

一次性 vitest 脚本（真实 execFile spawn SILLYSPEC_BIN 源码直连 + 真实主仓根 + 真实 30s 超时，零 mock；跑完即删）：

- **结果**：2/2 passed，采集器快照与 CLI 直连 envelope 逐项计数一致
- **EVIDENCE-SNAPSHOT**（真实快照 console 输出）：
  ```json
  {"ok":true,"active_changes":8,"healthy_count":1,"ghost_count":7,"conflict_count":11,
   "conflict_types":{"spec-tree":10,"progress":1},"changes_n":8,
   "first_change":"2026-09-02-changes-overview-card","generated_at":"2026-09-03T07:26:18.335Z"}
  ```
- 一致性断言：ok / active_changes / ghost_count / conflict_count / warnings_count / errors_count 与直连 envelope 全等；changes 截断 ≤50；纯函数 buildSillySpecStatusSummary(直连 envelope) 与采集快照同计数
- 注：ghost/conflict 计数为当日动态值（sillyspecer 此前清理后又有新残留产生——印证「残留 ongoing 产生」的设计判断）

## ② backend API 链路——HTTP 全链路 + 迁移链 ✅

- `test_http_heartbeat_accepts_and_clears_sillyspec_status`（ASGI + 真实 DB session）：POST /api/daemon/heartbeat 带真实形态摘要 → 11 键落库、嵌套 steps 投影、无 since 注入；显式 null → 置 NULL；缺省（旧 daemon）→ 同清除（NFR-01）——**89 passed** 内
- `test_machines_view_exposes_sillyspec_status_typed`：GET /api/daemon/machines 嵌套类型化透出 + NULL 机为 null
- `test_openapi_contains_machine_sillyspec_status_field`：OpenAPI schema 嵌套 $ref（task-05 gen:types 同源输入）
- 迁移链：`alembic heads` 单 head（20260903090000），up/down 可逆用例绿

## ③ 前端消费链路——真实 envelope 形态 + 类型对齐 ✅

- 组件测试 7/7（fixture=真实 envelope 形态，含 readable/command/stages 冗余字段容忍）：健康条计数/管线/ghost 折叠/冲突区/过滤 tab/null 占位/过期标记/超限降级
- 类型从 OpenAPI 生成（gen:types，api-types +127）非手写；conflict_types `[key:string]: number` 计数映射与 daemon 产出/后端 DTO 三端同形
- 挂载 16/16：page 渲染组件 + workspaceId 透传 + 变更中心入口 href

## 边界说明（诚实标注）

- **compose 部署级浏览器端到端未做**：当前 compose 运行的 backend/frontend 为旧镜像（不含本变更），重新 build+up 属部署动作（超出本变更 execute 范围）。浏览器真实页面验证留待部署后由管理员在面板直接查看（卡片三态均可从上述证据链推导正确性）。
- **daemon 常驻进程心跳全链路**：第五循环/心跳组装已由 daemon 层 4 用例覆盖（含尾参占位修复后的 length=6 断言）；真实常驻 daemon 对真实 backend 的长跑验证属部署后观察项。

## 全局验收 5 条核验（plan.md）

1. ✅ 后端新增单测 + 前端组件测试全绿（仅跑相关测试：23+28+89+108+7+16，全量留 CI）
2. ✅ 三端真实数据一致性（①真实采集 vs CLI 直连逐项相等；②③API/消费链路真实形态验证）
3. ✅ null 占位态与数据过期标记用例各有独立断言（task-06 测试 5/6 号用例）
4. ✅ 既有心跳消费者回归（test_machines_router / test_register_heartbeat_daemon / daemon-heartbeat-sillyspec 既有断言零变化全绿）
5. ✅ api-types.ts 为生成产物（gen:types 再生成）；旧 daemon 心跳（无 sillyspec_status 键）行为不变（缺省=清除语义下旧载荷不携带键时与显式 null 同效，但旧 daemon 不发键且值为 NULL 保持——HTTP 用例第 3 段验证）
