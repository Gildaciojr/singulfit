import { Controller, Get } from '@nestjs/common';
import { AppService } from './app.service';
import { Plan } from '@prisma/client';

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get()
  async getHello(): Promise<{
    message: string;
    plans: Plan[];
  }> {
    return this.appService.getHello();
  }
}
