# 符号影响面报告

> tasks.md 内容指纹（生成时）: d8c9e79794387764——重入本步时若与当前 tasks.md 指纹一致且结论已填全，直接沿用不重做扫描。
> 骨架由 CLI 生成（`sillyspec symbol-impact --change <变更名>`，gate 失败时也会自动落一份）。
> 逐行把 `<!--TODO-->` 替换为真实结论：涉及签名级变更（构造函数参数/接口/DTO/方法签名增删改）
> 写变更类型 + 受影响调用点 + 是否在任务范围内；无签名级变更也要显式写「无签名级变更」。
> **gate 拒绝仍含 <!--TODO--> 的行**——骨架不能直接过门。

- task-01: 无签名级变更——Permission StrEnum 纯增量（+5 成员），group() 前缀映射新增 4 个前缀分支，不改既有成员与既有分支；既有调用点（require_permission 171 处 / admin schema list[Permission]）零影响。连带：backend/tests/modules/auth/test_permissions.py:59 计数 67→72 确定性失效，已在 task-01 卡 related_tests 声明且路径入 allowed_paths（任务范围内）。
- task-02: 无签名级变更——admin/model.py 新增 MenuOverride 表模型、admin/schema.py 新增 MenuOverrideRead/MenuOverrideUpsert 两个 DTO，纯新增类，无既有接口/DTO/签名改动。
- task-03: 无签名级变更——纯新增 Alembic 迁移文件（建 menu_overrides 表 + role_permissions 种子 INSERT），不改任何 Python 符号。
- task-04: 无签名级变更——纯新增 menu_overrides_service.py（MenuOverrideService 类），对内消费 task-02 新 DTO，不改既有服务签名。
- task-05: 无签名级变更——纯新增 menu_overrides_router.py 子路由 + main.py 追加一行 include_router（既有 main 符号零改动）。
- task-06: 无签名级变更——纯新增测试文件 + 既有种子断言测试同步，被测符号为 task-01~05 新增产物。
- task-07: 无签名级变更——pnpm gen:types 再生成 openapi.json/api-types.ts（产物替换，非手写符号）；确定性连带：frontend/src/lib/__tests__/menu-permissions.test.ts 的 BACKEND_PERMISSION_KEYS 镜像缺 5 新 key（归 task-12 同步，任务范围内）；gen:types 顺带重写 provider-caps 两产物（预期字节相同，卡内已声明）。
- task-08: 接口定义变更——menu-permissions.ts 的 PermissionItem.key 类型 string → api-types Permission 联合类型（编译期收窄，值域兼容：现有 37 个 key 均在联合内，审查已实证）；受影响调用点：仅本文件内字面量（编译期检查，无运行时行为变化）；MENU_PERMISSION_GROUPS 结构不变（4 条补 permissions 值 + 1 条新增 menus 项，类型不变）。连带断言失效归 task-12（任务范围内）。
- task-09: 无签名级变更——纯新增 lib/menu-overrides.ts（useMenuOverrides/mergeMenus），消费 task-07 生成的 MenuOverrideRead 类型。
- task-10: 无签名级变更——app-shell.tsx 渲染管线在 visibleMenusBySection 之后追加 mergeMenus 变换 + MENU_ICON_MAP 补一个键，不改既有组件签名。
- task-11: 无签名级变更——纯新增 /admin/menus 页面，消费 listRoles（既有 lib/admin.ts 符号，只读调用）。
- task-12: 无签名级变更——新增两测试文件 + 同步两既有测试断言（测试侧文本，非生产签名）。
- task-13: 无签名级变更——纯文档（模块 md + README 部署节）。
