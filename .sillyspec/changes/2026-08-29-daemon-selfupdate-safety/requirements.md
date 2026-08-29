---
author: qinyi
created_at: 2026-08-29 14:43:52
---
# 需求规格（Requirements）

## 角色
| 角色 | 说明 |
|---|---|
| 平台用户 | 在机器页查看 daemon 状态、触发升级的运维/开发者 |
| daemon | 本地守护进程（sillyhub-daemon），自更新的执行体 |
| 运维 | 通过 `sillyhub-daemon status` 与平台机器页观察升级状态、外部替换 bundle 的操作者 |
| backend | 心跳接收与机器视图透传方 |

## 功能需求

### FR-01: 升级空闲屏障
覆盖决策：D-001@v1, D-002@v1, D-005@v1
Given daemon 收到 SELF_UPDATE 指令或探测到磁盘版本变更
When 存在「进行中」工作（在跑 interactive 轮次 status==='running'，或在跑 batch lease _controllers 非空；空闲会话/reconnecting/change-write 不算）
Then 推迟升级：记录 pending（reason+目标+当前版本）+30s 后重探（无限等，每轮从零重跑 tryUpdate），不打断任何进行中工作

Given 推迟期间触发重发
Then 仅刷新目标版本，不叠定时器；离开推迟态（升级执行/noop/异常）必清定时器

Given 升级链执行中（下载完成、stop 之前）
When 终检发现新忙
Then 回推迟路径（终检与 stop 首动作间无 await，竞态窗口毫秒级）

### FR-02: 更新所有权与失败恢复
覆盖决策：D-005@v1
Given tryUpdate 被触发（指令/探测/复查）
When 已有更新在途
Then 本次忽略并记日志（JS 单线程原子占位）

Given 一切非「交接排定」路径（noop/下载失败/异常/终检回推迟）
Then 释放所有权+清 pending 文件；下一条 SELF_UPDATE 指令可再触发

Given respawn 拉起失败
Then 进程已 stop 停摆保活（不退出，WS/心跳已关）；backend 45s 判 offline 可见

### FR-03: 磁盘旁路探测
覆盖决策：D-003@v2
Given bundle 文件被外部替换/降级（BUILD_ID 与内存不同）
When self_reload_check_interval_sec（默认 600，0=关闭）周期探测（读文件正则提取 BUILD_ID，与 respawn 加载同一文件）
Then 触发 tryUpdate('disk_change')——走独立直启路径：不下载不查 manifest，空闲即 stop+respawn 到盘上版本（操作者换文件即意图）

Given 探测失败（读文件失败/正则不中/任一侧为空）或 dev 构建
Then ≠版本变化，仅 debug 日志不动作（防替换窗口自杀）

### FR-04: backend 透传
覆盖决策：D-004@v1
Given daemon 心跳携带 pending_update {reason, current_version, target_version}
When backend 心跳端点处理
Then upsert daemon_instances.pending_update（JSON nullable）；同内容 upsert 保留原 since，首次盖 now

Given 心跳无该字段
Then 置 NULL（清除——与兄弟字段「非空才覆盖」语义相反，刻意为之，单机单 daemon 无交错）

Given 机器视图查询（/machines、/runtimes/page）
Then 响应透出 pending_update（含 since）

### FR-05: 前端展示
覆盖决策：D-003@v2, D-004@v1
Given 机器卡渲染且 pending_update 非空
When reason==='server_command'
Then warning 横幅「等待空闲后自动升级（每 30s 复查）」+副行（原因+版本对比）；「升级 daemon」按钮禁用

When reason==='disk_change'
Then info 横幅「检测到程序文件已变更，等待空闲自动加载新版本」+副行（来源说明）；同按钮禁用

Given 升级完成（pending_update 清 NULL）
Then 横幅消失（前端 15s 轮询自然刷新，接受 30-60s 残留窗口）

## 非功能需求
- 兼容性：心跳新字段可选（旧 backend pydantic 忽略）；TaskRunnerLike 新方法可选化（缺省视为不忙，防砸碎测试 mock）；三端 Windows/Linux/macOS
- 可测试：忙判定/终检/探测/直启路径/所有权生命周期均有单测；「忙→推迟→空闲→升级」「下载窗口插任务→终检回推迟」集成用例
- 可回退：daemon 纯增量（新方法组+配置项）；backend 新列 nullable 无回填

## 决策覆盖矩阵
| 决策 ID | 覆盖的 FR | 说明 |
|---|---|---|
| D-001@v1 | FR-01 | 仅进行中算忙 |
| D-002@v1 | FR-01 | 无限等空闲 30s 复查 |
| D-003@v2 | FR-03, FR-05 | 读文件探测+直启路径（supersedes v1） |
| D-004@v1 | FR-04, FR-05 | A3 完整形态三端透传 |
| D-005@v1 | FR-01, FR-02 | 保活+失败释放（respawn 失败措辞修正） |
| D-006@v1 | 全部 | 设计整体确认 |
