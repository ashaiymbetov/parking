import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { IsIn, IsOptional } from 'class-validator';
import type { AuthUser } from '../auth/auth-user';
import { CurrentUser, Roles } from '../auth/decorators';
import { DomainError } from '../common/domain-error';
import { InvoiceView, VisitView } from './views';
import { AnomalyView, GateEventView, VisitsService } from './visits.service';

/** A malformed id names nothing that exists: 404, like someone else's id. */
const idParam = (code: string, message: string) =>
  new ParseUUIDPipe({
    exceptionFactory: () => new DomainError(404, code, message),
  });

@Controller()
@Roles('driver')
export class VisitsController {
  constructor(private readonly visits: VisitsService) {}

  @Get('visits')
  list(@CurrentUser() user: AuthUser): Promise<VisitView[]> {
    return this.visits.listOwn(user.id);
  }

  @Get('visits/:id')
  get(
    @CurrentUser() user: AuthUser,
    @Param('id', idParam('VISIT_NOT_FOUND', 'Визит не найден')) id: string,
  ): Promise<VisitView> {
    return this.visits.getOwn(user.id, id);
  }

  @Get('invoices')
  invoices(@CurrentUser() user: AuthUser): Promise<InvoiceView[]> {
    return this.visits.listOwnInvoices(user.id);
  }

  @Get('invoices/:id')
  invoice(
    @CurrentUser() user: AuthUser,
    @Param('id', idParam('INVOICE_NOT_FOUND', 'Счёт не найден')) id: string,
  ): Promise<InvoiceView> {
    return this.visits.getOwnInvoice(user.id, id);
  }
}

export class OperatorVisitsQueryDto {
  @IsOptional()
  @IsIn(['open', 'closed'])
  status?: 'open' | 'closed';
}

@Controller('operator')
@Roles('operator')
export class OperatorController {
  constructor(private readonly visits: VisitsService) {}

  @Get('visits')
  visitsList(@Query() q: OperatorVisitsQueryDto): Promise<VisitView[]> {
    return this.visits.listAll(q.status);
  }

  @Get('anomalies')
  anomalies(): Promise<AnomalyView[]> {
    return this.visits.anomalies();
  }

  @Get('gate-events')
  gateEvents(): Promise<GateEventView[]> {
    return this.visits.gateEvents();
  }
}
