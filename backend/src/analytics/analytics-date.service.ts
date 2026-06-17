import { BadRequestException, Injectable } from '@nestjs/common';

@Injectable()
export class AnalyticsDateService {
  utcDay(value: Date): Date {
    if (Number.isNaN(value.getTime())) {
      throw new BadRequestException('Data analítica inválida');
    }

    return new Date(
      Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()),
    );
  }

  nextDay(value: Date): Date {
    return this.addDays(this.utcDay(value), 1);
  }

  addDays(value: Date, days: number): Date {
    return new Date(this.utcDay(value).getTime() + days * 86_400_000);
  }

  endOfDay(value: Date): Date {
    return new Date(this.nextDay(value).getTime() - 1);
  }

  parse(value?: string): Date {
    if (!value) {
      return this.utcDay(new Date());
    }

    const date = new Date(`${value}T00:00:00.000Z`);

    if (
      Number.isNaN(date.getTime()) ||
      date.toISOString().slice(0, 10) !== value
    ) {
      throw new BadRequestException('Data analítica inválida');
    }

    if (date > this.utcDay(new Date())) {
      throw new BadRequestException('Data analítica não pode estar no futuro');
    }

    return date;
  }
}
