# 决策知识 — unmapped

> decision-distill 从变更 decisions.md 幂等提炼（「最近确认」= 归档时 HEAD）。条目字段行为 docs-check 机械解析契约，勿手改。

## D-unmapped-026@v1 dsh 二进制发现策略——照 agent-detector 先例
状态：implemented
变更：2026-10-15-dsh-engine-acp
原编号：D-001@v1
锚点：未记录
最近确认：775d86011
理由：A：在 sillyhub-daemon/src/agent-detector.ts 注册第 13 个探测项——`env 覆盖（SILLYHUB_DSH_PATH）→ PATH which → 不可用`，用户自行安装 dsh（`npm i -g @deepseek-ai/dsh` 或任意方式），平台只负责发现、`--version` 探测与提示；不做平台托管自动安装，不做仅显式配置。
故障面：用户机器装了 dsh 但不在 daemon 进程 PATH（如 GUI 启动继承环境不全）→ 误报不可用；缓解：SILLYHUB_DSH_PATH 显式覆盖 + 探测结果提示
退役判据：平台转为托管安装引擎（如 claude SDK 依赖模式）时重议

## D-unmapped-027@v1 dsh 版本门语义——最低版本门 + 警告（不硬拒）
状态：implemented
变更：2026-10-15-dsh-engine-acp
原编号：D-002@v1
锚点：未记录
最近确认：775d86011
理由：A：MIN_VERSIONS 增加条目 `dsh: (0,2,1)`，低于门槛返回警告文本但照常放行——与 claude(2.0.0)/codex(0.100.0)/copilot(1.0.0)/pi(0.81.0) 四引擎行为完全一致；alpha 破坏性变更风险由驱动层兜底（ACP 握手/协议失败时显式报错并终止会话，不静默错乱）。不做硬拒分支，不做精确钉死单版本。
故障面：低于门槛的 dsh 放行后遇协议破坏性变更 → 驱动握手失败显式报错（可接受，有结构化错误兜底）
退役判据：dsh 发布稳定版（≥1.0）或频繁出现低版本协议踩坑时升为硬拒重议

## D-unmapped-028@v1 驱动层实现方式——自研 ACP 驱动（方案 A）
状态：implemented
变更：2026-10-15-dsh-engine-acp
原编号：D-003@v1
锚点：未记录
最近确认：775d86011
理由：方案 A：新写 `sillyhub-daemon/src/interactive/dsh-acp-driver.ts`，复用 codex 同款 `adapters/json-rpc.ts` 分帧/关联基建，手写 ACP v1 方法面（initialize / session/new / session/prompt / session/cancel / session/update 通知 / session/request_permission / session/set_config_option）到 AgentEvent 的映射；对照 dsh 仓库 packages/subagent/subagent-acp 参考客户端实现。理由：ACP v1 方法面比 codex app-server 还小；与三驱动同构、注册表/caps 三端镜像/审批管线零摩擦；不给 daemon 添新依赖。
故障面：ACP 通知语义映射手写出错（如 tool_call 生命周期错序）→ 单测钉 ACP spec 样例事件序列防偏
退役判据：ACP 协议大版本升级致手写映射维护成本超过 SDK 接入成本时重议

## D-unmapped-029@v1 落选——官方 @agentclientprotocol/sdk 客户端包（方案 B）
状态：rejected
变更：2026-10-15-dsh-engine-acp
原编号：D-004@v1
锚点：未记录
最近确认：775d86011
理由：落选。核心劣势：daemon 新增 npm 依赖（供应链与版本面扩大），且 SDK client 的进程生命周期管理与平台 SessionManager 模式的适配未知、需额外调研成本；收益（协议演进保护）在已钉最低版本门 + dsh alpha 现实下敞口有限。
否决理由：新依赖 + 未知适配成本 > 协议演进保护收益
复潮条件：ACP 协议演进频繁致手写映射维护成本显著上升，或官方 SDK 提供与 SessionManager 兼容的进程托管抽象

## D-unmapped-030@v1 落选——headless --json 短命进程批处理通道（方案 C）
状态：rejected
变更：2026-10-15-dsh-engine-acp
原编号：D-005@v1
锚点：未记录
最近确认：775d86011
理由：落选。核心劣势：一次一任务、无审批代答、无 mid-turn 取消、多轮对话需手动 --session-id 续跑——不满足"平台上进行会话"的核心需求本体（仅适合批处理场景，与本次变更目标正交）。
否决理由：不满足会话交互核心需求
复潮条件：出现批处理/CI 型 dsh 任务接入需求时，可作为独立变更另行立项（与本变更不冲突）

## D-unmapped-031@v1 执行期任务边界合并——task-03 驱动与 task-04 注册的类型依赖
状态：implemented
变更：2026-10-15-dsh-engine-acp
原编号：D-006@v1
锚点：未记录
最近确认：775d86011
理由：task-03 与 task-04 的 providers.ts 注册面合并执行（驱动 + 注册表条目同批落地后才可能 typecheck 全绿）；测试仍按各自 verify 命令分开跑，wt-commit 按 task 文件集合分开提交。非破坏性局部裁决（不推翻 D-xxx、allowed_paths 并集仅限本两任务边界）。
故障面：两任务文件在中间态（驱动已写、注册未写）typecheck 红——已通过合并执行消除中间态
退役判据：若未来 InteractiveProvider 改为独立字面量联合（不随注册表推导），可解除合并恢复独立收口

## D-unmapped-032@v1 执行期任务边界修正——task-07 单一源实为 runtimes.ts
状态：implemented
变更：2026-10-15-dsh-engine-acp
原编号：D-007@v1
锚点：未记录
最近确认：775d86011
理由：边界修正为 runtimes.ts（+page.test.tsx 断言 + session-list-panel.tsx 仅头注释同步）——D-006 同款执行期裁决先例，commit a8f8b228/21f94d01 留痕；评审员建议补记本条目（execute-review note 级）。
退役判据：引擎选项单一源若迁址，条目随迁

## D-unmapped-033@v1 设计期风险与放弃方案（底稿）
状态：implemented
变更：2026-10-15-pseudo-domain-migration
原编号：D-001@v1
锚点：未记录
最近确认：4b034a03ce257a51d95c741e3ead072ed6427410
理由：最大风险：主域机械裁决的错分（如 ci-recurrence-guard 横断变更落 frontend_components 而非 CI 语义域）——接受：规则与触达路由同源（判定集含 frontend_components 时注入必达），横断变更多域命中下无唯一正确解；人工改判两处已在案。次风险：6 条无变更条目主题判域 daemon 属人工判断——留痕可复议。第三风险：坏段/重复段修复属数据手术——归档真相源核验+段字节级操作+validate ok+git 留痕四重保护。放弃方案：①按条目语义逐条人工判域（436 条不可行）；②保持 unmapped 只设基线消音（用户明示迁真域）；③重蒸馏迁移（归档源改不动）。

## D-unmapped-034@v1 设计期风险与放弃方案（底稿）
状态：implemented
变更：2026-10-15-workspace-session-agent-only
原编号：D-001@v1
锚点：未记录
最近确认：add1712b21ebc572ce84ff4e2436ed07500aba54
理由：**风险（已接受并留了出口）**： 1. 绑定机器离线/不可见时用户「无路可走」——本设计砍掉机器列表（需求要求），但空态文案给出两条恢复路径（启动 daemon / 去工作区页重绑定）。若实测反馈需要临时换机器，后续可在空态加「换机器」降级入口（本期不做，避免破坏「不选机器」语义）。 2. 门户/悬浮宿主沿用非工作区路径的旧直带逻辑未动，两套直带条件并存（工作区=agent 即可，非工作区=machineId+agent）——已在代码注释与 FR-04 显式声明，防后人误「统一」。 **试过但放弃的方案**： - 只改工作区 scope 页、不动全局门户的工作区分组 → 同一动作在不同入口表现不一致，用户会认为「有的地方还要选机器」。 - 后端支持「只传 workspace_id + provider，由后端按 binding 派发机器」→ 改动面扩到后端 placement/inject_gates/契约/gen:types，且前端仍需知道「哪台机器在线」才能给空态指引；本期前端解析 binding 已足够，后端零改动。 - 绑定模式保留「机器」只读展示 + 展开可换机器 → 与「不应该选择机器信息」直接冲突，且增加状态机复杂度。

## D-unmapped-035@v1 设计期风险与放弃方案（底稿）
状态：implemented
变更：2026-10-15-assets-graph-depth
原编号：D-001@v1
锚点：未记录
最近确认：2d3c285319fdf676ddfe02309fe7b19e69e1e48b
理由：- 风险一：深度 2-3 切片节点数可能超 FORCE_NODE_LIMIT=200——GraphCanvas 既有 >200 静态分环降级自动兜住（2026-10-15-graph-type-cluster 语义），组件无需新增护栏；可达性上 depth 3 大仓可能秒级耗时，keepPreviousData 已保证切换期间有内容可看。 - 风险二：keepPreviousData 期间 counts 文案显示旧切片计数——数据到达即原位刷新，短暂陈旧可接受（与 changes 列表页同语义）。 - 试过放弃：①Select 下拉选深度——卡头横向空间紧张，三档 chips 一眼可达（图谱页用 Select 是因为表单还有 sub/edges 多控件，此处只有 depth 一维）；②把 depth 做成资产卡 props 传下来——深度是图谱分区内部交互态，与资产卡取数无关，上提徒增传参链。
