---
author: qinyi
created_at: 2026-08-18 11:50:35
---
# 需求规格（Requirements）— 工作区文件浏览器（只读）

## 角色

| 角色 | 说明 |
|---|---|
| 平台用户（workspace 成员） | 浏览自己绑定的工作区副本的文件树、预览与下载文件、按文件名搜索 |

## 功能需求

### FR-01: 目录树浏览（懒加载）
覆盖决策：D-001@v1, D-002@v1, D-003@v1
Given 用户已登录且对 workspace 有 workspace:read 权限，且当前用户有 daemon 绑定且 daemon 在线
When 打开「文件」标签页 / 展开某目录节点
Then 前端调用 `GET /explorer/tree?path=<rel>`，backend 按当前用户绑定解析 daemon 并转发 `explorer_list_dir`，返回该层条目（目录优先排序，含 name/type/size/mtime）

Given daemon 离线
When 打开文件页
Then 显示「守护进程离线」降级卡，不报 500 堆栈

Given 当前用户无绑定行或绑定行 daemon_id IS NULL
When 打开文件页
Then 返回 404 并显示「未绑定」引导卡

### FR-02: 文件预览
覆盖决策：D-001@v1, D-004@v1
Given 用户在树中选中一个文件
When 前端调用 `GET /explorer/file?path=<rel>`
Then 按类型渲染：代码→语法高亮（react-syntax-highlighter）；Markdown→渲染视图；图片→blob 内联；二进制或 >10MB→元信息卡 + truncated 提示

Given 文件为 utf8 解码失败的非文本文件
When daemon explorer_read_file 处理
Then 返回 binary=true + base64，前端落元信息卡而非乱码

### FR-03: 文件下载
覆盖决策：D-001@v1, D-004@v1
Given 用户选中任意已列出文件
When 点击下载
Then `GET /explorer/download?path=<rel>` 经 daemon `encoding=base64` 通道回传，StreamingResponse + Content-Disposition attachment，文件字节无损

### FR-04: 文件名全局搜索
覆盖决策：D-005@v1
Given 用户已加载文件页
When 在搜索框输入关键词提交
Then `GET /explorer/search?q=` → daemon 全树递归（跳过 node_modules/.git 等噪声目录）大小写不敏感子串匹配文件名/目录名，返回 ≤100 条（超出 truncated=true），点击结果经祖先链逐层展开直达文件

### FR-05: 路径安全
覆盖决策：D-002@v1, D-003@v1
Given 任意 explorer 端点收到恶意 path（`../`、绝对路径、UNC、工作区内 symlink 指向 root 外）
When backend 预检或 daemon 校验执行
Then backend 预检拒绝（422）或 daemon realpath 落点校验拒绝（forbidden→403），无任何 root 外内容泄漏

### FR-06: 版本兼容降级
覆盖决策：D-002@v1
Given 用户本机 daemon 为旧版（未注册 explorer_* 方法）
When 调用任意 explorer 端点
Then daemon 回 method_not_found，backend 映射 422，前端显示「daemon 版本过旧请升级」卡；平台其它功能不受影响

## 非功能需求

- 兼容性：Win/Mac/Linux daemon 行为一致（搜索用纯 Node fs 遍历，不 shell out；路径校验按 root 形态分发 Win/POSIX 语义）；不改既有端点/表结构/RPC 签名。
- 可回退：纯新增模块与页面，回退=摘路由/摘标签；无数据迁移。
- 可测试：daemon（双校验/截断/二进制/搜索上限/symlink 逃逸）、backend（containment/绑定解析/错误映射/download 头）、frontend（懒加载/预览分发/降级态/搜索交互）三端均有自动化测试。
- 性能：RPC 显式超时 tree/file 30s、search/download 60s；搜索单遍 readdir withFileTypes + 噪声排除 + 上限 100。

## 决策覆盖矩阵

| 决策 ID | 覆盖的 FR | 说明 |
|---|---|---|
| D-001@v1 | FR-01, FR-02, FR-03 | 实时 daemon RPC，不落平台存储 |
| D-002@v1 | FR-01, FR-05, FR-06 | file-rpc 扩展方案，method_not_found 降级 |
| D-003@v1 | FR-01, FR-05 | 当前用户绑定语义，复用 MemberBindingResolver |
| D-004@v1 | FR-02, FR-03 | 10MB 截断，download 强制 base64 |
| D-005@v1 | FR-04 | 文件名搜索，非内容 grep |

无未覆盖决策、无剩余风险项。
