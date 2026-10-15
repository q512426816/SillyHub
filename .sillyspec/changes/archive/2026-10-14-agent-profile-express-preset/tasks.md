---
author: flow-machine-draft
created_at: 2026-10-14T02:38:51.950Z
---
# 任务注册表（Tasks）— 2026-10-14-agent-profile-express-preset

- [x] task-01: seed.py 新增确定性 uuid5 平台预置档案（名字：SillySpec 极速变更），visibility=platform、is_system_default=False、provider=claude，system_prompt 完整编码极速通道协议
- [x] task-02: 空库调用 ensure 补种 1 条；重复调用返回 0 且无重复行（幂等）
- [x] task-03: 管理员改过该档案（如 system_prompt）后重复调用不覆盖、不回写
- [x] task-04: main.py lifespan 启动序列挂载新 ensure 函数，异常不阻断启动
- [x] task-05: test_profile_seed.py 新增用例覆盖以上契约，既有用例全部通过
