import { Injectable } from '@nestjs/common';
import { OutboxEventHandler } from './event-bus.interfaces';

@Injectable()
export class EventHandlerRegistry {
  private readonly handlers = new Map<string, OutboxEventHandler>();

  register(eventType: string, handler: OutboxEventHandler): void {
    if (this.handlers.has(eventType)) {
      throw new Error(`Handler duplicado para o evento ${eventType}`);
    }

    this.handlers.set(eventType, handler);
  }

  get(eventType: string): OutboxEventHandler | undefined {
    return this.handlers.get(eventType);
  }
}
