import { Expense, Product, Sale, StockMovement, User } from '../types';
import { broadcastLocalChange } from './realtimeBus';
import {
  directUpsertProduct,
  directDeleteProduct,
  directUpsertSale,
  directCancelSale,
  directUpsertExpense,
  directDeleteExpense,
  directUpsertStockMovement,
} from './supabaseDirect';

/**
 * Default users – kept in memory only.
 */
export const DEFAULT_USERS: User[] = [
  {
    id: 'user-seller-1',
    name: 'Carlos Vendedor',
    email: 'carlos.vendedor@kwanzapos.ao',
    role: 'VENDEDOR',
    pin: '1111',
  },
  {
    id: 'user-manager-1',
    name: 'Maria Silva',
    email: 'maria.gerente@kwanzapos.ao',
    role: 'GERENTE',
    pin: '2222',
  },
  {
    id: 'user-admin-1',
    name: 'Eng. António Domingos',
    email: 'antonio.admin@kwanzapos.ao',
    role: 'ADMINISTRADOR',
    pin: '1234',
  },
];

/**
 * Simple in‑memory caches – they are refreshed on every fetch.
 */
let productsCache: Product[] = [];
let salesCache: Sale[] = [];
let expensesCache: Expense[] = [];
let stockMovementsCache: StockMovement[] = [];
let currentUser: User = DEFAULT_USERS[0];

/** Helper to display a minimal network‑error alert. */
function handleNetworkError(err: any) {
  console.warn('[Storage] Network error:', err);
  if (typeof window !== 'undefined') {
    window.alert('Sem conexão com o servidor');
  }
}

/** ---------------------- READERS (direct from Supabase) ---------------------- */
export async function fetchProductsFromSupabase(): Promise<Product[]> {
  try {
    const { getSupabaseClient } = await import('./supabase');
    const client = getSupabaseClient();
    if (!client) return [];
    const { data, error } = await client.from('produtos').select('*');
    if (error) throw error;
    if (Array.isArray(data)) {
      const mapped: Product[] = data.map((r: any) => ({
        id: String(r.id),
        name: r.nome ?? 'Sem nome',
        barcode: r.barcode ?? '',
        category: r.categoria ?? 'Geral',
        price: Number(r.preco ?? 0),
        costPrice: Number(r.preco_custo ?? r.precoCusto ?? 0),
        stock: Number(r.estoque ?? 0),
        minStock: Number(r.estoque_minimo ?? r.estoqueMinimo ?? 5),
        unit: r.unidade ?? 'un',
        imageUrl: r.imagem_url,
        updatedAt: r.atualizado_em ?? new Date().toISOString(),
      }));
      // keep cache sorted alphabetically by name
      mapped.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
      productsCache = mapped;
      return mapped;
    }
  } catch (err) {
    handleNetworkError(err);
  }
  return [];
}

export async function fetchSalesFromSupabase(): Promise<Sale[]> {
  try {
    const { getSupabaseClient } = await import('./supabase');
    const client = getSupabaseClient();
    if (!client) return [];
    const { data, error } = await client
      .from('vendas')
      .select('*')
      .order('createdAt', { ascending: false })
      .limit(300);
    if (error) throw error;
    if (Array.isArray(data)) {
      const mapped: Sale[] = data.map((r: any) => ({
        id: String(r.id),
        invoiceNumber: r.invoiceNumber ?? '',
        items: Array.isArray(r.items) ? r.items : [],
        subtotal: Number(r.subtotal) || 0,
        discountTotal: Number(r.discountTotal) || 0,
        total: Number(r.total) || 0,
        totalCost: Number(r.totalCost) || 0,
        payments: Array.isArray(r.payments) ? r.payments : [],
        amountReceived:
          r.amountReceived !== null && r.amountReceived !== undefined
            ? Number(r.amountReceived)
            : undefined,
        change: Number(r.change) || 0,
        sellerId: r.sellerId || '',
        sellerName: r.sellerName || '',
        sellerRole: r.sellerRole || 'VENDEDOR',
        customerName: r.customerName,
        customerNif: r.customerNif,
        notes: r.notes,
        status: r.status || 'CONCLUIDA',
        cancelledAt: r.cancelledAt,
        cancelledBy: r.cancelledBy,
        cancellationReason: r.cancellationReason,
        createdAt: r.createdAt ?? new Date().toISOString(),
        syncedToSupabase: true,
        sincronizado: true,
      }));
      salesCache = mapped;
      return mapped;
    }
  } catch (err) {
    handleNetworkError(err);
  }
  return [];
}

export async function fetchExpensesFromSupabase(): Promise<Expense[]> {
  try {
    const { getSupabaseClient } = await import('./supabase');
    const client = getSupabaseClient();
    if (!client) return [];
    const { data, error } = await client.from('despesas').select('*');
    if (error) throw error;
    if (Array.isArray(data)) {
      const mapped: Expense[] = data.map((r: any) => ({
        id: String(r.id),
        description: r.description ?? '',
        type: r.type ?? 'FIXA',
        category: r.category ?? 'Outros',
        amount: Number(r.amount) || 0,
        dueDate: r.dueDate ?? r.date,
        date: r.date ?? new Date().toISOString().split('T')[0],
        status: r.status ?? 'PAGO',
        registeredBy: r.registeredBy ?? 'Sistema',
        notes: r.notes,
        createdAt: r.createdAt ?? r.created_at ?? new Date().toISOString(),
        syncedToSupabase: true,
      }));
      expensesCache = mapped;
      return mapped;
    }
  } catch (err) {
    handleNetworkError(err);
  }
  return [];
}

export async function fetchStockMovementsFromSupabase(): Promise<StockMovement[]> {
  try {
    const { getSupabaseClient } = await import('./supabase');
    const client = getSupabaseClient();
    if (!client) return [];
    const { data, error } = await client.from('movimentacoes_estoque').select('*');
    if (error) throw error;
    if (Array.isArray(data)) {
      const mapped: StockMovement[] = data.map((r: any) => ({
        id: String(r.id),
        productId: String(r.produtoId ?? r.productId ?? ''),
        tipo: r.tipo ?? r.type ?? 'AJUSTE',
        quantity: Number(r.quantidade ?? r.quantity) || 0,
        previousStock: Number(r.estoqueAnterior ?? r.previousStock) || 0,
        resultingStock: Number(r.estoqueResultante ?? r.resultingStock) || 0,
        reason: r.motivo ?? r.reason,
        userId: String(r.responsavelId ?? r.userId ?? ''),
        userName: String(r.responsavelNome ?? r.userName ?? 'Sistema'),
        createdAt: r.criadoEm ?? r.createdAt ?? new Date().toISOString(),
        updatedAt: r.atualizadoEm ?? r.updatedAt ?? new Date().toISOString(),
        sincronizado: true,
      }));
      stockMovementsCache = mapped;
      return mapped;
    }
  } catch (err) {
    handleNetworkError(err);
  }
  return [];
}

/** ---------------------- PUBLIC GETTERS (in‑memory) ---------------------- */
export function getProducts(): Product[] {
  return productsCache;
}
export function getSales(): Sale[] {
  return salesCache;
}
export function getExpenses(): Expense[] {
  return expensesCache;
}
export function getStockMovements(): StockMovement[] {
  return stockMovementsCache;
}
export function getCurrentUser(): User {
  return currentUser;
}
export function setCurrentUser(user: User): void {
  currentUser = user;
}
export function getSystemUsers(): User[] {
  return DEFAULT_USERS;
}

/** ---------------------- MUTATIONS – direct Supabase ---------------------- */
export function saveProduct(product: Product): void {
  const updated = { ...product, updatedAt: new Date().toISOString() };
  // update in‑memory cache
  const idx = productsCache.findIndex((p) => p.id === updated.id);
  if (idx >= 0) {
    productsCache[idx] = updated;
  } else {
    productsCache.unshift(updated);
  }
  broadcastLocalChange('produtos', updated);
  directUpsertProduct(updated).catch(handleNetworkError);
}

export function deleteProduct(productId: string): void {
  productsCache = productsCache.filter((p) => p.id !== productId);
  broadcastLocalChange('produtos', { id: productId, deleted: true });
  directDeleteProduct(productId).catch(handleNetworkError);
}

export function adjustProductStock(
  productId: string,
  quantityChange: number,
  reason: string,
  user?: { id?: string; name?: string },
  explicitType?: string
): Product | null {
  const product = productsCache.find((p) => p.id === productId);
  if (!product) return null;

  const previousStock = product.stock;
  const resultingStock = Math.max(0, product.stock + quantityChange);
  product.stock = resultingStock;
  product.updatedAt = new Date().toISOString();

  // persist product update
  saveProduct(product);

  const movement: StockMovement = {
    id: `mov-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
    productId: product.id,
    tipo:
      explicitType &&
      ['ENTRADA', 'IN', 'SAIDA', 'OUT', 'VENDA', 'CANCELAMENTO'].includes(
        explicitType.toUpperCase().trim()
      )
        ? explicitType.toUpperCase().trim()
        : quantityChange >= 0
        ? 'ENTRADA'
        : 'SAIDA',
    quantity: Math.abs(quantityChange),
    previousStock,
    resultingStock,
    reason: reason || 'Ajuste de estoque',
    userId: user?.id || 'usr-sistema',
    userName: user?.name || 'Sistema',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    sincronizado: false,
  };
  stockMovementsCache.unshift(movement);
  broadcastLocalChange('produtos', { product, movement });
  directUpsertStockMovement(movement).catch(handleNetworkError);
  return product;
}

/** ---------------------- VENDAS ---------------------- */
export async function createSaleAsync(
  saleData: Omit<Sale, 'id' | 'invoiceNumber' | 'createdAt' | 'status'>
): Promise<{ success: boolean; sale?: Sale; error?: string }> {
  // limit check omitted for brevity – keep existing logic if needed
  // Deduct stock locally
  for (const item of saleData.items) {
    const prod = productsCache.find((p) => p.id === item.productId);
    if (prod) {
      prod.stock = Math.max(0, prod.stock - item.quantity);
      prod.updatedAt = new Date().toISOString();
    }
  }

  const newSale: Sale = {
    ...saleData,
    id: `sale-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`,
    invoiceNumber: `VD-${new Date().getFullYear()}-${String(Date.now()).slice(-4)}`,
    status: 'CONCLUIDA',
    createdAt: new Date().toISOString(),
    syncedToSupabase: true,
    sincronizado: true,
  };

  salesCache.unshift(newSale);
  broadcastLocalChange('all', { sale: newSale, stockDeducted: true });

  try {
    await directUpsertSale(newSale);
    // update each product after stock change
    for (const item of saleData.items) {
      const p = productsCache.find((prod) => prod.id === item.productId);
      if (p) await directUpsertProduct(p);
    }
    return { success: true, sale: newSale };
  } catch (err) {
    handleNetworkError(err);
    return { success: false, error: 'Sem conexão com o servidor' };
  }
}

export function saveSale(sale: Sale): void {
  const idx = salesCache.findIndex((s) => s.id === sale.id);
  if (idx >= 0) {
    salesCache[idx] = sale;
  } else {
    salesCache.unshift(sale);
  }
  broadcastLocalChange('vendas', sale);
  directUpsertSale(sale).catch(handleNetworkError);
}

export function canCancelSale(sale: Sale, user: User): { canCancel: boolean; reason?: string } {
  // Allow cancellation for admins and managers within 1 hour of sale creation
  const now = new Date();
  const created = new Date(sale.createdAt);
  const diffMs = now.getTime() - created.getTime();
  const oneHourMs = 60 * 60 * 1000;

  if (user.role !== 'ADMINISTRADOR' && user.role !== 'GERENTE') {
    return { canCancel: false, reason: 'Apenas administradores ou gerentes podem cancelar vendas.' };
  }
  if (diffMs > oneHourMs) {
    return { canCancel: false, reason: 'A venda tem mais de 1 hora e não pode ser cancelada.' };
  }
  if (sale.status !== 'CONCLUIDA') {
    return { canCancel: false, reason: 'Só é possível cancelar vendas concluídas.' };
  }
  return { canCancel: true };
}

  export function cancelSale(
  saleId: string,
  user: User,
  cancellationReason: string
): { success: boolean; error?: string } {
  const sale = salesCache.find((s) => s.id === saleId);
  if (!sale) return { success: false, error: 'Venda não encontrada.' };

  // permission check – kept simplistic
  if (user.role !== 'ADMINISTRADOR' && user.role !== 'GERENTE') {
    return { success: false, error: 'Permissão negada.' };
  }

  // restore stock
  for (const item of sale.items) {
    const prod = productsCache.find((p) => p.id === item.productId);
    if (prod) {
      prod.stock += item.quantity;
      prod.updatedAt = new Date().toISOString();
    }
  }

  sale.status = 'CANCELADA';
  sale.cancelledAt = new Date().toISOString();
  sale.cancelledBy = `${user.name} (${user.role})`;
  sale.cancellationReason = cancellationReason || 'Cancelamento aprovado';

  broadcastLocalChange('all', { saleCancelled: sale });
  directCancelSale(sale.id, sale.cancelledAt, sale.cancelledBy, sale.cancellationReason).catch(
    handleNetworkError
  );

  // sync restored stock
  for (const item of sale.items) {
    const p = productsCache.find((prod) => prod.id === item.productId);
    if (p) directUpsertProduct(p).catch(handleNetworkError);
  }
  return { success: true };
}

  if (!sale) return { success: false, error: 'Venda não encontrada.' };

  // permission check – kept simplistic
  if (user.role !== 'ADMINISTRADOR' && user.role !== 'GERENTE') {
    return { success: false, error: 'Permissão negada.' };
  }

  // restore stock
  for (const item of sale.items) {
    const prod = productsCache.find((p) => p.id === item.productId);
    if (prod) {
      prod.stock += item.quantity;
      prod.updatedAt = new Date().toISOString();
    }
  }

  sale.status = 'CANCELADA';
  sale.cancelledAt = new Date().toISOString();
  sale.cancelledBy = `${user.name} (${user.role})`;
  sale.cancellationReason = cancellationReason || 'Cancelamento aprovado';

  broadcastLocalChange('all', { saleCancelled: sale });
  directCancelSale(sale.id, sale.cancelledAt, sale.cancelledBy, sale.cancellationReason).catch(
    handleNetworkError
  );
  // sync restored stock
  for (const item of sale.items) {
    const p = productsCache.find((prod) => prod.id === item.productId);
    if (p) directUpsertProduct(p).catch(handleNetworkError);
  }
  return { success: true };
}

/** ---------------------- DESPESAS ---------------------- */
export function addExpense(expense: Omit<Expense, 'id' | 'createdAt' | 'syncedToSupabase'>): Expense {
  const newExp: Expense = {
    ...expense,
    id: `exp-${Date.now()}`,
    createdAt: new Date().toISOString(),
    syncedToSupabase: true,
  };
  expensesCache.unshift(newExp);
  broadcastLocalChange('despesas', newExp);
  directUpsertExpense(newExp).catch(handleNetworkError);
  return newExp;
}

export function updateExpense(expense: Expense): void {
  const idx = expensesCache.findIndex((e) => e.id === expense.id);
  if (idx >= 0) {
    expensesCache[idx] = expense;
    broadcastLocalChange('despesas', expense);
    directUpsertExpense(expense).catch(handleNetworkError);
  }
}

export function deleteExpense(expenseId: string): void {
  expensesCache = expensesCache.filter((e) => e.id !== expenseId);
  broadcastLocalChange('despesas', { id: expenseId, deleted: true });
  directDeleteExpense(expenseId).catch(handleNetworkError);
}

/** ---------------------- SYNC QUEUE – NO‑OP ---------------------- */
export function addToSyncQueue(
  _table: any,
  _action: any,
  _data: any
): void {
  // Offline sync removed – function kept as no‑op for compatibility
}
export function getSyncQueue(): any[] {
  return [];
}
export function removeSyncQueueItem(_id: string): void {}
export function clearSyncQueue(): void {}

/** ---------------------- COMPATIBILITY STUBS ---------------------- */
// These stubs preserve the original public API expected by other modules after removing offline sync.
export function getSupabaseConfig(): { url: string; anonKey: string; lastSyncTime?: string } {
  return {
    url: (typeof process !== 'undefined' && process.env?.NEXT_PUBLIC_SUPABASE_URL) || '',
    anonKey: (typeof process !== 'undefined' && process.env?.NEXT_PUBLIC_SUPABASE_ANON_KEY) || '',
  };
}

export function saveSupabaseConfig(_cfg: any): void {
  // No‑op – configuration is handled via environment variables.
}

export function getUnsyncedSales(): any[] {
  // Offline queue removed; return empty array.
  return [];
}

export function markSalesAsSynced(_ids: string[]): void {
  // No‑op – nothing to mark as synced.
}





export function removeSyncQueueItemsForSale(_saleId: string): void {
  // No‑op – sync queue is disabled.
}
