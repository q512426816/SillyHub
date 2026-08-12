---
author: WhaleFall
created_at: 2026-08-12T13:20:00
task: task-15
title: 模块测试 + verify
---

# task-15: 模块测试 + verify

- **allowed_paths**: 只读校验，不改源码（失败回 W1~W3 修）
- **改动**：跑 change+agent+daemon 模块 pytest + frontend vitest；对照 design §8 验收标准 8 条逐项核验。
- **完成标准**：design §8 八条全过；测试不回归。
- **依赖**：W1+W2+W3 全部完成 + task-14。
