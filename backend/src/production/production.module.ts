import { Global, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from '../prisma/prisma.module';
import { ProductionReadinessService } from './production-readiness.service';

@Global()
@Module({
  imports: [ConfigModule, PrismaModule],
  providers: [ProductionReadinessService],
  exports: [ProductionReadinessService],
})
export class ProductionModule {}
