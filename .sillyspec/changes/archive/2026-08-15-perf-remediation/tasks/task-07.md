---
id: task-07
title: "module-map 缓存"
title_zh: "_load_module_map 按 (resolved path, mtime) 复合键进程级缓存 + platform_managed 路径探测附带修复"
author: qinyi
created_at: 2026-08-15 07:00:00
priority: P1
depends_on: []
blocks: [task-10]
requirement_ids: [FR-09]
decision_ids: [D-002@v1]
allowed_paths:
  - backend/app/modules/change/parser.py
  - backend/app/modules/change/tests/test_parser.py
goal: >
  _load_module_map（change/parser.py:408）每次调用全量重读模块清单文件，reparse 高频路径浪费 IO——加模块级缓存按 (resolved map 文件路径, mtime) 复合键失效，值不可变、幂等填充；附带修复 platform_managed 布局路径探测预存缺陷（只找 root/.sillyspec/docs 而实际在 root/docs，两处都找）。
implementation:
  - change/parser.py 的 _load_module_map 增加模块级缓存 dict——键为 (map 文件 resolve 后的绝对路径, mtime) 二元组，仅按 mtime 会跨 workspace 串结果（Grill B-3 修订），复合键根治
  - 缓存值为不可变结构（dict 读侧不再原地改），未命中才读文件并填充；幂等填充、单键赋值原子，良性竞态容忍（design 风险 R-01 应对）
  - 文件 mtime 变化即键变、自然失效重读；删除文件（stat 抛错）按现有语义走未命中分支
  - platform_managed 路径探测附带修复——模块清单路径探测同时找 root/.sillyspec/docs 与 root/docs 两处（先优先级后兜底），修复 platform_managed 布局下 map 路径恒空的预存缺陷；该布局修复后缓存对它才开始有收益
  - 测试三件——同 mtime 复用（mock read 计数断言只读一次）、文件变更后（mtime 变）失效重读、跨 workspace 不串（两个不同 root 同名 map 文件各自独立缓存条目）
acceptance:
  - 同一 (path, mtime) 重复调用不再读文件（read 计数为 1）
  - map 文件内容变更后（mtime 变化）缓存失效，读到新内容
  - 两个 workspace 各自 map 互不污染，各自命中各自条目
  - platform_managed 布局（map 在 root/docs）路径探测能命中
  - 既有 change parser 测试全绿（解析语义不变）
verify:
  - cd backend && uv run pytest app/modules/change/tests/test_parser.py -q --no-cov
constraints:
  - 只改 change/parser.py 与其测试——与同 Wave 的 task-06（不改 parser.py 本体）文件不重叠
  - 缓存引入后 parser 出现模块级可变状态，design 段 4 已明示 R-01「无状态」前提对缓存键失效；除缓存外不得新增其它模块级可变状态
  - 缓存键必须含 resolved path——禁止退化成仅 mtime 单键（跨 workspace 串结果是 Grill FAIL 过的缺陷）
  - 行为零变更（NFR-01）——解析产物对外结构不变
related_tests:
  - path: backend/app/modules/change/tests/test_parser.py
    reason: 既有 parser 测试作行为锚点，新增缓存三件（复用/失效/跨 workspace 隔离）用例落点
---
