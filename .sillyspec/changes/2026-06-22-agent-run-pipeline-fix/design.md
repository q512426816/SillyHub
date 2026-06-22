---
author: qinyi
created_at: 2026-06-22T15:35:00
change: 2026-06-22-agent-run-pipeline-fix
---

# 设计：agent-run 调度链路修复 + 前端日志展示优化

## 1. 背景

SillyHub 平台调度 agent 对项目 `myaaa` 执行 `sillyspec scan` 的运行日志（agent-run-7142b6cb.log，8588 行）暴露了调度链路、sillyspec CLI、日志记录器三层问题。本变更修复这些问题并优化前端运行日志展示。

涉及两个仓库：
- **SillyHub**（本仓库 `multi-agent-platform`）：调度逻辑、部署配置、daemon 日志记录器、前端展示
- **sillyspec**（`C:\Users\qinyi\IdeaProjects\sillyspec`，v3.18.5）：CLI 的 post-check / 子项目探测 / 命令路由 / 门控

## 2. 问题清单（来自日志诊断 + 代码调研）

| ID | 问题 | 仓库 | 根因（file:line） |
|---|---|---|---|
| A1 | `/data/` 路径在 Windows Git Bash 被 MSYS 转成 `C:\Program Files\Git\data\` → EPERM | SillyHub | `spec-data` 是 Docker named volume（docker-compose.yml:55,110），daemon(Win宿主机)访问不到；`SPEC_ROOT_MAP` 翻译器是死代码（daemon.ts:1694-1705 无配置注入） |
| C1 | scan 每步报警"拒绝删除源码目录的 .sillyspec：检测到真实资产" | SillyHub | context_builder.py:465 build_scan_bundle 生成 `init --dir <源码目录>`，平台模式在源码目录建 .sillyspec |
| D1 | [THINKING] 逐 token 碎片化（一句话拆多行） | SillyHub | session-manager.ts:1323-1444 partial 缓冲 80字符/120ms flush（stream-json.ts:148-149） |
| D2 | thinking 重复打印两次（增量段+完整段） | SillyHub | 完整 message 到达时 _clearPartialBuffer(:1301-1303) 撤销不了已 flush partial；backend _extract_sdk_messages(service.py:3329-3488) 又展开全文 [THINKING] |
| D3 | tool_call 双份（stdout + JSON）漏合并 | SillyHub | task-runner.ts:1273-1304 / service.py:3418-3462 故意双 emit；前端 normalize.ts:359-386 ±3 窗口太窄 |
| B1 | post-check 报"文件不存在 .sillyspec/docs/frontend/scan/" | sillyspec | workflow.js:155/312/331 硬编码 `.sillyspec`（resolve(cwd,rawPath)）；scan-docs.yaml outputs.path 写死；项目名来自 perProject 展开标记（run.js:2627-2629）变 frontend |
| B2 | scan-projects.json 含 `{"projects":[...,"0","7"]}` | sillyspec | run.js:2160 正则过宽；sanitizeProjectName(:2154-2156) 不拒绝纯数字 |
| B3 | `sillyspec doctor` 报"未知命令" | sillyspec | index.js:44-46 help 列了 doctor；switch(160-804) 无顶层 case，落 default(:800) |
| B4 | post-check 全红仍能 `--done` 推进 | sillyspec | run.js:2433-2438 失败分支只改 status 没 return，穿透到 :2603 无条件 return true |

## 3. 总体方案：P0/P1 分层

执行策略见 [[decisions]] D-005。

- **P0 — 打通 scan 主链路**（阻塞 scan 跑通）：A1 路径、B1 post-check 路径、B4 门控、C1 init 残留
- **P1 — 体验与正确性**：B2 脏数据、B3 doctor、D1/D2/D3 日志、前端 timeline 重设计

## 4. P0 详细设计

### 4.1 A1 路径崩溃（bind mount + daemon 翻译）

**根因链**：backend 在 Docker 容器内按 `SPEC_DATA_ROOT=/data/spec-workspaces`（config.py:64-68 默认，docker-compose.yml:74 覆盖）拼 `spec_root={spec_data_root}/{ws_id}`（spec_workspace/service.py:73），嵌进 scan prompt（context_builder.py:465-505 build_scan_bundle）→ 经 lease metadata 透传 → daemon（Windows 主机）唯一的翻译器 `SPEC_ROOT_MAP`（daemon.ts:1694-1705）因无配置注入而失效 → prompt 里 `/data/...` 字面落到 Claude Code Bash 工具 → Git Bash MSYS 转成 `C:\Program Files\Git\data\...` → EPERM。

深层问题：`spec-data` 是 Docker **named volume**（非 bind mount），宿主机无真实路径，daemon 根本访问不到——backend 和 daemon **不共享 spec-workspaces 文件系统**。

**修复**（三层，配合 D-001）：

1. **bind mount 共享文件系统** — `deploy/docker-compose.yml`:
   - `spec-data:/data/spec-workspaces`（:55）→ `"${SPEC_DATA_HOST_DIR:-C:/data/spec-workspaces}:/data/spec-workspaces"`
   - 顶级 `volumes:` 下删除 `spec-data`（:110 附近）
   - `deploy/.env.example` 增 `SPEC_DATA_HOST_DIR=C:/data/spec-workspaces`（含注释：宿主机真实路径，daemon 与容器共享）
   - 容器内仍见 `/data/spec-workspaces`，宿主机/daemon 见 `C:/data/spec-workspaces`，物理同一目录

2. **daemon 激活 SPEC_ROOT_MAP 翻译器** — `sillyhub-daemon/src/daemon.ts:1694-1705`:
   - 现有逻辑已读 `process.env.SPEC_ROOT_MAP` 并 replaceAll，**保持不动**
   - 配置注入：daemon 启动处（`sillyhub-daemon/src/config.ts` 或 `daemon-start.bat`）设置 `SPEC_ROOT_MAP=/data/spec-workspaces:${SPEC_DATA_HOST_DIR}`（如 `/data/spec-workspaces:C:/data/spec-workspaces`）
   - daemon 拿到 prompt 后把 `/data/spec-workspaces/<id>` 翻译成 `C:/data/spec-workspaces/<id>`

3. **backend 防御性透传**（不依赖 prompt 字符串）— `backend/app/modules/daemon/service.py:618-638` `_build_claim_payload` interactive 分支:
   - 补回 `specRoot` / `runtimeRoot` 字段进 payload（当前只透传 prompt，字段 undefined）
   - daemon 端 interactive 路径读取 payload.specRoot 做翻译（与 prompt 双保险）

**验收**：Windows daemon 跑 scan，agent 拿到的 spec-root 是 `C:/data/...` 而非 `C:\Program Files\Git\data\...`，无 EPERM；backend 写入的文档 daemon 可见、agent 可见（同一物理目录）。

### 4.2 B1 post-check 路径不一致（sillyspec）

**根因**：两套 post-check 分裂。
- `src/workflow.js`（B1 元凶）：`checkOutput`(:155) `resolve(cwd, rawPath)`、`_checkWorkflow`(:312,:331) `join(cwd,'.sillyspec',...)` —— 硬编码源码目录 .sillyspec
- `src/scan-postcheck.js`（行为正确）：`projectName=basename(cwd)`(:54)、`join(specDir,'docs',projectName,'scan')`(:86) —— 用 specDir
- `templates/workflows/scan-docs.yaml` outputs.path 全写 `.sillyspec/docs/<project>/scan/...`
- 项目名 frontend 来自 perProject 展开标记（run.js:2627-2629 `steps[idx].project`），子项目展开后非 basename(cwd)

**修复**：
1. `run.js` 调 `runPostCheck`（:2647）传入 `specBase = platformOpts.specRoot || join(cwd,'.sillyspec')`
2. `workflow.js` `checkOutput`(:155)/`_checkWorkflow`(:312,:331) 用 `specBase` 替代裸 `cwd`
3. `scan-docs.yaml` outputs.path 改占位符 `{SPEC_ROOT}/docs/<project>/scan/...`；`run.js` outputStep(:641-645) 渲染时替换占位符（参考 :2683-2684 archive 分支对 `<change-name>` 的处理）
4. 项目名统一：post-check 用 change 的 project 字段（platformOpts.specRoot 模式即 dbProjectName），非 perProject 标记 —— 消除 myaaa/frontend 分裂
5. 两套 post-check 不强行合并（workflow.js 走 specBase 后行为与 scan-postcheck.js 一致即可）

**验收**：scan 跑完 post-check 检查 spec-root 下真实文档路径，不再报"目录不存在 .sillyspec/docs/frontend/scan/"。

### 4.3 B4 门控失效（sillyspec）

**根因**：`run.js:2433-2438` scan post-check 失败分支只 `stageData.status=FAILED_POST_CHECK` + console.error，**无 return**，控制流穿透到 :2603 无条件 `return {stageCompleted:true}`。对照 plan contract(:2551) 失败时 `return {stageCompleted:false}` 写对了。

**修复**：
1. `run.js:2433-2438` 失败分支末尾补 `return { stageCompleted:false, currentIdx, nextPendingIdx: currentIdx }`；平台模式（platformOpts.specRoot 存在）追加 `process.exit(1)` 让 SillyHub 感知非0退出码
2. `run.js:2323` `stageData.status='completed'` 无条件赋值**推迟**到 post-check 通过之后（当前先标 completed 再跑 post-check，顺序反了）
3. `stage-contract.js:592` `checkTransition` 增加防御：`stageData.status==='failed_post_check'` 时从 scan 进下游阶段 `return {allowed:false, reason:'scan post-check 未通过，需修复重跑'}`
4. `run.js:2645-2670` workflow post_check 的 `anyFailed` 也触发 return false（B1 那套同样只报不挡）

**验收**：post-check 失败时 `--done` 被拒、CLI exit 非0、stage 状态为 failed_post_check；下游阶段被 transition 门控拦截直到修复。

### 4.4 C1 init 残留（SillyHub）

**根因**：`context_builder.py:465` `init_cmd = f"sillyspec init --dir {root_path}"`，root_path 是源码目录 → 平台模式在源码目录建 .sillyspec → 后续每步 scan/done 触发 sillyspec 的源码保护"拒绝删除源码目录的 .sillyspec：检测到真实资产"。

**修复**：`build_scan_bundle`（context_builder.py:465-505）平台模式（`platformOpts.specRoot` 存在）**跳过 init 步骤**——平台模式文档写 spec-root，源码目录不需要 .sillyspec。stage 模式（service.py:1006-1019 start_stage_dispatch）同理不含 init，无需改。

**验收**：scan 全程不再出现"拒绝删除源码目录的 .sillyspec"。

## 5. P1 详细设计

### 5.1 B2 scan-projects 脏数据（sillyspec）

**修复**：
1. `run.js:2154-2156` `sanitizeProjectName` 加字母校验：`if (!/[a-zA-Z]/.test(clean)) return null`（纯数字 "0"/"7" 被拒）；同时最小长度 `clean.length < 2` 返回 null
2. `run.js:2160` 正则收紧：先用段分隔正则截取"扫描项目列表"段（如 `/扫描项目列表[：:]\s*\n([\s\S]*?)(?:\n\n|\n###|$)/`），段内再匹配 `/^\s*\d+\.\s+(\S+)/gm`；或要求 token 以字母开头 `/^\s*\d+\.\s+([a-zA-Z][\w\-.]*)/gm`

**验收**：scan-projects.json 仅含合法项目名（含字母、长度≥2），无 "0"/"7"；不误建 projects/0.yaml。

### 5.2 B3 doctor 幽灵命令（sillyspec）

**修复**（推荐加顶层别名）：`src/index.js` switch(160-804) 增 `case 'doctor':` `case 'scan':` `case 'status':` `case 'quick':` `case 'explore':`，内部转发 `runCommand([stageName, ...rest], dir, specDir)`，与 `case 'run':`(:271) 一致。`doctor` 已在 stageRegistry（stages/index.js:25）注册，`sillyspec run doctor` 可用，别名只是补顶层入口。

**验收**：`sillyspec doctor` 和 `sillyspec run doctor` 都工作；`sillyspec scan` 同理。

### 5.3 D1/D2/D3 日志碎片化+重复（SillyHub）

**根因**：[THINKING] 两条独立 emit 路径。路径A（partial 增量）：session-manager.ts:1323-1444 缓冲 + stream-json.ts:148-149 节流（80字符/120ms）切片 flush。路径B（完整累积）：完整 assistant message 到达，_onMessage(:1301-1303) `_clearPartialBuffer` 只清 buffer 撤销不了已 flush 行；backend `_extract_sdk_messages`(service.py:3329-3488) 展开全文 [THINKING]。tool_call 双写是故意的（stdout 人读 + JSON 给前端），但前端 ±3 窗口漏合并。

**修复（源头，按 D-002）**：
1. **partial/完整去重** — session-manager.ts：完整 assistant message 到达时，记录该 thinking segment 的 stable id；partial 行携带同 segment id。backend `submit_messages`(service.py:1088-1290) 落库时，若该 segment 已有完整行，丢弃同 segment 的 partial 行；或前端 normalize 用完整行覆盖同 segment partial（对照 mergeAssistantPiece:208-237 已对 assistant 做的去重，补到 thinking 路径）
2. **backend `_extract_sdk_messages`**：完整 message 展开全文 [THINKING] 时，如检测该段已有 partial 落库，标记去重
3. **tool_call 全局配对**（两步）：
   - **源头补字段**：`task-runner.ts:1284-1304` / `service.py:3443-3462` emit tool_call JSON 时加入 `tool_use_id`。当前日志样例 `{"tool","args","timestamp","status","success"}` **不含 id**，需补。id 取自 SDK content_block_start 事件的 tool_use block index/id（delta 流和完整 message 共享同一 block id）。
   - **前端配对**：normalize.ts:359-386 放弃 ±3 索引窗口，改用 `tool_use_id` 全局关联 stdout `[TOOL_USE]` 与 tool_call JSON（两者 emit 时都带同一 id），窗口外也能合并。
   - **退化方案**：若 SDK 不提供稳定 block id，退化为"时间戳邻近 + tool 名匹配"启发式配对（扩大窗口上限并去重），并接受偶发漏配对。

**验收**：同一思考内容只出现一次；同一 tool 调用只一张卡片（含窗口外场景）。

### 5.4 前端 timeline 重设计

**改造**（参考原型 `prototype-agent-log-viewer.html`）：
1. `frontend/src/components/agent-log/normalize.ts`：thinking 跨 `[TOOL_USE]`/`[ASSISTANT]` 断点的去重；tool_use↔result 全局配对（tool_use_id）
2. `frontend/src/components/agent-log-viewer.tsx`（AgentLogRow:173-344 + AgentLogViewer:350-589）：渲染改为 **turn 分组**（一个 turn = assistant 文本 + 其触发的 tool_use 集合 + 各自 result）；thinking 默认折叠成单行摘要（点击展开）；tool_call JSON 收进 `ToolCallPreview` 卡片；channel 着色强化（user_input 紫 / thinking 灰 / assistant 亮 / tool 蓝 / 成功绿 / 失败红）
3. `frontend/src/components/agent-log/tool-renderers.tsx`：tool 卡片头部加状态徽标（✓/✗ + 耗时），点击展开参数与结果

**验收**：日志可读性大幅提升；无重复卡片；thinking 折叠/展开交互正常；tool 卡片状态清晰。

### 5.5 Token 消耗展示（D-006@v1，用户补充需求）

**数据源（已有，无需后端逻辑改动）**：`AgentRun` 表已含 `input_tokens` / `output_tokens`，daemon 实时回写：
- `sillyhub-daemon/src/daemon.ts:1070-1080` — assistant message 的 usage 提到顶层，backend `submit_messages` 实时更新 `AgentRun.input_tokens/output_tokens`（累积值，每条 assistant message 都带）
- `sillyhub-daemon/src/daemon.ts:1000-1004` — result 事件 usage 汇总
- `sillyhub-daemon/src/task-runner.ts:1192-1195` — `usage_update` 事件透传给 backend

**前端展示**：
- run 概要区（`AgentRunPanel` / `AgentLogViewer` 顶部）展示累计 **input / output tokens**（从 `AgentRun` 读，SSE done 事件终态 + 流式期间从 `usage_update` 刷新）
- turn 级增量：当前 usage 是累积值，turn 级需前端对相邻 assistant message 的 usage 差分（YAGNI，先做 run 级累计展示）

**API 确认**：确认 `frontend/src/lib/agent.ts` 的 `getAgentRun` / `StreamLogEvent` 返回 `input_tokens` / `output_tokens`；如未返回，backend `agent` router 补字段暴露。

**验收**：agent-run 日志面板可见 input/output token 消耗，流式期间实时更新。

## 6. 数据模型 / 接口变更

- **无 schema 迁移**。本变更不动 DB 表结构。
- `AgentRunLog` 落库逻辑（service.py:1159-1167）增加 thinking segment 去重判断（应用层逻辑，非 DDL）。
- daemon ↔ backend interactive claim payload 新增 `specRoot`/`runtimeRoot` 字段（`_build_claim_payload`，daemon service.py:618-638）——向后兼容（daemon 未读到则回退 prompt 翻译）。
- normalize.ts `ProcessedLog`（types.ts）可能新增 `toolUseId` 关联字段 + thinking segment id。

## 7. 跨仓库管理（D-004）

- sillyspec 改动在 `C:\Users\qinyi\IdeaProjects\sillyspec` 源码改 + git 提交（B1/B2/B3/B4）
- 全局安装生效：sillyspec v3.18.5 当前全局安装于 `C:/Users/qinyi/AppData/Local/nvm/v24.15.0/node_modules/sillyspec`。改完源码后 `npm link`（或 reinstall）让全局命令指向新源码。execute 阶段确定具体方式
- 本变更文档（design/plan/tasks）在 multi-agent-platform 仓库记录跨仓库影响；sillyspec 仓库自身提交信息回引本变更名

## 8. 验收标准

| ID | 验收点 |
|---|---|
| A1 | Windows daemon 跑 scan，agent spec-root = `C:/data/...`，无 EPERM；backend/daemon/agent 三方见同一物理目录 |
| B1 | post-check 检查 spec-root 下真实文档路径，项目名一致，无"目录不存在" |
| B4 | post-check 失败时 `--done` 被拒、exit 非0、transition 门控生效 |
| C1 | scan 全程无"拒绝删除源码目录的 .sillyspec" |
| B2 | scan-projects.json 无纯数字项目名 |
| B3 | `sillyspec doctor` / `sillyspec scan` 直接可用 |
| D1/D2 | 同一思考只出现一次（无增量段+完整段重复） |
| D3 | 同一 tool 调用只一张卡片（含窗口外场景） |
| 前端 | timeline turn 分组、thinking 折叠、tool 卡片状态徽标、无重复 |

最终联调验收：用修复后的 sillyspec + SillyHub 对 `myaaa` 重跑一次完整 scan，确认全程无 EPERM、无 post-check 误报、日志可读、最终状态正确（不再 completed_with_warnings/failed_post_check 带病推进）。

## 9. 兼容策略（D-003）

- spec-data named volume → bind mount：既有 named volume 数据按 CLAUDE.md 规则7（未上线可清空）直接重建。需 `docker volume rm spec-data`（如存在）+ 重建容器。`.env` 不配 `SPEC_DATA_HOST_DIR` 时默认 `C:/data/spec-workspaces`。
- daemon SPEC_ROOT_MAP 未配置时：翻译器跳过（保持现状行为），不报错——向后兼容旧 daemon。
- backend claim payload specRoot 字段：daemon 旧版不读该字段（undefined）回退 prompt 翻译，兼容。
- sillyspec B1 占位符替换：旧 scan-docs.yaml（无占位符）时 workflow.js 仍按旧逻辑（fallback cwd）——但本次会一并更新 yaml。

## 10. 风险与对策

| 风险 | 对策 |
|---|---|
| daemon-service-split 正在拆分 daemon.ts（W1 建 facade），本次改 daemon.ts:1694-1705 + 日志记录可能落在被拆分文件 | execute 前确认 daemon-service-split 当前进度，若 daemon.ts 已拆出日志/路径模块，定位新位置改；否则在原文件改并留 TODO |
| sillyspec 改源码后全局未生效（daemon 调旧版） | execute 验证 `sillyspec --version` / `which sillyspec` 指向新源码；npm link 后确认 |
| bind mount 路径 C:/data/spec-workspaces 宿主机权限 | 默认路径在 C 盘根，Windows 用户目录可写；如遇权限，.env 改 SPEC_DATA_HOST_DIR 到用户目录 |
| thinking segment 去重改动 daemon 缓冲逻辑，可能影响流式实时性 | 去重只在"完整 message 到达"时触发，partial 实时 flush 行为保留（折叠展示在前端，不阻塞流式） |
| B4 门控变严后，既有进行中 scan 变更可能卡在 failed_post_check | transition 门控允许 `--reset` 或修复后重跑；不影响新变更 |

## 11. 决策覆盖映射

| 决策 | 覆盖章节 | 状态 |
|---|---|---|
| D-001@v1 A1=bind mount+daemon翻译 | §4.1 | accepted |
| D-002@v1 前端=修bug+优化展示 | §5.3, §5.4 | accepted |
| D-003@v1 数据迁移可清空 | §9 | accepted |
| D-004@v1 sillyspec 跨仓库管理 | §7 | accepted |
| D-005@v1 执行策略 P0/P1 | §3 | accepted |
| D-006@v1 token 消耗展示 | §5.5 | accepted |

## 12. 非目标（YAGNI）

- 不重写 daemon 整个 interactive session 生命周期（仅修路径翻译 + 日志去重）
- 不统一 sillyspec 两套 post-check 为一套（workflow.js 走 specBase 后行为一致即可）
- 不改日志传输协议（仍 SSE + Redis pubsub + DB 落库）
- 不做 agent-run 日志的全文搜索/过滤增强（仅修展示 bug + timeline 重设计）
- 不处理 backend 容器与 daemon 在 macOS/Linux 宿主的情况（当前仅 Windows 主机）

## 13. 自审

- **需求覆盖**：A1/C1/D1/D2/D3/B1/B2/B3/B4 + 前端展示，全部覆盖 ✓
- **决策引用**：D-001~D-005 全部映射（§11）✓
- **约束一致性**：与 scan CONVENTIONS.md（monorepo、backend Python/daemon Node、frontend Next.js）一致 ✓
- **真实性**：所有 file:line 来自 3 个 Explore agent 实际调研，未编造 ✓
- **YAGNI**：非目标章节已界定 ✓
- **验收标准**：每条具体可测试（§8）✓
- **兼容策略**：回退路径明确（§9）✓
- **风险识别**：5 条风险 + 对策（§10）✓
- **生命周期契约**：本变更不动 session/lease/claim 状态机，仅动 claim payload 字段透传（向后兼容）+ 日志 IR 去重，无需完整生命周期契约表 ✓
- ⚠️ **自审存疑 1**：D1/D2 partial/完整去重的 segment id 方案需在 execute 时验证 SDK 事件是否提供稳定 thinking block id；若无，退化为前端 normalize 启发式去重（对照 mergeAssistantPiece）
- ⚠️ **自审存疑 2（Design Grill X-001）**：§5.3.3 tool_call 全局配对依赖 `tool_use_id`，但当前 tool_call JSON 不含该字段（日志样例证实）。已在 §5.3.3 补"源头补字段 + 退化方案"。execute 验证 SDK 是否提供稳定 block id。

自审通过，进入下一步。

## 14. 文件变更清单

### P0
**SillyHub（本仓库）**
- `deploy/docker-compose.yml` — spec-data named volume → bind mount（`${SPEC_DATA_HOST_DIR:-C:/data/spec-workspaces}:/data/spec-workspaces`）
- `deploy/.env.example` — 新增 `SPEC_DATA_HOST_DIR` 变量
- `sillyhub-daemon/src/config.ts`（或 `daemon-start.bat`）— 注入 `SPEC_ROOT_MAP=/data/spec-workspaces:<host>`
- `sillyhub-daemon/src/daemon.ts:1694-1705` — 确认 SPEC_ROOT_MAP 翻译器读取生效；interactive 路径补读 payload.specRoot 双保险
- `backend/app/modules/daemon/lease/context.py:59-79` — `_build_claim_payload` interactive 分支补 specRoot/runtimeRoot 透传（daemon-service-split 后从 service.py 迁出，service.py 现为 facade）
- `backend/app/modules/agent/context_builder.py:465-505` — `build_scan_bundle` 平台模式跳过 init_cmd

**sillyspec（`C:\Users\qinyi\IdeaProjects\sillyspec`）**
- `src/run.js:2323,2433-2438,2627-2629,2647` — scan post-check 失败补 return+exit；completed 标记推迟；项目名用 change.project；调 runPostCheck 传 specBase
- `src/workflow.js:155,312,331` — checkOutput / _checkWorkflow 用 specBase 替裸 cwd
- `src/stage-contract.js:592` — checkTransition 加 failed_post_check 门控
- `templates/workflows/scan-docs.yaml` — outputs.path 改占位符 `{SPEC_ROOT}/docs/<project>/scan/...`

### P1
**sillyspec**
- `src/run.js:2154-2156,2160` — sanitizeProjectName 加字母校验 + 正则收紧
- `src/index.js:160-804` — switch 加顶层 case（doctor/scan/status/quick/explore）转发 runCommand

**SillyHub（本仓库）**
- `sillyhub-daemon/src/interactive/session-manager.ts:1301-1303,1323-1444` — partial/完整 thinking 去重（segment id）
- `sillyhub-daemon/src/task-runner.ts:1284-1304` — tool_call JSON 补 tool_use_id
- `sillyhub-daemon/src/adapters/stream-json.ts` — thinking delta 携带 segment id（如 SDK 提供）
- `backend/app/modules/daemon/run_sync/service.py:691-850` — `_extract_sdk_messages` 完整 message 去重（daemon-service-split 后从 service.py 迁出）
- `backend/app/modules/daemon/run_sync/service.py:48-136` — `submit_messages` 落库按 segmentId 去重
- `backend/app/modules/daemon/run_sync/service.py:805-824` — tool_call JSON 补 tool_use_id

**frontend（本仓库）**
- `frontend/src/components/agent-log/normalize.ts:294-316,359-386` — tool_use 全局配对（tool_use_id）+ thinking 跨断点去重
- `frontend/src/components/agent-log-viewer.tsx:173-589` — turn 分组渲染 + thinking 折叠摘要
- `frontend/src/components/agent-log/tool-renderers.tsx` — tool 卡片状态徽标（✓/✗ + 耗时）
- `frontend/src/components/agent-log/types.ts` — ProcessedLog 加 toolUseId / segmentId（如需）
- `frontend/src/components/agent-run-panel.tsx` — run 概要区展示 input/output tokens
- `frontend/src/lib/agent.ts` — 确认 getAgentRun / StreamLogEvent 返回 input_tokens / output_tokens
