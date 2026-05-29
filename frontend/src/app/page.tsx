import Link from "next/link";

import { HealthCard } from "@/components/health-card";
import { Button } from "@/components/ui/button";

export default function HomePage() {
  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-6 px-6 py-10">
      <header>
        <h1>Multi-Agent Platform</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          V1 骨架 · 当前页用于 task-01 的端到端联通性验证
        </p>
      </header>

      <div>
        <Link href="/workspaces">
          <Button>进入 Workspaces</Button>
        </Link>
      </div>

      <HealthCard />
    </main>
  );
}
