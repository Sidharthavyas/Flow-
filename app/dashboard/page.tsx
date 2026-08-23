import { requireUser } from "@/lib/auth";
import FlowDashboard from "@/components/FlowDashboard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const user = await requireUser();
  return <FlowDashboard user={user} />;
}
