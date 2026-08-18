---
author: qinyi
created_at: 2026-08-18T11:25:00
---

# 决策台账 — 2026-08-18-workspace-file-browser

## D-001@v1: 数据来源=实时 daemon RPC 浏览真实代码树
- type: architecture
- status: accepted
- source: user
- priority: P0
- question: 文件浏览器看的是哪里的文件？（工作区代码只在成员本机 daemon 宿主机，backend 读不到）
- answer: 实时经 daemon WS RPC 浏览真实代码树；daemon 离线显示降级提示。不选服务器 spec 镜像、不做平台缓存。
- normalized_requirement: tree/file/download/search 四端点必须实时转发 daemon RPC，不得落平台存储；daemon 不可达时返回结构化降级错误。
- impacts: [FR-01, FR-02, design §5]
- evidence: 用户第一轮 AskUserQuestion 回答「实时浏览真实代码树」

## D-002@v1: 取数通道=方案 B 扩展 file-rpc
- type: architecture
- status: accepted
- source: user
- priority: P0
- question: backend 从 daemon 拿文件数据走哪条通道？（A 复用 host_fs 内部委托通道 / B 扩展 file-rpc 新增 explorer_* RPC / C 平台镜像缓存）
- answer: 方案 B：daemon file-rpc.ts 新增 explorer_list_dir/explorer_read_file/explorer_search，带 root+allowed_roots 双重校验；接受版本耦合代价（旧 daemon 报 method_not_found → 友好降级）。
- normalized_requirement: daemon 新增三个 explorer_* RPC 方法；backend 不得复用 host_fs.* 通道做浏览；method_not_found 必须映射为「daemon 版本过旧」422。
- impacts: [FR-01, FR-02, FR-04, task W1, design §5/§7.1]
- evidence: 用户方案选择 AskUserQuestion 回答「方案 B」

## D-003@v1: 多成员语义=当前用户自己绑定的副本
- type: boundary
- status: accepted
- source: code
- priority: P1
- question: 多成员各自绑定同一 workspace（不同 daemon/路径）时，文件浏览器展示谁的树？
- answer: 只展示当前登录用户自己的绑定行（workspace_member_runtimes PK(workspace_id,user_id)），不复用无 user 门控 LIMIT 1 的 resolve_daemon_instance_for_workspace（已知撞离线 daemon 坑）；无绑定→引导卡。
- normalized_requirement: 所有 explorer 端点必须经 MemberBindingResolver.resolve_member_binding_or_none(workspace_id, user.id)（复用 member_runtimes/resolver.py，不新增查询函数）解析 daemon_id+root_path；查询不到或 daemon_id IS NULL 返回 404 引导。
- impacts: [FR-01, design §5.4, R-05]
- evidence: backend/app/modules/workspace/member_runtimes/model.py:48-89 + queries.py:115-168 代码查证 + 历史坑记忆 dispatch-fails-multi-binding-limiter

## D-004@v1: 文本预览截断上限 10MB
- type: boundary
- status: accepted
- source: user
- priority: P1
- question: 单文件预览/读取大小上限？（初稿 2MB）
- answer: 10MB。超出返回 truncated 标记 + 前 10MB；二进制走 base64 仅供下载。
- normalized_requirement: EXPLORER_MAX_READ_BYTES = 10*1024*1024；daemon 侧截断先于传输；download 端点 RPC 超时放宽到 60s。
- impacts: [FR-03, design §7.1, R-04]
- evidence: 用户设计确认轮回答「≤2MB 截断 这个可以大点 10MB吧」

## D-005@v1: 搜索=按文件名全树搜索
- type: boundary
- status: accepted
- source: user
- priority: P1
- question: 全局搜索搜文件名还是文件内容？
- answer: 按文件名/目录名全树递归搜索（大小写不敏感子串匹配），点击结果直达文件；不做内容 grep。纯 Node fs 遍历实现，兼容 Win/Mac/Linux。
- normalized_requirement: explorer_search RPC 递归遍历（跳过噪声目录）、大小写不敏感子串匹配、结果上限 100 条 + truncated 标记；不 shell out 外部命令。
- impacts: [FR-04, design §7.1, R-03]
- evidence: 用户设计确认轮回答「搜索那块 想要做目录下全局搜索（注意兼容 win,mac,linux）」+ 追问轮选「按文件名搜索」
