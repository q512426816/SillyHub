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
- `CredentialManager(credentials_path?)` — 初始化并自动加载凭据文件
- `get(key)` / `set(key, value)` / `remove(key)` / `list_keys()` — CRUD 操作，set/remove 立即持久化
- `save()` — 写入文件并设 0600 权限
- `render_config(config: dict) -> dict` — 解析 `{{USER_*}}` 占位符，优先级：credentials.json > 环境变量
- `build_env(config: dict) -> dict[str, str]` — 渲染配置后转为环境变量字典（key 大写，过滤未解析项）

## 关键逻辑
```
render_config(config)
  for each key, value in config:
    if value matches "{{USER_*}}":
      env_var = strip {{ }}
      resolved = credentials[env_var] || os.environ[env_var]
      未解析则保留原始占位符

build_env(config)
  rendered = render_config(config)
  过滤掉仍含 "{{" 的项 → key.upper() → env dict
```

## 注意事项
- 凭据文件权限 0600 在 Windows 上可能无法完全生效（os.chmod 行为不同）
- 占位符格式固定为 `{{USER_*}}`，修改格式需同步修改 server 端模板生成逻辑
- `build_env` 的 key 转大写行为意味着配置键名设计需注意避免冲突
- 被 cli 和 task-runner 使用（task-runner 在任务执行前调用 build_env）

## 人工备注

<!-- MANUAL_NOTES_START -->

<!-- MANUAL_NOTES_END -->
