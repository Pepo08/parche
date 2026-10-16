// Cambios a propósito: crear pide moneda e idempotencia; reembolsar recibe un número; listar queda deprecado.
export declare class Pagos {
  crear(monto: number, moneda: string, idempotencia: string): Promise<{ id: string }>;
  reembolsar(id: number): Promise<void>;
  /** @deprecated Usá buscar(). */
  listar(): Promise<unknown[]>;
  buscar(filtro?: string): Promise<unknown[]>;
}
