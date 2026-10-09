import { getSupabaseClient } from './supabase';
import { Product, Sale, Expense, StockMovement, StockMovementType } from '../types';

// ============================================================
// CACHE LOCAL EM MEMÓRIA (modo 100% online — sem localStorage)
// ============================================================
let _produtos: Product[] = [];
let _vendas: Sale[] = [];
let _despesas: Expense[] = [];
let _movimentacoes: StockMovement[] = [];

// ============================================================
// INICIALIZAÇÃO
// ============================================================
export function initStorage(): void {
  // Modo 100% online: sem cache local persistente.
  // Os dados vêm sempre do Supabase.
}

// ============================================================
// PRODUTOS
// ============================================================

/** Mapeia uma linha do Supabase (100% português) para Product */
function mapRowToProduto(r: any): Product {
  return {
    id: String(r.id),
    nome: r.nome || r.name || 'Sem nome',
    barcode: r.barcode || '',
    categoria: r.categoria || r.category || 'Geral',
    preco_custo: Number(r.preco_custo ?? r.costPrice ?? r.price ?? 0),
    preco_venda: Number(r.preco_venda ?? r.price ?? 0),
    quantidade: Number(r.quantidade ?? r.stock ?? r.estoque ?? 0),
    estoque_minimo: Number(r.estoque_minimo ?? r.minStock ?? r.estoque_min ?? 5),
    atualizado_em: r.atualizado_em || r.updatedAt || new Date().toISOString(),
    unit: r.unit || 'un',
    imageUrl: r.imageUrl || r.imagem_url || undefined,
  };
}

/** Retorna produtos do cache local em memória */
export function getProducts(): Product[] {
  return [..._produtos];
}

/** Persiste produto no Supabase e actualiza cache local */
export async function saveProduct(produto: Product): Promise<void> {
  const payload = {
    id: produto.id,
    nome: produto.nome || 'Sem nome',
    barcode: produto.barcode || '',
    categoria: produto.categoria || 'Geral',
    preco_custo: Number(produto.preco_custo) || 0,
    preco_venda: Number(produto.preco_venda) || 0,
    quantidade: Number(produto.quantidade) || 0,
    estoque_minimo: Number(produto.estoque_minimo) || 5,
    atualizado_em: produto.atualizado_em || new Date().toISOString(),
  };

  const client = getSupabaseClient();
  if (client) {
    const { error } = await client.from('produtos').upsert(payload, { onConflict: 'id' });
    if (error) {
      console.warn('[storage] Erro ao gravar produto no Supabase:', error.message);
      throw error;
    }
  }

  // Actualiza cache em memória
  const idx = _produtos.findIndex((p) => p.id === produto.id);
  if (idx >= 0) {
    _produtos[idx] = produto;
  } else {
    _produtos.push(produto);
  }
}

/** Remove produto do Supabase e do cache */
export async function deleteProduct(id: string): Promise<void> {
  const client = getSupabaseClient();
  if (client) {
    const { error } = await client.from('produtos').delete().eq('id', id);
    if (error) {
      console.warn('[storage] Erro ao eliminar produto:', error.message);
      throw error;
    }
  }
  _produtos = _produtos.filter((p) => p.id !== id);
}

/** Ajusta o estoque de um produto e regista movimentação */
export async function adjustProductStock(
  productId: string,
  delta: number,
  motivo: string,
  operador: { id: string; name: string },
  tipo: StockMovementType = 'AJUSTE'
): Promise<void> {
  const produto = _produtos.find((p) => p.id === productId);
  if (!produto) return;

  const novaQtd = Math.max(0, produto.quantidade + delta);
  await saveProduct({ ...produto, quantidade: novaQtd, atualizado_em: new Date().toISOString() });

  // Registo de movimentação
  await logMovimentacao({
    id: `mov-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    produto_id: productId,
    tipo,
    quantidade: Math.abs(delta),
    motivo: motivo || 'Ajuste de estoque',
    criado_em: new Date().toISOString(),
  });
}

// ============================================================
// MOVIMENTAÇÕES DE ESTOQUE
// ============================================================

async function logMovimentacao(mov: StockMovement): Promise<void> {
  const payload = {
    id: mov.id,
    produto_id: mov.produto_id,
    tipo: mov.tipo,
    quantidade: mov.quantidade,
    motivo: mov.motivo || 'Ajuste de estoque',
    criado_em: mov.criado_em || new Date().toISOString(),
  };

  const client = getSupabaseClient();
  if (client) {
    const { error } = await client.from('movimentacoes_estoque').insert(payload);
    if (error) {
      console.warn('[storage] Erro ao registar movimentação:', error.message);
    }
  }
  _movimentacoes.unshift(mov);
}

// ============================================================
// VENDAS
// ============================================================

/** Mapeia uma linha do Supabase (português) para Sale */
function mapRowToVenda(r: any): Sale {
  return {
    id: String(r.id),
    numero_fatura: r.numero_fatura || r.invoiceNumber || '',
    itens: Array.isArray(r.itens) ? r.itens : (Array.isArray(r.items) ? r.items : []),
    subtotal: Number(r.subtotal) || 0,
    desconto_total: Number(r.desconto_total ?? r.discountTotal ?? 0),
    total: Number(r.total) || 0,
    custo_total: Number(r.custo_total ?? r.totalCost ?? 0),
    pagamentos: Array.isArray(r.pagamentos) ? r.pagamentos : (Array.isArray(r.payments) ? r.payments : []),
    valor_recebido: r.valor_recebido ?? r.amountReceived ?? null,
    troco: Number(r.troco ?? r.change ?? 0),
    operador_id: r.operador_id || r.sellerId || '',
    operador_nome: r.operador_nome || r.sellerName || '',
    operador_cargo: r.operador_cargo || r.sellerRole || 'VENDEDOR',
    nome_cliente: r.nome_cliente || r.customerName || null,
    nif_cliente: r.nif_cliente || r.customerNif || null,
    observacoes: r.observacoes || r.notes || null,
    status: r.status || 'CONCLUIDA',
    cancelado_em: r.cancelado_em || r.cancelledAt || null,
    cancelado_por: r.cancelado_por || r.cancelledBy || null,
    motivo_cancelamento: r.motivo_cancelamento || r.cancellationReason || null,
    criado_em: r.criado_em || r.createdAt || new Date().toISOString(),
  };
}

/** Retorna vendas do cache em memória */
export function getSales(): Sale[] {
  return [..._vendas];
}

/** Constrói e grava uma venda (síncrono para App.tsx) */
export function createSale(payload: any): { success: boolean; sale?: Sale; error?: string } {
  try {
    const id = `vda-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const count = _vendas.length + 1;
    const numero_fatura = `VD-${new Date().getFullYear()}-${String(count).padStart(4, '0')}`;

    const venda: Sale = {
      id,
      numero_fatura,
      itens: payload.items || [],
      subtotal: Number(payload.subtotal) || 0,
      desconto_total: Number(payload.discountTotal) || 0,
      total: Number(payload.total) || 0,
      custo_total: Number(payload.totalCost) || 0,
      pagamentos: payload.payments || [{ method: 'DINHEIRO', amount: payload.total }],
      valor_recebido: payload.amountReceived ?? payload.total,
      troco: Number(payload.change) || 0,
      operador_id: payload.sellerId || '',
      operador_nome: payload.sellerName || '',
      operador_cargo: payload.sellerRole || 'VENDEDOR',
      nome_cliente: payload.customerName || 'Consumidor Final',
      nif_cliente: payload.customerNif || null,
      observacoes: payload.notes || null,
      status: 'CONCLUIDA',
      criado_em: new Date().toISOString(),
    };

    _vendas.unshift(venda);

    // Ajusta estoque dos produtos vendidos
    for (const item of venda.itens) {
      const prod = _produtos.find((p) => p.id === item.productId);
      if (prod) {
        const novaQtd = Math.max(0, prod.quantidade - item.quantity);
        _produtos = _produtos.map((p) =>
          p.id === prod.id ? { ...p, quantidade: novaQtd, atualizado_em: new Date().toISOString() } : p
        );
        // Persiste alteração de estoque em segundo plano
        saveProduct({ ...prod, quantidade: novaQtd, atualizado_em: new Date().toISOString() }).catch(console.warn);
      }
    }

    // Persiste venda no Supabase em segundo plano
    saveSaleToSupabase(venda).catch(console.warn);

    return { success: true, sale: venda };
  } catch (err: any) {
    return { success: false, error: err?.message || 'Erro ao criar venda' };
  }
}

/** Alias async de createSale */
export async function createSaleAsync(payload: any): Promise<{ success: boolean; sale?: Sale; error?: string }> {
  return createSale(payload);
}

/** Persiste venda no Supabase (campos em português) */
async function saveSaleToSupabase(venda: Sale): Promise<void> {
  const client = getSupabaseClient();
  if (!client) return;

  const payload = {
    id: venda.id,
    numero_fatura: venda.numero_fatura,
    itens: venda.itens,
    subtotal: venda.subtotal,
    total: venda.total,
    operador_id: venda.operador_id,
    operador_nome: venda.operador_nome,
    criado_em: venda.criado_em,
  };

  const { error } = await client.from('vendas').upsert(payload, { onConflict: 'id' });
  if (error) {
    console.warn('[storage] Erro ao gravar venda no Supabase:', error.message);
  }
}

/** Alias para compatibilidade */
export async function saveSale(venda: any): Promise<void> {
  return saveSaleToSupabase(venda);
}

// ============================================================
// DESPESAS
// ============================================================

export function getExpenses(): Expense[] {
  return [..._despesas];
}

// ============================================================
// FETCH DO SUPABASE (CARGA INICIAL E REFRESH)
// ============================================================

export async function fetchProductsFromSupabase(): Promise<Product[] | null> {
  const client = getSupabaseClient();
  if (!client) return null;

  try {
    const { data, error } = await client
      .from('produtos')
      .select('*')
      .order('nome', { ascending: true });

    if (error) {
      console.warn('[storage] Erro ao carregar produtos:', error.message);
      return null;
    }

    if (Array.isArray(data)) {
      _produtos = data.map(mapRowToProduto);
      return [..._produtos];
    }
    return null;
  } catch (err) {
    console.warn('[storage] Exceção ao carregar produtos:', err);
    return null;
  }
}

export async function fetchSalesFromSupabase(): Promise<Sale[] | null> {
  const client = getSupabaseClient();
  if (!client) return null;

  try {
    const { data, error } = await client
      .from('vendas')
      .select('*')
      .order('criado_em', { ascending: false })
      .limit(500);

    if (error) {
      console.warn('[storage] Erro ao carregar vendas:', error.message);
      return null;
    }

    if (Array.isArray(data)) {
      _vendas = data.map(mapRowToVenda);
      return [..._vendas];
    }
    return null;
  } catch (err) {
    console.warn('[storage] Exceção ao carregar vendas:', err);
    return null;
  }
}

export async function fetchExpensesFromSupabase(): Promise<Expense[] | null> {
  const client = getSupabaseClient();
  if (!client) return null;

  try {
    const { data, error } = await client
      .from('despesas')
      .select('*')
      .order('date', { ascending: false });

    if (error) {
      console.warn('[storage] Erro ao carregar despesas:', error.message);
      return null;
    }

    if (Array.isArray(data)) {
      _despesas = data as Expense[];
      return [..._despesas];
    }
    return null;
  } catch (err) {
    console.warn('[storage] Exceção ao carregar despesas:', err);
    return null;
  }
}

// ============================================================
// LEGACY STUBS (mantidos para compatibilidade com supabase.ts)
// ============================================================
export function getSupabaseConfig(): any {
  return { url: '', anonKey: '' };
}
export function getSyncQueue(): any[] {
  return [];
}
export function getUnsyncedSales(): any[] {
  return [];
}
export function markSalesAsSynced(_ids: string[]): void { /* no-op */ }
export function removeSyncQueueItem(_id: string): void { /* no-op */ }
export function removeSyncQueueItemsForSale(_saleId: string): void { /* no-op */ }
export function saveSupabaseConfig(_config: any): void { /* no-op */ }

// ============================================================
// OBJECTO storage (API compatível com código antigo)
// ============================================================
export const storage = {
  produtos: {
    getAll: fetchProductsFromSupabase,
    save: saveProduct,
    delete: deleteProduct,
  },
  vendas: {
    getAll: fetchSalesFromSupabase,
    save: saveSaleToSupabase,
  },
  movimentacoes: {
    async getAll() {
      const client = getSupabaseClient();
      if (!client) return [];
      const { data } = await client
        .from('movimentacoes_estoque')
        .select('*')
        .order('criado_em', { ascending: false });
      return data || [];
    },
    log: logMovimentacao,
  },
  despesas: {
    getAll: fetchExpensesFromSupabase,
    async save(despesa: any) {
      const client = getSupabaseClient();
      if (!client) return null;
      const { data, error } = await client.from('despesas').insert(despesa).select();
      if (error) throw error;
      return data?.[0];
    },
  },
};
