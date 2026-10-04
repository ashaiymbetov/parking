import { DynamicModule, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { buildDataSourceOptions } from './data-source-options';

@Module({})
export class DatabaseModule {
  static forRoot(opts: { runMigrations: boolean }): DynamicModule {
    return {
      module: DatabaseModule,
      imports: [
        TypeOrmModule.forRootAsync({
          inject: [ConfigService],
          useFactory: (config: ConfigService) =>
            buildDataSourceOptions({
              url: config.getOrThrow<string>('DATABASE_URL'),
              runMigrations: opts.runMigrations,
            }),
        }),
      ],
    };
  }
}
