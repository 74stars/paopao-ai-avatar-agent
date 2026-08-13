import type { DomainEventV1 } from "@paopao/contracts";

export interface Clock {
  now(): string;
}

export interface IdGenerator {
  next(): string;
}

export interface DomainEventPublisher {
  publish(event: DomainEventV1): void | Promise<void>;
}

export const systemClock: Clock = { now: () => new Date().toISOString() };
