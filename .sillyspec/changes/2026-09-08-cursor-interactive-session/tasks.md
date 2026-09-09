---
author: qinyi
created_at: 2026-09-08 12:17:43
---

# 任务清单（Tasks）

- [x] task-01: 前置实测——帧样本抓取与 resume 连续性验证（Wave 0，需先 cursor-agent login；fixture 落盘 + 帧形状结论回填）
- [x] task-02: 前置实测——非 force 权限行为探针（Wave 0，D-003@v2 回填 + driver 启动参数定版）
- [x] task-03: cursor-events.ts 归一化器 + cursor-events.test.ts golden 测试（fixture 驱动）(depends_on: task-01)
- [x] task-04: cursor-driver.ts 实现（每轮 respawn + --resume chatId + Windows shim + interrupt/close）+ cursor-driver.test.ts (depends_on: task-02, task-03)
- [x] task-05: providers.ts 注册（PROVIDER_CAPS.cursor + INTERACTIVE_PROVIDERS.cursor）+ provider-registry.test.ts 键集合同步 (depends_on: task-04)
- [x] task-06: daemon 注册点收尾（cli.ts drivers 装配行 + session-store-persistence.ts VALID_PROVIDERS）(depends_on: task-04)
- [x] task-07: backend 镜像（provider_caps.py + test_provider_caps_alignment.py EXPECTED_PROVIDERS + schema.py InteractiveProviderLiteral）(depends_on: task-05)
- [x] task-08: frontend 镜像与白名单（provider-caps.ts + pre-session-picker.tsx + runtime-session-helpers.tsx）(depends_on: task-05)
- [x] task-09: 静态检查与相关测试（typecheck×2 + provider-registry/cursor-events/cursor-driver/caps-alignment/agent-log normalize）(depends_on: task-05, task-06, task-07, task-08)
- [x] task-10: 真机冒烟（建会话双轨落库/SSE/usage/resume 连续/interrupt 规范通道/caps 门控/claude 零回归）(depends_on: task-09)
- [x] task-11: 文档同步（onboarding 手册 §5.4 cursor 案例锚 + 实测记录归档）(depends_on: task-10)
