import Link from "next/link";

import { HealthCard } from "@/components/health-card";
import { ServerStatusCard } from "@/components/server-status-card";
import { Button } from "@/components/ui/button";

export default function HomePage() {
  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-6 px-6 py-10">
      <header>
        <h1>SillyHub</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          多智能体开发协作平台
        </p>
      </header>

      <div className="flex flex-wrap gap-2">
        <Link href="/workspaces">
          <Button>进入工作区</Button>
        </Link>
        <Link href="/ppm/project-plans">
          <Button variant="outline">进入项目管理平台</Button>
        </Link>
      </div>

      <HealthCard />
      <ServerStatusCard />
    </main>
  );
}
