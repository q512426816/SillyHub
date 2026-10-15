# 决策知识 — workspace

> decision-distill 从变更 decisions.md 幂等提炼（「最近确认」= 归档时 HEAD）。条目字段行为 docs-check 机械解析契约，勿手改。

## D-003@v1 技术方案 A——判定链单点收紧 + 三触点对齐
状态：implemented
变更：2026-09-20-workspace-member-visibility
锚点：未记录
最近确认：3642c3d0
理由：选方案 A。改 rbac.has_permission 单点（workspace_id≠None 时平台段仅 platform:admin 放行）+ 列表端点平台分支收窄 + 通知收件人段 2 收窄，三处口径联动。否决 B：mcp:read 等双用途权限（既开菜单又开工作区内容）无法从平台角色剥离，否则菜单消失，且手授即可重开暗道；否决 C：权限数量/种子/前端矩阵/存量数据全要动，过度设计。
故障面：三处若不同步会出现口径割裂（列表看得见进不去 / 收到通知看不了内容）——ql-20260917-007 的反向教训，验收用三口径一致性测试兜底
退役判据：若未来引入「平台级巡视员」类需跨工作区只读的角色需求，重新评估平台级白名单机制（届时走新决策版本）

## D-002@v1 形态=展示对照+一键导入（用户选定）
状态：implemented
变更：2026-10-10-linked-repos-local-echo
锚点：未记录
最近确认：f4f974870
理由：展示+一键导入：卡片新增「本机已有配置」对照区（三态：两边一致/仅本地/仅平台），「仅本地有」条目可勾选导入为平台登记。

## D-003@v1 拉取时机=手动刷新现拉（不随 GET 自动拉）
状态：implemented
变更：2026-10-10-linked-repos-local-echo
锚点：未记录
最近确认：f4f974870
理由：手动「刷新本机现状」按钮现拉（请求-响应 RPC）。理由：daemon 离线/超时不阻塞列表加载；本地配置低频变化，conflict_snapshot 按需拉取先例同款。
故障面：用户忘刷新看到旧快照——展示 fetched_at 时间戳缓解
退役判据：若未来做快照增量缓存（多成员聚合视图），手动刷新可升级为缓存+手动强制刷新

## D-004@v1 导入语义——复用平台登记建行，重名跳过
状态：implemented
变更：2026-10-10-linked-repos-local-echo
锚点：未记录
最近确认：f4f974870
理由：导入=调既有 create_repo 建平台登记行：projects 条目的 path 带入 rel_path（保持团队约定相对路径原样）；repos: 条目的绝对路径写入**当前用户**的 my_path（成员级语义天然对位）；与平台已有同名登记跳过（幂等，响应标 skipped）。

## D-005@v1 快照不落库（实时取，只读）
状态：implemented
变更：2026-10-10-linked-repos-local-echo
锚点：未记录
最近确认：f4f974870
理由：不落库。实时拉取即弃（对照视图是即时快照不是状态源）；与 sync_states（下行落盘状态）分离。
故障面：无持久化即无历史——对照视图只有「当下」，回看历史需另行落库（v2 候选）
退役判据：出现快照历史/审计需求时升表持久化（复用 sync_states 模式）

## D-002@v2 v1 范围修订——登记+双落盘为核心，会话注入移出本期
状态：implemented
变更：2026-10-10-workspec-maintenance
锚点：未记录
最近确认：b15fafc3b
理由：修订。用户确认双落盘架构时明确「会话上下文注入降为可选加分项不再作为核心」。v1 范围=关联仓登记（共享字段+成员级路径）+daemon 双落盘+落盘状态回环；会话上下文注入移入非目标（留 v2 候选——落盘后 CLI 自身的模块上下文/跨仓对账机制已覆盖大部分场景）。
supersedes：D-002@v1

## D-003@v2 实现路线修订——「平台登记 + daemon 双落盘」取代纯「登记+会话注入」
状态：implemented
变更：2026-10-10-workspec-maintenance
锚点：未记录
最近确认：b15fafc3b
理由：不维持纯 A。修订为：A 的平台登记层（CRUD/成员级路径/审计）保留为 UI 与权威源，但价值核心转向 daemon 落盘层（D-008）：projects/*.yaml（workspace add）+ local.yaml repos:（register-repo）。会话注入从必做降为可选。
supersedes：D-003@v1

## D-006@v1 砍掉关联类型枚举（spec_source/peer）——用户否决
状态：implemented
变更：2026-10-10-workspec-maintenance
锚点：未记录
最近确认：b15fafc3b
理由：用户原话：「我认为没必要类型啊」——v1 两类行为完全一样（都只是注入上下文），枚举只有展示意义，配置时多一步选择。砍掉，保留 name/repo_url/本地路径/描述。v2 若需按类型分化行为（规范聚合/跨仓影响标记），届时再补列迁移（本项目未上线无历史兼容负担，CLAUDE.md 规则 11）。

## D-007@v1 关联仓本地路径改为成员级（每用户每机器各自配置）
状态：implemented
变更：2026-10-10-workspec-maintenance
锚点：未记录
最近确认：b15fafc3b
理由：用户原话：「你要关注的应该是 不同用户电脑上 这些关联的仓库位置都不一样」——原设计工作区级单值无法适配多成员多机器（A 的 clone 在 C:/Users/A/...，B 的在 /home/b/...）。改为两层：仓的共享登记（name/repo_url/description）为工作区级；本地路径为成员级（每用户各自保存自己的路径），对齐 WorkspaceMemberRuntime 成员绑定 root_path 的既有模式。会话注入时按 lease 认领成员解析其配置的本地路径，未配置则该条只注入 repo_url 并标注路径未配置。

## D-008@v1 平台配置必须落盘到工具消费点（local.yaml repos: + projects/）——用户定调
状态：implemented
变更：2026-10-10-workspec-maintenance
锚点：未记录
最近确认：b15fafc3b
理由：用户原话：「local.yaml 中 和 project 目录 要考虑清楚怎么配置，这个是必须的！ 不涉及 sillyspec 工具能力，做这个功能没意义，并且 sillyspec 现有的能力应该满足的！」——即：平台配置必须驱动工具行为（跨仓对账/子项目登记），纯平台侧登记+会话注入不构成这个功能的意义；且用工具现有机制落盘（不改 sillyspec 本身）。查证证实工具能力满足：① `sillyspec workspace add` 路径校验仅 existsSync(resolve(cwd,path)) 无「根目录内」限制，`../xxx` 跨目录树相对路径可登记（sillyspec/src/workspace.js:38-70）；② `sillyspec local register-repo <key> <path>` 外科写 local.yaml repos: 段，跨仓 task 卡 repo: key 校验/plan-postcheck/MultiRepoContext/scope-audit 消费（sillyspec/src/index.js:4972-5008、src/stages/plan-postcheck.js:247-283）。
故障面：daemon 落盘经 spawn CLI 有版本依赖（老 sillyspec 无 register-repo 命令则该层降级，需能力探测+状态可见）；成员机器目录布局不满足约定相对路径时 workspace add 落盘失败（需失败回报与 UI 提示）；平台 DB 与落盘产物间存在最终一致窗口
退役判据：sillyspec 工具若原生提供「平台侧配置拉取」命令（pull 式），daemon push 式落盘可退役

## D-009@v1 execute 验收审查返工——越权修复/PATCH 清除语义/best-effort 补全/owner 视角/四处偏差登记
状态：implemented
变更：2026-10-10-workspec-maintenance
锚点：未记录
最近确认：b15fafc3b
理由：全部修复+登记。①跨工作区 repo_id 越权（IDOR）：service 层 get/update/delete/upsert_my_path 加 workspace 归属过滤（跨工作区统一 404）+回归用例；②PATCH 清除失效：改 exclude_unset 语义（JSON null=显式清除，缺省=不动）+用例；③best-effort 推送半通道：payload 补逐成员 abs_path（按 binding.user_id 查 paths）、推送挂 PATCH/my-path 端点（原仅 create）、任务引用模块级集合持有（fire-and-forget 不阻塞 CRUD）+用例；④owner 视角走样：summary 提权视角扩为 owner（workspace 建者，_ensure_creator_as_owner 先例）||platform admin；⑤daemon 失败重试一次（R-07 承诺补齐，unsupported 不重试）+3 用例；⑥死代码 clear_all_sync_states 删除。
故障面：无（收敛性修复）
退役判据：无

## D-002@v1 不做自动写库匹配/双向/路径复用
状态：implemented
变更：2026-10-11-linked-repo-workspace-ref
锚点：未记录
最近确认：0f7af00fe
理由：不做。自动匹配只提示（local-echo 回显时标 matched_workspace），确认后由用户手动挂载；双向自动会在两表间形成同步循环面；路径复用涉及跨工作区权限边界，均留 v2 候选。
