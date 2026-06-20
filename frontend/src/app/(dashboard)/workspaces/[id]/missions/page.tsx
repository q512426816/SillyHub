import Link from "next/link";
import { ChevronLeft } from "lucide-react";

import { MissionConsole } from "@/components/mission-console";

interface Props {
  params: { id: string };
}

export default function MissionsPage({ params }: Props) {
  return (
    <div className="mx-auto max-w-3xl space-y-4 p-6">
      <Link
        href={`/workspaces/${params.id}`}
        className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-800"
      >
        <ChevronLeft className="h-4 w-4" /> 返回工作区
      </Link>
      <h1 className="text-xl font-semibold">Agent 团队</h1>
      <MissionConsole workspaceId={params.id} />
    </div>
  );
}
