/** Waiting for a durable dependency is not a failed delivery attempt. */
export class DeliveryPendingError extends Error {
  constructor(readonly dependencyId: string) {
    super(`Entrega pendente: ${dependencyId}`);
    this.name = 'DeliveryPendingError';
  }
}
