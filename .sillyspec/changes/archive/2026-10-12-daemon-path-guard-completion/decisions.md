---
author: flow-machine-draft
created_at: 2026-10-12T01:26:48.710Z
---
# 决策记录（Decisions）— 2026-10-12-daemon-path-guard-completion

## D-001@v1: 风险与死路（design 槽4 收割）
- 类型：process
- 状态：confirmed
- 答案：- 最大风险：存量部署 allowed_roots 未包含工作区根 → linked_repos 同步被 forbidden 拒止——loadConfig 默认 allowed_roots=[homedir()]，宿主项目根通常在家目录之下；且 get_spec_bundle 对同一类值已用同款守卫跑了数月，真实环境已隐式要求「workspace root 在 allowed_roots 内」，不引入新的部署约束。 - 放弃方案 A：把 allowed_roots 校验下沉进 linked-repos-sync.ts 纯函数——纯函数无法访问 daemon 实例的 _effectiveAllowedRoots（需注入 roots 参数，改签名波及既有 25 用例）；入口（daemon.ts handler）是 allowed_roots 的天然作用域，与 get_spec_bundle 同层。 - 放弃方案 B：spec-sync 相对形态改为 warn+按 cwd 解析继续——静默写错误位置正是要堵的缺陷，warn 不可接受；fail-loud 让 backend 侧 502/失败结果可见，登记数据质量问题立即暴露。
