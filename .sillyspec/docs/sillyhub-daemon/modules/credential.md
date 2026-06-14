---
schema_version: 1
doc_type: module-card
module_id: credential
author: qinyi
created_at: 2026-06-10T16:55:00
---

# credential

## 定位
本地凭据存储与占位符渲染。用户密钥不离开本机——server 只下发含 `{{USER_*}}` 占位符的配置模板，daemon 在本地解析后传给 agent 子进程。凭据文件存储在 `~/.sillyhub/daemon/credentials.json`，权限 0600。

## 契约摘要
- `DEFAULT_CREDENTIALS_PATH` — 默认凭据文件路径常量
- `CredentialManager(credentialsPath?)` — 初始化并自动加载凭据文件
- `get(key)` / `set(key, value)` / `remove(key)` / `listKeys()` — CRUD 操作，set/remove 立即持久化
- `save()` — 写入文件并设 0600 权限（Node 通过 `fs.chmod`）
- `renderConfig(config: Record<string, unknown>) -> Record<string, unknown>` — 解析 `{{USER_*}}` 占位符，优先级：credentials.json > `process.env`
- `buildEnv(config: Record<string, unknown>) -> Record<string, string>` — 渲染配置后转为环境变量字典（key 大写，过滤未解析项）

## 关键逻辑
```
renderConfig(config)
  for each [key, value] of Object.entries(config):
    if value matches "{{USER_*}}":
      envVar = strip {{ }}
      resolved = credentials[envVar] || process.env[envVar]
      未解析则保留原始占位符

buildEnv(config)
  rendered = renderConfig(config)
  过滤掉仍含 "{{" 的项 → key.toUpperCase() → env object
```

## 注意事项
- 凭据文件权限 0600 在 Windows 上可能无法完全生效（`fs.chmod` 行为不同）
- 占位符格式固定为 `{{USER_*}}`，修改格式需同步修改 server 端模板生成逻辑
- `buildEnv` 的 key 转大写行为意味着配置键名设计需注意避免冲突
- 凭据文件格式与 Python 版完全相同（G-02 不变）
- 被 cli 和 task-runner 使用（task-runner 在任务执行前调用 buildEnv）

## 人工备注

<!-- MANUAL_NOTES_START -->

<!-- MANUAL_NOTES_END -->
