import { redirect } from "next/navigation";
import { getCurrentUser, getRoleDashboardPath } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const user = await getCurrentUser();
  if (user) {
    redirect(getRoleDashboardPath(user.role));
  }
  redirect("/login");
}
