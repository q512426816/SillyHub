---
schema_version: 1
doc_type: module-card
module_id: credential
author: qinyi
created_at: 2026-08-18 01:45:00
---

# 本地凭证存储与渲染（credential）

## 定位

本地凭证存储与 `{{USER_*}}` 占位符渲染。安全模型（design §4.2.3）：server 只下发含
占位符的配置模板，用户密钥不离开本机；daemon 在本地把模板解析成实际值后注入 agent
子进程 env。管的是「用户自有密钥」这一半；lease 下发的 provider 配置凭证归
credential-injector。由 Python credential.py 1:1 迁移而来，文件格式兼容。

## 契约摘要

- `DEFAULT_CREDENTIALS_PATH` = `~/.sillyhub/daemon/credentials.json`。
- `CredentialManager(credentialsPath?)`：构造即加载（路径可注入，单测用临时路径）。
  - CRUD：`get`（不存在返回 undefined）/ `set` / `remove`（key 不存在不抛）/
    `listKeys`；set/remove 立即 `save()` 持久化。
  - `renderConfig(config)`：解析值中的 `{{USER_*}}` 占位符，返回新对象，不改入参。
  - `buildEnv(config)`：渲染后转子进程 env 字典（key 大写）。
- 解析优先级：credentials.json > 同名环境变量 > 保留原占位符。

## 关键逻辑

```
renderConfig(value):
  整值 startsWith "{{USER_" && endsWith "}}"   # 非子串替换；显式前后缀判断，不用正则
  envVar = 去 {{ }}（保留 USER_ 前缀，如 USER_GITHUB_TOKEN）
  resolved = credentials[envVar] || process.env[envVar]   # || 短路，空串跳下一源
  resolved !== undefined ? 写入 : 保留原占位符            # 仅 undefined 算未解析
buildEnv: renderConfig → 过滤「仍以 {{ 开头」与「非 string」项 → key 转大写
```

## 注意事项

- 未解析占位符不注入 env（buildEnv 过滤），避免模板结构泄漏给子进程。
- 0600 权限仅 POSIX 有语义；Windows / chmod 失败降级 warn 不抛（R-05/FR-05）。
- 凭证文件不存在 → info 日志 + 空表不抛（首次使用正常路径）；JSON 损坏 → 抛
  SyntaxError 让用户感知（B-03）。加载时 stripBOM。
- `buildEnv` key 转大写，配置键名设计需避免与系统 env 撞名（如 path → PATH）。
- 占位符格式 `{{USER_*}}` 与 server 端模板生成耦合，改格式需两端同步。
- 依赖面已收窄：仅 cli 直接 import；task-runner / spawn-env 经
  RunnerCredentialManager / SpawnCredentialManager 接口注入，不再直接依赖。

## 人工备注

<!-- MANUAL_NOTES_START -->

<!-- MANUAL_NOTES_END -->
