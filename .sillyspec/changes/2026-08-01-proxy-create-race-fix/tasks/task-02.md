---
id: task-02
title: _build_change_key 改 unicode 感知正则加 .lower() 保中文标题可读
title_zh: 中文 change_key unicode 正则
author: qinyi
created_at: 2026-08-02 00:33:20
priority: P1
depends_on: []
blocks: []
requirement_ids: [FR-06]
decision_ids: [D-003@v1]
allowed_paths:
  - backend/app/modules/change_writer/proxy.py
provides: []
expect_from: []
related_tests: []
goal: >
  _build_change_key 改用 unicode 感知字符类加 .lower()，中文标题保留可读原字，纯标点兜底 untitled，末尾 uuid 后缀保唯一。
implementation:
  - 把 slug 的字符类从仅 ascii 字母数字 改为 unicode 感知集含中文字母数字，并启用 re.UNICODE 标志，具体正则见 design §5 Phase 3 与 D-003@v1
  - 保留 title.lower() 让英文统一小写与 worktree lease 分支一致，中文无大小写无副作用，末尾 uuid 后缀与 date_prefix 的三段返回格式不变
  - 纯标点或空标题经 strip 与截断后 slug 为空时走 untitled 兜底
acceptance:
  - AC-01 中文保留 标题为测试二字时 change_key 形如 2026-08-02-测试-xxxxxx 不再是 untitled
  - AC-01 纯标点兜底 标题全为标点时 slug 为空 change_key 形如 2026-08-02-untitled-xxxxxx
  - 英文小写一致 标题为 My Change 时 slug 为 my-change 与 worktree lease 分支一致
  - uuid 后缀保唯一 连续两次同标题调用末尾六位 hex 不同
verify:
  - cd backend 然后 uv run pytest app/modules/change_writer/tests/test_proxy.py -q --no-cov
constraints:
  - 不改 _build_change_key 函数签名与三段返回格式
  - 不加 migration 不动 DB schema
  - 保留 title.lower() 不移除以与 worktree lease 分支一致
  - Windows 文件名非法字符与空格须被正则剔除不进入 slug
---
