// SDK de ejemplo para los tests del diff (versión 2). No es un paquete real.
// Cambios a propósito: clientes.borrar desaparece, Legado desaparece, ping suma un parámetro opcional.
import { Pagos } from './resources/pagos';

export interface Opciones {
  apiKey: string;
}

export declare class Cliente {
  constructor(opts: Opciones);
  pagos: Pagos;
  clientes: {
    crear(email: string): Promise<{ id: string }>;
  };
  ping(timeoutMs?: number): Promise<boolean>;
  private secreto: string;
}

export declare function crearCliente(opts: Opciones): Cliente;

export default Cliente;
