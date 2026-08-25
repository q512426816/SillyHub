---
author: qinyi
created_at: 2026-08-25 21:24:40
change: 2026-08-25-workspace-git-log
---
# 需求规格（Requirements）

## 角色

| 角色 | 说明 |
|---|---|
| 工作区成员（开发者） | 有 WORKSPACE_READ 权限的平台用户，浏览工作区 git 历史 |
| daemon（宿主机） | 承载工作区源码的本地守护进程，执行只读 git 命令 |
| platform backend | FastAPI API 层，负责绑定解析、lane 计算、错误映射与鉴权 |

## 功能需求

### FR-01: Git 日志列表与泳道拓扑展示
覆盖决策：D-001@v1, D-004@v1, D-006@v1
Given 工作区为 git 仓库（git_mode=git）且用户已绑定可用 daemon
When 用户打开「Git 日志」tab
Then 显示泳道 SVG（commit 圆点按 lane 取色板、HEAD 虚线环）+ 提交列表（message/作者/短哈希/refs 标签/时间），默认全分支（git log --all），refs 含本地分支/远程分支/tag/HEAD，annotated tag 经 peeled 映射到 commit

Given 仓库存在分叉与合并
When 渲染泳道
Then 每条 commit 的 lane 编号由 backend graph_layout 确定性计算（同前缀同输出），父边 straight/curve 形态正确，前端不做布局计算

### FR-02: 提交详情与变更文件目录树
覆盖决策：D-005@v1
Given 用户点击列表某行
When 打开右侧 Drawer
Then 展示哈希/作者/时间/message 全文 + 变更文件**目录树**（--numstat 平铺路径按 / 前端聚合，目录节点聚合 +x/-y，叶子显示单文件增删行数）

### FR-03: 文件级 diff 查看
覆盖决策：D-003@v1, D-005@v1
Given Drawer 文件树中某叶子文件被点击
When 按需请求该文件 diff（此前不请求）
Then 展示 unified diff（+绿/-红语义 token，行号列，hunk 头）；binary 文件显示「二进制文件」提示；超 64KB 截断并标记 truncated

### FR-04: 分支与作者过滤
覆盖决策：D-005@v1, D-006@v1
Given 工具栏分支下拉（数据源=响应 top-level branches[]，git_refs 全量）与作者文本输入框
When 用户设定过滤并触发
Then 请求携带 branch/author 参数（git log <branch> 替代 --all；--author 独立 argv），结果集更新；过滤后结果集外的 parent 不产生边（泳道自然简化）

### FR-05: 异常与降级形态
覆盖决策：D-002@v1, D-006@v1
Given 工作区非 git 仓库（probe=direct）
Then git_mode=no_git，前端渲染空态卡（不是报错）
Given daemon 离线 / RPC 超时 / 旧版 daemon（method_not_found）/ 用户未绑定
Then 分别映射 502 / 504 / 422（提示升级）/ 404，与 explorer 同款中文文案
Given 空仓库（无任何提交）
Then daemon 返回空态结构（commits:[] / head:null），前端渲染空列表而非报错

### FR-06: 分页与性能
覆盖决策：D-004@v1, D-005@v1
Given 大仓库历史
When 用户翻页（skip/limit，默认 100/页）
Then daemon 每页从 HEAD 拉 skip+limit+lookahead(50) 条，backend 全前缀确定性 lane 计算只返回窗口——任意页 lane 与全量一致；skip 上限 2000、limit 上限 200 超限 422
Given 长列表滚动
Then react-virtual 虚拟滚动，SVG 只绘可视区 ± overscan 的边与点；父边目标超出 lookahead 时不绘制（页边界视觉截断为接受退化）
Then 过滤请求经 react-query 缓存（skip/limit/branch/author 入 queryKey）

### FR-07: 只读与参数安全
覆盖决策：D-003@v1
Given 全部后端链路
Then 只使用只读 git 子命令（log/for-each-ref/show/rev-parse），无 DB 写入，无状态迁移
Given sha/branch/author/path 输入
Then sha 匹配 ^[0-9a-fA-F]{4,40}$；branch 匹配 ^[A-Za-z0-9][A-Za-z0-9._\-/]*$ 且 ≤200 字符（首字符禁 -）；author 可打印且 ≤120 字符；path 拒 pathspec magic 并经 containment 预检 + daemon allowed_roots 双重校验；全部参数独立 argv 经 execFile（无 shell）

### FR-08: 三主题视觉合规
覆盖决策：D-001@v1
Given blue / ai-native / dark 任一主题
When 打开 Git 日志页
Then 颜色全部走 themes.ts 消费链（CSS 变量 / brand-* / semantic token），泳道色板三主题各配亮暗档；tab 内无 md: 等视口响应式前缀；≥8 并发泳道视图辨识度验收留证

## 非功能需求

- 兼容性：不改任何现有 API/表结构/路由行为；旧 daemon 调新端点得到 422 可预期降级；Windows/Linux/macOS 三平台兼容（daemon execFile git、路径 containment 双形态）
- 可回退：main.py 去掉 include_router + 前端 TABS 去掉一项即整体回退，无数据残留
- 可测试：graph_layout 纯函数七类拓扑单测；router 七分支集成测试（mock daemon RPC）；daemon 解析边界单测；前端泳道渲染与文件树聚合组件测试
- UI 中文优先（专业术语除外），文案对齐 explorer 降级卡风格

## 决策覆盖矩阵

| 决策 ID | 覆盖的 FR | 说明 |
|---|---|---|
| D-001@v1 | FR-01, FR-08 | 自研 SVG 泳道 + 主题 token，禁第三方组件 |
| D-002@v1 | FR-05, FR-07 | 方案 A 链路：新模块 + daemon host_fs 只读 RPC |
| D-003@v1 | FR-03, FR-07 | 第一版只读边界（浏览 + diff） |
| D-004@v1 | FR-01, FR-06 | lane 后端计算 + 全前缀确定性 + lookahead |
| D-005@v1 | FR-02, FR-03, FR-04, FR-06 | 作者过滤 / 文件树 / 性能强化 |
| D-006@v1 | FR-01, FR-04, FR-05, FR-06 | Grill 修正合订（平名直连 / git_mode 两态 / 退化行为 / 总数与作者形态） |
