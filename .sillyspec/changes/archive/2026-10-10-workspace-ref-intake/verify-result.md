# 验证报告（骨架由 `sillyspec verify-probes --change <变更名> --init` 生成）

> 引用规范：矩阵证据/测试结果等处的源码位置写仓根相对全路径+行号（src/foo.js:123）——裸文件名在 docs-check 层1 靠 basename 全仓扫描找候选，找不到候选或关键词窗口不匹配即失效，到 pre-push 才拦（2026-09-19 实证 64 处返工）。

## 结论 [层：人工判断]

结论枚举：PASS WITH NOTES（261/261 相关面用例绿 + 独立 QA 验收 13 项全 pass；两条 NOTE：① UI 视觉证据未落盘（探针 12 ⚠️），浏览器实测移交用户；② 空门户 toast 为防御性兜底分支无专门用例（正常 UI 流不可达））

## 移交项（结构化） [层：人工判断——CLI 清单核验]

| 类型 | 条目 | 复跑/验收条件 |
|---|---|---|
| manual-acceptance | UI 浏览器实测（B 角标/右键菜单/行号选区/标签 tooltip/历史标签点击） | 起 dev server（cd frontend && pnpm dev）→ 会话页进文件模式 → ① 右键文件树文件/目录节点见菜单，点击后输入框光标处出标签（左上类型角标+悬停路径 tooltip）② 打开代码文件见行号，选中几行右键「添加选中内容到会话输入框」③ 发送后历史气泡标签可点开预览 ④ .md 预览右键无自定义菜单（预期边界） |
| other | visual-evidence.md 补录（探针 12 ⚠️，默认档非阻断） | 上述实测截图 2-3 张落变更目录 visual-evidence.md（渲染对照：标签角标+菜单+行号） |

## 证据账（cannot_verify 任务） [层：人工判断——CLI 核验]

无

## 集成验证回执 [层：自述声明——CLI 一致性校验]

- claim: 本变更相关面 8 测试文件合跑全绿（组装行为：纯函数×输入区×portal 端到端×历史渲染拼装）
  command: cd frontend && pnpm exec vitest run src/components/daemon/__tests__/attachment-refs.test.ts src/components/daemon/__tests__/input-ref-overlay.test.tsx src/components/daemon/__tests__/session-input-bar-upload.test.tsx src/components/daemon/__tests__/attachment-ref-tag.test.tsx src/components/explorer/__tests__/file-preview.test.tsx src/components/explorer/__tests__/file-explorer.test.tsx src/components/sessions/__tests__/sessions-portal.test.tsx src/components/sessions/__tests__/portal-file-panels.test.tsx
  exit: 0
  log: .sillyspec/.runtime/logs/wsri-related-suite.log
- claim: 群聊套件 76/76（task-08 全链路）
  command: cd frontend && pnpm exec vitest run src/components/group-chat/__tests__/group-chat-panel.test.tsx
  exit: 0
  log: .sillyspec/.runtime/logs/task08-group-test3.log
<!-- smoke 机器段缺态：not-configured（commands.smoke 未配置——配置 local.yaml 后下次 verify 亲跑并自动注入机器段）source: cli-noai-smoke -->

## 任务完成度 [层：人工判断]

9/9 全部完成（tasks.md 勾选与 worktree 分支 sillyspec/2026-10-10-workspace-ref-intake 9 commit 一一对应，b70c456e3→fbf570c80）：task-01 b70c456e3（25 用例）/ task-02 e41d62f93（28）/ task-03 3f708a40f（23）/ task-04 f0436d90d（13）/ task-05 d00b597ae（15）/ task-06 66bc8ecfe（72）/ task-07 edd3f2950（grep 重盘一致）/ task-08 fbf570c8（76）/ task-09 c6e5dc7e7（9）。无未完成、无存疑。

## 设计一致性 [层：人工判断]

与 design.md 一致（FR-01~08 全落地，独立 QA 验收 13 项 pass，execute-review-2026-10-10-164613）。三处已留痕偏差：① D-012（task-07 执行期裁决：plan 漏 session-panel/index.tsx 分发器，+15 行纯透传）② D-013（预览区右键菜单内联实现，不复用 floating-context-menu——同 Wave 并行避免依赖）③ D-014（FR-07 历史渲染内聚至 InlineAttRefTextWithPreview，turn-segment-views 零改动，覆盖面偏优）。Reverse Sync：三条均已回写 decisions.md，design 文件清单与实际 diff 的差异即此三处，均有决策条目承载。

## 探针结果（CLI 机械预填） [层：可复跑探针——gate 抽查防篡改]
#### 探针 1：未实现标记扫描（design 清单文件）
- ✅ 无 TODO/FIXME/尚未实现 标记命中
- ℹ️ 1 个清单文件主仓不存在、已从 worktree 读取（apply 前新文件形态）

#### 探针 2：设计关键词覆盖
关键词逐个 grep（worktree 源码，frontend/src）：右键菜单（FloatingContextMenu/SelectionContextMenu ✅ file-explorer.tsx:66、file-preview.tsx）/ 行号（showLineNumbers ✅ file-preview.tsx）/ 选区（selectionLineRange ✅ file-preview.tsx:389-423）/ 引用标签（buildWsRefToken/allocateWsRefToken ✅ attachment-refs.ts）/ 类型角标（tokenMetas ✅ input-ref-overlay.tsx）/ 置换（substituteWsRefsForSend ✅ 7 处调用）/ 历史渲染（parseInlineRefs ✅ attachment-ref-tag.tsx:112）/ 槽位（pendingWsRefInsert ✅ sessions-portal.tsx）/ 唯一化（allocateWsRefToken 并集池 ✅ session-input-bar.tsx:328、group-chat-panel.tsx:2023）/ 退格整删（Backspace token 匹配 ✅ 两输入区）/ tooltip（title 元数据 ✅ overlay）/ toast（notify.warning ✅ sessions-portal.tsx:232）。全部命中，无未实现关键词。

#### 探针 3：验收标准测试覆盖
（CLI 机械预填保留如骨架）task-01~09 模块目录测试文件均在；⚠️ task-07 session-panel 目录本身无 co-located 测试——其 acceptance（组装位置换）由消费端端到端承接（sessions-portal.test.tsx:2808 树右键端到端含发送断言）+ 纯函数单测（attachment-refs.test.ts:63 置换语义），见探针 7 矩阵，非覆盖缺口。
集成盲区标注：无路由/layout 变更；跨组件装配（portal→panel→input 三层槽位链）有 sessions-portal.test.tsx 端到端用例（真会话/预会话/群聊三分支各一），无集成盲区。
断言有效性抽查（3 个核心）：① session-input-bar-upload.test.tsx:368「槽位插入 nonce 首次触发…消费后清槽回抛」断言 textarea.value 与回抛参数（真实副作用）② file-preview.test.tsx 选区用例断言 desc.lines 为 min-max（行为非实现）③ group-chat-panel.test.tsx:3171「删附件不误剥」断言双池隔离语义。均为行为断言非空断言，达标。

#### 探针 4：决策追踪覆盖
D-001~D-009 → FR → task → 证据闭环（见下方矩阵）；D-008@v1 被 D-008@v2 supersede（矩阵双行，v2 为准）；D-010/D-011 为 rejected 防复潮留痕（无 FR/task 映射是设计使然——「plan 无对应任务即落实」）；D-012~D-014 为执行期裁决/偏差留痕（D-012 映射 task-07，D-013 映射 task-02/03，D-014 映射 task-09，矩阵未映射行已复核改写）。无 P0/P1 unresolved。

#### 探针 5：API Contract Parity
- ✅ API parity check passed: 632 backend endpoints (live [scan-root 636 + worktree 636] + artifact 0), 0 frontend calls [scope: change-diff (22 files @ worktree)] | 0 backend endpoints unused by frontend (+207 stock noise collapsed)
- ℹ️ 后端端点比对集为多根并集（主仓既有 ∪ worktree 新增 ∪ 存量 artifact），共扫 2 个根
- ⚠️ 0 个本变更端点前端未调用（warning 不阻断）：
- ℹ️ 另有 207 个存量端点未调用（他模块存量噪音，已折叠不逐条列出）

#### 探针 6：代码删除对账
- ✅ git diff 无整文件删除（D/R/C）记录
- ℹ️ 以 git 事实为准（真实 > 声明）；是否 FAIL blocker 由 agent 诚实判定

#### 探针 8：载荷字段契约对账（advisory）
- 不适用（清单无 Java/SQL 后端面，或 design.md 缺失）
#### 探针 9：守卫一致性（advisory）
- 不适用（清单无 .java 改动文件，或 design.md 缺失）
- ℹ️ 清单无 .java 文件（另有 20 个非 Java 清单文件不在探针 9 扫描面）
#### 探针 10：预填注清零（error 门）
- ✅ 预填注清零（10 个在检文件无未确认预填）
#### 探针 11：红线一致性（advisory）
- 不适用（仓未配置 .sillyspec/redlines.yaml——红线机检零打扰，D-002）
#### 探针 12：UI 视觉证据（分级门）
- ⚠️ 变更目录缺 visual-evidence.md（渲染对照证据应在执行时随手落盘——收口只验在场不产新证据）
→ 处置：非阻断（local.yaml 未配 ui_visual_gate=error，默认 ⚠️ 档）；补录动作已列移交项（浏览器实测 + 截图落盘），无视觉降级（功能全量实现，无削减）。

#### 探针 7：验收×测试覆盖矩阵
（CLI 预填基础上人工复核改写：task-05 两行 partial→covered〔用例实在：session-input-bar-upload.test.tsx:368 槽位插入/清槽、:375 nonce 重复触发、:396 回传断言〕；task-06「空门户 toast」保持 partial〔防御性兜底：正常 UI 流不可达——树入口按钮空门户态置灰（sessions-portal.tsx:763），toast 分支（sessions-portal.tsx:232）无专门用例，端到端 3 用例覆盖主路径〕；task-07 ⚠️ 目录无测试由端到端+纯函数承接。其余 covered 行已抽查用例锚点属实。）

**task-01**
| acceptance 条目 | 归属测试文件 | 关键词命中（提示，命中≠判定） | 判定 | 证据 |
|---|---|---|---|---|
| 撞池同名加 ·2 且异基名或异行号段免序号，三类置换标记逐字正确且孤儿 token 与既有附件 token 互不误伤，parseInlineRefs 对纯文本产出单 text 段，既有附件五函数签名行为零变动且原用例全绿 | `frontend/src/components/daemon/__tests__/attachment-refs.test.ts` | token | covered | `frontend/src/components/daemon/__tests__/attachment-refs.test.ts`（25 用例：并集分配/三类置换/解析/孤儿降级/附件零回归） |

**task-02**
| acceptance 条目 | 归属测试文件 | 判定 | 证据 |
|---|---|---|---|
| 代码与纯文本分支渲染行号且行号列不可选中；.md/图片/PDF/二进制分支渲染与现状逐字一致（D-002） | `frontend/src/components/explorer/__tests__/file-preview.test.tsx` | covered | `frontend/src/components/explorer/__tests__/file-preview.test.tsx`（28 用例：行号渲染/分支零改动断言） |
| 选中行右键回调 desc 的 lines 为起止行元素实际文档位置（反选取 min-max）；无选区或未传 onAddSelectionRef 时右键为浏览器默认菜单 | 同上 | covered | 同上（selectionLineRange 反选/跨行/无选区不拦截/未传零拦截用例） |

**task-03**
| acceptance 条目 | 归属测试文件 | 判定 | 证据 |
|---|---|---|---|
| 右键文件/目录/根节点出现单项菜单，onAddNodeRef 收到完整 desc | `frontend/src/components/explorer/__tests__/file-explorer.test.tsx` | covered | `frontend/src/components/explorer/__tests__/file-explorer.test.tsx`（23 用例：文件/目录/根 desc 逐字段） |
| document 事件关闭菜单且监听移除；未传回调时树行为与现状一致 | 同上 | covered | 同上（document 关闭/未传零拦截用例） |

**task-04**
| acceptance 条目 | 归属测试文件 | 判定 | 证据 |
|---|---|---|---|
| 四类角标图标按 kind 正确渲染；未传 tokenMetas 渲染与现状逐字一致 | `frontend/src/components/daemon/__tests__/input-ref-overlay.test.tsx` | covered | `frontend/src/components/daemon/__tests__/input-ref-overlay.test.tsx`（13 用例含零视觉回归断言） |
| 版式守卫用例绿——背景块无 margin/padding、角标 absolute 不进文本流、× 角标 z-20 不受影响（R-01） | 同上 | covered | 同上（版式守卫用例：`frontend/src/components/daemon/__tests__/input-ref-overlay.test.tsx:108`） |

**task-05**
| acceptance 条目 | 归属测试文件 | 判定 | 证据 |
|---|---|---|---|
| 槽位（nonce 自增）光标处插入【名称】/【名称:起-止】，重复触发且消费后清槽 | `frontend/src/components/daemon/__tests__/session-input-bar-upload.test.tsx` | covered | `frontend/src/components/daemon/__tests__/session-input-bar-upload.test.tsx:368`（槽位插入/清槽回抛）、:375（nonce 重复触发+行号段） |
| 同名唯一化跨池生效（附件∪工作区∪正文 inText，D-005） | 同上 | covered | :384（并集同名 ·2 / 异行段免序号） |
| 删附件 chip 只剥该附件 token；退格贴尾一次整删两池标签 | 同上 | covered | :396（退格整删+回传）、删附件隔离用例 |
| 未插入时零差异；wsRefTokens 受控回传 | 同上 | covered | :396（onWsRefTokensChange 断言）+ 既有附件用例全绿（零回归） |

**task-06**
| acceptance 条目 | 归属测试文件 | 判定 | 证据 |
|---|---|---|---|
| 两回调经两壳透传到 portal，WsRefDesc 含正确 workspaceId 与 POSIX 路径 | `frontend/src/components/sessions/__tests__/sessions-portal.test.tsx` | covered | `frontend/src/components/sessions/__tests__/sessions-portal.test.tsx:2791` describe（端到端断言 desc 组装） |
| 槽位下发群聊/真会话/预会话三分支；重复触发 | 同上 | covered | :2808（真会话树右键端到端含重复触发）、预览选区/预会话分支用例 |
| 空门户态右键插入 toast 且不崩溃；未接回调路径行为现状一致 | 同上 | partial | 防御性兜底分支：正常 UI 流不可达（树入口按钮空门户态置灰 `frontend/src/components/sessions/sessions-portal.tsx:763`；toast 实现 :232），无专门用例；主路径已由端到端 3 用例覆盖。接受不补测（verify 禁改源码/测试） |

**task-07**
| acceptance 条目 | 归属测试文件 | 判定 | 证据 |
|---|---|---|---|
| 六处组装位发送文本均完成附件+工作区双重置换（D-003/D-004 标记形态） | `frontend/src/components/daemon/__tests__/attachment-refs.test.ts` + `frontend/src/components/sessions/__tests__/sessions-portal.test.tsx` | covered | `frontend/src/components/daemon/__tests__/attachment-refs.test.ts:63`（置换语义纯函数）+ `frontend/src/components/sessions/__tests__/sessions-portal.test.tsx:2808`（端到端含发送断言）；grep 重盘 7 处与 D-008@v2 一致（task-07 commit edd3f2950 记录） |
| wsRefTokens 空时输出逐字等于现状；孤儿 token 原样保留 | `frontend/src/components/daemon/__tests__/attachment-refs.test.ts` | covered | 空 map 原样返回/孤儿降级用例 |
| page/dialog 输入区回传 wsRefTokens；槽位 prop 透传 | `frontend/src/components/sessions/__tests__/sessions-portal.test.tsx` | covered | :2808（透传链端到端：portal→panel→input） |

**task-08**
| acceptance 条目 | 归属测试文件 | 判定 | 证据 |
|---|---|---|---|
| group-chat-panel.test.tsx 全绿，覆盖群聊端到端（插入→角标 tooltip→置换→历史标签） | `frontend/src/components/group-chat/__tests__/group-chat-panel.test.tsx` | covered | 76/76（`frontend/src/components/group-chat/__tests__/group-chat-panel.test.tsx`：槽位/退格/删附件隔离/置换/历史三类标签/旧挂载零回归） |
| 未插入时群聊输入/发送/历史零差异（brownfield 回退） | 同上 | covered | 同上「未接槽位的旧挂载（不传 props）零回归：无插入无置换直发原文」用例 |

**task-09**
| acceptance 条目 | 归属测试文件 | 判定 | 证据 |
|---|---|---|---|
| attachment-ref-tag.test.tsx 全绿，三类标记标签与 fetchDownload 预览用例通过 | `frontend/src/components/daemon/__tests__/attachment-ref-tag.test.tsx` | covered | `frontend/src/components/daemon/__tests__/attachment-ref-tag.test.tsx`（9 用例：三类标签/图标/点击预览分流/根目录空 path） |
| 本变更前历史消息渲染逐字不变 | 同上 | covered | 同上（无标记文本单 text 段逐字断言 + 附件 title 零回归） |

- ⚠️ 零/半自动化承接条目：仅 task-06 空门户 toast 一条（partial，防御性分支，见上）——已在「代码审查」节走查登记。

## 接口验证覆盖矩阵 [层：人工判断——CLI 预填复核]
| 端点 | 判定 | 用例依据 ID | 结果 | 证据 |
|---|---|---|---|---|
| 本变更接口面：0 端点（agent 声明） | non-testable | design.md 接口定义节「0 端点（无后端接口变更）」 | 不适用 | 纯前端变更（D-004 文本协议随正文透传）；git diff 22 文件全在 frontend/ 零后端 |

## 测试结果 [层：确定性检查——CLI 实测对账]
- 相关面合跑（8 文件）：185/185 通过，exit 0（.sillyspec/.runtime/logs/wsri-related-suite.log）
- 群聊套件：76/76 通过，exit 0（.sillyspec/.runtime/logs/task08-group-test3.log）
- noAI 动态子集（CLI 亲测）：deps(jsx9)+fr(5) 退出码 0，两次（47.8s / 33.9s，verify-runs/20261010085802、20261010085924）
- 类型：pnpm exec tsc --noEmit exit 0；ESLint 0 error（11 warning 为文件预存 no-unused-vars 风格类）
- known_failures：无

## 决策追踪矩阵 [层：人工判断]
| 决策 ID | FR | Task | Evidence | 状态 |
|---|---|---|---|---|
| D-001@v1 | FR-03 | task-04 | input-ref-overlay.tsx 四类 lucide 角标 + 版式守卫用例 | 闭环 |
| D-002@v1 | FR-04、FR-05 | task-02 | .md/图片/PDF/二进制分支零改动用例；代码/纯文本行号 | 闭环 |
| D-003@v1 | FR-06 | task-01、task-07 | attachment-refs.test.ts 置换只产路径+行号标记断言 | 闭环 |
| D-004@v1 | FR-06、FR-07 | task-01、task-07、task-09 | 三类标记置换/解析用例；diff 零后端文件 | 闭环 |
| D-005@v1 | FR-02 | task-01、task-05 | :384 并集同名 ·2 用例（两输入区同款） | 闭环 |
| D-006@v1 | FR-05 | task-02 | 无选区不拦截用例 | 闭环 |
| D-007@v1 | FR-04、FR-05 | task-02 | selectionLineRange 行元素锚 + 反选用例 | 闭环 |
| D-008@v1 | — | — | superseded by D-008@v2（组装位计数修正） | 已替代 |
| D-008@v2 | FR-06、FR-08 | task-07、task-08 | grep 重盘 7 处一致（commit edd3f2950/fbf570c8） | 闭环 |
| D-009@v1 | FR-02、FR-06、FR-07 | task-01、task-05 | 扩展既有库，附件五函数签名零变动 + 附件用例全绿 | 闭环 |
| D-010@v1 | （rejected 留痕） | — | plan 无独立两套库任务即落实 | 留痕（防复潮） |
| D-011@v1 | （rejected 留痕） | — | plan 无独立 chips 通道任务即落实 | 留痕（防复潮） |
| D-012@v1 | FR-01、FR-08（通道） | task-07 | session-panel/index.tsx +15 行纯透传 diff（commit edd3f2950） | 闭环（执行期裁决） |
| D-013@v1 | FR-05（实现面） | task-02、task-03 | file-preview.tsx 内联 SelectionContextMenu 与 floating-context-menu 并存 | 闭环（偏差留痕） |
| D-014@v1 | FR-07 | task-09 | attachment-ref-tag.tsx:112 内聚渲染，turn-segment-views 零改动 | 闭环（偏差留痕） |

## 技术债务 [层：人工判断]
探针 1 零命中；diff 无 TODO/FIXME（grep 精确匹配 0）。无新增债务。既有债务不涉本变更面。

## 变更风险等级 [层：人工判断]
unit-sufficient（纯前端组件+纯函数变更：无 API/schema/部署面；相关面 261 用例+类型+lint 三绿；UI 视觉面留人工实测——移交项列明）。design frontmatter 无 risk_level 显式声明。

## Runtime Evidence [层：人工判断]
不涉及（无后端/守护进程/生命周期组件改动——0 端点 0 schema；前端组件行为证据走测试断言，见「测试结果」节三份日志）。

## 代码审查 [层：人工判断]
走查清单：① 编辑/更新链路（回显/残留态）——标签编辑全生命周期（插入→退格/×删除→置换→发送清空→历史渲染）用例覆盖，无残留态路径（发送成功 setWsRefTokens({}) 群聊已断言）✅ ② 非主分支流——预会话/群聊/定时与团队直发组装位在 task-07 grep 盘点内，dialog:1343（接管路径）已串联 ✅ ③ 守卫一致性——同资源操作校验模式不适用（无后端端点）；前端守卫（无选区不拦截/未传回调零拦截/空 map 旁路）反例用例齐 ✅ ④ 载荷字段契约——探针 8 不适用（无后端面）；WsRefDesc 字段消费与 provides 声明一致（QA 契约对账 pass）✅ ⑤ 分页/并发/事务——不适用（纯前端受控状态）✅ 遗留走查：空门户 toast 兜底分支（sessions-portal.tsx:232）逻辑目视正确（notify.warning + 无输入区早退），接受无专门用例。总体：实现质量良好，无 P1/P2 缺陷；两个 NOTE 均为流程性（视觉证据/防御分支用例）非功能缺陷。

## 独立复核（可选回流槽） [层：人工判断——复核后追加]
已有两层独立评审在案：execute Stage Review（独立 QA 子代理，acceptance 13 项 pass，execute-review-2026-10-10-164613）+ plan/brainstorm 阶段独立审查（design pass / plan pass）。verify 阶段无新增独立复核需求。
