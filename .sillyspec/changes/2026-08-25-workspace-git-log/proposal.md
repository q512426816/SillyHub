---
author: qinyi
created_at: 2026-08-25 21:24:40
change: 2026-08-25-workspace-git-log
---
# 提案书（Proposal）

## 动机

平台工作区目前只能浏览文件与方案文档镜像，看不到代码提交历史；用户要在平台上直接获得类 IDEA Git Log 的体验——分支拓扑泳道图 + 提交列表 + 提交详情与 diff，用于了解工作区仓库的演进脉络与分支状态，而不必切换到本地 IDE。

## 关键问题

1. **后端没有任何 git log 数据链路**：工作区源码物理存放在 daemon 宿主机，backend（Docker 部署形态）路径不可达，只读 git 数据必须仿 explorer 模式经 daemon host_fs RPC 获取（现状缺失整条链路）。
2. **无可用现成前端组件**：调研（2026-08-25 explore）证实 React 18 生态没有维护良好、能渲染真实仓库历史的组件（@tomplum/react-git-log 3.x 需 React 19；@gitgraph/react 已归档且为示意图 API），自研 SVG 泳道是唯一可行路线，且必须与平台 AI-native 三主题 token 体系融合。
3. **分页下的泳道一致性**：git 历史分页加载时，泳道 lane 分配若不全局确定，页间会出现图断裂/错位，需要专门的算法设计（后端全前缀确定性计算）。

## 变更范围

- daemon：host-fs-handler 新增 4 个只读方法（git_log / git_refs / git_show / git_diff_file，平名注册，含空态与截断契约）
- backend：新模块 `app/modules/git_log/`（router/service/schema/tests）+ `graph_layout.py` lane 计算器（Gitea 算法移植）；3 个 GET 端点；main.py 挂载
- frontend：工作区新 tab「Git 日志」页面（泳道 SVG + react-virtual 虚拟列表 + 详情 Drawer + 变更文件目录树 + 分支/作者过滤）；`lib/git-log.ts` hooks；`pnpm gen:types` 再生成
- 详见 design.md §6 文件变更清单（约 20 文件，跨三子项目）

## 不在范围内（显式清单）

- 任何 git 写操作（checkout / merge / pull / cherry-pick / rebase 等，未来走既有 git_gateway/worktree 体系另立变更）
- commit message 全文搜索、按日期区间过滤、blame、文件历史视图
- diff 的 side-by-side 双栏模式（第一版只做 unified）
- 重命名文件的 rename 跟踪展示（`--no-renames` 简化为删+增两条）
- 仓库提交总数显示（避免第 5 个 rev-list --count RPC）
- 浅 clone / 部分克隆等仓库级优化

## 成功标准（可验证）

- 工作区打开「Git 日志」tab：默认全分支泳道图 + 提交列表正常渲染，HEAD/分支/tag 标注正确；翻页后泳道 lane 与前页连续一致（graph_layout 窗口一致性单测 + 页面实测）
- 点击提交：详情 Drawer + 变更文件目录树（+x/-y 聚合）；点击叶子文件展示 unified diff（+绿/-红语义色）
- 分支下拉过滤与作者文本过滤生效（过滤后缺失 parent 的边不画）
- 非 git 工作区显示空态卡；daemon 离线→502 / 超时→504 / 旧版 daemon→422 提示升级
- 攻击面验证：sha/branch/author/path 非法输入被 422 拒绝，无 shell 注入路径（execFile argv 数组）
- 蓝色/AI紫/暗夜三主题下页面无硬编码色值（走 themes.ts 消费链）；≥8 并发泳道视图辨识度验收留证
- `pnpm gen:types` 产物（api-types.ts + openapi.json）随变更提交；backend pytest / daemon vitest / frontend vitest 全绿
