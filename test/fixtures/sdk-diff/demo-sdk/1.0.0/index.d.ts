// SDK de ejemplo para los tests del diff (versión 1). No es un paquete real.
import { Pagos } from './resources/pagos';

export interface Opciones {
  apiKey: string;
}

export declare class Cliente {
  constructor(opts: Opciones);
  pagos: Pagos;
  clientes: {
    crear(email: string): Promise<{ id: string }>;
    borrar(id: string): Promise<void>;
  };
  ping(): Promise<boolean>;
  private secreto: string;
}

export declare function crearCliente(opts: Opciones): Cliente;

export declare class Legado {
  enviar(texto: string): void;
}

export default Cliente;
