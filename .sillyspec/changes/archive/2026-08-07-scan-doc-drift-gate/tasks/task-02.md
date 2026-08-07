---
id: task-02
title: scripts/scan-drift-check.py 双信号检测脚本 + 单元测试
title_zh: scan 文档漂移双信号检测脚本与单元测试
author: qinyi
created_at: 2026-08-06 14:04:48
priority: P0
depends_on: [task-01]
blocks: [task-04]
requirement_ids: [FR-01, FR-02, FR-04, FR-07]
decision_ids: [D-001@v1]
allowed_paths:
  - scripts/scan-drift-check.py
  - scripts/test_scan_drift_check.py
goal: >
  实现 scan 文档漂移双信号检测脚本（source_commit 时效 + 文件路径存在性）加单元测试，warn-only 输出 ::warning 注解与人类可读报告（D-001）。
implementation:
  - 实现 parse_source_commit 读 scan 文档 frontmatter 的 source_commit 字段
  - 实现 commits_behind 用 git rev-list --count 算 source_commit 落后 HEAD 的 commit 数，非祖先或异常返 None
  - 实现 extract_file_refs 正则提取四端前缀路径并剥行号
  - 实现 check_drift 汇总双信号，threshold 默认 50 由 env SCAN_DRIFT_COMMIT_THRESHOLD 可配，输出 ::warning 注解加人类可读报告，漂移也 exit 0
  - 写 scripts/test_scan_drift_check.py 覆盖四函数关键分支
acceptance:
  - source_commit 落后超阈值（默认 50，env 可配）报漂移；source_commit 缺失或非 HEAD 祖先不崩、按漂移报（FR-01）
  - 四端前缀加完整扩展名匹配，剥行号校验文件存在，目录路径 isdir 也认；白名单外、示例、截断路径（如 package.js）不报（FR-02）
  - 仓库根直接 python scripts/scan-drift-check.py 可跑，输出人类可读，不依赖 CI 环境（FR-04）
  - 跨平台 Windows/Linux/macOS 通用，无平台特定路径或命令（FR-07，CLAUDE.md 规则 13）
  - 单元测试覆盖 parse_source_commit/commits_behind/extract_file_refs/check_drift 关键分支全绿（AC-08）
verify:
  - python -m pytest scripts/test_scan_drift_check.py -q
  - python scripts/scan-drift-check.py
constraints:
  - 漂移时 exit 0（warn-only，仅脚本自身异常非 0），符合 D-002
  - 文件路径白名单仅 backend/frontend/sillyhub-daemon/deploy 四端前缀加完整扩展名 py/ts/tsx/mjs/js/json/yaml/yml/md
  - 带行号路径剥行号后校验，目录路径用 isdir 也认
  - R-02 正则误报率留 execute 实测调参，初版容忍少量噪声
  - 不改 sillyspec-scan skill 本身，只消费现有 source_commit 加文档 body 路径
  - 跨平台兼容 CLAUDE.md 规则 13
---
