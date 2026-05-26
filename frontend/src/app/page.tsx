import Link from "next/link";

import { HealthCard } from "@/components/health-card";
import { Button } from "@/components/ui/button";

export default function HomePage() {
  return (
    <main className="container mx-auto flex max-w-4xl flex-col gap-8 px-4 py-12">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Multi-Agent Platform</h1>
          <p className="mt-2 text-muted-foreground">
            V1 骨架 · 当前页用于 task-01 的端到端联通性验证
          </p>
        </div>
        <Link href="/workspaces">
          <Button>Workspaces</Button>
        </Link>
      </header>

      <HealthCard />

      <section className="rounded-lg border bg-muted/30 p-6 text-sm text-muted-foreground">
        <p className="font-medium text-foreground">下一步</p>
        <ul className="mt-2 list-inside list-disc space-y-1">
          <li>
            <Link className="underline" href="/workspaces">
              /workspaces
            </Link>{" "}
            — task-02 已实现：扫描 .sillyspec 仓库、注册 Workspace、re-scan / 软删除
          </li>
          <li>task-03 起 Project Component 详细解析</li>
          <li>登录 / RBAC 见 task-04（references/15、16）</li>
          <li>Git Identity / Worktree 见 task-09 / task-10</li>
        </ul>
      </section>
    </main>
  );
}
