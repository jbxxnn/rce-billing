import type { NextRequest } from "next/server";
import { adminMutation } from "@/admin/http";
import { calculateLegacyV1 } from "@/domain/billing/formulas/legacy-v1";
import { parseUsd } from "@/domain/billing/money";
import {
  reconciliationInput,
  reconciliationSchema,
} from "@/reconciliation/validation";

export async function POST(request: NextRequest) {
  return adminMutation(request, async (fields) => {
    const value = reconciliationSchema.parse(fields);
    const calculation = calculateLegacyV1(reconciliationInput(value));
    const legacyTotal = value.legacyInvoiceTotal
      ? parseUsd(value.legacyInvoiceTotal)
      : null;
    return {
      planType: value.planType,
      flowrouteTotalCost: value.flowrouteTotalCost,
      roundedUsage: calculation.usageQuantity.toString(),
      calculatedMinor: calculation.amountMinor.toString(),
      calculatedAmount: (Number(calculation.amountMinor) / 100).toFixed(2),
      legacyAmount:
        legacyTotal === null ? null : (Number(legacyTotal) / 100).toFixed(2),
      differenceAmount:
        legacyTotal === null
          ? null
          : (Number(calculation.amountMinor - legacyTotal) / 100).toFixed(2),
      matches:
        legacyTotal === null ? null : calculation.amountMinor === legacyTotal,
      lines: calculation.lines.map((line) => ({
        description: line.description,
        amount: (Number(line.amountMinor) / 100).toFixed(2),
      })),
    };
  });
}
