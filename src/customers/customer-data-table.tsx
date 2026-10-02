"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import * as React from "react";
import {
  getCoreRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  type LegacyColumnDef,
  useLegacyTable,
} from "@tanstack/react-table/legacy";
import { flexRender } from "@tanstack/react-table";
import type { SortingState } from "@tanstack/table-core";
import {
  ArrowUpDown,
  ChevronLeft,
  ChevronRight,
  Columns3,
  Search,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

type CustomerRow = {
  id: string;
  fullName: string;
  email: string;
  status: string;
  paymentStatus: string;
  billingDay: number;
  credentialStatus: string | null;
};

const columns: LegacyColumnDef<CustomerRow>[] = [
  {
    accessorKey: "fullName",
    header: "Customer",
    cell: ({ row }) => (
      <Link
        className="font-medium text-primary hover:underline"
        href={`/revenue/customers/${row.original.id}`}
      >
        {row.original.fullName}
      </Link>
    ),
  },
  { accessorKey: "email", header: "Email" },
  {
    accessorKey: "status",
    header: "Status",
    cell: ({ row }) => (
      <Badge
        variant={row.original.status === "ACTIVE" ? "default" : "secondary"}
      >
        {row.original.status}
      </Badge>
    ),
  },
  { accessorKey: "paymentStatus", header: "Payment" },
  {
    accessorKey: "billingDay",
    header: "Billing day",
    cell: ({ row }) => `Day ${row.original.billingDay}`,
  },
  {
    accessorKey: "credentialStatus",
    header: "Flowroute keys",
    cell: ({ row }) => (
      <Badge
        variant={
          row.original.credentialStatus === "ACTIVE" ? "default" : "outline"
        }
      >
        {row.original.credentialStatus ?? "NOT STORED"}
      </Badge>
    ),
  },
];

export function CustomerDataTable({
  data,
  initialSearch,
  initialStatus,
}: {
  data: CustomerRow[];
  initialSearch: string;
  initialStatus: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [sorting, setSorting] = React.useState<SortingState>([]);
  const [globalFilter, setGlobalFilter] = React.useState(initialSearch);
  const [status, setStatus] = React.useState(initialStatus);
  const [columnVisibility, setColumnVisibility] = React.useState({});
  const table = useLegacyTable({
    data,
    columns,
    state: { sorting, globalFilter, columnVisibility },
    onSortingChange: setSorting,
    onGlobalFilterChange: setGlobalFilter,
    onColumnVisibilityChange: setColumnVisibility,
    globalFilterFn: (row, _, value) =>
      [row.original.fullName, row.original.email].some((field) =>
        field.toLowerCase().includes(String(value).toLowerCase()),
      ),
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
  });
  const updateFilters = (nextSearch: string, nextStatus: string) => {
    const params = new URLSearchParams();
    if (nextSearch) params.set("q", nextSearch);
    if (nextStatus !== "ALL") params.set("status", nextStatus);
    router.replace(`${pathname}${params.size ? `?${params}` : ""}`);
  };
  const rows = table.getRowModel().rows;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-1 flex-col gap-3 sm:flex-row sm:items-center">
          <div className="relative w-full sm:max-w-sm">
            <Search className="pointer-events-none absolute top-2.5 left-3 size-4 text-muted-foreground" />
            <Input
              value={globalFilter}
              onChange={(event) => {
                const value = event.target.value;
                setGlobalFilter(value);
                updateFilters(value, status);
              }}
              className="pl-9"
              placeholder="Search name or email"
            />
          </div>
          <select
            value={status}
            onChange={(event) => {
              const value = event.target.value;
              setStatus(value);
              updateFilters(globalFilter, value);
            }}
            className="h-9 rounded-md border border-input bg-background px-3 text-sm"
          >
            <option value="ALL">All statuses</option>
            {["DRAFT", "ACTIVE", "SUSPENDED", "ARCHIVED"].map((value) => (
              <option key={value}>{value}</option>
            ))}
          </select>
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              className="bg-card text-card-foreground hover:bg-card-hover hover:text-card-foreground hover:shadow-md hover:cursor-pointer"
              size="sm"
            >
              <Columns3 /> Columns
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {table
              .getAllColumns()
              .filter((column) => column.getCanHide())
              .map((column) => (
                <DropdownMenuCheckboxItem
                  key={column.id}
                  checked={column.getIsVisible()}
                  onCheckedChange={(value) =>
                    column.toggleVisibility(Boolean(value))
                  }
                >
                  {column.id === "fullName" ? "Customer" : column.id}
                </DropdownMenuCheckboxItem>
              ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <div className="overflow-hidden rounded-lg border border-input bg-card">
        <Table>
          <TableHeader className="[&_tr]:border-input">
            {table.getHeaderGroups().map((group) => (
              <TableRow className="border-input" key={group.id}>
                {group.headers.map((header) => (
                  <TableHead
                    key={header.id}
                    className="bg-muted border-input px-4 py-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground"
                  >
                    {header.isPlaceholder ? null : (
                      <button
                        className="inline-flex items-center gap-1"
                        onClick={header.column.getToggleSortingHandler()}
                      >
                        {flexRender(
                          header.column.columnDef.header,
                          header.getContext(),
                        )}
                        <ArrowUpDown className="size-3.5" />
                      </button>
                    )}
                  </TableHead>
                ))}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {rows.length ? (
              rows.map((row) => (
                <TableRow
                  className="cursor-pointer border-input focus-visible:bg-muted/40 focus-visible:outline-none"
                  key={row.id}
                  role="link"
                  tabIndex={0}
                  aria-label={`Open invoice history for ${row.original.fullName}`}
                  onClick={() =>
                    router.push(`/revenue/customers/${row.original.id}`)
                  }
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      router.push(`/revenue/customers/${row.original.id}`);
                    }
                  }}
                >
                  {row.getVisibleCells().map((cell) => (
                    <TableCell className="px-4 py-3" key={cell.id}>
                      {flexRender(
                        cell.column.columnDef.cell,
                        cell.getContext(),
                      )}
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell
                  colSpan={columns.length}
                  className="h-24 text-center text-muted-foreground"
                >
                  No customers match these filters.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
      <div className="flex items-center justify-between text-sm text-muted-foreground">
        <span>
          {rows.length} customer{rows.length === 1 ? "" : "s"}
        </span>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="icon"
            onClick={() => table.previousPage()}
            disabled={!table.getCanPreviousPage()}
          >
            <ChevronLeft />
          </Button>
          <span>
            Page {table.getState().pagination.pageIndex + 1} of{" "}
            {table.getPageCount()}
          </span>
          <Button
            variant="outline"
            size="icon"
            onClick={() => table.nextPage()}
            disabled={!table.getCanNextPage()}
          >
            <ChevronRight />
          </Button>
        </div>
      </div>
    </div>
  );
}
