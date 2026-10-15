# 符号影响面报告

> tasks.md 内容指纹（生成时）: 09e6bbb280053ff6——重入本步时若与当前 tasks.md 指纹一致且结论已填全，直接沿用不重做扫描。
> 骨架由 CLI 生成（`sillyspec symbol-impact --change <变更名>`，gate 失败时也会自动落一份）。
> 逐行把 `<!--TODO-->` 替换为真实结论：涉及签名级变更（构造函数参数/接口/DTO/方法签名增删改）
> 写变更类型 + 受影响调用点 + 是否在任务范围内；无签名级变更也要显式写「无签名级变更」。
> **gate 拒绝仍含 <!--TODO--> 的行**——骨架不能直接过门。

- task-01: Permission 枚举新增成员 SYSTEM_STATUS_READ（枚举扩员，非签名改写——无既有调用点受影响；backend/tests/modules/auth/test_permissions.py:51 计数锚 59→60 属计划内连带，在任务范围）。system_status() 端点函数签名增加权限依赖参数（FastAPI Depends 注入，路由路径与响应模型不变；该端点前端零消费已核实，无调用点需改）。无其它签名级变更。
- task-02: frontend/src/lib/health.ts 新增导出 getSystemStatus()（新增符号，无改写）；新建页面组件 ServerStatusPage（新增符号）。无签名级变更（无既有函数/接口签名增删改）。
- task-03: 无签名级变更（openapi.json/api-types.ts 为生成物再生成；Permission 联合类型扩员属类型生成面，编译期自动收录，无手写签名）。
- task-04: MENU_PERMISSION_GROUPS 数组追加元素（数据扩员非签名变更；连带 admin/menus 测试锚在任务范围）；MENU_ICON_MAP 追加键值（同理）。无签名级变更。
