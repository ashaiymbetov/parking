import { INestApplication, ValidationPipe } from '@nestjs/common';

/** Shared by main.ts and e2e tests so both run the same HTTP setup. */
export function configureApp(app: INestApplication): void {
  app.setGlobalPrefix('api');
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  app.enableShutdownHooks();
}
