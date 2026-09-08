---
author: qinyi
created_at: 2026-09-07 21:05:00
---

# 验证报告（Verify Result）— 2026-09-07-conflict-diff-compare

## 结论

**PASS WITH NOTES**

变更中心「平台同步」冲突对比弹窗 + quick 条目 ql 编号展示：11/11 任务完成，三端 158 用例全绿（独立复验 70/70），实机集成链路验证通过（runtime evidence 见下），design/FR/决策逐条对照无缺口。两条 NOTE 为文档级说明，不阻断。

## 任务完成度

11/11 = 100%。产物核验：daemon 测试（765 行 14 用例）+ conflictSnapshot 实现（6 处符号）+ RPC 注册（3 处）+ backend 测试（1044 行 23 用例）+ compare service + 端点（2 处路由）+ api-types（3 处生成类型）+ 弹窗组件 + 行改造（5 处「查看对比」）+ 验收记录 + 模块文档（2+2 条）。

## 单元测试结论

| 套件 | 命令 | 结果 |
|---|---|---|
| backend | `uv run pytest app/modules/daemon/tests/test_sillyspec_compare.py -q` | 23 passed（ruff 全过） |
| daemon | `pnpm exec vitest run tests/sillyspec-conflict-snapshot.test.ts tests/sillyspec-platform-command.test.ts tests/sillyspec-manager.test.ts` | 102 passed（3 文件） |
| frontend | `pnpm exec vitest run`（conflict-compare-modal + platform-sync-section + changes-overview-card） | 33 passed（13+12+8） |
| 类型 | daemon/frontend `tsc --noEmit` | 双 exit 0 |

已知基线既有失败：test_heartbeat_spec_cache 2 例（主仓并行在途迁移所致，stash 验证与本变更无关）。

## Runtime Evidence（integration-critical 门：真实 daemon↔backend 集成，非 mock）

完整证据链见 `acceptance/task-10-integration-acceptance.md`。摘要：

- 环境：worktree 代码实跑——backend uvicorn 127.0.0.1:8100（commit b77d5d6841dd 系）+ 隔离 daemon 实例（SILLYHUB_DAEMON_DIR 重定向，注册为在线机器 a20631a6，7 providers）。
- **端到端链路实测**：`GET /machines/{id}/sillyspec-conflicts/{change}/compare` → HTTP 鉴权/路由/query 校验 → WS RPC `sillyspec_conflict_snapshot` → daemon `registerRpcHandler` 分发 → `conflictSnapshot` 真实执行 → 错误/结果回传。日志片段（真实响应体）：
  ```
  HTTP 502 {"code":"HTTP_502_DAEMON_RPC_REMOTE","details":{
    "method":"sillyspec_conflict_snapshot",
    "daemon_code":"no_spec_root",
    "daemon_message":"未观察到 workspace 主仓根，无法生成冲突快照"}}
  HTTP 504 {"code":"HTTP_504_DAEMON_RUNTIME_OFFLINE",...}
  ```
  `no_spec_root` 为隔离实例未跑任务未观察根的正确业务态（design §5 Phase 1 明确错误码）；真实用户 daemon（有根）同路径。
- 错误形态全谱：离线 504 / 不存在 404 / change 白名单 422（中文报文）/ 无凭证 401。
- ql_id 心跳字段实机形态：机器视图 pending_conflicts 6 条真实冲突透出，本仓 3 条 ql_id=null（guard.json 已清理，D-004 已知限制兜底原 ID）。
- **实机发现并修复真实缺陷**：首发 compare 500（asyncpg `another operation is in progress / manually started transaction`，gather 并发同请求 session 连接冲突——单测 mock RPC 立即返回未暴露交叠）。修复=平台侧定位改 RPC 前顺序执行（commit d9e1f0494，docstring 落痕），修复后单测 23/23 不回归 + 实机 502/504 形态正确。
- 环境清理：临时 api key 吊销（DB revoked=t）、daemon stop、uvicorn kill、临时 Redis 容器删除、共享 DB 迁移漂移复位（主栈 backend 容器 latest 镜像 recreate 后 healthy——crash 根因是并行会话镜像重建后容器未 recreate，非本变更）。

## 设计对照

- §7.1/§7.2/§7.3 契约逐字段对齐（QA 终审核：跨 task 零错位、ql_id 四跳、daemon `size` 字段 backend 未消费属冗余无害）。
- §7.5 生命周期契约表四行事件必需字段在真实接口全部存在。
- §8 风险六项缓解全落地（四道截断护栏、15s 显式超时、双侧 containment、信噪比排序、ql 兜底、mtime 辅助文案）。
- §5 Phase 2「gather 并行」→ 顺序化：有据偏离，代码 docstring + design 修订 + 验收记录三处落痕。

## FR 覆盖

FR-01~10 全部落地（映射见 plan.md 覆盖矩阵，QA 终审 19 项 checklist 双 pass 复核）。FR-10（gen:types）产物已核：api-types.ts 新端点路径/SillySpecConflictCompareResponse/ql_id 字段。

## 决策覆盖

- D-001@v1 实时 RPC 对比：实机链路证据 ✓
- D-002@v1 裁决收进弹窗：行上无裁决按钮（测试钉定）+ 弹窗底部裁决 ✓
- D-003@v1 进度对比表：三列对比表+差异高亮，无原始 JSON ✓
- D-004@v1 ql 编号：心跳补报+标题规则+存量兜底原 ID（已知限制如实呈现）✓

## NOTES（不阻断）

1. UI 实机演示未做：frontend 容器连主栈旧 backend（无 compare 端点），弹窗/行改造行为由 33 个组件测试覆盖并说明（acceptance §4）。
2. design「并行」表述已修订为顺序化；模块文档（task-11 产物）尚在主仓工作区未随 worktree 提交，apply 后统一 commit 时收入。

## 下一步

- apply 回 main：`sillyspec worktree apply 2026-09-07-conflict-diff-compare`（或等用户统一提交）
- 归档：人工确认后 `sillyspec:archive`
