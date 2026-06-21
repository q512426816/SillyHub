import Link from "next/link";
import { ChevronLeft } from "lucide-react";

import { PageContainer, PageHeader } from "@/components/layout";
import { MissionConsole } from "@/components/mission-console";

interface Props {
  params: { id: string };
}

export default function MissionsPage({ params }: Props) {
  return (
    <PageContainer size="full">
      <PageHeader
        title="Agent 团队"
        actions={
          <Link
            href={`/workspaces/${params.id}`}
            className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
          >
            <ChevronLeft className="h-4 w-4" /> 返回工作区
          </Link>
        }
      />
      <MissionConsole workspaceId={params.id} />
    </PageContainer>
  );
}
