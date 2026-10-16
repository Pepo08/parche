export declare class Pagos {
  crear(monto: number, moneda?: string): Promise<{ id: string }>;
  reembolsar(id: string): Promise<void>;
  /** Lista los pagos. */
  listar(): Promise<unknown[]>;
}
