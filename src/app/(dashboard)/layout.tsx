import { AppSidebar } from "@/components/app-sidebar";
// import { SiteHeader } from "@/components/site-header";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { requireAdministrator } from "@/auth/server";

export const dynamic = "force-dynamic";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const admin = await requireAdministrator();
  return (
    <SidebarProvider
      style={
        {
          "--sidebar-width": "calc(var(--spacing) * 72)",
          "--header-height": "calc(var(--spacing) * 12)",
        } as React.CSSProperties
      }
    >
      <AppSidebar user={{ name: admin.email, email: admin.email }} variant="inset" />
      <SidebarInset>
        {/* <SiteHeader /> */}
        {children}
      </SidebarInset>
    </SidebarProvider>
  );
}
