/**
 * Dashboard layout placeholder.
 *
 * Real navigation chrome lives in task-05 once the Workspace shell exists.
 */
export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <div className="min-h-screen bg-background">{children}</div>;
}
