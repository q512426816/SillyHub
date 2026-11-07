# 决策知识 — docs

> decision-distill 从变更 decisions.md 幂等提炼（「最近确认」= 归档时 HEAD）。条目字段行为 docs-check 机械解析契约，勿手改。

## D-001@v1 : 缺口①触发形态 — 心跳恢复事件触发
状态：implemented
变更：2026-08-30-daemon-self-heal
锚点：未记录
文件：.zcode/skills/deploy-to-server/SKILL.md, docs/releases/2026-10-14-002-a176393cb.md
最近确认：ecdae9ba
理由：`_sendHeartbeatOnce` 成功分支、degraded 累计 >720s 守卫、复用 boot

## D-003@v1 : 下载校验口径 — 零子进程
状态：implemented
变更：2026-08-30-daemon-self-heal
锚点：未记录
最近确认：ecdae9ba
理由：buffer ≥64KB 且 `BUILD_ID` 正则可提取（与 `DISK_BUILD_ID_RE` 同款，

## D-005@v1 : respawn 最后防线 — 不退出保活
状态：implemented
变更：2026-08-30-daemon-self-heal
锚点：未记录
最近确认：ecdae9ba
理由：spawn 前同款校验，不过 → error 日志 + 提前 return 不退出；返回类型

## D-009@v1 : respawn 前校验提前到 stop 之前（主拦截点）
状态：implemented
变更：2026-08-30-daemon-self-heal
锚点：未记录
最近确认：ecdae9ba
理由：新增 `validateBundleOnDisk` 导出；`_tryUpdate` 在 stop() **之前**调用：

## D-docs-001@v1 2026-09-27-assets-testfile-bracket-note——在 frontend/src/components/changes/detail/change-assets-card.tsx 的 normalizeTestF
状态：implemented
变更：2026-09-27-assets-testfile-bracket-note
原编号：D-000@v1
锚点：.sillyspec/changes/archive/2026-09-27-assets-testfile-bracket-note/design.md
文件：docs/sillyspec/test-trace-tests-glue-bracket-note.md, frontend/src/components/changes/detail/__tests__/change-assets-card.test.tsx, frontend/src/components/changes/detail/change-assets-card.tsx
最近确认：未记录
理由：在 frontend/src/components/changes/detail/change-assets-card.tsx 的 normalizeTestFilePath 追加一步「」注解段剥离（/「[^」]*」/g 全局移除后再 trim）。该函数是测试文件路径解析的唯一归一入口：resolveTestFilePath 的等值/后缀比较与 TestFileBody 的 basename→explorer search 查询串都取自它的输出，一处剥离即同时修正搜索入参与比较基准。选前端归一而非改 sillyspec CLI 的 test-trace 产物：CLI 修复只能救未来记录，存量已冻结数据（如 sillyspec 仓 2026-09-27-ui-visual-guidance 归档件）里「路径「用例描述」」粘联只能靠读侧容错救回，与既有短路径/反斜杠归一同层同性质。

## D-docs-002@v1 2026-09-30-vitest-passwithnotests-rollback——sillyspec 仓依赖推断三缺陷已修复（用户授权，npm link 直连源码即时生效）：①依赖命中剥注释后匹配（字符串感知状态机——注释里的路径字面引用不再
状态：implemented
变更：2026-09-30-vitest-passwithnotests-rollback
原编号：D-000@v1
锚点：.sillyspec/changes/archive/2026-09-30-vitest-passwithnotests-rollback/design.md
文件：docs/sillyspec/finished/dynamic-deps-e2e-vitest-exclude-false-red.md, frontend/vitest.config.ts
最近确认：未记录
理由：sillyspec 仓依赖推断三缺陷已修复（用户授权，npm link 直连源码即时生效）：①依赖命中剥注释后匹配（字符串感知状态机——注释里的路径字面引用不再算依赖边）②isTestFilePath 正则补 jsx|tsx（自家 .test.tsx 进依赖面）③jsProject 批过滤 e2e/cypress 端到端目录（进 skip 批留痕不产命令）。三路验证：sillyspec 仓新 8 用例 + 受影响既有 31 用例全绿；原始失败面批组成复算（两路都不再产生 vitest run e2e/auth.spec.ts，真实测试入跑面）；门禁函数端到端（deps(auto-jsx) 实跑全绿 + e2e 走披露式 skip）。故本仓撤掉 passWithNoTests 兜底（恢复正常空收集报错语义），缺陷文档移 finished/ 附处置记录。

## D-docs-003@v1 2026-10-05-promo-film-page——参考 lemomo-ai/lemo-opuscar 的「纯代码拍片」思路：不用视频模型、不用视频文件，宣传片就是一页代码——单文件 HTML 内用 Canvas
状态：implemented
变更：2026-10-05-promo-film-page
原编号：D-000@v1
锚点：.sillyspec/changes/archive/2026-10-05-promo-film-page/design.md
文件：docs/promo/README.md, docs/promo/sillyhub-promo.html
最近确认：未记录
理由：参考 lemomo-ai/lemo-opuscar 的「纯代码拍片」思路：不用视频模型、不用视频文件，宣传片就是一页代码——单文件 HTML 内用 Canvas 2D 按主时钟逐帧实时渲染一部约 98 秒、8 幕的电影，配乐用 WebAudio 振荡器实时合成。放在 `docs/promo/` 下，与仓库现有 docs 静态产物（原型 HTML、PPT 等）同列，不触碰 frontend/backend/daemon 任何平台代码，零部署成本、双击即开。 影片结构（时间轴为确定性函数，seek 严格可重放）：序幕「失控的代码」（终端+红色告警，制造张力）→ 标题揭示（粒子汇聚成 SillyHub）→ 规范驱动（SillySpec 五阶段流水线+门禁）→ 架构（README 架构图动画化：浏览器→backend→存储；daemon→Agent）→ 多 Agent 编排（12 宿主星座+并行 worktree 车道）→ 实时可视（SSE 日志流+拓扑+看板）→ 团队与安全（RBAC 盾+双层审批门）→ 尾声 CTA（数据收束成 logo，`make up` 一键起）。所有文案以 README 为唯一事实源。视觉用 AI-Native 品牌紫 #7C3AED 主导、青 #0891B2 点缀，深色电影底+胶片颗粒+遮幅黑边，与平台主题血缘一致。 播放器为 DOM chrome（海报页/播放暂停/章节进度条/静音/重播/快捷键），画布只负责画面；音乐按「小节和弦轨道表」调度，与画面共用同一主时钟，seek 时两者同步重启对齐。

## D-docs-004@v1 2026-10-05-promo-film-v2——v1 的两大问题分别对症：**卡顿**——渲染循环逐帧 shadowBlur/全屏 overlay 颗粒/每帧重建渐变，v2 引擎重写为「静态层缓存 + 辉光精
状态：implemented
变更：2026-10-05-promo-film-v2
原编号：D-000@v1
锚点：.sillyspec/changes/archive/2026-10-05-promo-film-v2/design.md
文件：docs/promo/README.md, docs/promo/v2/assets/add-workspace.jpg, docs/promo/v2/assets/agent-profiles.jpg, docs/promo/v2/assets/approvals.jpg, docs/promo/v2/assets/change-detail.jpg, docs/promo/v2/assets/changes-archived.jpg, docs/promo/v2/assets/changes.jpg, docs/promo/v2/assets/fork.jpg, docs/promo/v2/assets/groupchat-members.jpg, docs/promo/v2/assets/groupchat.jpg, docs/promo/v2/assets/knowledge.jpg, docs/promo/v2/assets/local-agent-logs.jpg, docs/promo/v2/assets/login.jpg, docs/promo/v2/assets/plus-menu.jpg, docs/promo/v2/assets/ppm-kanban.jpg, docs/promo/v2/assets/ppm-plannodes.jpg, docs/promo/v2/assets/ppm-problems.jpg, docs/promo/v2/assets/ppm-projects.jpg, docs/promo/v2/assets/presession.jpg, docs/promo/v2/assets/releases.jpg
最近确认：未记录
理由：v1 的两大问题分别对症：**卡顿**——渲染循环逐帧 shadowBlur/全屏 overlay 颗粒/每帧重建渐变，v2 引擎重写为「静态层缓存 + 辉光精灵贴图 + 隔帧颗粒 + 自适应画质三档」的性能优先架构；**内容不符**——v2 从抽象图示转向真实产品演示：用浏览器自动化登录线上环境（crrcdt.ppdmq.top）采集 28 张真实界面截图入库 `docs/promo/v2/assets/`，影片每幕以截图为主角（带地址栏的浏览器窗口框 + Ken Burns 缓推 + 圆角高亮标注 + 人话字幕），按 11 幕约 300 秒讲完整平台故事；配乐沿用 WebAudio 合成并扩展至约 120 小节分章情绪。v1 文件保留，`docs/promo/README.md` 指向 v2 为正片。 **分镜表（11 幕 · 300s · 资产名对应 assets/ 文件）：** | # | 时间 | 幕名 | 资产/画面 | 人话字幕要点 | |---|------|------|-----------|--------------| | 1 | 0–16 | 为什么需要它 | login.jpg 推近 + 大字开场 | AI 在写代码，谁在管？→ SillyHub：让 Agent 有规可循 | | 2 | 16–38 | 平台总览 | ws-list.jpg 高亮工作区卡片 | Git 仓库变成工作区——多项目多团队，一台平台 | | 3 | 38–66 | 新项目怎么接入 | add-workspace.jpg → ws-onboarding.jpg 高亮「我的接入/初始化」 | 选你的电脑→浏览本机路径→初始化下发配置；每人绑自己的机器，代码靠 git 同步，平台不碰代码内容 | | 4 | 66–90 | 接入即扫描 | scan-docs.jpg → topology.jpg | 架构、约定、模块地图自动成档——Agent 的作业地图 | | 5 | 90–130 | 变更中心·两种流程 | changes.jpg（高亮平台同步+411/1066）→ change-detail.jpg（流程条/用量/留痕时间线逐区推进）+ 五阶段图示复用 | 大改走完整流程 brainstorm→plan→execute→verify→archive；小修走轻量流程；每次变更都有文档、门禁、留痕 | | 6 | 130–156 | 本地干活·平台同步 | 画中画：代码绘制的 CLI 终端 ↔ change-detail.jpg 留痕时间线，脉冲对齐 | 在终端里干活，平台实时知道；不必在平台上操作，也能被平台管控 | | 7 | 156–194 | 智能体会话·操作入口 | sessions.jpg 分区高亮（群聊/工作区×机器/本地Agent/分叉）→ presession.jpg（配置条/供应商额度） | 跨机器跨智能体的统一入口；新建会话=选机器+选智能体；供应商、思考级别、档案随会话切换 | | 8 | 194–232 | 群聊·派团队·分叉 | groupchat.jpg → groupchat-members.jpg（影子会话）→ plus-menu.jpg → team-popover.jpg → fork.jpg | 把人和 Agent 拉进一个群；当前智能体升级主控、MCP 派发分身干各自 worktree；走岔了就分叉，两条路都在 | | 9 | 232–256 | 运行时与韧性 | runtimes.jpg（3 机器在线）→ session-panel.jpg（46 轮导航/打断/恢复）→ local-agent-logs.jpg | Agent 在你自己的机器上跑；中断能恢复，历史能回放 | | 10 | 256–276 | PPM→Hub 联动 | ppm-projects.jpg → ppm-plannodes.jpg → ppm-kanban.jpg → ppm-problems.jpg + plus-menu 回闪 | 项目计划、问题清单，在 Hub 落地执行；会话里 @ 一下绑定任务上下文 | | 11 | 276–300 | 知识沉淀与收尾 | knowledge.jpg → releases.jpg → 数据行 → logo | 每次变更沉淀为知识，注入下一次开发；一键起，跑起来 | （补充说明：数字行使用线上实测值 411 归档变更 / 1066 快速修复 / 520+ 会话 / 3 机器在线 / 12 宿主。）

## D-docs-005@v1 2026-10-06-opencode-go-direct-anthropic——opencode go 端点原生提供 Anthropic `/v1/messages`（仅认 x-api-key；Claude Code 原生 session
状态：implemented
变更：2026-10-06-opencode-go-direct-anthropic
原编号：D-000@v1
锚点：.sillyspec/changes/archive/2026-10-06-opencode-go-direct-anthropic/design.md
文件：docs/sillyspec/litellm-v1950-image-entrypoint-not-found.md, frontend/src/components/llm-providers/__tests__/llmProviderPresets.test.ts, frontend/src/config/llmProviderPresets.ts
最近确认：未记录
理由：opencode go 端点原生提供 Anthropic `/v1/messages`（仅认 x-api-key；Claude Code 原生 session 头被上游识别，真机 2.1.216 纯文本 + Read 工具往返实测通过），故放弃依赖已隔离 LiteLLM 的 openai_chat 转换链，改走与 GLM/DeepSeek/Kimi 同型的 anthropic 直连。改动两处：① 阿里云服务器 llm_providers 行 OpenCode Go（api_format=anthropic / base_url=https://opencode.ai/zen/go / auth_field=ANTHROPIC_API_KEY / model=deepseek-v4.1-flash + 4 角色槽同填，key 按平台 cipher 重加密，经 backend 容器内一次性脚本执行）；② 仓内前端 opencode_go 预设同口径修正（auth_field 原照抄 cc-switch 为 ANTHROPIC_AUTH_TOKEN，配出来必 401；模型 4 槽 deepseek-v4-flash→deepseek-v4.1-flash 并补 FABLE 槽）+ 回归断言。选直连而非修 litellm：坑 litellm-v1950-image-entrypoint-not-found 已矩阵证伪「健康镜像 + gap-A」无 tag 可 pin，直连零新增组件、少一个 SPOF。

## D-docs-006@v1 2026-10-06-opencode-session-send-incident——双故障一根一修：①前端 TDZ——handleSend（useCallback）函数体引用 isToolReportBody，而该 const 声明在预会话 i
状态：implemented
变更：2026-10-06-opencode-session-send-incident
原编号：D-000@v1
锚点：.sillyspec/changes/archive/2026-10-06-opencode-session-send-incident/design.md
文件：docs/sillyspec/litellm-v1950-image-entrypoint-not-found.md, frontend/src/components/daemon/session-panel/session-panel-page.tsx
最近确认：未记录
理由：双故障一根一修：①前端 TDZ——handleSend（useCallback）函数体引用 isToolReportBody，而该 const 声明在预会话 if (!sessionId) 早退**之后**（sessionBody 派生区，d6fabf408 引入）；预会话渲染（新建会话页）走早退，声明语句不执行 → 闭包绑定停 TDZ → 首句点发送必抛 ReferenceError（线上 chunk 的 ae 即此变量，session-panel-page.tsx:3234 实证 + 预会话测试文件 15 用例挂）。修法：派生上移到 deriveSessionStatusFlags 旁（所有早退分支之前），session 判空改可选链（预会话/加载中 null → false，真会话语义不变），并补进 handleSend 依赖数组（顺手补同行的 handleTakeoverSend 预存缺依赖）。②opencode SSL——daemon 所在机器直连 opencode.ai 被 TLS 劫持（证书主机名不匹配，本机 curl SEC_E_WRONG_PRINCIPAL 复现），opencode 供应商改 anthropic 直连后 Claude Code 子进程直打出网即撞此劫持；修法：供应商行 extra_env 注入 HTTPS_PROXY=http://127.0.0.1:7897（daemon 本机 Clash 混合端口，http 代理实测 200），注入器规则 6 Object.assign 原样透传给子进程，Claude Code（undici）原生尊重该 env。为什么不改代码路由层：问题分别是变量作用域错位与机器网络环境，均无代码架构面变更必要，最小修复即正确修复。

## D-docs-007@v1 2026-10-06-opencode-settings-config-poison——纯运维数据修复 + 文档补记，无代码改动。
状态：implemented
变更：2026-10-06-opencode-settings-config-poison
原编号：D-000@v1
锚点：.sillyspec/changes/archive/2026-10-06-opencode-settings-config-poison/design.md
文件：docs/sillyspec/litellm-v1950-image-entrypoint-not-found.md
最近确认：未记录
理由：纯运维数据修复 + 文档补记，无代码改动。根因：OpenCode Go 供应商行残留旧 settings_config.env（错误 ANTHROPIC_BASE_URL 指向 /zen/go/v1/chat/completions 全端点 + 无关 sk- key + mimo 模型串），daemon 注入器规则 7（settings_config.env 最高优先级）覆盖平台全部注入 → Claude Code 打错端点报「selected model 不存在」。处置：psql UPDATE settings_config=NULL（行 68b4b5b9）+ 坑文档补记覆盖链教训。选数据修复而非代码改动：注入器规则 7 的优先级设计本身是有意的（D-007 settings_config 是用户显式配置的最高意志，cc-switch 导入兼容），毒在数据残留不在代码；平台 UI 真实新会话端到端验证（发送「请只回复两个字：收到」→ 回复「收到」，第 1 轮已完成）闭环。

## D-docs-008@v1 2026-10-10-ws-init-dialog-close-guard——24h 审查发现 1940c83b1「创建即初始化」弹窗收口不完整：initializing 态只把 footer 取消按钮 disabled，antd v6
状态：implemented
变更：2026-10-10-ws-init-dialog-close-guard
原编号：D-000@v1
锚点：.sillyspec/changes/archive/2026-10-10-ws-init-dialog-close-guard/design.md
文件：docs/sillyspec/finished/fourpiece-created-at-utc-born-anchor-offset.md, docs/sillyspec/finished/tombstone-conflict-per-sync-accounting.md, frontend/src/components/__tests__/workspace-scan-dialog.test.tsx, frontend/src/components/workspace-scan-dialog.tsx
最近确认：未记录
理由：24h 审查发现 1940c83b1「创建即初始化」弹窗收口不完整：initializing 态只把 footer 取消按钮 disabled，antd v6 Modal 默认开启的 ESC（keyboard）/点遮罩（maskClosable）/右上角 X（closable）三条通道仍会触发 onCancel → 父组件卸载弹窗、轮询清理、进度反馈丢失且列表不刷新；另后台标签页期间轮询 tick 被 document.hidden 短路而 5min 超时 setTimeout 不暂停，后台初始化实际成功、回前台却见假失败。方案：①Modal 三属性随 busy（creating/initializing）态翻转（`!busy`），idle/done/init_failed 保持默认；②超时回调改 armInitDeadline 递归——到期时若 document.hidden 则顺延一拍（2s）再探，回前台后重挂满窗（5min）再计，与轮询的 D-005 可见性暂停钟对齐。选属性翻转而非 onCancel 内拦截：属性禁用让三条通道在交互层就不触发（含 X 按钮直接不渲染），比事后拦截语义更明确且不影响 idle 态既有行为。

## D-docs-009@v1 2026-10-14-files-refresh-explicit-sync——上一变更（2026-10-13-change-files-refresh-sync）把同步前置挂在 GET files 接口本体上，导致悬浮面板 15s 自动轮
状态：implemented
变更：2026-10-14-files-refresh-explicit-sync
原编号：D-000@v1
锚点：.sillyspec/changes/archive/2026-10-14-files-refresh-explicit-sync/design.md
文件：backend/app/modules/change/router.py, backend/app/modules/change/tests/test_files_refresh_sync.py, backend/openapi.json, docs/sillyspec/finished/flow-done-design-question-line-injection.md, docs/sillyspec/finished/flow-dynamic-subset-root-scripts-path.md, docs/sillyspec/finished/thin-upgrade-stale-stage-window.md, frontend/src/components/__tests__/change-file-tree-autorefresh.test.tsx, frontend/src/components/change-file-tree.tsx, frontend/src/lib/api-types.ts, frontend/src/lib/change-files.ts
最近确认：未记录
理由：上一变更（2026-10-13-change-files-refresh-sync）把同步前置挂在 GET files 接口本体上，导致悬浮面板 15s 自动轮询等非主动读取也周期性触发 daemon CLI 同步并阻塞请求（实测感知为页面一直慢）。本变更收窄触发面：GET files 增加可选查询参数 `sync`（默认 false=纯读，行为回到上一变更之前），仅显式 `sync=1`（前端「刷新」按钮点击、错误重试——用户主动动作）才触发 daemon 定向上行同步；同时把 sync 路径的 RPC 等待预算从 15s 降到 3s——点击刷新多数情况在预算内拿到同步后数据，超时静默降级返回现有镜像数据（daemon 防抖 15s 内再点秒回新数据），任何一次点击都不会长时间卡住。前端改动集中在 change-file-tree.tsx 的 refreshTree 增加来源区分：按钮点击/错误重试带 sync=true，初始挂载、autoRefreshMs 轮询、保存后刷新不带。

## D-docs-010@v1 2026-10-16-decision-pill-no-workspace——根因：2026-10-16-session-decision-pill task-04 把悬浮行挂载条件写成 `sessionId != null && ses
状态：implemented
变更：2026-10-16-decision-pill-no-workspace
原编号：D-000@v1
锚点：.sillyspec/changes/archive/2026-10-16-decision-pill-no-workspace/design.md
文件：docs/releases/2026-10-16-006-9b5485fb0.md, frontend/src/components/daemon/__tests__/session-decisions-hover.test.tsx, frontend/src/components/daemon/session-panel/session-panel-page.tsx
最近确认：未记录
理由：根因：2026-10-16-session-decision-pill task-04 把悬浮行挂载条件写成 `sessionId != null && session?.workspace_id != null`（沿变更文件 pill 先例），待决策 pill 只消费 sessionId 却被 workspace 门连坐——老会话 workspace_id 为空（如 445e12d9，10-09 创建早于工作区绑定约束）时整个悬浮行不挂载。修复：行门槛放宽为仅 `sessionId != null`，变更文件 pill 子槽保留自己的 `session?.workspace_id != null` 门（其 API 需要 workspace，缺省不渲染零占位契约不变）。改动仅 frontend/src/components/daemon/session-panel/session-panel-page.tsx 挂载条件一处。

## D-docs-011@v1 2026-10-20-conflict-platform-archive——核心洞察：冲突推送里被拒的 op 本身就是机器侧事实——add/update 的 base64 `content` 与 `mtime`、delete 的「机器侧
状态：implemented
变更：2026-10-20-conflict-platform-archive
原编号：D-000@v1
锚点：.sillyspec/changes/archive/2026-10-20-conflict-platform-archive/design.md
文件：backend/app/modules/daemon/sillyspec_compare.py, backend/app/modules/daemon/tests/test_sillyspec_compare.py, backend/app/modules/spec_workspace/service.py, backend/app/modules/spec_workspace/tests/test_conflict_local_archive.py, backend/conftest.py, docs/releases/2026-10-20-001-e94cc6e8e.md, docs/sillyspec/active-pitfalls.md, docs/sillyspec/finished/2026-10-19-sillyspec-v3.33.1-rewrites-agents-md-deletes-claude-md.md, frontend/src/components/changes/__tests__/conflict-compare-modal.test.tsx, frontend/src/components/changes/conflict-compare-modal.tsx
最近确认：未记录
理由：核心洞察：冲突推送里被拒的 op 本身就是机器侧事实——add/update 的 base64 `content` 与 `mtime`、delete 的「机器侧已删」语义、rename 的 new_path 落点。因此不需要任何新通道：apply_ops 的七处被拒点（乐观锁冲突 / 删除前缀拦截 add+update 两处 / 墓碑行 add / 墓碑行 update / rename 目标删除前缀 / rename 目标墓碑 / rename 目标占用——见「接口契约」逐点）在既有 conflict 收集动作旁把被拒 op 追加进 `conflicted_ops` 列表，收尾交给 `_upsert_sync_conflict` 蒸馏成 `details_json.local_archive`（条目 `{path, missing, content, binary, truncated, mtime}`，三重帽）。对比端点 `SillySpecCompareService.compare` 在 spec-tree 分支捕获 `_fetch_snapshot` 抛出的 `conflict_record_missing` 网关错，查 open 行留档，命中则以留档为机器侧快照走既有 `_build_spec_tree_compare`（平台侧仍实时读 spec_root），`record_label="platform-archive"`。 选这个方案而不是「服务端 upsert 时经 daemon RPC 抓记录快照」的原因：机器侧 `spec-sync-conflict-*.json` 是 CLI 在**收到推送响应之后**才落盘的（CLI 侧 spec-sync.js 冲突处理时点），服务端在 apply_ops/upsert 时点抓取必竞态 miss；且 Workspace 表无 instance 绑定，服务端无从得知该向哪台机器发 RPC。也不是「平台行携带记录 label 驱动对比」：那只解决记录名口径（full-tree 兜底 2026-10-16 已解决记录**活着**时的读取），不解决记录**死亡**——本坑的残留断层正是「行开记录亡」。

## D-docs-012@v1 2026-10-22-agent-profile-edit-refresh——在 `lib/agent-profiles.ts` 的 `useCreateAgentProfile` / `useUpdateAgentProfile` on
状态：implemented
变更：2026-10-22-agent-profile-edit-refresh
原编号：D-000@v1
锚点：.sillyspec/changes/archive/2026-10-22-agent-profile-edit-refresh/design.md
文件：docs/releases/2026-10-22-002-43f2423a8.md, frontend/src/lib/__tests__/agent-profiles.test.tsx, frontend/src/lib/agent-profiles.ts
最近确认：未记录
理由：在 `lib/agent-profiles.ts` 的 `useCreateAgentProfile` / `useUpdateAgentProfile` onSuccess 里**补一个** `agentProfileQueryKeys.mineList` 失效（保留既有 workspaceList(wid) 失效）。根因是桶错配：全局卡片墙页（/agent-profiles）数据在 mineList 桶，而这两个 mutation 只失效 workspaceList(wid) 桶；复制/删除当年已在页面层用裸 fetch+手动失效绕过（page.tsx 头注释明载），新建/编辑走表单内的这两个 hook 漏掉。修在 hook 层而非页面层：一处修复同时覆盖全局页与工作区内页两个消费面，且与「mutation 失效缓存复用同一 key 工厂」的仓约定一致。

## D-docs-013@v1 2026-10-23-rename-ghost-pit-doc——代码根治在 sillyspec 仓变更 2026-10-23-rename-platform-tombstone（renameChange 成功后旧名落删除台账
状态：implemented
变更：2026-10-23-rename-ghost-pit-doc
原编号：D-000@v1
锚点：.sillyspec/changes/archive/2026-10-23-rename-ghost-pit-doc/design.md
文件：docs/sillyspec/finished/坑11-rename-弃名不落台账平台幽灵永挂.md
最近确认：未记录
理由：代码根治在 sillyspec 仓变更 2026-10-23-rename-platform-tombstone（renameChange 成功后旧名落删除台账，借 sync 台账墓碑分支收敛平台旧名行，提交 bfc29340），本仓只做知识留痕：把 2026-10-23 幽灵行事故的现象/根因链/修复/清理/验证写成坑11，落 `docs/sillyspec/finished/`，与坑9、坑10 同体例互链，供 knowledge 蒸馏与后续防复潮。
