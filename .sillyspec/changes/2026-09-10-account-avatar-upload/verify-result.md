---
author: qinyi
created_at: 2026-09-10 20:45:00
change: 2026-09-10-account-avatar-upload
---

# 验证报告（verify-result）— 个人中心头像替换

## 结论

结论枚举：PASS WITH NOTES

**PASS WITH NOTES**

（结论枚举三选一：PASS / PASS WITH NOTES / FAIL。本次取 PASS WITH NOTES：全部 FR 达标且证据齐；备注项为人工双主题目检未做真机截图 + 3 条新测试文件 eslint warning，均不阻断。）

## FR 逐条核验

| FR | 内容 | 结论 | 证据 |
|---|---|---|---|
| FR-01 | users.avatar 列 + 迁移 + /me 带出 | PASS | model.py:53 String(512) nullable；迁移 20260910160000 可逆循环（upgrade→downgrade→upgrade 三步 exit 0，临时库验证共享库零触碰）；UserRead.avatar 经 from_attributes 由 /me 带出（test_me_returns_avatar 断言） |
| FR-02 | PATCH /api/auth/me/avatar 四态 | PASS | router.py:173-185 + service.py 三态分派（''=置 NULL 非存空串，C-08）；test_my_avatar.py 7 用例：设置/清除断言列 is None/401/513→422/恰 512→200/缺省不改/带出——7 passed |
| FR-03 | 桌面个人资料卡片 | PASS | 修改密码卡片上方，GroupMemberAvatarUpload 整态 + ownerType=user_avatar + updateMyAvatar 写回不自管副本；page.test.tsx 9 用例（5 既有收窄 selector 不删断言 + 4 新增） |
| FR-04 | 移动头像上传 | PASS | 整块可点（64px≥44px）+ 相机角标 + 恢复默认 min-h-[44px] + busy 禁点 + 非图片拦截；NEW page.test.tsx 5 用例 |
| FR-05 | 五处展示 | PASS | 桌面/移动个人中心（FR-03/04）；TopBar avatar prop + AvatarImage blob 渲染（top-bar-avatar.test 4 用例 + 既有 5 零回归）；群聊 user 成员后端回落 D-002（helpers._apply_user_avatar_fallback + crud 6 调用点批量预取 + members 三构造点；16 用例含 N+1 单查询断言 + 既有 50 用例零回归）；1:1 气泡 sender.me 接线（241 相关测试零回归） |
| FR-06 | 类型同步 | PASS | pnpm gen:types 一次成功：api-types.ts 含 UserRead.avatar（:24607）+ PATCH 路径（:1416）+ UpdateMyAvatarRequest；openapi.json 同批刷新；与 api-types.ts 同 commit（b77817555）提交 |

## 非目标核对（D-003）

- `git diff 8661982b..HEAD -- '*ppm*'` 为空——PPM 模块零改动 ✓
- 无裁剪器（两页选图直传）✓；无外链 URL 手输 UI ✓；群内用户成员独立头像覆盖 UI 未做 ✓；agent 成员头像行为不变（members.py PATCH 语义原样，test_group_project 既有 avatar 往返用例过）✓

## 兼容策略核验

- 未设头像（NULL）五处展示点全部首字回退（TopBar Radix Fallback / turn-timeline avatar=undefined / 移动页无图首字 / 桌面控件 fallbackClassName / 群聊回落 or None）——源码级核验 + blob 失败静默回退测试
- SessionUser.avatar 可选字段 + persist version 不 bump：旧 localStorage user 缺字段按 undefined 兼容（storage 回放只回放存在的字段）
- 群成员 PATCH None=不改/空串=清除语义原样；群内自定义头像优先级不变

## 测试汇总（仅相关，全量留 CI）

| 命令 | 结果 |
|---|---|
| backend: pytest 5 文件（my_avatar + change_password + group_member_avatar_fallback + group_project + group_chat_management） | 80 passed, exit 0 |
| backend: mypy app/modules/auth app/modules/daemon/group | Success, 22 files |
| backend: ruff check 足迹 | All checks passed |
| frontend: tsc --noEmit | exit 0 |
| frontend: vitest 4 文件（account/m-account/top-bar-avatar/member-panel） | 4 files, 61 passed |
| frontend: eslint 足迹 10 文件 | 0 errors, 10 warnings（7 存量 + 3 新增，见备注） |

## 备注与遗留

1. **双主题目检**（R-04 应对）：静态源码核验通过（brand-* 语义阶 + 主题 token + 无硬编码 hex——相机角标 bg-brand-600、卡片容器沿用既有 token 类）；blue/ai-native 真机截图属人工验收，建议用户部署后在两主题下目检一遍（个人中心/顶栏/群聊三处足够）。
2. **eslint 3 条新 warning**：top-bar-avatar.test.tsx 的 FakeImage.addEventListener listener `event` 参数未用——next lint 默认不卡 warning，与代码库既有 warning 水平一致；后续顺手 `_event` 化即可，不构成本变更债。
3. **合流注意**：共享开发 PG 当前被另一并行 worktree 迁移（20260910140000）推进；两变更合流时 20260910160000 与其将形成双 head，需按仓库 merge-heads 迁移惯例收敛（非本变更缺陷，已在 task-01 review 记录）。
4. 前端语义修正说明：updateMyAvatar 的卡面 acceptance 原文「发出 avatar 为 null 的清除请求」与后端三态语义（null=不改）冲突，实现取「null→'' 下发」（json: avatar ?? ""），与 design「null（清除）」意图及群成员 PATCH 惯例一致——execute 阶段已消解并注释落码。

## 决策闭环

D-001@v1（文件中心存储）✓ / D-002@v1（群聊回落）✓ / D-003@v1（PPM 非目标）✓——三条决策全部落地，无 stale 引用、无 unresolved。

## 探针结果（CLI 机械预填，--init 补注入） [层：可复跑探针——gate 抽查防篡改]
#### 探针 1：未实现标记扫描（design 清单文件）
- ✅ 无 TODO/FIXME/尚未实现 标记命中
- ℹ️ 清单文件不存在（跳过）：NEW:backend/migrations/versions/20260910160000_users_avatar.py、NEW:backend/tests/modules/auth/test_my_avatar.py、NEW:backend/tests/modules/daemon/test_group_member_avatar_fallback.py、NEW:frontend/src/app/m/account/page.test.tsx、NEW:frontend/src/components/__tests__/top-bar-avatar.test.tsx

#### 探针 2：设计关键词覆盖
- ✅ users.avatar 列：model.py avatar Column(String(512)) 命中
- ✅ PATCH /api/auth/me/avatar：router.py @router.patch("/me/avatar") 命中
- ✅ 三态语义（值=设置/空串=清除置 NULL/None=不改）：service.py update_my_avatar 分派 + UpdateMyAvatarRequest docstring 命中
- ✅ 群聊回落 member.avatar or user.avatar：helpers._apply_user_avatar_fallback 命中
- ✅ 批量预取（_to_read 同步不能直查 DB）：helpers._user_avatar_map select in + crud 6 调用点命中
- ✅ useAvatarSrc blob 渲染：top-bar/移动页/桌面控件（GroupMemberAvatar 内置）三处命中
- ✅ owner_type=user_avatar 上传：USER_AVATAR_OWNER_TYPE 常量 + 两页 uploadFile 调用命中
- ✅ 首字回退（无图/失败）：五展示点 fallback 分支 + 静默回退测试命中
- ✅ gen:types 类型同步：api-types.ts UserRead.avatar + PATCH 路径命中

#### 探针 3：验收标准测试覆盖
- ⚠️ task-01: 模块目录（backend/app/modules/auth、NEW:backend/migrations/versions）递归未找到测试文件（含 co-located tests/）
- ⚠️ task-02: 模块目录（backend/app/modules/auth）递归未找到测试文件（含 co-located tests/）
- ⚠️ task-03: 模块目录（backend/app/modules/auth、NEW:backend/tests/modules/auth）递归未找到测试文件（含 co-located tests/）
- ⚠️ task-04: 模块目录（backend/app/modules/daemon/group/service、NEW:backend/tests/modules/daemon）递归未找到测试文件（含 co-located tests/）
- ✅ task-05: 模块目录（frontend/src/stores、frontend/src/lib、backend）找到 63 个测试文件（frontend/src/stores/floating-session.test.ts、frontend/src/stores/session.test.ts、frontend/src/stores/theme.test.ts、frontend/src/stores/workspace.test.ts、frontend/src/lib/api/__tests__/llm-providers.test.ts …）
- ✅ task-06: 模块目录（frontend/src/components/group-chat）找到 3 个测试文件（frontend/src/components/group-chat/__tests__/group-askuser-aggregate.test.tsx、frontend/src/components/group-chat/__tests__/group-chat-panel.test.tsx、frontend/src/components/group-chat/__tests__/member-panel.test.tsx）
- ✅ task-07: 模块目录（frontend/src/app/(dashboard)/account）找到 1 个测试文件（frontend/src/app/(dashboard)/account/page.test.tsx）
- ⚠️ task-08: 模块目录（frontend/src/app/m/account）递归未找到测试文件（含 co-located tests/）
- ✅ task-09: 模块目录（frontend/src/components、frontend/src/components/__tests__）找到 20 个测试文件（frontend/src/components/agent/borrowed-solution-files-panel.test.tsx、frontend/src/components/agent/borrowed-solution-files.test.tsx、frontend/src/components/agent/__tests__/borrow-trigger-contract.test.ts、frontend/src/components/agent-log/__tests__/normalize-dual-path.test.ts、frontend/src/components/agent-log/__tests__/normalize.test.ts …）
- ✅ task-10: 模块目录（frontend/src/components/daemon）找到 10 个测试文件（frontend/src/components/daemon/__tests__/activity-catalog.test.tsx、frontend/src/components/daemon/__tests__/agent-log-card.test.tsx、frontend/src/components/daemon/__tests__/agent-task-card-lifecycle.test.tsx、frontend/src/components/daemon/__tests__/agent-task-card.test.tsx、frontend/src/components/daemon/__tests__/attachment-chips.test.tsx …）
- ⚠️ task-11: 模块目录（.sillyspec/changes/2026-09-10-account-avatar-upload）递归未找到测试文件（含 co-located tests/）
- ℹ️ 集成盲区（路由/跨模块装配）与断言有效性抽查是语义判断，留给 agent 逐 task 标注 ⚠️

**agent 标注（⚠️ 消解）**：task-01/02/03/04/08 的「未找到测试文件」是探针扫描根指向主仓、而新测试文件（test_my_avatar.py / test_group_member_avatar_fallback.py / m/account/page.test.tsx 等）落 worktree 所致——worktree 内实测：backend 2 新测试文件 23 用例 + frontend m-account 5 用例全绿（见测试汇总节）；task-11 纯验证卡本无测试文件（本质属性）。断言有效性抽查已在 execute 独立验收审查做过（抽跑 7+16+4 复核一致）。

#### 探针 4：决策追踪覆盖
- ✅ D-001@v1（文件中心存储）：FR-01/02/03/04 ← task-01/02/03/05/06 → 证据：迁移+列（task-01 review）、四态端点（task-03 review 7 用例）、两页上传走 user_avatar（task-07/08 review）——闭环
- ✅ D-002@v1（群聊回落）：FR-05 ← task-04 → 证据：16 用例矩阵（自定义优先/空值回落/agent 不动/N+1 断言）+ 既有 50 用例零回归——闭环
- ✅ D-003@v1（PPM 非目标）：非需求 ← task-11 verify → 证据：git diff -- '*ppm*' 为空——闭环
- 无 stale 引用（decisions.md 无 superseded 版本）；无 unresolved/blocking 决策

#### 探针 5：API Contract Parity
- ✅ API parity check passed: 3240 backend endpoints (live [scan-root 572 + worktree 573] + artifact 2865), 8 frontend calls [scope: change-diff (24 files @ worktree)] | 955 backend endpoints unused by frontend | 8 calls matched after mount-prefix alignment (artifact paths exclude include_router/app.use prefixes)
- ℹ️ 后端端点比对集为多根并集（主仓既有 ∪ worktree 新增 ∪ 存量 artifact），共扫 2 个根
- ℹ️ 8 处前端调用经挂载前缀对齐匹配（endpoints 提取不含 include_router/app.use 挂载点前缀，比对时剥除对齐——非契约缺口）
- ⚠️ 955 个后端端点前端未调用（warning 不阻断）：GET /admin/roles、POST /admin/roles、GET /admin/organizations、POST /admin/organizations、GET /admin/users …

#### 探针 6：代码删除对账
- ✅ git diff 无整文件删除（D/R/C）记录
- ℹ️ 以 git 事实为准（真实 > 声明）；是否 FAIL blocker 由 agent 诚实判定
## 证据账（cannot_verify 任务）
[层：人工判断——CLI 核验]

<!-- 无 cannot_verify 任务时本节写「无」 -->
无（本次变更无 cannot_verify 任务）

## 集成验证回执
[层：自述声明——CLI 一致性校验]

无（design.md frontmatter 已声明 risk_level: unit-sufficient——「daemon」命中为后端 group chat 模块路径误伤，非 Node 守护进程；无路由/启动入口/跨进程装配改动。FastAPI 异步测试 + 前端组件测试已充分覆盖，探针 5 API parity 亦过。）

