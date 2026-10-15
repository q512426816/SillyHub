---
author: qinyi
created_at: 2026-10-15 16:05:50
generated_by: sillyspec-fourpiece-init
change: 2026-10-15-server-logs-panel
---
# 需求规格（Requirements）

## 角色
| 角色 | 说明 |
|---|---|
| 平台管理员 | 持 platform:admin 或被勾选 system_status:read，查看/下载服务器日志 |
| 普通登录用户 | 无 system_status:read，两端点 403 不可见 |
| 匿名访问者 | 两端点 401 |

## 功能需求

### FR-01: 日志文件落盘与轮转
覆盖决策：D-001@v1, D-006@v1, D-008@v1
Given 后端日志现仅输出 stderr（structlog JSON）
When 本次变更后应用运行并产生日志
Then 每条日志必须同时写入轮转文件（默认 <repo>/data/logs/backend.log，路径可配置）与 stderr（后者零行为变化）；单文件达 5MB 必须轮转为 .1 并把 .1→.2→.3 链式后移、最旧/.3 必须删除；文件写入失败禁止抛出（降级 stderr-only，进程不受影响）

### FR-02: 日志展示端点
覆盖决策：D-002@v1, D-008@v1
Given 管理员登录且持 system_status:read
When GET /api/server-logs?lines=N（N ∈ {100,200,500,1000}，非白名单回退 200）
Then 必须返回文件尾部 N 行：JSON 行解析为 {time, level, event, fields}，非 JSON 行必须按原文降级展示不丢行；响应须含 total_lines（文件总行数）与 returned（实际返回行数）供页脚展示；文件不存在时返回空列表 + 提示字段（非 500）

### FR-03: 日志下载端点
覆盖决策：D-003@v1
Given 管理员登录且持 system_status:read
When GET /api/server-logs/download?file=<name>（name ∈ {backend.log, backend.log.1, backend.log.2, backend.log.3}）
Then 必须返回该文件流（Content-Disposition attachment，文件名白名单外的值必须 400/404 拒绝——目录遍历防护）；文件不存在 404 中文错误

### FR-04: 页面改造（删统计卡+日志卡）
覆盖决策：D-002@v1, D-003@v1, D-007@v1
Given 管理员登录进入 /admin/server-status
When 页面加载及此后每 5 秒
Then 业务统计卡（四格）必须已移除；「服务器日志」卡必须满宽置底渲染——行数切换（100/200/500/1000）、日志流按级别着色（INFO/WARN/ERROR/DEBUG）、点行展开原始 JSON、页脚显示「显示最近 N 行（文件共 M 行）」；工具条含文件选择（当前+历史轮转）与下载按钮（fetch blob 经由鉴权下载）；卡内固定安全提示「日志含运行路径与账号信息，请勿外传」
When 下载被点击
Then 必须按所选文件发起带 Bearer 的请求并触发浏览器下载（失败显示中文提示）

## 非功能需求
- 兼容性：MUST 保持 stderr 输出与现有测试零回归；Windows/Linux/macOS 均可运行（路径经 repo_root 派生）；日志文件目录启动期自动创建
- 性能：日志读取 MUST 只读文件尾部（tail 语义，大文件不全文加载内存）；5s 轮询下读取开销小于 10ms 量级（有大小上限 5MB）
- 安全：下载文件名 MUST 白名单校验；两端点 MUST 挂 require_permission_any(SYSTEM_STATUS_READ)；日志内容不脱敏（D-005@v1，管理员受众+页面提示）
- 可测试：轮转逻辑（rename 链）与 tail 读取 MUST 可注入路径/大小参数以便测试小文件触发轮转

## 决策覆盖矩阵（如存在 decisions.md）
| 决策 ID | 覆盖的 FR | 说明 |
|---|---|---|
| D-001@v1 | FR-01 | 落文件+轮转（用户亲选） |
| D-002@v1 | FR-02, FR-04 | 结构化+自动刷新（用户亲选） |
| D-003@v1 | FR-03, FR-04 | 单文件可选历史（用户亲选） |
| D-004@v1 | FR-02, FR-03（鉴权口径） | 复用 system_status:read（用户亲选） |
| D-005@v1 | FR-04（提示文案）/ NFR 安全 | 原始日志+页面提示 |
| D-006@v1 | FR-01 | 单点插入文件写入（用户亲选） |
| D-007@v1 | FR-04 | 删统计卡+日志卡满宽居底（用户亲选） |
| D-008@v1 | FR-01, FR-02 | lines 白名单+轮转常量口径 |

## 测试绑定（每条 FR 至少一行：`FR-NN: test/路径「用例名」`；不适用要写理由；flow done 空行拒收）

FR-01: （待填——哪个测试文件/用例覆盖这条 FR；无测试面写「不适用：理由」）
FR-02: （待填——哪个测试文件/用例覆盖这条 FR；无测试面写「不适用：理由」）
FR-03: （待填——哪个测试文件/用例覆盖这条 FR；无测试面写「不适用：理由」）
FR-04: （待填——哪个测试文件/用例覆盖这条 FR；无测试面写「不适用：理由」）
