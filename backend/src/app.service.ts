import { Injectable } from '@nestjs/common';
import { PrismaService } from './prisma/prisma.service';
import { Plan } from '@prisma/client';

@Injectable()
export class AppService {
  constructor(private readonly prisma: PrismaService) {}

  async getHello(): Promise<{
    message: string;
    plans: Plan[];
  }> {
    const plans: Plan[] = await this.prisma.plan.findMany();

    return {
      message: 'Backend funcionando',
      plans,
    };
  }
}
