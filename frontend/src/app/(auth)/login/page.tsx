/**
 * Placeholder login page.
 *
 * Real implementation arrives with task-04. We keep the route so the App Router
 * group `(auth)` already compiles and the directory structure stays stable.
 */
export default function LoginPage() {
  return (
    <main className="container mx-auto flex min-h-screen max-w-md items-center justify-center px-4 py-12">
      <section className="w-full rounded-lg border bg-card p-8 shadow-sm">
        <h1 className="text-2xl font-semibold tracking-tight">登录</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          认证流程将在 task-04 实现。当前页仅占位以保留路由结构。
        </p>
      </section>
    </main>
  );
}
