---
author: qinyi
created_at: 2026-08-25 21:06:55
change: 2026-08-25-workspace-git-log
---

# 决策台账 — 2026-08-25-workspace-git-log

> 只记录有实现/验收影响的决策。Grill/execute 修正时新版本 supersedes 旧版本。

## D-001@v1 : 前端自研 SVG 泳道渲染，禁止引入第三方 git 图组件

- type: frontend-architecture
- status: confirmed
- source: explore 阶段调研（2026-08-25）+ 用户在 AskUserQuestion 拍板（方案 B：自研 SVG 泳道）
- question: git 日志视图的前端渲染层用现成组件还是自研？
- answer: 自研 SVG 泳道，走 AI-native 双主题 token，react-virtual 虚拟滚动。
- normalized_requirement: 前端不得引入任何第三方 git 图组件；泳道 SVG 自绘；颜色取值单一源 themes.ts；长列表虚拟滚动。
- impacts: 前端新增 commit-graph.tsx 等四个组件；无新增 npm 依赖；lane 数据由后端供给（见 D-004）。
- evidence: npm registry/GitHub 实测：@tomplum/react-git-log 3.x peer 要求 React ≥19（本项目 React 18.3+Next14 装不上，2.5.0 可装但小众锁版本）；@gitgraph/react 已归档且为手动 addCommit 示意图 API；Gitea/GitLab 均为内嵌实现无 npm 包。
- priority: P0
- 锚点: frontend/src/components/git-log/commit-graph.tsx
- 模块域: frontend

## D-002@v1 : 数据链路走方案 A——新 backend git_log 模块 + daemon host-fs 只读 RPC

- type: backend-architecture
- status: confirmed
- source: brainstorm step 4 用户 AskUserQuestion 选择方案 A
- question: git log 数据链路的组织方式？
- answer: 仿 explorer 四件套新建 backend/app/modules/git_log/ + daemon host-fs-handler 新增 4 个只读 RPC。
- normalized_requirement: 不扩展 explorer 模块；不经 backend 直跑 git；daemon 侧复用 execFile('git') 统一执行器与 allowed_roots 守卫；backend service 照抄 explorer 的绑定解析/显式超时/错误映射模式。
- impacts: 三端均有新增文件（见 design §6 文件变更清单）；daemon protocol 加 4 方法名。
- evidence: 工作区源码物理在 daemon 宿主机（backend Docker 容器路径不可达，resolve_root_path_for_daemon 为证）；explorer 模块为同构模板（router/service/schema 四端点全套先例）。
- priority: P0
- 锚点: backend/app/modules/git_log/service.py
- 模块域: backend, sillyhub-daemon
- 否决理由（被否方案）: 方案 B（扩展 explorer）——文件浏览与 git 历史两个领域混在一个模块，lane 算法无法独立演化；方案 C（backend 直跑 git）——Docker 生产部署下工作区路径不可达，直接失效。
- 复潮条件（被否方案）: C 仅在 backend 与工作区恒同机部署的形态下可复潮；B 在 explorer 与 git_log 决定共享超过 70% 逻辑时可复潮。

## D-003@v1 : 第一版严格只读（浏览 + diff 详情），不做任何 git 写操作

- type: scope
- status: confirmed
- source: brainstorm step 3 用户 AskUserQuestion 选择「浏览 + diff 详情」
- question: 第一版功能边界？
- answer: 泳道图 + 提交列表 + 详情 Drawer（含变更文件树与文件级 unified diff）；不做 checkout/merge/pull 等任何写操作。
- normalized_requirement: 全链路只读子命令（log/for-each-ref/show/rev-parse）；无 DB 写入；写操作需求未来另立变更走既有 git_gateway/worktree 体系。
- impacts: daemon RPC 白名单面收窄；无状态迁移（生命周期契约豁免的依据）。
- evidence: git_gateway 已有 lease 内白名单执行体系可承载未来写操作，避免本变更重复建设。
- priority: P0
- 锚点: backend/app/modules/git_log/router.py
- 模块域: backend, sillyhub-daemon

## D-004@v1 : lane 坐标后端计算、前端纯渲染；跨页一致性用全前缀确定性计算

- type: algorithm
- status: confirmed
- source: explore 阶段用户指定 + brainstorm step 5 确认（设计深化）
- question: 泳道 lane 分配在哪一端算？分页下如何保证页间一致？
- answer: backend graph_layout.py 纯函数计算（Gitea modules/git/graph 算法移植：有序活跃槽位 + 最左空闲分配 + 回收复用）；daemon 不用 --skip，每页拉 skip+limit+lookahead(50) 条全前缀确定性计算，只返回窗口。
- normalized_requirement: 算法确定性（同前缀同输出）；前端不做布局计算；lookahead=50；skip 上限 2000。
- impacts: design §7.3 接口契约（edges 预计算进响应）；R-02 深翻页 O(skip) 风险被接受并设上限。
- evidence: GitLab 同思路（服务端算坐标）；--skip 会破坏 lane 全局一致性（页首活跃槽状态丢失）；cursor 方案把状态推给前端违背纯渲染原则。
- priority: P1
- 锚点: backend/app/modules/git_log/graph_layout.py
- 模块域: backend, frontend

## D-005@v1 : 作者过滤 + 变更文件目录树 + 性能强化（用户确认补充）

- type: requirement-refinement
- status: confirmed
- source: brainstorm step 5 用户确认设计时补充（原话：筛选条件再补充个作者，变更文件最好以结构树的形式展示，整体还要考虑性能问题）
- question: 设计确认时用户追加的三点要求如何落位？
- answer: ① git log --author（独立 argv，无注入面；过滤后缺失 parent 的边不画）② 文件树为前端聚合（--numstat 平铺路径按 / 聚合，目录节点聚合 +x/-y，diff 挂叶子按需加载，零额外 RPC）③ 性能：react-query 缓存 + SVG 视口重绘 + diff 延迟加载 + --max-count/skip 硬上限。
- normalized_requirement: 工具栏含分支+作者两过滤；Drawer 文件区为目录树交互；性能四项措施纳入验收。
- impacts: design §2 目标 2/3、§5.3 过滤语义、§5.4 前端组件、R-02/R-05/R-06。
- evidence: 用户 AskUserQuestion 备注原话；change-file-tree.tsx 为树交互现成参考。
- priority: P1
- 锚点: frontend/src/components/git-log/file-tree.tsx
- 模块域: frontend, backend

## D-006@v1 : Design Grill 修正合订——RPC 平名直连 / git_mode 两态 / lookahead 退化明文化 / 总数与作者输入形态

- type: consistency
- status: confirmed
- source: design-grill（独立审查子代理 17 项交叉点，2026-08-25）
- question: design v1 与现行代码/自身章节间的 3 项 P1 冲突与若干 P2 缺口如何裁定？
- answer: ① backend 数据通路按 D-002 原意走 explorer 平名直连（daemon.ts 平名注册 git_log/git_refs/git_show/git_diff_file，**不新增 HostFsDelegate 方法**——_via_rpc_or_degrade 会静默吞 offline/timeout 且经无 user 门控的解析路径）；② git_mode 只暴露 git|no_git 两态（probe 真实返回 git/direct/unknown，service 映射 direct→no_git、unknown→offline 502，无 worktree 态）；③ lookahead=50 不足时父边不绘制（页边界视觉截断为接受退化，lane 编号不受影响），补第七类测试用例；④ 不显示提交总数（避免 rev-list --count 第 5 个 RPC），副标题改「已加载 N 条」；⑤ 分支下拉数据源=响应 top-level branches[]（git_refs 全量），作者过滤为文本输入框（无稳定候选数据源）；⑥ tag 用 %(*objectname) peeled 回退映射；⑦ branch 正则禁首 '-'、path 拒 pathspec magic、64KB 为独立选定上限、seq 定义为全局绝对序、--no-renames 简化入非目标、空仓库转空态结构。
- normalized_requirement: design.md v2（§3/§5.1-§5.5/§6/§7.2/§7.4/§12 修正记录）为实现与验收唯一口径；delegate.py 不在文件变更清单。
- impacts: 文件清单删 delegate.py 行、加 daemon.ts 注册行；§7.4 契约加 branches[] 与 seq 语义；前端工具栏形态两处调整。
- evidence: 审查报告 CC-01~CC-17（review.json 同目录）；delegate.py:819-828 静默降级、ws_rpc.py:113 前缀、explorer/service.py:5-7 门控坑注、for-each-ref peeled 语义、file-rpc.ts:221 上限 10MB。
- priority: P1
- 锚点: backend/app/modules/git_log/service.py
- 模块域: backend, sillyhub-daemon, frontend
