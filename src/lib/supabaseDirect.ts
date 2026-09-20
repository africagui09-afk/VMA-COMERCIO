import { getSupabaseClient, notifyApiError, sanitizeStockMovementForSupabase } from './supabase';
import { Sale, Product, Expense, StockMovement } from '../types';

/**
 * Módulo de Disparo Direto e Assíncrono ao Supabase (Client-Side).
 * 
 * Executa as mutações em segundo plano para que o PostgreSQL emita imediatamente
 * os eventos de Realtime (CDC) para todos os outros aparelhos conectados (Tablet, Desktop, Telemóvel),
 * mantendo a UI do dispositivo atual reativa em 0 milissegundos (Optimistic Update).
 */

export async function directUpsertProduct(product: Product): Promise<boolean> {
  const client = getSupabaseClient();
  if (!client || (typeof navigator !== 'undefined' && !navigator.onLine)) return false;

  try {
    const payload = {
      id: String(product.id),
      name: product.name || 'Sem nome',
      barcode: product.barcode || '',
      category: product.category || 'Geral',
      price: Number(product.price) || 0,
      costPrice: Number(product.costPrice) || 0,
      stock: Number(product.stock) || 0,
      minStock: Number(product.minStock) || 5,
      unit: product.unit || 'un',
      imageUrl: product.imageUrl || null,
      updatedAt: product.updatedAt || new Date().toISOString(),
    };

    const { error } = await client.from('produtos').upsert(payload, { onConflict: 'id' });
    if (error) {
      console.warn('[DirectSupabase] Erro ao sincronizar produto:', error.message);
      notifyApiError('Erro ao atualizar produto no servidor', error.message);
      return false;
    }
    return true;
  } catch (err: any) {
    console.warn('[DirectSupabase] Exceção ao gravar produto:', err);
    notifyApiError('Exceção ao gravar produto', err?.message);
    return false;
  }
}

export async function directDeleteProduct(productId: string): Promise<boolean> {
  const client = getSupabaseClient();
  if (!client || (typeof navigator !== 'undefined' && !navigator.onLine)) return false;

  try {
    const { error } = await client.from('produtos').delete().eq('id', productId);
    if (error) {
      notifyApiError('Erro ao excluir produto no servidor', error.message);
      return false;
    }
    return true;
  } catch (err: any) {
    notifyApiError('Exceção ao excluir produto', err?.message);
    return false;
  }
}

export async function directUpsertSale(sale: Sale): Promise<boolean> {
  const client = getSupabaseClient();
  if (!client || (typeof navigator !== 'undefined' && !navigator.onLine)) return false;

  try {
    const sanitized = {
      id: String(sale.id),
      invoiceNumber: String(sale.invoiceNumber || ''),
      items: Array.isArray(sale.items) ? sale.items : [],
      subtotal: Number(sale.subtotal) || 0,
      discountTotal: Number(sale.discountTotal) || 0,
      total: Number(sale.total) || 0,
      totalCost: Number(sale.totalCost) || 0,
      payments: Array.isArray(sale.payments) ? sale.payments : [],
      amountReceived: sale.amountReceived !== undefined && sale.amountReceived !== null ? Number(sale.amountReceived) : null,
      change: Number(sale.change) || 0,
      sellerId: String(sale.sellerId || ''),
      sellerName: String(sale.sellerName || ''),
      sellerRole: String(sale.sellerRole || 'VENDEDOR'),
      customerName: sale.customerName || null,
      customerNif: sale.customerNif || null,
      notes: sale.notes || null,
      status: String(sale.status || 'CONCLUIDA'),
      cancelledAt: sale.cancelledAt || null,
      cancelledBy: sale.cancelledBy || null,
      cancellationReason: sale.cancellationReason || null,
      createdAt: sale.createdAt || new Date().toISOString(),
    };

    const { error } = await client.from('vendas').upsert(sanitized, { onConflict: 'id' });
    if (error) {
      console.warn('[DirectSupabase] Erro ao gravar venda no Supabase:', error.message);
      notifyApiError('Erro ao gravar venda no servidor', error.message);
      return false;
    }
    return true;
  } catch (err: any) {
    console.warn('[DirectSupabase] Exceção ao sincronizar venda:', err);
    notifyApiError('Exceção ao sincronizar venda', err?.message);
    return false;
  }
}

export async function directCancelSale(
  saleId: string,
  cancelledAt: string,
  cancelledBy: string,
  cancellationReason?: string
): Promise<boolean> {
  const client = getSupabaseClient();
  if (!client || (typeof navigator !== 'undefined' && !navigator.onLine)) return false;

  try {
    const { error } = await client
      .from('vendas')
      .update({
        status: 'CANCELADA',
        cancelledAt,
        cancelledBy,
        cancellationReason: cancellationReason || null,
      })
      .eq('id', saleId);
    if (error) {
      notifyApiError('Erro ao cancelar venda no servidor', error.message);
      return false;
    }
    return true;
  } catch (err: any) {
    notifyApiError('Exceção ao cancelar venda', err?.message);
    return false;
  }
}

export async function directUpsertExpense(expense: Expense): Promise<boolean> {
  const client = getSupabaseClient();
  if (!client || (typeof navigator !== 'undefined' && !navigator.onLine)) return false;

  try {
    const expData = {
      id: String(expense.id),
      description: expense.description || '',
      category: expense.category || 'Outros',
      amount: Number(expense.amount) || 0,
      date: expense.date || new Date().toISOString().split('T')[0],
      registeredBy: expense.registeredBy || 'Sistema',
      createdAt: expense.createdAt || new Date().toISOString(),
    };
    const { error } = await client.from('despesas').upsert(expData, { onConflict: 'id' });
    if (error) {
      notifyApiError('Erro ao gravar despesa no servidor', error.message);
      return false;
    }
    return true;
  } catch (err: any) {
    notifyApiError('Exceção ao sincronizar despesa', err?.message);
    return false;
  }
}

export async function directDeleteExpense(expenseId: string): Promise<boolean> {
  const client = getSupabaseClient();
  if (!client || (typeof navigator !== 'undefined' && !navigator.onLine)) return false;

  try {
    const { error } = await client.from('despesas').delete().eq('id', expenseId);
    if (error) {
      notifyApiError('Erro ao excluir despesa no servidor', error.message);
      return false;
    }
    return true;
  } catch (err: any) {
    notifyApiError('Exceção ao excluir despesa', err?.message);
    return false;
  }
}

export async function directUpsertStockMovement(mov: StockMovement | any): Promise<boolean> {
  const client = getSupabaseClient();
  if (!client || (typeof navigator !== 'undefined' && !navigator.onLine)) return false;

  try {
    const sanitized = sanitizeStockMovementForSupabase(mov);
    const { error } = await client.from('movimentacoes_estoque').upsert(sanitized, { onConflict: 'id' });
    if (error) {
      console.warn('[DirectSupabase] Erro ao gravar movimentação de estoque:', error.message);
      notifyApiError('Erro ao gravar movimentação de estoque no servidor', error.message);
      return false;
    }
    return true;
  } catch (err: any) {
    console.warn('[DirectSupabase] Exceção ao gravar movimentação de estoque:', err);
    notifyApiError('Exceção ao gravar movimentação de estoque', err?.message);
    return false;
  }
}
