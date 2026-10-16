---
author: qinyi
created_at: 2026-10-16 16:55:44
generated_by: sillyspec-fourpiece-init
change: 2026-10-16-conflict-full-tree-compare
---

# 决策记录（Decisions）

<!-- 增量落盘：每解决一个有实现影响的问题当场追加一条（格式见 brainstorm Step 3 模板）；幂等按 D-xxx@vN 判重 -->
<!-- 引用规范：evidence 等处的源码位置写仓根相对全路径+行号（src/foo.js:123）——裸文件名在 docs-check 层1 靠 basename 全仓扫描找候选，找不到候选或关键词窗口不匹配即失效，到 pre-push 才拦（2026-09-19 实证 64 处返修） -->

## D-001@v1: full-tree 冲突记录的兜底读由后端承担（不是 daemon）
- type: architecture
- priority: P0
- 模块域: backend
- status: accepted
- source: user
- question: 跨变更全量冲突在机器上落盘为 `spec-sync-conflict-full-tree.json`（CLI 归因口径），平台却按单变更名找 `spec-sync-conflict-<change>.json` 导致对比恒 `conflict_record_missing`；兜底读放哪一侧？
- answer: 用户确认放后端——后端在 daemon 返回 `conflict_record_missing` 时，以记录名 `full-tree` 重发快照 RPC，并在平台侧按该变更路径前缀过滤后做对比。理由：平台部署即生效，不依赖每台机器 daemon 自更新（daemon 侧修复要等自更新铺开）。
- normalized_requirement: `GET /api/daemon/machines/{id}/sillyspec-conflicts/{change}/compare` 在 `<change>` 记录缺失、而 `full-tree` 记录存在且含该变更路径时，仍返回该变更范围内的文件级对比（HTTP 200）；实现不得引入 daemon 版本依赖（旧 daemon 只需支持按任意 label 读记录，其既有行为）。
- impacts: [FR-1, task-02, verify-1]
- evidence: docs/sillyspec/conflict-compare-full-tree-label-mismatch.md；backend/app/modules/daemon/sillyspec_compare.py:410-454（RPC 与错误映射）；sillyhub-daemon/src/sillyspec-manager.ts:1612-1621（按 change 拼记录文件名读取）；backend/app/modules/daemon/router/machines.py:576-610（compare 端点）
- 故障面: 缺失场景多一次 RPC 往返；后端必须自证「路径归属」过滤正确——漏过滤会把别的变更的文件混入对比。
- 退役判据: CLI 侧记录命名与平台行归因口径统一（记录名即变更名）后，本兜底可删。

## D-002@v1: 「裁决」本轮不修，跨变更记录的裁决留 CLI 侧后续 change
- type: boundary
- priority: P1
- 模块域: backend, frontend
- status: accepted
- source: user
- question: 跨变更记录的「保本地/取平台」裁决在平台上同样不可用（CLI 按记录名匹配），本轮是否一起修？
- answer: 用户确认本轮只修对比+文案；裁决入口行为保持现状，平台对该类行的正确引导是「重新同步」或 CLI 侧 `sillyspec platform resolve full-tree`；CLI 口径改动另开 change。
- normalized_requirement: 本 change 不改裁决下发链路（daemon `sillyspec_resolve` 与前端裁决确认弹窗语义不变）；界面文案不得承诺跨变更记录可裁决。
- impacts: [FR-3, task-04]
- evidence: /c/nvm4w/nodejs/node_modules/sillyspec/src/sync.js:2296-2319（listConflictFiles 按 `cf.change` 匹配，full-tree 记录只能以 `full-tree` 名裁决）；sync.js:2108（按变更名找不到文件时报「无可解决冲突」）

## D-003@v1: 新增平台侧「标记已处理」关闭入口（复用已有 resolve 接口）
- type: boundary
- priority: P1
- 模块域: backend, frontend
- status: accepted
- source: user
- question: 注册表 open 行只有「下一次同步全绿」才自动关闭，刷新永不消失（用户实证「刷新了问题还在」）；是否加平台侧手动关闭入口？
- answer: 用户确认加——冲突行上加「标记已处理」，调用已有 `POST /api/workspaces/{workspace_id}/spec-conflicts/{conflict_id}/resolve`，仅可操作者（canOperate）可见/可点。
- normalized_requirement: 关闭动作把该行置 `resolved` 并从列表消失；成功/失败均有可读反馈；无权限者不可见该入口；不改后端既有 resolve 端点契约（已有 response_model/权限门）。
- impacts: [FR-4, task-05]
- evidence: backend/app/modules/spec_workspace/router.py:459-495（POST /spec-conflicts/{conflict_id}/resolve，WORKSPACE_WRITE）；frontend/src/components/changes/platform-sync-section.tsx:277-280（spec-conflicts?status=open 行来源）；backend/app/modules/spec_workspace/service.py:1366-1390（自动关闭契约）

## D-004@v1: 失败文案按 daemon_code 分支，`conflict_record_missing` 不再显示「离线/504」
- type: term
- priority: P1
- 模块域: frontend
- status: accepted
- source: user
- question: 对比失败卡写死「机器可能离线或对比读取超时（504）」，真实失败常是 502/记录缺失，误导排查（用户实证）。
- answer: 用户原话要求文案按 daemon_code 分支。我的判断（细节口径）：`conflict_record_missing` → 「该冲突在本机已无快照（可能已随同步清理或已裁决），请重新同步后再试」，且该场景下不展示「重试」（重试必然同样失败）；`workspace_root_unknown` → 保留既有「尚未被本机认领」文案；其余（离线/超时/502 兜底）保留机器与超时语义文案。
- normalized_requirement: 前端失败卡按错误码/daemon_code 分支展示文案；`conflict_record_missing` 分支不出现「离线」「504」字样，不提供「重试」按钮。
- impacts: [FR-3, task-04]
- evidence: frontend/src/components/changes/conflict-compare-modal.tsx:260-277（失败卡写死 504/离线文案）；backend/app/modules/daemon/sillyspec_compare.py:58-63（daemon_code→文案表）；frontend/src/lib/api.ts:50-62（ApiError 带 code/details，可读 daemon_code）

## D-005@v1: 后端 `conflict_record_missing` 文案改为可行动指引（去掉「刷新冲突列表」）
- type: term
- priority: P2
- 模块域: backend
- status: accepted
- source: code
- question: 后端 `_GATEWAY_MESSAGE_BY_CODE["conflict_record_missing"]` 现文案「冲突记录已失效，请刷新冲突列表。」给了无效建议（刷新不关闭注册表行）。
- answer: 我的判断：改为「该冲突在本机已无快照（可能已随同步清理或已裁决），请重新同步后再试。」与前端 D-004 口径一致；错误码与 details 透传不变。
- normalized_requirement: 后端该码的用户可见 message 与前端文案语义一致，均指向「重新同步」而不是「刷新列表」。
- impacts: [FR-3, task-03]
- evidence: backend/app/modules/daemon/sillyspec_compare.py:60-63；docs/sillyspec/conflict-compare-full-tree-label-mismatch.md（「刷新无效」实证）

## D-006@v1: 兜底命中时的对比范围与来源标注
- type: boundary
- priority: P2
- 模块域: backend, frontend
- status: accepted
- source: code
- question: full-tree 记录覆盖多个变更的路径，兜底命中后对比应展示哪些文件？界面是否标注来源？
- answer: 我的判断：后端只保留属于所请求变更的路径（`changes/(archive/)?<change>/` 前缀匹配）参与文件清单与 diff；响应标注记录来源（如 `record_label=full-tree`）与原始变更名集合，前端在对比弹窗顶部以小字提示「该记录由全量同步产生，本次仅展示与 <change> 相关的 N 个路径」。
- normalized_requirement: 兜底响应不含其他变更的文件；来源提示可关闭、不影响对比主体渲染。
- impacts: [FR-2, task-02, task-04]
- evidence: backend/app/modules/daemon/sillyspec_compare.py:478-486（_build_spec_tree_compare 以 conflicting_paths 建清单）；sillyhub-daemon/src/sillyspec-manager.ts:1616-1620（specPathSignalRank 已按 change 排序路径，兜底读取天然可用）

## D-007@v1: 本变更不需要新建页面类原型（规则类）
- type: boundary
- priority: P2
- 模块域: frontend
- status: accepted
- source: code
- question: 本次前端改动（失败卡文案分支 + 关闭入口按钮 + 对比来源小字提示）是否需要走原型管线出定稿原型？
- answer: 我的判断：无新页面/新布局，仅既有组件文案与分支行为，按 .sillyspec/docs/SillyHub/scan/PROTOTYPE.md 三类划分属「规则类」（文本即源，无编译产物）；不新建页面类原型，design.md 对应小节即规则源；前端沿用现有组件与主题 token。
- normalized_requirement: 前端改动不新增页面/不改布局骨架；样式一律走主题 token 与既有组件（tailwind 类 + themes.ts），禁硬编码色。
- impacts: [task-04, task-05]
- evidence: .sillyspec/docs/SillyHub/scan/PROTOTYPE.md（三类原型表：规则类=本体文本，无编译产物）；frontend/src/components/changes/conflict-compare-modal.tsx（既有组件，改动为分支与文案）

## D-008@v1: 验收含部署后真机复验
- type: risk
- priority: P1
- 模块域: backend, frontend
- status: accepted
- source: user
- question: 本 change 验收标准是否包含部署到生产并真机复验？
- answer: 用户确认包含——本地相关测试全绿后，部署到生产（腾讯云 124.222.127.242）并用真实案例（现网 `2026-10-13-fire-unitadd-form-import` 注册表行）复验对比可打开、文案正确、关闭入口可用。
- normalized_requirement: 验收证据包含部署后真机实测记录（请求 + 响应摘要）；后端兜底方案不依赖 daemon 自更新，部署后立即可验。
- impacts: [verify-1]
- evidence: docs/sillyspec/conflict-compare-full-tree-label-mismatch.md（生产排查入口：真实栈在腾讯云 124.222.127.242）；.claude/CLAUDE.md 规则 8（完成后对照文档验收）

## D-009@v1: 实现方案选定——后端「失败即重试 full-tree」兜底（方案 A）
- type: architecture
- priority: P0
- 模块域: backend
- status: accepted
- source: user
- question: 跨变更全量冲突的对比修复，在「A 后端失败即重试 full-tree 兜底 / B 平台行携带记录名 / C 新增 daemon 列记录 RPC」三方案中选哪个？
- answer: 用户选定方案 A：compare 端点收到 `conflict_record_missing` 时以 `change='full-tree'` 重发一次快照 RPC，后端校验该变更路径在记录内并裁成该变更范围后走既有 diff；响应标注记录来源。理由要点：与 D-001 一致（平台侧落地、无 daemon 依赖）、落地面最小、部署即生效；B/C 的抗未来命名变化收益在 CLI 口径未变前属过度设计且需跨端发布。
- normalized_requirement: 兜底链路限定在 backend（`sillyspec_compare.py`）单点；兜底只对 `kind=spec-tree` 且首批 RPC 以 `conflict_record_missing` 失败、重试快照内确有该变更路径时生效；其余情况维持现错误路径。
- impacts: [FR-1, FR-2, task-02]
- evidence: 本步方案选择轮（用户回答「A 后端失败即重试（推荐）」）；backend/app/modules/daemon/sillyspec_compare.py:410-454、:478-486；sillyhub-daemon/src/sillyspec-manager.ts:1612-1621
- 故障面: 多一次 RPC 往返（仅缺失场景）；裁剪逻辑若按前缀误配（如变更名前缀互相包含）会把无关路径带入——实现需按 `changes/(archive/)?<change>/` 段边界匹配并以测试钉住。
- 退役判据: CLI 记录命名与平台行归因口径统一（记录名=变更名）后，兜底删除回落到单次 RPC。

## D-010@v1: 落选——平台行携带记录名（方案 B）
- type: architecture
- priority: P1
- 模块域: backend
- status: rejected
- source: user
- question: 是否改推送链路让平台行携带冲突记录名，从而根治「平台按单变更名、机器按 label 记名」的口径分裂？
- answer: 方案 B 落选（用户选 A）。
- normalized_requirement: 本 change 不改 CLI 推送负载与平台行 schema 口径。
- impacts: []
- evidence: 本步方案选择轮；/c/nvm4w/nodejs/node_modules/sillyspec/src/spec-sync.js:815-870（推送不携带 conflictLabel）
- 否决理由: 需改外部 CLI 仓并发布，存量行无该字段仍要兜底，跨仓联动周期长、收益兑现慢。
- 复潮条件: CLI 侧因其他需求必须改动 spec-sync 推送负载（顺带携带记录名零成本）时，可重议并以「记录名直读」取代名字兜底。

## D-011@v1: 落选——新增 daemon「列记录」RPC（方案 C）
- type: architecture
- priority: P2
- 模块域: sillyhub-daemon, backend
- status: rejected
- source: user
- question: 是否新增 daemon RPC 列出本机冲突记录，平台按目录发现任意记录名（不写死 full-tree）？
- answer: 方案 C 落选（用户选 A）。
- normalized_requirement: 本 change 不新增 daemon RPC 面。
- impacts: []
- evidence: 本步方案选择轮；sillyhub-daemon/src/daemon.ts:7278-7285（现存仅 sillyspec_conflict_snapshot 一个冲突类 RPC）
- 否决理由: 必须等 daemon 自更新铺开才生效，新增 RPC 带来协议/权限/测试成本，而当前机器侧只有 full-tree 一种已成形形态，收益是假想的未来变化。
- 复潮条件: 机器侧出现第三种以上记录命名形态（如按工作区/轮次改名）导致「猜名字」清单不可维护时，重议升级为目录发现。

## D-007@v2: 本变更生成真码原型（supersedes D-007@v1 的「跳过」判断）
- type: boundary
- priority: P2
- 模块域: frontend
- status: accepted
- source: code
- question: D-007@v1 判「无新页面/仅文案」跳过原型；但 Step 5 注入契约明确「组件级变化（含弹窗/列表局部变化）建议生成，拿不准默认生成」，且本仓 local.yaml 登记 `ui_prototype.form = real-code`（原型须真码形态，单 HTML 降级需用户裁决留痕）。
- answer: 我的判断：改为生成真码原型——新增 `frontend/src/components/prototype/conflict-sync-states-view.tsx`（primer/Tailwind/token 方言，fixture 覆盖三个界面态：行级关闭入口、失败卡四臂分支、full-tree 兜底来源提示），`pnpm prototype:build` 编译产物拷入变更目录 `prototype-conflict-sync-states.html`；构建脚本 VIEWS 登记一行。
- normalized_requirement: 原型源码过前端质量门（tsc/eslint/禁硬编码色）；产物与源码同提交（重编译 git diff 为空）；execute 阶段前端实现直接对照原型搬文案与结构。
- impacts: [task-04, task-05]
- evidence: .sillyspec/.runtime/step-guides/brainstorm-step4-e3d95561.md（原型三选一与默认生成口径）；.sillyspec/projects/*.yaml 注入的 ui_prototype 登记；frontend/scripts/prototype-build.mjs:21-30（VIEWS）；frontend/src/components/prototype/README.md
- 故障面: 新增常驻原型视图会进入每次 prototype:build 的产物集，后续改动需保持产物对账（重编译后 git diff 为空）。
- 退役判据: 该视图长期不再被引用（连续多个变更不再涉及冲突同步界面）时可从 VIEWS 与目录中移除。

## D-006@v2: 兜底裁剪输入面与来源提示语义修订（supersedes D-006@v1）
- type: consistency
- priority: P1
- 模块域: backend, frontend
- status: accepted
- supersedes: D-006@v1
- source: design-grill
- question: 首轮独立审查发现 D-006@v1/design 三处与实现口径不符：①daemon 快照 `SillySpecConflictSnapshot` **没有 `conflicting_paths` 字段**（记录读取时已截 300 转成 `files[]`），按 v1 字面实现则归属判定恒空、兜底永不触发；②`path_total` 声称「记录裁剪前路径总数」——平台侧不可得（快照即受帽报数）；③v1 写的「来源提示可关闭」未落 design/tasks 产物。
- answer: 修订为——归属校验与裁剪一律以 **`snapshot.files[].path`** 为输入（entry 保持完整，与 `_build_spec_tree_compare` 的消费面一致）；`path_total` 语义＝**兜底快照返回的路径总数**（受 daemon 300 路径帽截断，不声称记录真实总数）；来源提示为**固定说明行、无关闭控件**（告知性质；如需关闭控件另开）。
- normalized_requirement: 实现只依赖快照 `files[].path` 与顶层键（change/kind/ql_id/conflict_created_at/local_updated_at/progress）；提示文案按「快照返回 N 个路径，本次展示与 `<change>` 相关的 M 个」措辞。
- impacts: [FR-02, task-01, task-03]
- evidence: design-grill 首轮审查（checklist 交叉点1/5，blockers P1-A/P2-D/P2-F）；sillyhub-daemon/src/sillyspec-manager.ts:346-359,1617-1690；backend/app/modules/daemon/sillyspec_compare.py:478-547

## D-012@v1: 首轮独立审查其余修订项（分支键/失效键/关闭范围/保真损失）
- type: consistency
- priority: P1
- 模块域: backend, frontend
- status: accepted
- source: design-grill
- question: 首轮独立审查除 D-006 外的修订项（失败卡分支键、invalidate 键、关闭连带范围、兜底保真损失）如何拍定？
- answer: 全部按审查结论修订进 design/requirements/tasks——①失败卡分支键＝`details.daemon_code`（daemon 业务失败时外层 `ApiError.code` 恒为 `HTTP_502_DAEMON_RPC_REMOTE`，不可作键；离线/超时臂按外层 `HTTP_504_DAEMON_RUNTIME_OFFLINE` / `HTTP_504_DAEMON_RPC_TIMEOUT`）；②关闭成功后 invalidate 键＝`["platform-sync-section","spec-conflicts",workspaceId]`（`QUERY_KEY_ROOT=["platform-sync-section"]` 实际值）；③「标记已处理」关闭范围＝整条注册表记录（一条记录可含多个变更名，并列展示的兄弟行会一起消失），写进确认文案并记 R-07；④兜底命中时 `ql_id` 恒 null、archive 路径排序沉底、>300 路径时属该变更的路径可能被帽截掉（表现为缺路径）——均接受为已知边界，记 R-08/R-02。
- normalized_requirement: 前端实现按上述键值与文案范围；测试覆盖分支键命中与「关闭后并列行一起消失」。
- impacts: [FR-03, FR-04, task-03, task-04]
- evidence: design-grill 首轮审查（blockers P1-B/P1-C、checklist 交叉点4、P3-G/P3-H）；backend/app/modules/daemon/runtime/service.py:83-99；frontend/src/components/changes/platform-sync-section.tsx:90,277
