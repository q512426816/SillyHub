---
author: qinyi
created_at: 2026-10-15 16:05:50
generated_by: sillyspec-fourpiece-init
change: 2026-10-15-server-logs-panel
---
# 提案书（Proposal）

## 动机

用户要求服务器信息页（2026-10-14-admin-server-status 刚交付）做两件事：去掉业务统计卡、补充服务器日志展示与下载。现状后端日志（structlog JSON）仅输出 stderr（backend/app/core/logging.py:19-41），无日志文件——"展示和下载"无源可读，须先落盘。

## 关键问题

1. **日志无文件**：日志只进容器 stdout/stderr，页面上无法读取；Docker 容器内也拿不到 docker 引擎日志（无 docker.sock 权限）。
2. **业务统计冗余**：四格统计（任务/项目/里程碑/用户）在系统管理区使用价值低（用户裁决删除），腾出的版面给日志。
3. **排查体验**：出问题时要登服务器 docker logs / 命令行 tail，管理员在页面上看不到运行现场。

## 变更范围

- 后端：logging 配置增加轮转文件落盘（5MB×3，stderr 保留零扰动）；新增 `GET /api/server-logs`（tail+JSON 行解析）与 `GET /api/server-logs/download`（白名单文件下载）两端点，复用 `system_status:read` 权限。
- 前端：服务器信息页删除业务统计卡；新增「服务器日志」卡满宽置底（行数切换/5s 自动刷新/级别着色/展开原始行/文件选择下载/安全提示）。
- 测试：后端落盘+轮转+白名单+解析降级；前端日志卡交互与删卡回归。

## 不在范围内（显式清单）

- MUST NOT 引入运行时日志脱敏管道（原始日志+页面安全提示，D-005@v1）
- 不做日志全文搜索/级别过滤（仅 tail 展示，后续需要再立变更）
- 不打包 zip 下载（单文件可选历史，D-003@v1）
- 不新增权限枚举（复用 system_status:read，D-004@v1）
- 不改容器日志配置（docker json-file 照旧）
- 不做日志聚合/持久化外部化（D-001@v1 退役判据留待未来）

## 成功标准（可验证）

- 管理员打开服务器信息页：无业务统计卡；「服务器日志」卡显示最近 200 行结构化日志，5 秒自动刷新
- 行数切换 100/500/1000 生效；点日志行展开原始 JSON；非 JSON 行原文降级展示不丢行
- 下载按钮可下载当前与历史轮转文件（backend.log/.1/.2/.3），文件名白名单防目录遍历
- 日志文件按 5MB 轮转、超 3 个历史自动清理；stderr 输出行为零变化（既有测试不回归）
- 未登录 401 / 无权限 403 / 持 system_status:read 或 platform:admin 200（两端点同口径）
