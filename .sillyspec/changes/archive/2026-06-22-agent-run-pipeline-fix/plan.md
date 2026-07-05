---
author: qinyi
created_at: 2026-06-22T21:19:09
change: 2026-06-22-agent-run-pipeline-fix
---

# Plan: agent-run 调度链路修复 + 前端日志展示优化

plan_level: full

## 概览
- **仓库**：SillyHub（本仓库）+ sillyspec（`C:\Users\qinyi\IdeaProjects\sillyspec`）
- **策略**：拓扑 Wave（满足 depends_on）+ priority 调度（D-005@v1：同 Wave 内 P0 优先，先止血再优化）
- **Wave**：4 个（拓扑深度 0/1/2/3）；17 任务
- **Spike**：不需要；**批量模式**：不适用

## 全局验收标准
- FR-01~FR-11（见 requirements.md）全部满足
- **兼容性条款（brownfield）**：daemon 未配 `SPEC_ROOT_MAP` 时翻译器跳过不报错；backend claim payload `specRoot` 字段对 daemon 旧版无影响；sillyspec scan-docs.yaml 占位符旧值时 workflow.js 回退 cwd；无 DB schema 变更
- 联调：用修复后的 sillyspec + SillyHub 对 `myaaa` 重跑完整 scan，全程无 EPERM / 无 post-check 误报 / 无 init 告警 / 无碎片重复卡片 / token 展示正常 / 最终状态正确

## execute 调度策略（D-005@v1 落地）
- Wave 串行（W1→W2→W3→W4）；同 Wave 内任务无依赖、可并行
- **同 Wave 内 P0 任务优先于 P1**（先打通 scan 主链路止血，再做体验优化）
- priority 列标注每个 task 的 P0/P1，execute 按此调度

---

## Wave 1: 拓扑深度 0（无依赖，可并行）
**P0**：task-01（A1 bind mount）、task-04（B1 workflow specBase）、task-06（B4 post-check return）、task-08（C1 跳过 init）
**P1**：task-09（B2 字母校验）、task-10（B3 别名）、task-11（D1/D2 daemon partial）、task-13（D3 tool_use_id 源头）、task-16（token 展示）

- [x] task-01: [A1][SillyHub-deploy] docker-compose spec-data 改 bind mount + .env.example 加 SPEC_DATA_HOST_DIR（文件: deploy/docker-compose.yml、.env.example；完成: 容器/宿主共享同一物理目录）
- [x] task-04: [B1][sillyspec] workflow.js checkOutput/_checkWorkflow 走 specBase（文件: sillyspec/src/workflow.js:152,256；run.js:2647,2685；完成: post-check 检查 spec-root 下路径）
- [x] task-06: [B4][sillyspec] scan post-check 失败补 return + completed 推迟 + 平台 exit(1)（文件: sillyspec/src/run.js:2323,2433；完成: 失败时 --done 被拒、exit 非0）
- [x] task-08: [C1][SillyHub-backend] build_scan_bundle 平台模式跳过 init（文件: backend/app/modules/agent/context_builder.py:422；完成: 无 init 残留告警）
- [x] task-09: [B2][sillyspec] sanitizeProjectName 字母校验 + 正则收紧（文件: sillyspec/src/run.js:2154,2160；完成: scan-projects.json 无纯数字）
- [x] task-10: [B3][sillyspec] index.js 顶层命令别名 doctor/scan/status/quick/explore（文件: sillyspec/src/index.js:160-804；完成: sillyspec doctor 可用）
- [x] task-11: [D1/D2][SillyHub-daemon] partial/完整 thinking 按 segmentId 去重（文件: sillyhub-daemon/src/interactive/session-manager.ts:1454；完成: 同一思考只出现一次）
- [x] task-13: [D3][SillyHub] tool_call JSON 补 tool_use_id（文件: sillyhub-daemon/src/task-runner.ts:1284；run_sync/service.py:805；完成: JSON 含 id）
- [x] task-16: [token][前端] agent-run-panel 展示 input/output tokens（文件: frontend/src/components/agent-run-panel.tsx；agent.ts；完成: 面板可见 token，流式更新）

**W1 退出标准**：FR-04（C1）、FR-05（B2）、FR-06（B3）满足；A1/B1/B4/D1/D2/D3/token 的源头/独立部分完成。

---

## Wave 2: 拓扑深度 1（依赖 W1）
**P0**：task-02（←task-01 A1 翻译）、task-05（←task-04 B1 yaml/项目名）、task-07（←task-06 B4 transition 门控）
**P1**：task-12（←task-11 D1/D2 backend 去重）、task-14（←task-13 D3 前端配对）

- [x] task-02: [A1][SillyHub-daemon] 激活 SPEC_ROOT_MAP（修复 split(':',2) Win 盘符 bug）（文件: sillyhub-daemon/src/config.ts；daemon.ts:1694；完成: /data/→C:/data/ 翻译）
- [x] task-05: [B1][sillyspec] scan-docs.yaml 占位符 + 项目名统一 change.project（文件: sillyspec/templates/workflows/scan-docs.yaml；run.js:641,2627；完成: 写入路径与检查路径一致）
- [x] task-07: [B4][sillyspec] checkTransition 加 failed_post_check 门控（扩展第3参 options）+ workflow anyFailed 阻断（文件: sillyspec/src/stage-contract.js:592；run.js:2645；完成: failed_post_check 阻断下游）
- [x] task-12: [D1/D2][SillyHub-backend] submit_messages 落库按 segmentId 去重（文件: backend/app/modules/daemon/run_sync/service.py:691,48；完成: AgentRunLog 无重复 thinking）
- [x] task-14: [D3][前端] normalize tool_use_id 全局配对 + thinking 跨断点去重（文件: frontend/src/components/agent-log/normalize.ts:294,359；完成: 同一 tool 一张卡片）

**W2 退出标准**：FR-02（B1）、FR-03（B4）、FR-07、FR-08（D1/D2）、FR-09（D3）满足。

---

## Wave 3: 拓扑深度 2（依赖 W2）
**P0**：task-03（←task-02 A1 payload 透传）
**P1**：task-15（←task-14 前端 timeline）

- [x] task-03: [A1][SillyHub-backend] _build_claim_payload 透传 specRoot/runtimeRoot + daemon warn 监测（文件: backend/app/modules/daemon/lease/context.py:59；完成: payload 含 specRoot，双保险）
- [x] task-15: [前端] agent-log-viewer turn 分组渲染 + thinking 折叠 + tool 卡片状态徽标（文件: frontend/src/components/agent-log-viewer.tsx；tool-renderers.tsx；完成: timeline 展示对照原型）

**W3 退出标准**：FR-01（A1 完整）、FR-10（前端 timeline）满足。

---

## Wave 4: 拓扑深度 3（依赖全部）
- [x] task-17: [联调] sillyspec npm link + 对 myaaa 重跑完整 scan（完成: 对照 requirements.md 联调验收）

---

## 任务总表

| task | Wave | 优先级 | 问题 | 仓库 | 主文件 | 依赖 |
|---|---|---|---|---|---|---|
| task-01 | W1 | P0 | A1 | SillyHub-deploy | docker-compose.yml | — |
| task-02 | W2 | P0 | A1 | SillyHub-daemon | config.ts, daemon.ts:1694 | task-01 |
| task-03 | W3 | P0 | A1 | SillyHub-backend | daemon/lease/context.py:59 | task-02 |
| task-04 | W1 | P0 | B1 | sillyspec | workflow.js:152,256 | — |
| task-05 | W2 | P0 | B1 | sillyspec | scan-docs.yaml, run.js:641 | task-04 |
| task-06 | W1 | P0 | B4 | sillyspec | run.js:2433 | — |
| task-07 | W2 | P0 | B4 | sillyspec | stage-contract.js:592 | task-06 |
| task-08 | W1 | P0 | C1 | SillyHub-backend | context_builder.py:422 | — |
| task-09 | W1 | P1 | B2 | sillyspec | run.js:2154,2160 | — |
| task-10 | W1 | P1 | B3 | sillyspec | index.js:160 | — |
| task-11 | W1 | P1 | D1/D2 | SillyHub-daemon | session-manager.ts:1454 | — |
| task-12 | W2 | P1 | D1/D2 | SillyHub-backend | run_sync/service.py:691 | task-11 |
| task-13 | W1 | P1 | D3 | SillyHub | task-runner.ts:1284, run_sync/service.py:805 | — |
| task-14 | W2 | P1 | D3 | frontend | normalize.ts:294,359 | task-13 |
| task-15 | W3 | P1 | 前端 | frontend | agent-log-viewer.tsx, tool-renderers.tsx | task-14 |
| task-16 | W1 | P1 | token | frontend | agent-run-panel.tsx, agent.ts | — |
| task-17 | W4 | — | 联调 | 跨仓库 | — | W1+W2+W3 |

## 决策覆盖矩阵
| 决策 | 覆盖任务 |
|---|---|
| D-001@v1 A1=bind mount+daemon翻译 | task-01, task-02, task-03 |
| D-002@v1 前端=修bug+优化展示 | task-11, task-12, task-13, task-14, task-15, task-16 |
| D-003@v1 数据迁移可清空 | task-01 |
| D-004@v1 sillyspec 跨仓库管理 | task-04, task-05, task-06, task-07, task-09, task-10 |
| D-005@v1 执行策略 P0/P1 | priority 列 + execute 调度策略（同 Wave 内 P0 优先） |
| D-006@v1 token 消耗展示 | task-16 |

## Wave 依赖与关键路径
```
W1（task-01,04,06,08,09,10,11,13,16）─ 无依赖，可并行
  └→ W2（task-02,05,07,12,14）
       └→ W3（task-03,15）
            └→ W4（task-17 联调）
```
- **关键路径**：task-01→02→03→17（A1 链 + 联调，跨 W1/W2/W3/W4）
- 次关键：task-13→14→15→17（前端 D3 链）
- 无循环依赖（已验证）

## execute 注意事项
1. **daemon-service-split 已重构**：`backend/app/modules/daemon/service.py` 现 537 行 facade；`_build_claim_payload` 在 `daemon/lease/context.py`，`_extract_sdk_messages`/`submit_messages`/tool_call JSON 在 `daemon/run_sync/service.py`。task-03/12/13 已用真实路径。
2. task-02 修复 `daemon.ts:1701` 的 `split(':',2)` 在 Windows 盘符场景（`/data:C:/data`）截断为 `to='C'` 的 bug，改 `indexOf(':')`+slice。
3. task-07 `checkTransition` 当前只收 2 参，扩展第 3 位 `options={fromStageData}` 可选参数（向后兼容）。
4. task-17 验证 `which sillyspec` 指向新源码；`docker volume rm spec-data` 清空（D-003@v1）。

## 验证命令（local.yaml 不存在，用默认）
- backend: `cd backend && mypy app && pytest`
- frontend: `cd frontend && npm run lint && tsc --noEmit && npm test`
- sillyspec: `cd sillyspec && node bin/sillyspec.js doctor`（修后）+ 对 myaaa 跑 scan
- daemon: `cd sillyhub-daemon && pnpm typecheck && pnpm test`
