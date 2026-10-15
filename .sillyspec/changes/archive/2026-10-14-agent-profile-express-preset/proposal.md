---
author: flow-machine-draft
created_at: 2026-10-14T02:38:51.949Z
---
# 提案书（Proposal）— 2026-10-14-agent-profile-express-preset

## 动机

任务原话转写：平台需要内置一个通用的智能体档案（平台预置），让用户在任何会话里可主动选用该档案，会话内所有代码修改都按 SillySpec 轻量变更极速通道（flow start 立项 → 干活 → flow done 收口）执行，杜绝裸改代码；采用启动幂等补种机制（同 agent-profile-layer task-11 范式），平台级可见、默认不进 dispatch 兜底链。

成功标准：
- seed.py 新增确定性 uuid5 平台预置档案（名字：SillySpec 极速变更），visibility=platform、is_system_default=False、provider=claude，system_prompt 完整编码极速通道协议
- 空库调用 ensure 补种 1 条；重复调用返回 0 且无重复行（幂等）
- 管理员改过该档案（如 system_prompt）后重复调用不覆盖、不回写
- main.py lifespan 启动序列挂载新 ensure 函数，异常不阻断启动
- test_profile_seed.py 新增用例覆盖以上契约，既有用例全部通过

## 变更范围

按成功标准机械推导，共 5 条验收面：
1. seed.py 新增确定性 uuid5 平台预置档案（名字：SillySpec 极速变更），visibility=platform、is_system_default=False、provider=claude，system_prompt 完整编码极速通道协议
2. 空库调用 ensure 补种 1 条；重复调用返回 0 且无重复行（幂等）
3. 管理员改过该档案（如 system_prompt）后重复调用不覆盖、不回写
4. main.py lifespan 启动序列挂载新 ensure 函数，异常不阻断启动
5. test_profile_seed.py 新增用例覆盖以上契约，既有用例全部通过

## 成功标准（可验证）

1. seed.py 新增确定性 uuid5 平台预置档案（名字：SillySpec 极速变更），visibility=platform、is_system_default=False、provider=claude，system_prompt 完整编码极速通道协议
2. 空库调用 ensure 补种 1 条；重复调用返回 0 且无重复行（幂等）
3. 管理员改过该档案（如 system_prompt）后重复调用不覆盖、不回写
4. main.py lifespan 启动序列挂载新 ensure 函数，异常不阻断启动
5. test_profile_seed.py 新增用例覆盖以上契约，既有用例全部通过
