---
author: flow-machine-draft
created_at: 2026-10-10T06:51:49.152Z
---
# 提案书（Proposal）— 2026-10-10-repo-native-no-platform-markers

## 动机

任务原话转写：默认源项目即真理（repo-native）时源项目根不该出现 .sillyspec-platform.json / .sillyspec-platform-managed / .sillyspec-platform-cleaned 平台标记三件套，但 daemon 的 repo-native 分支在源项目无 .sillyspec 时降级走 platform-managed pull（缓存成普通目录），sillyspec CLI 的自指守卫（realpath 穿透 junction 判回环）随之失效，三件套投毒源项目根（deepseek-harness 项目实证：无 .sillyspec 但三件套齐全）；缓存被普通目录残留阻塞时同样降级投毒。

成功标准:
- repo-native 且源项目无 .sillyspec 时不再降级：daemon 就地创建空 .sillyspec 后建 junction，getSpecBundle 不被调用（junction 分支早退）
- repo-native 且缓存为普通目录残留时不再静默降级：残留 rename 备份后建 junction，原缓存数据保留在备份目录
- junction 成立后 init 时 sillyspec 自指守卫生效：源项目根不落 .sillyspec-platform.json / .sillyspec-platform-managed / .sillyspec-platform-cleaned 任一文件
- 既有 repo-native / repo-mirrored / platform-managed 策略分支测试全部保持绿（无回归）
- backup rename 失败（如 Windows 句柄占用）时仍走原降级 pull 路径，不抛错不删数据

## 变更范围

按成功标准机械推导，共 5 条验收面：
1. repo-native 且源项目无 .sillyspec 时不再降级：daemon 就地创建空 .sillyspec 后建 junction，getSpecBundle 不被调用（junction 分支早退）
2. repo-native 且缓存为普通目录残留时不再静默降级：残留 rename 备份后建 junction，原缓存数据保留在备份目录
3. junction 成立后 init 时 sillyspec 自指守卫生效：源项目根不落 .sillyspec-platform.json / .sillyspec-platform-managed / .sillyspec-platform-cleaned 任一文件
4. 既有 repo-native / repo-mirrored / platform-managed 策略分支测试全部保持绿（无回归）
5. backup rename 失败（如 Windows 句柄占用）时仍走原降级 pull 路径，不抛错不删数据

## 成功标准（可验证）

1. repo-native 且源项目无 .sillyspec 时不再降级：daemon 就地创建空 .sillyspec 后建 junction，getSpecBundle 不被调用（junction 分支早退）
2. repo-native 且缓存为普通目录残留时不再静默降级：残留 rename 备份后建 junction，原缓存数据保留在备份目录
3. junction 成立后 init 时 sillyspec 自指守卫生效：源项目根不落 .sillyspec-platform.json / .sillyspec-platform-managed / .sillyspec-platform-cleaned 任一文件
4. 既有 repo-native / repo-mirrored / platform-managed 策略分支测试全部保持绿（无回归）
5. backup rename 失败（如 Windows 句柄占用）时仍走原降级 pull 路径，不抛错不删数据
