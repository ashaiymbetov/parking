import { RateKind } from '../tariffing/tariffing.types';

export interface InvoiceSegmentView {
  tariffId: string;
  kind: RateKind;
  from: string;
  to: string;
  minutes: number;
  pricePerMinuteKop: number;
  amountKop: number;
}

export interface InvoiceView {
  id: string;
  visitId: string;
  plate: string;
  minutes: number;
  amountKop: number;
  segments: InvoiceSegmentView[];
  createdAt: string;
}

export interface VisitView {
  id: string;
  plate: string;
  spot: { id: string; code: string };
  bookingId: string | null;
  enteredAt: string;
  exitedAt: string | null;
  closeReason: 'exit' | 'forced' | null;
  invoice: InvoiceView | null;
}

/** One row per visit with its invoice (if any). Add WHERE / ORDER BY. */
export const SELECT_VISIT = `
  SELECT v.id, v.plate, v.spot_id, s.code AS spot_code, v.booking_id,
         v.entered_at, v.exited_at, v.close_reason,
         i.id AS invoice_id, i.minutes, i.amount_kop, i.breakdown,
         i.created_at AS invoice_created_at
  FROM visits v
  JOIN spots s ON s.id = v.spot_id
  LEFT JOIN invoices i ON i.visit_id = v.id`;

export interface VisitRow {
  id: string;
  plate: string;
  spot_id: string;
  spot_code: string;
  booking_id: string | null;
  entered_at: Date;
  exited_at: Date | null;
  close_reason: 'exit' | 'forced' | null;
  invoice_id: string | null;
  minutes: number | null;
  amount_kop: number | null;
  breakdown: InvoiceSegmentView[] | null;
  invoice_created_at: Date | null;
}

export function toVisitView(r: VisitRow): VisitView {
  return {
    id: r.id,
    plate: r.plate,
    spot: { id: r.spot_id, code: r.spot_code },
    bookingId: r.booking_id,
    enteredAt: r.entered_at.toISOString(),
    exitedAt: r.exited_at?.toISOString() ?? null,
    closeReason: r.close_reason,
    invoice:
      r.invoice_id === null
        ? null
        : {
            id: r.invoice_id,
            visitId: r.id,
            plate: r.plate,
            minutes: r.minutes!,
            amountKop: r.amount_kop!,
            segments: r.breakdown!,
            createdAt: r.invoice_created_at!.toISOString(),
          },
  };
}
