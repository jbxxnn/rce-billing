"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import { Columns3, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

type Plan = {
  id: string;
  name: string;
  planType: string;
  baseAmount: string | null;
  version: number | null;
  active: boolean;
};
// The plan list returns minor units from the database, so 7,500 means $75.00.
const money = (value: string | null) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(
    Number(value ?? "0") / 100,
  );

export function PlanDataTable({
  data,
  initialSearch,
}: {
  data: Plan[];
  initialSearch: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [search, setSearch] = useState(initialSearch);
  const [status, setStatus] = useState("ALL");
  const [visible, setVisible] = useState({
    type: true,
    amount: true,
    version: true,
    status: true,
  });
  const rows = data.filter(
    (plan) =>
      status === "ALL" || (status === "ACTIVE" ? plan.active : !plan.active),
  );
  const updateSearch = (value: string) => {
    setSearch(value);
    router.replace(
      `${pathname}${value ? `?q=${encodeURIComponent(value)}` : ""}`,
    );
  };
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-1 flex-col gap-3 sm:flex-row">
          <div className="relative w-full sm:max-w-sm">
            <Search className="pointer-events-none absolute top-2.5 left-3 size-4 text-muted-foreground" />
            <Input
              value={search}
              onChange={(event) => updateSearch(event.target.value)}
              className="pl-9"
              placeholder="Search plans"
            />
          </div>
          <select
            value={status}
            onChange={(event) => setStatus(event.target.value)}
            className="h-9 rounded-md border border-input bg-background px-3 text-sm"
          >
            <option value="ALL">All statuses</option>
            <option value="ACTIVE">Active</option>
            <option value="INACTIVE">Inactive</option>
          </select>
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              className="bg-card text-card-foreground hover:bg-card-hover hover:text-card-foreground hover:shadow-md hover:cursor-pointer"
              size="sm"
            >
              <Columns3 />
              Columns
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {Object.entries({
              type: "Type",
              amount: "Base USD",
              version: "Version",
              status: "Status",
            }).map(([key, label]) => (
              <DropdownMenuCheckboxItem
                key={key}
                checked={visible[key as keyof typeof visible]}
                onCheckedChange={(checked) =>
                  setVisible((current) => ({
                    ...current,
                    [key]: Boolean(checked),
                  }))
                }
              >
                {label}
              </DropdownMenuCheckboxItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <div className="overflow-hidden rounded-lg border border-input bg-card">
        <table className="w-full text-left text-sm">
          <thead>
            <tr>
              <th className="bg-muted px-4 py-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Plan
              </th>
              {visible.type && (
                <th className="bg-muted px-4 py-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Type
                </th>
              )}
              {visible.amount && (
                <th className="bg-muted px-4 py-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Base USD
                </th>
              )}
              {visible.version && (
                <th className="bg-muted px-4 py-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Version
                </th>
              )}
              {visible.status && (
                <th className="bg-muted px-4 py-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Status
                </th>
              )}
            </tr>
          </thead>
          <tbody>
            {rows.map((plan) => (
              <tr
                className="cursor-pointer border-t border-input transition-colors hover:bg-muted/40 focus-visible:bg-muted/40 focus-visible:outline-none"
                key={plan.id}
                role="link"
                tabIndex={0}
                aria-label={`Open ${plan.name}`}
                onClick={() => router.push(`/plans/${plan.id}`)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    router.push(`/plans/${plan.id}`);
                  }
                }}
              >
                <td className="px-4 py-3">
                  <Link
                    className="font-medium text-primary hover:underline"
                    href={`/plans/${plan.id}`}
                  >
                    {plan.name}
                  </Link>
                </td>
                {visible.type && <td className="px-4 py-3">{plan.planType}</td>}
                {visible.amount && (
                  <td className="px-4 py-3">{money(plan.baseAmount)}</td>
                )}
                {visible.version && (
                  <td className="px-4 py-3">{plan.version ?? "—"}</td>
                )}
                {visible.status && (
                  <td className="px-4 py-3">
                    {plan.active ? "Active" : "Inactive"}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-sm text-muted-foreground">
        {rows.length} plan{rows.length === 1 ? "" : "s"}
      </p>
    </div>
  );
}
