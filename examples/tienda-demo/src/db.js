const pedidos = new Map();

export async function guardarPedido(pedido) {
  pedidos.set(pedido.pedidoId, pedido);
}

export async function marcarPagado(pedidoId) {
  const pedido = pedidos.get(pedidoId);
  if (pedido) pedido.pagado = true;
}
