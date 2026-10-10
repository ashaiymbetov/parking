import {
  HttpStatus,
  INestApplication,
  ValidationError,
  ValidationPipe,
} from '@nestjs/common';
import { AllExceptionsFilter } from './common/all-exceptions.filter';
import { DomainError } from './common/domain-error';

function flatten(errors: ValidationError[], parent = ''): string[] {
  return errors.flatMap((e) => {
    const path = parent ? `${parent}.${e.property}` : e.property;
    return [
      ...Object.values(e.constraints ?? {}).map((m) => `${path}: ${m}`),
      ...flatten(e.children ?? [], path),
    ];
  });
}

/** Shared by main.ts and e2e tests so both run the same HTTP setup. */
export function configureApp(app: INestApplication): void {
  app.setGlobalPrefix('api');
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      exceptionFactory: (errors) => {
        const details = flatten(errors);
        return new DomainError(
          HttpStatus.UNPROCESSABLE_ENTITY,
          'VALIDATION_FAILED',
          'Некорректные данные запроса',
          { details },
        );
      },
    }),
  );
  app.useGlobalFilters(new AllExceptionsFilter());
  app.enableShutdownHooks();
}
