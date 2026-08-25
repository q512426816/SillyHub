# 团队分身子会话系统（daemon + 前端）审计报告

author: qinyi
created_at: 2026-08-26 05:45:10

审计范围：2026-08-25/26 团队分身子会话相关改动（会话总数闸 / worker_depth 分层链路 / 分层工具集 / 前端 subGrouping / WorkerSessionOverlay）。只读代码 + 定向测试，未改任何源码。

审计对象（均为绝对路径，下文简写）：

| 侧 | 文件 |
| --- | --- |
| daemon | sillyhub-daemon/src/interactive/session-manager.ts、session-store-persistence.ts、../mcp-server.ts、../mcp-config.ts、../cli.ts、../daemon.ts |
| 前端 | frontend/src/components/sessions/session-list-panel.tsx、daemon/team-task-block.tsx、daemon/session-panel.tsx |

---

## 一、结论速览

**总体：链路正确性良好，未发现 P0/P1 缺陷。** 会话闸计数口径、worker_depth 0/undefined 区分与三路（create/restore/reload）保档、分层工具集单源注册、浮层 SSE 生命周期四处核心链路均实现正确且有测试覆盖。发现 7 项 P2/P3 级问题（2 项 P2、5 项 P3），全部为边界 / 旁路缺陷，不影响主路径功能。

| # | 等级 | 侧 | 摘要 | 位置 |
| --- | --- | --- | --- | --- |
| F1 | P2 | daemon | `SILLYHUB_MAX_ACTIVE_SESSIONS` 空串/纯空白被解析为 0 = 不限，闸静默失效 | session-manager.ts:840-842 |
| F2 | P2 | 前端 | `shownSessions` 每渲染新数组（截断态 slice 未 memo）→ subGrouping/sections useMemo 恒重算 | session-list-panel.tsx:1371-1374 |
| F3 | P3 | daemon | `_destroyPartialBuffer` 早退在 budget 清理之前 → 无 partial buffer 会话的 `_sessionBudgetTokens`/`_overBudgetSessions` 永不回收（慢泄漏 + 注释与实现不符） | session-manager.ts:4913-4928 |
| F4 | P3 | daemon | daemon.ts 读 `rawExec.worker_depth` 未归一化：字符串形态运行期可被 normalize 救回，但落盘重启后 validateRecord 拒收 → 非叶静默降级叶档 | daemon.ts:4321-4324 |
| F5 | P3 | 前端 | `filterEpoch` 拼接串理论碰撞（筛选值含 `\|`）→ openParents 不重置；另截断边界漂移时已展开子折叠组会瞬时跳成孤儿小节（视觉） | session-list-panel.tsx:1046,1383 |
| F6 | P3 | 前端 | 浮层打开期间主控 SSE 不关 + 浮层面板挂载即发 ~6 个并发请求（含对分身会话恒空的 team-missions 查询） | session-panel.tsx:2616-2626,2812 |
| F7 | P3 | 前端 | 组内 >50 截断时「分身 N」徽标按 shownSessions 计数偏小；子会话被截掉时父行计数为 0 不渲染折叠组头 | session-list-panel.tsx:1372-1402,1775 |

---

## 二、逐项审计（按审计清单）

### A1. 会话总数闸计数口径 —— 正确，一处 env 解析边界缺口

**计数不含终态延迟清理条目（正确）。** `create` 的闸只数 `_store` 中 `status !== 'ended' && status !== 'failed'` 的条目（session-manager.ts:1153-1161）。`_terminateSession` 收尾时 status 先置终态再 schedule 10 分钟延迟清理（:2829, :2892），因此 10 分钟窗口内的终态条目**不占额度**，限额不会虚高拒绝新会话。有测试直接覆盖（tests/interactive/session-manager-worker-depth.test.ts:284「终态会话不计数」）。

**restore 恢复态**：`reconnecting` 条目计入后续 create 的额度（非终态），但 `restoreAndReconnect` 本身不走闸（有意设计，防误伤恢复；有测试 :298）。

**并发安全**：闸检查 → `_store.set`（:1214）之间全同步无 await，JS 单线程下并发 create 无 TOCTOU 竞态。

**env 解析边界（F1, P2）**：`Number(process.env.SILLYHUB_MAX_ACTIVE_SESSIONS)` 对 `''` 与 `' '` 均得 0，`Number.isFinite(0) && 0 >= 0` 成立 → **空串 = 0 = 不限**（:840-842）。负数（`-5` → 默认 20）与非数字（`abc` → NaN → 默认 20）处理正确，唯独空串漏洞。风险场景：Docker Compose `SILLYHUB_MAX_ACTIVE_SESSIONS: ${VAR:-}` 这类缺省展开即产出空串，会静默关掉防进程风暴闸（FR-06）。对照先例 `SESSION_IDLE_TIMEOUT_SEC`（:823-825）空串落默认值无危害，本处语义相反。
**最小修复**（session-manager.ts）：

```ts
const gateRawStr = process.env.SILLYHUB_MAX_ACTIVE_SESSIONS?.trim();
const gateRaw = gateRawStr ? Number(gateRawStr) : Number.NaN;
```

### A2. worker_depth 链路（0 与 undefined 区分 / snapshot 往返）—— 正确，一处入口归一化缺口

**0 与 undefined 全链区分正确**：
- 语义：0 = 合法非负深度（`normalizeWorkerDepth(0)=0`、`isNonLeafWorkerDepth(0)=true`，mcp-config.ts:337-354）；undefined = 旧 lease / 主控 / 普通会话（缺键穿透 = 叶档兜底，宁少勿多）。主控不通过 worker 链（stage 谓词分流），不会产生 depth=0 的主控。
- create：daemon.ts:4321-4324（claim payload 归一）→ :3934 → session-manager.ts:1199（state）/ :1247（ctx）。
- restore：snapshot 写侧 `state.worker_depth !== undefined` 才写、0 保留（:3003-3005）；读侧 validateRecord `Number.isFinite` 回填、0 合法（session-store-persistence.ts:223-225，P0-1 修复链）；state/ctx 保档（:3114/:3151）。
- reload：ctx 条件补字段（:3709）。
- 测试覆盖三路 + 0 + 缺省（session-manager-worker-depth.test.ts 10 例 + worker-tiered-toolset.test.ts snapshot→restore 往返例）。

**snapshot 往返丢档场景**：
1.（既有设计边界，非缺陷）会话在首 turn `system/init` 前终态 → 无 agentSessionId → 整条 record 不落盘（snapshotPersistable :2960-2962 只取 active/running 且有 agentSessionId）；reconnecting 态同样不落盘（daemon 重启丢会话，Wave1/2 D-003 已知限制）。
2.（F4, P3）daemon.ts:4321 直接 `rawExec.worker_depth as number | undefined`，**未套 normalizeWorkerDepth**。若 backend 侧写出字符串 `"1"`：运行期 `buildWorkerMcpServerConfig` 的 normalize（mcp-config.ts:568）会救回（env 正确写 1）；但 `snapshotPersistable` 原样写字符串 → 重启 load 时 validateRecord `typeof r.worker_depth === 'number'` 拒收丢字段 → **非叶分身降级叶档**（砍掉合法递归派工，静默）。当前 backend Python 写 int，纯防御缺口。
**最小修复**（daemon.ts:4321）：读入后 `normalizeWorkerDepth(raw) ?? undefined` 再赋 execPayload（或落 CreateSessionInput 前归一），与 mcp-config 单源口径对齐。

### A3. 分层工具集（非叶 5 件 / orchestration 6 件 / 叶 1 件）—— 无注册漂移、无两源冲突

**共享 helper 单源，无拷贝漂移**：orchestration 6 件（dispatch / get_worker_result / list_workers / converge / report_progress / mission_status，mcp-server.ts:403-408）与非叶 5 件中的 4 件（:390-393）全部调用同一组 per-tool helper（registerDispatchWorkerTool 等），worker_done 独立 registerWorkerTools（:395）。不存在第二份注册实现，改一处漏一处的结构风险不存在。唯一前瞻性注意：未来 orchestration 若新增第 7 工具不会自动进非叶清单——这是有意固定集合，两处注释已互指。
**测试**：worker-tiered-toolset.test.ts 20 例覆盖两档、0/2/3 边界、undefined/-1/1.5 非法值、env 写读往返、create/restore 注入链档位。

**MCP_WORKER_DEPTH env 与 ctx.worker_depth 不是竞争两源**：链路为单向派生 `ctx.worker_depth（lease metadata → claim payload → daemon）→ buildWorkerMcpServerConfig 写 per-server env → MCP 子进程 readEnv 读 env`（cli.ts:863-892 / mcp-config.ts:546-577 / mcp-server.ts:172）。per-server env 覆盖式注入（spike-01 结论：子进程只继承白名单 + per-server env），daemon 自身进程 env 即使有同名键也不会漏进子进程。写读两侧共用 normalizeWorkerDepth，幂等无漂移。**结论：无优先级冲突问题。**

### A4. 前端 subGrouping（byParent / orphans / openParents）—— 主逻辑正确，性能反模式一处

**byParent / 孤儿小节逻辑正确**：`subGrouping` 以 shownSessions 中无 parent 的会话建 mainIds，子会话父在 mainIds → byParent 附属组，否则 → 孤儿小节（session-list-panel.tsx:1383-1402）；sections 循环里子会话 `continue` 不进机器分桶，附属组渲染在父行下（:1726-1798）。有测试（默认折叠 / 展开 / 孤儿兜底 / 无子会话零变化 4 例）。

**截断（GROUP_ITEM_LIMIT=50）交互**：
- 父被截掉（50 名外）而子在 50 内 → 子正确落「团队分身」孤儿小节不丢行（兜底设计生效，无丢行）。
- 父在 50 内而子被截掉 → 「分身 N」按 shownSessions 计数偏小（F7, P3）；点「显示全部」后恢复。组头「N 个会话」用 visibleSessions 全量计数不受影响。
- 状态筛选把父滤掉而子留下 → 子落孤儿小节，语义合理。
- 轮询/信号到达使截断边界漂移（新会话入榜挤掉旧父行）→ 已展开的附属组瞬时跳成孤儿小节（F5 的视觉部分，数据正确）。

**openParents 与 filterEpoch 重置**：重置 effect 依赖 `[filterEpoch]`（:1480-1483），原始 string 值比较，正确；挂载时也执行一次（置空，无害）。边缘：epoch 拼接 `${a}|${b}|${c}|${d}` 存在理论碰撞（如搜索词含 `|` 使不同筛选态拼出同串 → 不重置），实际影响趋零（F5, P3）。选中兜底展开是渲染期派生（`openParents.has(id) || childSubs 含 selected`，:1730-1732），不与用户手动收起打架（手动收起后 selected 仍在 childSubs 会强制展开——注意：这与组级「同一选中只触发一次」语义不同，选中子会话时父折叠组**无法被手动收起**（收起立即被渲染期条件弹回）。属可接受的产品取舍，未列缺陷，但建议知悉）。

**内存**：openParents 上限 ≈ 组内父行数（≤50）且随 epoch 重置，无无上限增长。

### A5. WorkerSessionOverlay（卸载关流 / 切换竞态 / mission 查询）—— 全部正确

**卸载关流（三层防护）**：① `key={subSessionId}` 驱动整体 remount（session-panel.tsx:592-595），关闭浮层 = 卸载 = dialog 面板 unmount cleanup 执行：先置 disposedRef 再 close streamConnRef + clearInterval attachPoll（:3341-3356）；② `establishStream` 在 prefetch await 返回后自查 `disposed / 已有连接 / 代际` 放弃建流（:2971-2975），杜绝「cleanup 先跑、close 落空、await 返回后新建僵尸流」（streamSession 内建退避重连 30s 封顶，僵尸流代价高，此处防护到位）；③ in-flight 复用 + streamEpoch 代际（:2947-2953, 2862-2872）。

**连续快速切换**：A→B 切换触发 key 变化 remount，A 的 cleanup 与 B 的 mount 由 React 生命周期串行化；面板内部 establishingRef/epoch 防同 id 并发双连。**无竞态缺口。**

**mission 查询**：dialog 面板对 view.sessionId 调 `useSessionTeamMissions`（:2812-2813）→ 分身会话非 mission 锚点，后端按 AgentMission.session_id 直查返回**空数组**（非 404）；渲染门控 `teamMissions.length > 0 &&`（:4067）→ 不渲染团队块，**无闪烁**；拉取失败 catch 静默。唯一小代价：每个浮层挂载都白发一次恒空查询（F6 一部分）。

### A6. 会话列表轮询 / sessions_events 信号流与新分组交互 —— 正确

- sessions_events 哑信号 → 400ms leading+trailing 去抖 invalidate（sessions-portal.tsx:203-241，含 onConnected/onReconnected 补拉）→ refetch。
- 折叠态全部为组件 state（组级 collapsedIds、openParents、subOrphanOpen、toolOpenState），WorkspaceGroupNode key=group.id 跨 refetch 稳定不 remount → **折叠态保持**；react-query structuralSharing 数据不变零重渲染。
- 轮询间隔自适应：有进行中会话 10s / 全静默 30s（session-list-panel.tsx:351-358），后台标签不轮询。
- 唯一交互瑕疵即 F5 的截断边界漂移视觉跳变。

### A7. 内存泄漏

- **daemon（F3, P3）**：`_destroyPartialBuffer` 的 `if (!sessionMap) return;`（session-manager.ts:4916-4917）早退在 `_sessionBudgetTokens.delete` / `_overBudgetSessions.delete`（:4926-4927）**之前**——无 partial buffer 的会话（首 turn 早失败、无流式 delta、budget-only）end/fail 后这两个 Map 的条目永不回收：终态延迟清理 timer 只删 `_store` + `_pendingInjectCount`（:2909-2910）。create 失败路径显式删过（:1290-1292，注释 :1287-1289 甚至自认了这个早退问题），end/fail 主路径漏了。量级小（每条一个 string key + number）但随 daemon 寿命无界增长，且注释宣称的清理与实现不符（违反仓库规则 18「注释和实现不一致是万恶之源」）。
  **最小修复**：把 :4926-4927 两行 delete 移到早退判断之前（budget 清理不依赖 partial buffer 存在性）。
- **前端**：openParents 有界（见 A4）；effect 清理齐全（SSE 订阅 close :3240、interval clear、rAF cancel、去抖 cancel :213-216）。

### B. 性能

| 项 | 结论 |
| --- | --- |
| subGrouping useMemo 依赖（F2, P2） | **确认反模式**：`shownSessions = truncated ? visibleSessions.slice(0,50) : visibleSessions`（:1371-1374）在 render 内联计算，截断态（组 >50 条）每次渲染产出新数组引用 → `subGrouping`（:1383）与 `sections`（:1404）两个 useMemo deps 失稳**每次渲染重算**。未截断时引用稳定（复用 visibleByGroup 产物）无问题。触发源：10s 轮询数据更新、勾选/展开等任何父 state 变化。**最小修复**：`const shownSessions = useMemo(() => truncated ? visibleSessions.slice(0, GROUP_ITEM_LIMIT) : visibleSessions, [visibleSessions, showAll]);` |
| 500 条 byParent 聚合复杂度 | O(n) 单遍 + Map 查找，且 n 被截断钳到 ≤50/组；无嵌套循环、无重复计算（除 F2 的 memo 失效）。算法层面可接受。 |
| 上游 memo 链 | sessions/viewFiltered/visibleByGroup/groups 均 useMemo 且依赖引用稳定（react-query structuralSharing 保 sessions 引用）——健康。 |
| 浮层 SessionPanel 初始查询集（F6, P3） | 挂载即发 ~6 并发：logs 预取（establishStream）+ attach 轮询 getAgentSession（1.5s，active 即停）+ fetchPendingDialogs + fetchSessionDialogHistory + queue GET + team-missions（对分身恒空）。量级可接受；可选优化：dialog 模式 attach 到子会话（parent_session_id 非空）时跳过 team-missions 查询。主控 SSE 双流并存是有意取舍（「关闭返回主控」验收），记录不判缺陷。 |

---

## 三、测试验证（本次实跑）

| 命令 | 结果 |
| --- | --- |
| `cd sillyhub-daemon && pnpm vitest run tests/interactive/{session-manager-worker-depth,worker-tiered-toolset,session-manager-worker-restricted-mcp,session-manager-terminal-cleanup,session-store-persistence}.test.ts` | **87 passed**（5 文件） |
| `cd frontend && pnpm vitest run src/components/sessions/__tests__/session-list-panel.test.tsx -t "分身子会话"` | **4 passed** |
| `cd frontend && pnpm vitest run src/components/daemon/__tests__/{team-task-block,session-panel-team}.test.tsx` | **36 passed**（含浮层 dialog/page 两模式开合用例） |

### 测试覆盖缺口（建议补）

1. daemon：`SILLYHUB_MAX_ACTIVE_SESSIONS=""`（空串）→ 应回落默认 20 而非 0（F1 修复的验收用例）。
2. daemon：claim payload `worker_depth` 为字符串 / 负数时 daemon 入口归一化（F4 修复的验收用例）。
3. daemon：无 partial buffer 会话 end 后 `_sessionBudgetTokens` 无残留（F3 修复的验收用例）。
4. 前端：组内 >50 截断 × subGrouping 交互（父被截掉 → 子落孤儿小节；「分身 N」计数口径）。
5. 前端：filterEpoch 变化重置 openParents / subOrphanOpen。
6. 前端：分身行快速 A→B 切换后旧 SSE 已关（可断言 streamSession close 调用次数）。

---

## 四、TOP 5 必修项（按 影响 × 修复成本 排序）

1. **F3（P3）daemon budget Map 慢泄漏** — session-manager.ts:4913-4928：把 `_sessionBudgetTokens.delete(sessionId)` / `_overBudgetSessions.delete(sessionId)` 移到 `if (!sessionMap) return;` 之前。一行位移，消除真泄漏 + 注释与实现不一致。
2. **F1（P2）会话闸空串 env 静默解锁** — session-manager.ts:840-842：env 值 trim 后空串视为未配置（NaN → 默认 20），防 Compose 缺省展开把防风暴闸关掉。
3. **F2（P2）shownSessions memo 失效** — session-list-panel.tsx:1371-1374：用 useMemo 包裹截断 slice，稳定 subGrouping/sections 依赖。
4. **F4（P3）worker_depth 入口归一化** — daemon.ts:4321-4324：读入处套 `normalizeWorkerDepth`，闭合「字符串深度重启丢档 → 非叶降级叶」的防御缺口。
5. **F5+F7（P3）前端分组边界** — session-list-panel.tsx：filterEpoch 改用对象/数组 deps 或对含 `|` 转义；「分身 N」计数可选用 visibleSessions 全量口径（或维持现状并在「显示全部」提示中说明），连同补 4-6 三个前端测试。

---

## 五、总体评价

本次分身子会话改动的核心安全/正确性链路质量**明显高于平均水平**：递归闸（stage 谓词三态 + 深度两档 + backend 双保险 MAX_DISPATCH_DEPTH 单源注释）、worker_depth 保档链（create/restore/reload 三路 + 持久化往返）、浮层 SSE 生命周期（remount + disposed + 代际三层防护）都做了显式设计且测试密集（daemon 侧 87 例全过）。注释密度极高，绝大多数注释与实现一致——正因如此 F3 那处注释与实现相悖的泄漏更值得修。风险集中在两类：env/类型边界的防御缺口（F1/F4，均为「上游契约正常时无感、异常时静默降级」型）与前端 memo 反模式（F2）。无阻塞上线项，TOP 5 均为小改动。
