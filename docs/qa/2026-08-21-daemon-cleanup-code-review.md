# daemon 缓存清理功能 代码审查（2026-08-21）

- **审查对象**：工作区未提交的 daemon 缓存清理功能（`daemon:cleanup` 协议 + 后端推送端点 + 前端清理按钮 + daemon 侧 `cleanup.ts`），共 14 个修改文件 + 2 个新文件。
- **审查维度**：代码缺陷 / 性能 / 代码质量 / 垃圾代码 / 注释一致性 / 文档同步。
- **关联**：quick 会话 `quick-f71c030b`（ql-20260821-022-e17a）。原始功能开发无 QUICKLOG/变更记录，本审查一并补记。
- **依据**：`sillyhub-daemon/src/resilience/outbox.ts`（outbox 语义）、`sillyhub-daemon/src/terminal-observer.ts`（runs/ 保留期机制）、`backend/app/modules/daemon/router.py` self-update 既有模式、`.sillyspec/docs/*/modules/` 模块文档。

## 发现清单（按修正顺序编号）

### P0 缺陷（数据丢失风险）

**1. `sillyhub-daemon/src/cleanup.ts` — CLEANABLE_DIRS 含 `outbox`，会删未投递消息（数据丢失）**
`~/.sillyhub/daemon/outbox` 是 ResilienceService 的断线补发队列（task-15 / FR-06 / FR-09）：`submitWithRetry` 用尽后把会话消息信封落盘 JSONL，daemon 重启 `load()` 恢复、网络恢复后 `drainOutbox` 补发。整目录删除 = 永久丢失尚未送达 backend 的会话消息。
**修正**：从 CLEANABLE_DIRS 移除 `outbox`；测试同步反转断言。

**2. `sillyhub-daemon/src/cleanup.ts` — CLEANABLE_DIRS 含 `runs`，会删活跃任务终端日志**
`~/.sillyhub/daemon/runs/{leaseId}/terminal.log` 是 terminal-observer 正在 tail 的活跃任务日志；且 runs/ 已有专属保留期机制——`cleanupOldRuns`（task-09 / FR-12）启动时只删 7 天前的子目录、"mtime 新鲜绝不误删"。整目录删除与之冲突，Windows 上文件被占用还会导致 rm 部分失败。
**修正**：从 CLEANABLE_DIRS 移除 `runs`，交给既有保留期机制；测试同步反转断言。

### P1 缺陷（安全护栏缺失）

**3. `sillyhub-daemon/src/daemon.ts` — CLEANUP 处理无活跃会话守卫**
指令随时可能到达。交互会话运行中删除 `claude-config/projects`（Claude transcript 正被写）、`skills/`（可能正被部署读取）会破坏进行中的任务；Windows 上文件占用导致清理半途而废。
**修正**：handler 入口检查 `_interactiveSessionsByLease.size > 0` 则跳过并 `warn cleanup_skipped_busy`。

**4. `frontend/src/app/(dashboard)/runtimes/page.tsx` — 清理按钮无二次确认**
清理会删除 Claude 会话转录（本地聊天历史）等不可恢复内容；同页"移除运行时"等破坏性操作均走 antd `modal.confirm`（task-06 / FR-03 模式），清理按钮点按即发，误触代价高且与页面惯例不一致。
**修正**：`handleCleanup` 加 `modal.confirm`（危险确认文案说明清理范围与不可恢复性）。

### P2 测试缺口

**5. `backend/app/modules/daemon/tests/test_machines_router.py` — cleanup 端点零测试**
同款 self-update 端点有三件套测试（mock ws_hub 断言路由与参数 / 离线→504 / 越权·不存在→404）。新增端点必须镜像补齐。
**修正**：补 3 个测试。

**6. `frontend/src/components/daemon/__tests__/machine-card.test.tsx` — 清理按钮零断言**
仅补了 `onCleanup: vi.fn()` prop；升级按钮有"离线 disabled、点击不触发"测试（头注释第 7 条），清理按钮应镜像。
**修正**：补离线 disabled + 在线点击触发 onCleanup 测试，头注释同步。

**7. `sillyhub-daemon/tests/cleanup.test.ts` — 断言需随 #1/#2 反转；`.last-cleanup` 是无实现对应的死测试数据**
`createDaemonLayout` 写入 `claude-config/.last-cleanup` 但 `cleanup.ts` 从不读写该文件（疑似废弃的节流设计残留），且无任何断言引用。
**修正**：runs/outbox 断言反转为"保留"；删除 `.last-cleanup` 相关行；补 outbox/runs 保留校验。

### P3 代码质量 / 垃圾代码

**8. `sillyhub-daemon/src/cleanup.ts` — `listAllFiles` 是死代码**
全仓无任何调用方（仅自身递归引用）。删除。

**9. 动态 import 不一致**
- `sillyhub-daemon/src/cli.ts` `cleanAction` 动态 `import('./cleanup.js')`：cli.ts 其余依赖全部静态导入（DEFAULT_CONFIG_DIR 已在顶部静态导入），改为静态导入。
- `sillyhub-daemon/src/daemon.ts` CLEANUP handler 动态 `import('./config.js')` 取 `DEFAULT_CONFIG_DIR`：daemon.ts 顶部已有 `from './config.js'` 静态导入（第 43 行），把 DEFAULT_CONFIG_DIR 并入即可；`import('./cleanup.js')` 与同函数 SELF_UPDATE 的 `import('./preflight.js')` 风格一致，保留动态。

**10. `sillyhub-daemon/src/daemon.ts` — CLEANUP 无并发护栏**
连点两次清理指令会并发跑两个 `performCleanup`（统计重复、rm 竞态）。加进程内 in-flight 布尔守卫（对齐 terminal-observer 的 `cleanupStarted` 模式）。

### P4 注释修正（与实现不一致，CLAUDE.md 铁律 18）

**11. "保留 config.json、locks/、workspaces/" 注释语义误导（白名单口吻，实现是黑名单）**
实际保留集还包括：`claude-config/.claude.json` 活跃配置、`claude-config/.last-cleanup`、`bin/` 非 `.bak` 文件、`outbox/`、`runs/`（#1/#2 修正后）等一切不在清理目标内的内容。出现在 7 处：
- `backend/app/modules/daemon/protocol.py`（DAEMON_MSG_CLEANUP 注释块）
- `backend/app/modules/daemon/router.py`（端点 docstring）
- `backend/app/modules/daemon/ws_hub.py`（send_cleanup docstring）
- `sillyhub-daemon/src/protocol.ts`（MSG.CLEANUP 注释块）
- `sillyhub-daemon/src/daemon.ts`（handler 注释）
- `sillyhub-daemon/src/cleanup.ts`（文件头注释）
- 前端 `runtimes/page.tsx` / `machine-card.tsx` 相关注释（顺带核对）
**修正**：统一改为准确描述：删除目标为黑名单枚举，未列出一律保留。

**12. `sillyhub-daemon/src/cleanup.ts` — `CleanupEntry.path` 注释与实际取值不符**
注释称"目标路径（相对于 baseDir）"，但 bin/ 与根目录条目的取值是汇总描述文案（如 `bin/*.bak* (3 个文件)`）而非路径。
**修正**：注释改为"目标描述（目录条目为相对路径，文件类条目为汇总描述）"。

### P5 文档修正（模块文档与 openapi 同步）

**13.** `.sillyspec/docs/sillyhub-daemon/modules/protocol.md` — MSG 消息表缺 CLEANUP。
**14.** `.sillyspec/docs/sillyhub-daemon/modules/daemon.md:50` — 处理消息清单缺 CLEANUP。
**15.** `.sillyspec/docs/sillyhub-daemon/modules/cli.md` — 子命令清单仍是"4 个子命令 start / stop / status / logs"，缺 clean（修正时按 cli.ts 实际 `.command()` 全量核对）。
**16.** `.sillyspec/docs/SillyHub/modules/daemon.md` — RuntimeService（L17）与 WsHub（L35）能力清单缺 cleanup 指令下发。
**17.** `.sillyspec/docs/frontend/modules/lib-daemon.md` — 缺 `triggerMachineCleanup` 条目（L29 triggerDaemonSelfUpdate 附近）。
**18.** 新模块 `sillyhub-daemon/src/cleanup.ts` 无模块文档 — 新建 `modules/cleanup.md` + `_module-map.yaml` 条目。
**19.** `backend/openapi.json` + `frontend/src/lib/api-types.ts` 未再生成 — 新增 `POST /machines/{instance_id}/cleanup` 后两端 schema 落后（CLAUDE.md 铁律 21，且有 `gen:types:check` 守门）。跑 `backend/scripts/dump_openapi.py` + `pnpm gen:types`。

### P6 审查过程中发现的既有测试债（顺手修复）

**20. `sillyhub-daemon/tests/daemon-kind-dispatch.test.ts:643`、`tests/daemon-session-switch-config.test.ts:483-486` — inject 断言停留在 3 参签名**
2026-08-20-session-multimodal-attachments 后 daemon 的 `sessionManager.inject` 固定传 5 参（无附件时 attachments/downloadAttachment 为 undefined），两处断言仍按旧 3 参写，全量套件在 HEAD 即红。
**修正**：断言补全后两参 undefined，注释同步。
另：`tests/task-09-spec-pull-push.test.ts` 在全量并发下偶发失败（单独运行 16/16 绿），属既有 timing 抖动，未动。

### 已排查、无需修正（记录结论避免复查）

- **CLEANUP handler 内联 await 是否阻塞 WS 接收**：不阻塞。`ws-client.ts` `_handleMessage` 是同步 void，`onMessage` 回调同步调用，异步 handler 不阻塞后续消息与心跳定时器（SELF_UPDATE 同款内联 await）。排除。
- **后端 `svc._get_owned_instance` 私有方法调用、函数内局部 import**：与同文件 self-update 端点逐字同款，属既有风格，不在本次范围。
- **`dirSize` 串行递归 stat 性能**：维护性操作、目录规模有限（本地缓存），串行实现简单可靠；如未来单机 claude-config/projects 达到数十万文件再考虑并发化。不改。
- **版本号 0.1.0→0.1.1**：仅 handshake clientInfo 展示与测试断言，无后端最低版本表需要同步（router.py `minRequired="0.1.0"` 不受影响）。无需动作。
