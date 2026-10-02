"use client";

import type * as React from "react";
import Link from "next/link";
import {
  IconChartBar,
  IconCreditCard,
  IconDashboard,
  IconFileDescription,
  IconHelp,
  IconInnerShadowTop,
  IconListDetails,
  IconSettings,
  IconUsers,
} from "@tabler/icons-react";
import { NavDocuments } from "@/components/nav-documents";
import { NavMain } from "@/components/nav-main";
import { NavSecondary } from "@/components/nav-secondary";
import { NavUser } from "@/components/nav-user";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";

const navigation = [
  { title: "Dashboard", url: "/dashboard", icon: IconDashboard },
  { title: "Customers", url: "/customers", icon: IconUsers },
  { title: "Plans", url: "/plans", icon: IconListDetails },
  { title: "Subscriptions", url: "/subscriptions", icon: IconCreditCard },
  { title: "Billing runs", url: "/operations", icon: IconChartBar },
  {
    title: "Reconciliation",
    url: "/reconciliation",
    icon: IconFileDescription,
  },
];

const records = [
  { name: "Customer directory", url: "/customers", icon: IconUsers },
  { name: "Plan catalogue", url: "/plans", icon: IconFileDescription },
];

type AppSidebarProps = React.ComponentProps<typeof Sidebar> & {
  user: { name: string; email: string };
};

export function AppSidebar({ user, ...props }: AppSidebarProps) {
  return (
    <Sidebar collapsible="offcanvas" {...props}>
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              asChild
              className="data-[slot=sidebar-menu-button]:p-1.5!"
            >
              <Link href="/dashboard">
                <IconInnerShadowTop className="size-5!" />
                <span className="text-base font-semibold">RCE Billing</span>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        <NavMain items={navigation} />
        <NavSecondary
          items={[
            { title: "Settings", url: "/settings", icon: IconSettings },
            { title: "Get help", url: "/operations", icon: IconHelp },
          ]}
          className="mt-auto"
        />
      </SidebarContent>
      <SidebarFooter>
        <NavUser user={{ ...user, avatar: "" }} />
      </SidebarFooter>
    </Sidebar>
  );
}
