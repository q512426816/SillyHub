# 验证报告（骨架由 `sillyspec verify-probes --change <变更名> --init` 生成）

> 探针结果已机械预填；其余章节为 agent 逐项验证后填写。

---
author: qinyi
created_at: 2026-08-28 07:05:30
---

## 结论：PASS WITH NOTES

7/7 任务全部完成且与 design.md 一致；单元测试后端 675+前端 347 全绿；**真实容器集成验证 8 场景全通过**（含【PPM 任务上下文】前导真实注入 dispatch_prompt）；Notes 为 3 条非阻断事项（探针 5 基线过窄误报、alembic 并行分叉已修、预存测试债基线）。

## 任务完成度

| Task | 状态 | 证据 |
|---|---|---|
| task-01 绑定基座 | ✅ | ppm/common/session_binding.py + router.py + 迁移 20260828100000 + test_session_binding.py 15 用例；容器 DB 实测表/列/唯一约束在位 |
| task-02 三通道 | ✅ | schema 成对字段+422、create/inject/list 三层透传、test_ppm_session.py 14 用例；集成实测 A(422)/B(201 降级)/G(追问绑定)/H(422) |
| task-03 注入 | ✅ | build_ppm_item_context_preamble + _materialize_ppm_attachments + 五类降级 + 事务守卫测试 13 新用例；集成实测 lease prompt 含完整前导 |
| task-04 前端 API 层 | ✅ | gen:types api-types+73/openapi+158 幂等；四契约类型落点齐；daemon.ts 四透传+listItemSessions |
| task-05 入口与卡片 | ✅ | pendingPpmItem 挂起位+三入口+ppm-item-sessions-card；集成实测 item-sessions 端点返回本人会话列表（含 author/title） |
| task-06 @联想与筛选 | ✅ | 两分组+切全部+atEnabled 门控+列表 ppm 三段编码筛选；集成实测筛选命中/排除 |
| task-07 发起团队修复 | ✅ | autoTeamIntent→autoTeamOpen→自动弹层+defaultProjectId 预选+objective 预填；两步浮层 P2-3 修复含 2 新用例 |

完成率 7/7 = 100%。

## 设计一致性

与 design.md 一致。execute 期已记录的实现偏差（QA 验收通过并已补录 design §6/§7）：facade daemon/service.py 纯转发 +19 行（三层透传必经）；_materialize_ppm_attachments 实现签名优于草图（design §7 已注"以实现为准"）；pendingPpmItem 多带可选 title（零额外请求）。Reverse Sync：无实现超出 design 未覆盖范围。

## 探针结果（CLI 机械预填）

#### 探针 1：未实现标记扫描（design 清单文件）
- ✅ 无 TODO/FIXME/尚未实现 标记命中
- ℹ️ 清单文件不存在（跳过）：backend/migrations/versions/<rev>_add_ppm_item_session_links.py（设计用占位符命名，实际文件 20260828100000_add_ppm_item_session_links.py 已验证存在）

#### 探针 2：设计关键词覆盖
全部覆盖（grep 实证）：item-sessions 端点（ppm/common/router.py:89）、bind_session_to_ppm_item/resolve_item_workspace_id/load_ppm_item/load_item_files（session_binding.py）、session_ppm_bind_item_missing 降级（service.py+专测）、无权访问降级（service.py 5 处+GWT-3 断言）、分析项目 objective 预填（session-panel.tsx 3 处）、附件物化/降级（service.py _materialize_ppm_attachments）、@联想 PPM 分组（session-mention-sources.ts）、ppm 筛选（session-list-panel.tsx 8 处）。

#### 探针 3：验收标准测试覆盖
（CLI 预填 7 task 全 ✅ 略——见上方任务完成度表）
- 断言有效性抽查（3 个核心测试）：①test_ppm_session.py——走公开 API（httpx client）断言 link 落行/422/降级 warning/幂等，非空断言；②test_session_service.py TestPpmAttachmentDegrade——四类降级各一断言（真实输出检查）；③floating-session-host.test.tsx——断言 preContext.ppmItem+workspaceId 真实送达 mock 面板（DOM data 属性），非 getter 空测。均达标。
- 集成盲区：已补真实容器集成验证（见 Runtime Evidence），路由装配（main.py 挂载）实测可用。

#### 探针 4：决策追踪覆盖
闭环，无未决：D-001@v1→FR-02/04→task-05/06✅；D-002@v1→FR-02→task-06✅；D-003@v1→FR-03→task-03✅；D-004@v2→FR-01/04/06→task-01/05/07✅（升序键前后端同键断言齐）；D-005@v1→FR-01→task-01✅；D-006@v1→FR-03→task-03✅；D-007@v1→FR-03→task-03✅。无 P0/P1 unresolved。

#### 探针 5：API Contract Parity
- CLI 判 failed 属**探针基线过窄的系统性误报**：endpoints.json 仅含 task-01 提取的 69 端点，对账对象却是全仓 500+ 前端调用（scope: full-repo），missing 条目全部是既有功能调用（/api/auth/login、/api/workspaces 等本变更无关）。
- 本变更相关判定（真实路由核对）：新端点 GET /api/ppm/item-sessions 后端存在（ppm/common/router.py:89 装饰器+openapi.json:24738 收录）且前端有调用（daemon.ts listItemSessions）；POST /api/daemon/sessions、GET /api/daemon/sessions?ppm_item_kind= 真实存在且集成实测通过（见 Runtime Evidence）。**无本变更引入的 contract gap**。

#### 探针 6：代码删除对账
- ✅ git diff 无整文件删除；无静默删码。

## 测试结果

| 套件 | 结果 |
|---|---|
| backend 相关（ppm/common + daemon `-k "session or ppm"`） | 675 passed / 611 deselected（226.77s，worktree） |
| backend 关键文件复跑（主仓 merge 后） | test_ppm_session 14 passed + ruff All checks passed |
| frontend 相关 11 文件 | 347 passed（11 files，19.21s） |
| frontend 合并冲突文件复跑 | floating-session-host 26 passed（含 P2-3 新增 2 例）+ tsc --noEmit 0 错误 |
| known_failures 豁免 | session-panel-variant.test.tsx 1 例为基线预存债（local.yaml B 段已记录，非本变更引入，本变更未触碰该文件） |

## 决策追踪矩阵

| 决策 ID | FR | Task | Evidence | 状态 |
|---|---|---|---|---|
| D-001@v1 | FR-02, FR-04 | task-05/06 | 三入口+@联想分组（集成+单测） | 闭环 |
| D-002@v1 | FR-02 | task-06 | 默认进行中+切全部开关（sources 测试 7 用例） | 闭环 |
| D-003@v1 | FR-03 | task-03 | 物化注入+降级清单（GWT-2/3） | 闭环 |
| D-004@v2 | FR-01/04/06 | task-01/05/07 | workspace_id 升序（resolve ORDER BY+前端 sort 断言+集成实测 ws 回填 fe8fdaeb） | 闭环 |
| D-005@v1 | FR-01 | task-01 | 单表 kind+唯一约束（容器 DB 约束 uq_ppm_item_session_link_pair 实测） | 闭环 |
| D-006@v1 | FR-03 | task-03 | SessionAttachment 物化链+daemon 仓零 diff | 闭环 |
| D-007@v1 | FR-03 | task-03 | _can_access 口径+无权仅文件名（降级专测） | 闭环 |

## 技术债务

本次变更零新增 TODO/FIXME。遗留：①session-panel-variant 1 例预存债（归属变更收尾修复，local.yaml 已记录）；②探针 5 的 endpoints.json 基线机制（仅 task-01 视角对账全仓）属工具缺陷，已按 CLAUDE.md 规则 15 记录到 docs/sillyspec/（见 verify-known-failures 系列同款问题）。

## 变更风险等级

integration-critical（brainstorm 阶段 CLI 判级，属实非误伤——本变更触碰 session 创建链路 + daemon 协议消费面）。集成证据见下节，满足门控。

## Runtime Evidence

**真实容器集成验证**（docker compose 全栈：backend 重建镜像含本变更代码，容器 multi-agent-platform-backend-1 @ 127.0.0.1:8001，2026-08-28 早晨）：

1. **部署**：`docker compose build backend && up -d` → 容器内 `from app.modules.ppm.common.router import router` OK；`alembic upgrade head` 成功（发现并修复并行变更多 head：merge 迁移 6756e634f119 合并 20260828100000/20260828120000 两头）。
2. **建表**：容器 PG 实测 `ppm_item_session_links` 表存在，列 [id,kind,item_id,session_id,workspace_id,created_at]，唯一约束 uq_ppm_item_session_link_pair。
3. **端点探活**：`GET /api/ppm/item-sessions?kind=plan_task&item_id=<uuid>` → 200 `[]`（空态）。
4. **数据构造**（真实 HTTP）：登录 admin → 创建工作区 verify-spt-ws → PPM 项目 VSP-T001 → 项目关联工作区 201 → 计划任务「verify-spt 集成验证任务」（status=进行中, project_id 挂接）。
5. **绑定链路**：
   - A 只传 kind → **422**（成对校验）✅
   - B item 不存在 → **201 降级普通会话不报错**（§9 容错）✅
   - C 真实任务绑定 → **201**，`ppm_item_session_links` 落行，link.workspace_id=会话 workspace_id=项目第一个关联工作区 fe8fdaeb（D-004@v2 解析+回填）✅
   - **前导注入**：daemon_task_leases.metadata.prompt 实测含——
     ```
     【PPM 任务上下文】
     - 标题：verify-spt 集成验证任务
     - 描述：集成验证：会话关联 PPM 任务全链路
     - 状态：进行中
     - 项目：verify-spt-项目
     - 责任人：admin
     - 周期：2026-08-28 ~ 2026-08-30
     ---
     集成验证-真实绑定
     ```
     （全字段前导 + 用户原文拼接，真实 runtime evidence）✅
   - D `GET /api/ppm/item-sessions` → 200 返回 2 条关联会话（id/title/author.display_name 结构完整，卡片数据源可用）✅
   - E `GET /api/daemon/sessions?ppm_item_kind=&ppm_item_id=` → 200 命中 2 条；F 错 kind 过滤 → 0 条（排除正确）✅
   - G 追问 inject 携带 bind_ppm_item_* → 201 入队；重复发送幂等（link 行数保持 1，唯一约束生效）✅
   - H inject 只传其一 → **422** ✅
6. **清理**：会话软删（ended+deleted_at）、项目/工作区删除、任务与 link 行清理（links now: 0）；软删会话的 link 行保留与读取端点 deleted_at 过滤对齐 quicklog 模式（设计内）。
7. **daemon 进程**：本变更 sillyhub-daemon 仓零改动（git diff 实证），会话实际执行需 daemon 认领 lease——provider=claude 无在线 runtime 时会话进入排队（B/C 例 status），绑定与前导写入发生在 backend 侧已全部实证；daemon 消费面走既有 SESSION_INJECT 协议（协议零变更），由 675 单测+QA 验收覆盖，不涉及本次新风险。

## 代码审查

（execute step-12 已完成全量审查 + QA acceptance review 独立复审）风格合规（ruff 全过/中文注释含变更名标注/主题 token）；错误处理完善（五类附件降级+item 缺失容错+成对校验）；无 TODO 残留；无冗余（可选参数保旧调用点零改动）；架构合规（挂载形态/分层照既有模式）。总体评价：实现质量良好，可归档。
