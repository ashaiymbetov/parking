import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { configureApp } from './configure-app';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  configureApp(app);
  const port = app.get(ConfigService).getOrThrow<number>('PORT');
  await app.listen(port);
  Logger.log(`API listening on :${port}`, 'Bootstrap');
}
void bootstrap();
