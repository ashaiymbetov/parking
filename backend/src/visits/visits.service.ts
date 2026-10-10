import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { DomainError } from '../common/domain-error';
import {
  InvoiceView,
  SELECT_VISIT,
  toVisitView,
  VisitRow,
  VisitView,
} from './views';

const ORDER = `ORDER BY v.entered_at DESC, v.created_at DESC`;

export interface AnomalyView {
  id: string;
  kind: string;
  plate: string | null;
  bookingId: string | null;
  gateEventId: string | null;
  details: Record<string, unknown>;
  createdAt: string;
}

export interface GateEventView {
  id: string;
  kind: 'entry' | 'exit';
  rawPlate: string;
  plate: string | null;
  occurredAt: string;
  idempotencyKey: string | null;
  outcome: 'ok' | 'rejected';
  errorCode: string | null;
  visitId: string | null;
}

/** Read side: a driver's own history and the operator's journals. */
@Injectable()
export class VisitsService {
  constructor(@InjectDataSource() private readonly ds: DataSource) {}

  async listOwn(userId: string): Promise<VisitView[]> {
    const rows: VisitRow[] = await this.ds.query(
      `${SELECT_VISIT} WHERE v.user_id = $1 ${ORDER}`,
      [userId],
    );
    return rows.map(toVisitView);
  }

  async getOwn(userId: string, id: string): Promise<VisitView> {
    const rows: VisitRow[] = await this.ds.query(
      `${SELECT_VISIT} WHERE v.id = $1 AND v.user_id = $2`,
      [id, userId],
    );
    if (rows.length === 0) {
      throw new DomainError(404, 'VISIT_NOT_FOUND', 'Визит не найден');
    }
    return toVisitView(rows[0]);
  }

  async listOwnInvoices(userId: string): Promise<InvoiceView[]> {
    const rows: VisitRow[] = await this.ds.query(
      `${SELECT_VISIT} WHERE v.user_id = $1 AND i.id IS NOT NULL
       ORDER BY i.created_at DESC, v.entered_at DESC`,
      [userId],
    );
    return rows.map((r) => toVisitView(r).invoice!);
  }

  async getOwnInvoice(userId: string, id: string): Promise<InvoiceView> {
    const rows: VisitRow[] = await this.ds.query(
      `${SELECT_VISIT} WHERE i.id = $1 AND v.user_id = $2`,
      [id, userId],
    );
    if (rows.length === 0) {
      throw new DomainError(404, 'INVOICE_NOT_FOUND', 'Счёт не найден');
    }
    return toVisitView(rows[0]).invoice!;
  }

  async listAll(status?: 'open' | 'closed'): Promise<VisitView[]> {
    const where =
      status === 'open'
        ? 'WHERE v.exited_at IS NULL'
        : status === 'closed'
          ? 'WHERE v.exited_at IS NOT NULL'
          : '';
    const rows: VisitRow[] = await this.ds.query(
      `${SELECT_VISIT} ${where} ${ORDER} LIMIT 500`,
    );
    return rows.map(toVisitView);
  }

  async anomalies(): Promise<AnomalyView[]> {
    const rows: {
      id: string;
      kind: string;
      plate: string | null;
      booking_id: string | null;
      gate_event_id: string | null;
      details: Record<string, unknown>;
      created_at: Date;
    }[] = await this.ds.query(
      `SELECT id, kind, plate, booking_id, gate_event_id, details, created_at
       FROM anomalies ORDER BY seq DESC LIMIT 500`,
    );
    return rows.map((r) => ({
      id: r.id,
      kind: r.kind,
      plate: r.plate,
      bookingId: r.booking_id,
      gateEventId: r.gate_event_id,
      details: r.details,
      createdAt: r.created_at.toISOString(),
    }));
  }

  async gateEvents(): Promise<GateEventView[]> {
    const rows: {
      id: string;
      kind: 'entry' | 'exit';
      raw_plate: string;
      plate: string | null;
      occurred_at: Date;
      idempotency_key: string | null;
      outcome: 'ok' | 'rejected';
      error_code: string | null;
      visit_id: string | null;
    }[] = await this.ds.query(
      `SELECT id, kind, raw_plate, plate, occurred_at, idempotency_key,
              outcome, error_code, visit_id
       FROM gate_events ORDER BY seq DESC LIMIT 500`,
    );
    return rows.map((r) => ({
      id: r.id,
      kind: r.kind,
      rawPlate: r.raw_plate,
      plate: r.plate,
      occurredAt: r.occurred_at.toISOString(),
      idempotencyKey: r.idempotency_key,
      outcome: r.outcome,
      errorCode: r.error_code,
      visitId: r.visit_id,
    }));
  }
}
