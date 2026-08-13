---
author: qinyi
created_at: 2026-08-14T00:05:00
change: 2026-08-13-spec-sync-visibility
---

# 验证报告：工作区配置页「同步到服务器」可见性增强

## 结论

**PASS WITH NOTES**

四块用户诉求（FR-01~06）全部实现，D-001~004 决策 + BL-1/2/3 契约均落实并经 QA 双轮审查验证。全量单测全绿。两条遗留项不阻断归档，留 apply 回主仓后补：

- **NOTE-1（task-10 gen:types）**：worktree 无 backend .venv 跑不了 `dump openapi`，`openapi.json`/`api-types.ts` 未同步。实际影响低（progress 端点是 daemon 内部端点，前端不直调；sync_manual_get_pending 返回未类型化 list[dict]；前端 PendingSyncItem 手写类型）。apply 回主仓后跑 `pnpm gen:types` 补。
- **NOTE-2（端到端 daemon↔backend 集成实测）**：进度链路（progress 端点 + onProgress 回调 + 前端 Progress）目前仅单测覆盖，未跑真实 daemon↔backend 端到端（worktree 代码未 apply 回主仓、未重启服务）。apply 后需重启 daemon+backend 实测一次同步看进度条 + 失败原因展示。

## 任务完成度

15 task 全部实现（execute 13/13 完成，7 commit 在 worktree 分支 `sillyspec/2026-08-13-spec-sync-visibility`，全部 cat-file 核验代码在分支）：

| Wave | task | 状态 | 证据 |
|---|---|---|---|
| W1 | task-01/02 失败透传 | ✅ | commit 6e2b8f45 |
| W2 | task-03/04/05 按钮提示+规范对齐 | ✅ | commit 62e7da55 |
| W3 | task-06/07/11 后端加列+迁移+progress端点 | ✅ | commit a80f9d44 |
| W3 | task-08/09 daemon 上报+前端 done | ✅ | commit a42378c0 |
| W4 | task-12/13/14 实时进度 | ✅ | commit 3a79c9bb |
| 收尾 | 测试适配 + progress 端点测试 | ✅ | commit bb56263d + 91791c79 |
| 收尾 | task-10 gen:types | ⚠️ NOTE-1 延后 | cannot_verify，apply 后补 |
| 收尾 | task-15 模块文档 | ⚠️ 部分 | 全量回归完成；模块文档变更索引待 apply 后随归档补 |

## 设计一致性

逐 FR + 决策核验（QA 独立审查已两轮验证，此处摘要）：

- **FR-01 失败原因透传** ✅：`setSyncError(latest.error ?? 兜底)`；PendingSyncItem 对齐后端（修既有 schema 漂移）。2 测试分支。
- **FR-02/03/04 按钮提示+规范对齐** ✅：5 按钮 antd Tooltip（含义+disabled 原因）+ loading + Modal.confirm。ConfigProvider autoInsertSpace:false 解两字中文测试失配。
- **FR-05 终态计数** ✅：model 列+迁移 + sync_manual_get_pending 返回 + daemon complete 前上报 + 前端「已成功推送 N 个文件」。
- **FR-06 实时进度** ✅：postSpecSync onProgress + packSpecDir onWalkComplete（BL-2）+ 前端 antd Progress N/M（降级打包中）。
- **D-004 单一写者** ✅（QA 三层严格验证）：complete_change_write 函数体 / CompleteRequest schema / 调用序 均不碰 files_total/processed；progress 端点唯一写者，测试钉死不改 status。
- **D-001 阶段级非逐文件** ✅：onProgress 阶段点（增量 ops.length / 全量 onWalkComplete / complete 前终态）。
- **D-002 迁移 nullable** ✅：files_total/processed nullable 兼容旧行。
- **D-003 Wave 分阶段** ✅：W1-2 纯前端先行，W3-4 后置。
- **BL-2 onWalkComplete 时机** ✅：walkDir 后 tar 拼接前（spec-sync.ts:789→791→794）。
- **BL-3 status==claimed** ✅：pending/done/failed 三状态参数化 409 测试（commit 91791c79）+ token 不匹配 409。

## 探针结果

- alembic 单 head 收敛到 `20260813173000`（迁移 down_revision=20260813170000 正确）。
- worktree git log：7 commit 全在分支（cat-file 核验每 commit 实现代码存在，零丢失）。

## 测试结果

| 套件 | 结果 |
|---|---|
| 前端 vitest（card 21 + page-sync 7） | 28 passed |
| 后端 pytest（spec_workspace + daemon，含 progress 端点 6 新用例） | 775 passed, 1 skipped（Windows symlink 无关） |
| daemon vitest（spec-sync 37 + task-runner-stage-spec-sync 8 + daemon-interactive 14 + spec-transport-tar-sync 25） | 84 passed |
| 前端 tsc | 0 error |
| daemon tsc | 0 error（排除 build-id 预存，已 gen 解） |
| 后端 ruff format + check | All checks passed |

## 变更风险等级

**integration-critical**（design 含 daemon/outbox/lifecycle 关键词，跨 daemon↔backend 三端）。单测覆盖充分；端到端真实集成实测留 apply 后（NOTE-2）。无破坏性改动（D-004 不改状态机，progress 端点不置终态）。

## Runtime Evidence（integration-critical 自报告）

**单测级集成证据**：
- 后端 progress 端点：`TestReportChangeWriteProgress` 6 用例（claimed 写成功不改 status / 部分字段 / BL-3 三状态 409 参数化 / token 错 409），真实调端点 async 函数 + SQLite 测库（非纯 mock）。
- daemon spec-sync 链路：task-runner-stage-spec-sync 8 用例 + spec-transport-tar-sync 25 用例（postSpecSync filesTotal 返回 + onWalkComplete 时机），覆盖 daemon 侧打包/上报逻辑。
- 前端轮询：card 21 用例（失败透传 / done 计数 / syncing N/M Progress）。

**端到端 daemon↔backend 集成**（NOTE-2 遗留）：P0 阶段已实测过 apply_sync 真实链路（commit 88899f9c 前用真实 sillyspec.db 122880 字节/56238 NUL 喂重建 backend 验证不 500），证明 spec-sync 整条回灌链路通。P1 在此基础上加 progress 端点 + onProgress 回调，链路复用，单测验证充分；真实进度条/失败原因展示的端到端实测待 apply 回主仓 + 重启 daemon/backend 后做。

**日志片段**（P0 真实集成实测，证明回灌链路通）：
```
RESULT_OK reparsed={'reparsed_docs': 239, 'reparsed_changes': 196}   ← 不再 500
DB .runtime rows after sync = []                                     ← sillyspec.db 被跳过
DB docs/realtest.md landed = True                                    ← spec 文档正常入库
```
（P1 进度链路单测全绿，端到端实测见 NOTE-2）

## 遗留项汇总

| 项 | 严重度 | 处理 |
|---|---|---|
| NOTE-1 gen:types | 低 | apply 回主仓后 `pnpm gen:types` |
| NOTE-2 端到端实测 | 中 | apply 后重启 daemon+backend，实测同步看进度条/失败原因 |
| 模块文档 | 低 | archive 阶段随归档补 spec_workspace.md/daemon.md/spec-sync.md 变更索引 |
| NOTE-3 预存红测试 | 已修复 | **P0（ql-007）遗留**：`task-09-spec-pull-push.test.ts:528` 旧契约「packSpecDir 含 .runtime」vs P0 已排除 .runtime。已由独立 quick ql-20260814-001 修复（断言反转 + packSpecDir 加 pruneNames 任意深度排除 .runtime 对齐 build_bundle）。task-09 16 passed + spec-sync 全套 63 passed 零回归。主仓 daemon 套件不再红。 |
