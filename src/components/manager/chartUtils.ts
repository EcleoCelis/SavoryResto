import type { RevenuePeriod } from "../../types/staff";

export const EXPECTED_INTERVAL_COUNTS: Record<RevenuePeriod, number> = {
  last_7_days: 7,
  last_30_days: 30,
  last_12_months: 12,
};

const phpFormatter = new Intl.NumberFormat("en-PH", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export function formatPhpCurrency(value: number): string {
  return `₱${phpFormatter.format(value)}`;
}

/** Compute clean whole-number axis ticks starting at 0 with zero fractional or duplicate ticks. */
export function computeNiceIntegerAxis(
  maxValue: number,
  emptyDefaultMax = 8
): { maxTick: number; ticks: number[] } {
  const safeMax = maxValue <= 0 ? emptyDefaultMax : maxValue;
  if (safeMax <= 4) {
    const upper = Math.max(2, Math.ceil(safeMax));
    const ticks = Array.from({ length: upper + 1 }, (_, idx) => idx);
    return { maxTick: upper, ticks };
  }

  const rawStep = safeMax / 4;
  const magnitude = Math.pow(10, Math.floor(Math.log10(rawStep)));
  const normalized = rawStep / magnitude;
  const candidateSteps = [1, 2, 2.5, 4, 5, 10];
  let step = Math.ceil((candidateSteps.find((c) => c >= normalized) ?? 10) * magnitude);
  if (step < 1) step = 1;

  const maxTick = step * 4;
  const ticks = [0, step, step * 2, step * 3, maxTick];
  return { maxTick, ticks };
}

export function shouldRenderPeriodXAxisLabel(
  index: number,
  total: number,
  period: RevenuePeriod,
  plotWidth: number
): boolean {
  if (total <= 1) return true;
  if (period === "last_7_days") {
    return plotWidth >= 300 || index % 2 === 0 || index === total - 1;
  }
  if (period === "last_12_months") {
    const step = plotWidth >= 780 ? 1 : plotWidth >= 420 ? 2 : 3;
    if (index === 0 || index === total - 1) return true;
    if (step > 1 && total - 1 - index < step) return false;
    return index % step === 0;
  }
  // last_30_days
  const targetLabels = plotWidth >= 680 ? 7 : plotWidth >= 440 ? 5 : 4;
  const step = Math.max(1, Math.ceil((total - 1) / (targetLabels - 1)));
  if (index === 0 || index === total - 1) return true;
  if (total - 1 - index < Math.ceil(step / 2)) return false;
  return index % step === 0;
}

export function truncateLabel(label: string, maxChars: number): string {
  const trimmed = label.trim();
  if (trimmed.length <= maxChars) return trimmed;
  return `${trimmed.slice(0, Math.max(1, maxChars - 1))}…`;
}
