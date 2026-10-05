import { Expense, Product, Sale, StockMovement, StockMovementType, SyncQueueItem, User } from '../types';
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

export const SELLER_DAILY_LIMIT = 900000; // 900.000 Kz

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

// Sem dados fictícios - fonte da verdade direta no Supabase
export const KEYS = {
  PRODUCTS: 'kwanzapos_products_v1',
  SALES: 'kwanzapos_sales_v1',
  EXPENSES: 'kwanzapos_expenses_v1',
  CURRENT_USER: 'kwanzapos_current_user_v1',
  SYNC_QUEUE: 'kwanzapos_sync_queue_v1',
  INVOICE_SEQ: 'kwanzapos_invoice_sequence_v1',
  SUPABASE_CONFIG: 'kwanzapos_supabase_config_v1',
  STOCK_MOVEMENTS: 'kwanzapos_stock_movements_v1',
};

// Acesso seguro ao localStorage (Cache em Memória Local)
export function getFromStorage<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

export function setToStorage<T>(key: string, value: T): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (err) {
    console.error(`Erro ao guardar no storage [${key}]:`, err);
  }
}

// Inicializa armazenamento local sem injetar registros falsos
export function initStorage(forceClean: boolean = false): void {
  if (forceClean) {
    setToStorage(KEYS.PRODUCTS, []);
    setToStorage(KEYS.SALES, []);
    setToStorage(KEYS.EXPENSES, []);
    setToStorage(KEYS.STOCK_MOVEMENTS, []);
    setToStorage(KEYS.CURRENT_USER, DEFAULT_USERS[0]);
    setToStorage(KEYS.INVOICE_SEQ, 1);
    return;
  }

  const existingUser = getFromStorage<User | null>(KEYS.CURRENT_USER, null);
  if (!existingUser || !existingUser.id || !existingUser.role) {
    setToStorage(KEYS.CURRENT_USER, DEFAULT_USERS[0]);
  }

  if (!localStorage.getItem(KEYS.INVOICE_SEQ)) {
    setToStorage(KEYS.INVOICE_SEQ, 1);
  }
}

export function resetStorageToDefault(): void {
  initStorage(true);
}

// User state
export function getCurrentUser(): User {
  const user = getFromStorage<User>(KEYS.CURRENT_USER, DEFAULT_USERS[0]);
  if (!user || !user.id || !user.role) {
    setToStorage(KEYS.CURRENT_USER, DEFAULT_USERS[0]);
    return DEFAULT_USERS[0];
  }
  return user;
}

export function setCurrentUser(user: User): void {
  setToStorage(KEYS.CURRENT_USER, user);
}

export function getSystemUsers(): User[] {
  return DEFAULT_USERS;
}

// ─── LEITURAS DIRETAS DA NUVEM (SUPABASE) ───────────────────────────────────

/**
 * Busca a lista completa de produtos diretamente do Supabase e atualiza o cache local.
 */
export async function fetchProductsFromSupabase(): Promise<Product[]> {
  try {
    const { getSupabaseClient } = await import('./supabase');
    const client = getSupabaseClient();
    if (!client) {
      return getFromStorage<Product[]>(KEYS.PRODUCTS, []);
    }
    const { data, error } = await client.from('produtos').select('*').order('name', { ascending: true });
    if (error) {
      console.warn('[Supabase Direct] Erro ao buscar produtos:', error.message);
      return getFromStorage<Product[]>(KEYS.PRODUCTS, []);
    }
    if (Array.isArray(data)) {
      const mapped: Product[] = data.map((r: any) => ({
        id: String(r.id),
        name: r.name || 'Sem nome',
        barcode: r.barcode || '',
        category: r.category || 'Geral',
        price: Number(r.price) || 0,
        costPrice: Number(r.costPrice) || 0,
        stock: Number(r.stock) || 0,
        minStock: Number(r.minStock) || 5,
        unit: r.unit || 'un',
        imageUrl: r.imageUrl || undefined,
        updatedAt: r.updatedAt || new Date().toISOString(),
      }));
      setToStorage(KEYS.PRODUCTS, mapped);
      return mapped;
    }
  } catch (err) {
    console.warn('[Supabase Direct] Exceção ao buscar produtos:', err);
  }
  return getFromStorage<Product[]>(KEYS.PRODUCTS, []);
}

/**
 * Busca a lista de vendas diretamente do Supabase e atualiza o cache local.
 */
export async function fetchSalesFromSupabase(): Promise<Sale[]> {
  try {
    const { getSupabaseClient } = await import('./supabase');
    const client = getSupabaseClient();
    if (!client) {
      return getFromStorage<Sale[]>(KEYS.SALES, []);
    }
    const { data, error } = await client
      .from('vendas')
      .select('*')
      .order('createdAt', { ascending: false })
      .limit(300);
    if (error) {
      console.warn('[Supabase Direct] Erro ao buscar vendas:', error.message);
      return getFromStorage<Sale[]>(KEYS.SALES, []);
    }
    if (Array.isArray(data)) {
      const mapped: Sale[] = data.map((r: any) => ({
        id: String(r.id),
        invoiceNumber: r.invoiceNumber || '',
        items: Array.isArray(r.items) ? r.items : [],
        subtotal: Number(r.subtotal) || 0,
        discountTotal: Number(r.discountTotal) || 0,
        total: Number(r.total) || 0,
        totalCost: Number(r.totalCost) || 0,
        payments: Array.isArray(r.payments) ? r.payments : [],
        amountReceived: r.amountReceived !== null && r.amountReceived !== undefined ? Number(r.amountReceived) : undefined,
        change: Number(r.change) || 0,
        sellerId: r.sellerId || '',
        sellerName: r.sellerName || '',
        sellerRole: r.sellerRole || 'VENDEDOR',
        customerName: r.customerName || undefined,
        customerNif: r.customerNif || undefined,
        notes: r.notes || undefined,
        status: r.status || 'CONCLUIDA',
        cancelledAt: r.cancelledAt || undefined,
        cancelledBy: r.cancelledBy || undefined,
        cancellationReason: r.cancellationReason || undefined,
        createdAt: r.createdAt || new Date().toISOString(),
        syncedToSupabase: true,
        sincronizado: true,
      }));
      setToStorage(KEYS.SALES, mapped);
      return mapped;
    }
  } catch (err) {
    console.warn('[Supabase Direct] Exceção ao buscar vendas:', err);
  }
  return getFromStorage<Sale[]>(KEYS.SALES, []);
}

/**
 * Busca a lista de despesas diretamente do Supabase e atualiza o cache local.
 */
export async function fetchExpensesFromSupabase(): Promise<Expense[]> {
  try {
    const { getSupabaseClient } = await import('./supabase');
    const client = getSupabaseClient();
    if (!client) {
      return getFromStorage<Expense[]>(KEYS.EXPENSES, []);
    }
    const { data, error } = await client
      .from('despesas')
      .select('*')
      .order('createdAt', { ascending: false })
      .limit(300);
    if (error) {
      console.warn('[Supabase Direct] Erro ao buscar despesas:', error.message);
      return getFromStorage<Expense[]>(KEYS.EXPENSES, []);
    }
    if (Array.isArray(data)) {
      const mapped: Expense[] = data.map((r: any) => ({
        id: String(r.id),
        description: r.description || '',
        type: r.type || 'FIXA',
        category: r.category || 'Outros',
        amount: Number(r.amount) || 0,
        dueDate: r.dueDate || r.date,
        date: r.date || new Date().toISOString().split('T')[0],
        status: r.status || 'PAGO',
        registeredBy: r.registeredBy || 'Sistema',
        notes: r.notes || undefined,
        createdAt: r.createdAt || r.created_at || new Date().toISOString(),
        syncedToSupabase: true,
      }));
      setToStorage(KEYS.EXPENSES, mapped);
      return mapped;
    }
  } catch (err) {
    console.warn('[Supabase Direct] Exceção ao buscar despesas:', err);
  }
  return getFromStorage<Expense[]>(KEYS.EXPENSES, []);
}

/**
 * Busca movimentações de estoque diretamente do Supabase e atualiza o cache local.
 */
export async function fetchStockMovementsFromSupabase(): Promise<StockMovement[]> {
  try {
    const { getSupabaseClient } = await import('./supabase');
    const client = getSupabaseClient();
    if (!client) {
      return getFromStorage<StockMovement[]>(KEYS.STOCK_MOVEMENTS, []);
    }
    const { data, error } = await client
      .from('movimentacoes_estoque')
      .select('*')
      .order('createdAt', { ascending: false })
      .limit(300);
    if (error) {
      console.warn('[Supabase Direct] Erro ao buscar movimentações:', error.message);
      return getFromStorage<StockMovement[]>(KEYS.STOCK_MOVEMENTS, []);
    }
    if (Array.isArray(data)) {
      const mapped: StockMovement[] = data.map((r: any) => ({
        id: String(r.id),
        productId: String(r.productId || r.produtoId || ''),
        tipo: r.type || r.tipo || 'AJUSTE',
        quantity: Number(r.quantity || r.quantidade) || 0,
        previousStock: Number(r.previousStock || r.estoqueAnterior) || 0,
        resultingStock: Number(r.resultingStock || r.estoqueResultante) || 0,
        reason: r.reason || r.motivo,
        userId: String(r.userId || r.responsavelId || ''),
        userName: String(r.userName || r.responsavelNome || 'Sistema'),
        createdAt: r.createdAt || r.criadoEm || new Date().toISOString(),
        updatedAt: r.updatedAt || r.atualizadoEm || new Date().toISOString(),
        sincronizado: true,
      }));
      setToStorage(KEYS.STOCK_MOVEMENTS, mapped);
      return mapped;
    }
  } catch (err) {
    console.warn('[Supabase Direct] Exceção ao buscar movimentações:', err);
  }
  return getFromStorage<StockMovement[]>(KEYS.STOCK_MOVEMENTS, []);
}

// ─── PRODUTOS (ESTOQUE) ─────────────────────────────────────────────────────

export function getProducts(): Product[] {
  const prods = getFromStorage<Product[]>(KEYS.PRODUCTS, []);
  if (!Array.isArray(prods)) {
    return [];
  }
  return prods;
}

export function saveProduct(product: Product): void {
  const products = getProducts();
  const index = products.findIndex((p) => p.id === product.id);
  const nowStr = new Date().toISOString();
  const updatedProduct = { ...product, updatedAt: nowStr };

  if (index >= 0) {
    products[index] = updatedProduct;
    addToSyncQueue('produtos', 'UPDATE', updatedProduct);
  } else {
    products.unshift(updatedProduct);
    addToSyncQueue('produtos', 'INSERT', updatedProduct);
  }
  setToStorage(KEYS.PRODUCTS, products);
  broadcastLocalChange('produtos', updatedProduct);

  // Disparo direto e imediato para a API do Supabase
  directUpsertProduct(updatedProduct).catch((err) =>
    console.warn('[DirectSupabase] Falha ao enviar produto:', err)
  );
}

export function deleteProduct(productId: string): void {
  const products = getProducts();
  const filtered = products.filter((p) => p.id !== productId);
  setToStorage(KEYS.PRODUCTS, filtered);
  addToSyncQueue('produtos', 'DELETE', { id: productId });
  broadcastLocalChange('produtos', { id: productId, deleted: true });

  // Disparo direto e imediato para a API do Supabase
  directDeleteProduct(productId).catch((err) =>
    console.warn('[DirectSupabase] Falha ao excluir produto:', err)
  );
}

// Stock Movements (Histórico de Movimentações de Estoque)
export function getStockMovements(): StockMovement[] {
  return getFromStorage<StockMovement[]>(KEYS.STOCK_MOVEMENTS, []);
}

export function saveStockMovementLocal(mov: StockMovement): void {
  const list = getStockMovements();
  list.unshift(mov);
  setToStorage(KEYS.STOCK_MOVEMENTS, list);
}

export function adjustProductStock(
  productId: string,
  quantityChange: number,
  reason: string,
  user?: { id?: string; name?: string },
  explicitType?: StockMovementType | string
): Product | null {
  const products = getProducts();
  const p = products.find((item) => item.id === productId);
  if (!p) return null;

  const previousStock = p.stock;
  const resultingStock = Math.max(0, p.stock + quantityChange);
  const nowStr = new Date().toISOString();

  let tipo: StockMovementType = 'AJUSTE';
  if (explicitType) {
    const norm = String(explicitType).toUpperCase().trim();
    if (norm === 'IN' || norm === 'ENTRADA') tipo = 'ENTRADA';
    else if (norm === 'OUT' || norm === 'SAIDA' || norm === 'SAÍDA') tipo = 'SAIDA';
    else if (norm === 'VENDA') tipo = 'VENDA';
    else if (norm === 'CANCELAMENTO') tipo = 'CANCELAMENTO';
    else tipo = 'AJUSTE';
  } else {
    tipo = quantityChange >= 0 ? 'ENTRADA' : 'SAIDA';
  }

  p.stock = resultingStock;
  p.updatedAt = nowStr;
  saveProduct(p);

  const movement: StockMovement = {
    id: `mov-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
    productId: p.id,
    productName: p.name,
    tipo,
    quantity: Math.abs(quantityChange),
    previousStock,
    resultingStock,
    reason: reason || (tipo === 'ENTRADA' ? 'Entrada manual de estoque' : 'Saída manual de estoque'),
    userId: user?.id || 'usr-sistema',
    userName: user?.name || 'Sistema',
    createdAt: nowStr,
    updatedAt: nowStr,
    sincronizado: false,
  };

  saveStockMovementLocal(movement);
  addToSyncQueue('movimentacoes_estoque', 'INSERT', movement);
  broadcastLocalChange('produtos', { product: p, movement });

  // Disparo direto e imediato para a tabela movimentacoes_estoque no Supabase
  directUpsertStockMovement(movement).catch((err) =>
    console.warn('[DirectSupabase] Falha ao enviar movimentação de estoque:', err)
  );

  return p;
}

// ─── VENDAS (SALES) ─────────────────────────────────────────────────────────

export function getSales(): Sale[] {
  return getFromStorage<Sale[]>(KEYS.SALES, []);
}

// Total de vendas do vendedor hoje
export function getSellerDailyTotal(sellerId: string, dateStr?: string): number {
  const targetDate = dateStr || new Date().toISOString().split('T')[0];
  const sales = getSales();
  return sales
    .filter((s) => s.status === 'CONCLUIDA' && s.sellerId === sellerId && s.createdAt.startsWith(targetDate))
    .reduce((sum, s) => sum + s.total, 0);
}

// Verifica limite diário do vendedor (900.000 Kz)
export function checkSellerLimit(
  sellerId: string,
  sellerRole: string,
  newSaleTotal: number
): { allowed: boolean; currentTotal: number; limit: number; remaining: number; error?: string } {
  if (sellerRole !== 'VENDEDOR') {
    return { allowed: true, currentTotal: 0, limit: SELLER_DAILY_LIMIT, remaining: SELLER_DAILY_LIMIT };
  }

  const currentTotal = getSellerDailyTotal(sellerId);
  const projectedTotal = currentTotal + newSaleTotal;
  const remaining = Math.max(0, SELLER_DAILY_LIMIT - currentTotal);

  if (projectedTotal > SELLER_DAILY_LIMIT) {
    return {
      allowed: false,
      currentTotal,
      limit: SELLER_DAILY_LIMIT,
      remaining,
      error: `Limite diário de 900.000 Kz excedido! Vendas hoje: ${currentTotal.toLocaleString('pt-AO')} Kz. Saldo restante: ${remaining.toLocaleString('pt-AO')} Kz. Esta venda é de ${newSaleTotal.toLocaleString('pt-AO')} Kz.`,
    };
  }

  return { allowed: true, currentTotal, limit: SELLER_DAILY_LIMIT, remaining };
}

// Gera número sequencial de fatura seguro contra colisão
function getNextInvoiceNumber(): string {
  const year = new Date().getFullYear();
  let seq = getFromStorage<number>(KEYS.INVOICE_SEQ, 1);
  const sales = getSales();
  const existingInvoices = new Set(sales.map((s) => s.invoiceNumber));

  let candidate = `VD-${year}-${String(seq).padStart(4, '0')}`;
  while (existingInvoices.has(candidate)) {
    seq++;
    candidate = `VD-${year}-${String(seq).padStart(4, '0')}`;
  }

  setToStorage(KEYS.INVOICE_SEQ, seq + 1);
  return candidate;
}

/**
 * Cria uma venda com persistência direta e imediata na nuvem (Supabase)
 */
export async function createSaleAsync(
  saleData: Omit<Sale, 'id' | 'invoiceNumber' | 'createdAt' | 'status'>,
): Promise<{ success: boolean; sale?: Sale; error?: string }> {
  const limitCheck = checkSellerLimit(saleData.sellerId, saleData.sellerRole, saleData.total);
  if (!limitCheck.allowed) {
    return { success: false, error: limitCheck.error };
  }

  const products = getProducts();

  // Dedução e validação do estoque
  for (const item of saleData.items) {
    const prod = products.find((p) => p.id === item.productId);
    if (prod) {
      prod.stock = Math.max(0, prod.stock - item.quantity);
      prod.updatedAt = new Date().toISOString();
    }
  }
  setToStorage(KEYS.PRODUCTS, products);

  const newSale: Sale = {
    ...saleData,
    id: `sale-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`,
    invoiceNumber: getNextInvoiceNumber(),
    status: 'CONCLUIDA',
    createdAt: new Date().toISOString(),
    syncedToSupabase: true,
    sincronizado: true,
  };

  const sales = getSales();
  sales.unshift(newSale);
  setToStorage(KEYS.SALES, sales);

  addToSyncQueue('vendas', 'INSERT', newSale);
  broadcastLocalChange('all', { sale: newSale, stockDeducted: true });

  // Disparo direto e imediato para a API do Supabase (Venda + Estoque Atualizado de cada produto)
  try {
    await directUpsertSale(newSale);
    for (const item of saleData.items) {
      const p = products.find((prod) => prod.id === item.productId);
      if (p) {
        await directUpsertProduct(p);
      }
    }
  } catch (err) {
    console.warn('[DirectSupabase] Erro ao sincronizar venda/estoque diretamente:', err);
  }

  return { success: true, sale: newSale };
}

export function createSale(saleData: Omit<Sale, 'id' | 'invoiceNumber' | 'createdAt' | 'status'>): {
  success: boolean;
  sale?: Sale;
  error?: string;
} {
  const limitCheck = checkSellerLimit(saleData.sellerId, saleData.sellerRole, saleData.total);
  if (!limitCheck.allowed) {
    return { success: false, error: limitCheck.error };
  }

  const products = getProducts();

  // Dedução de estoque
  for (const item of saleData.items) {
    const prod = products.find((p) => p.id === item.productId);
    if (prod) {
      prod.stock = Math.max(0, prod.stock - item.quantity);
      prod.updatedAt = new Date().toISOString();
    }
  }
  setToStorage(KEYS.PRODUCTS, products);

  const newSale: Sale = {
    ...saleData,
    id: `sale-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`,
    invoiceNumber: getNextInvoiceNumber(),
    status: 'CONCLUIDA',
    createdAt: new Date().toISOString(),
    syncedToSupabase: true,
    sincronizado: true,
  };

  const sales = getSales();
  sales.unshift(newSale);
  setToStorage(KEYS.SALES, sales);

  addToSyncQueue('vendas', 'INSERT', newSale);
  broadcastLocalChange('all', { sale: newSale, stockDeducted: true });

  // Disparo assíncrono imediato para a nuvem
  directUpsertSale(newSale).catch((err) =>
    console.warn('[DirectSupabase] Falha ao enviar venda:', err),
  );
  for (const item of saleData.items) {
    const p = products.find((prod) => prod.id === item.productId);
    if (p) {
      directUpsertProduct(p).catch((err) =>
        console.warn('[DirectSupabase] Falha ao sincronizar baixa de estoque:', err),
      );
    }
  }

  return { success: true, sale: newSale };
}

export function saveSale(sale: Sale): void {
  const sales = getSales();
  const index = sales.findIndex((s) => s.id === sale.id);
  if (index >= 0) {
    sales[index] = sale;
    addToSyncQueue('vendas', 'UPDATE', sale);
  } else {
    sales.unshift(sale);
    addToSyncQueue('vendas', 'INSERT', sale);
  }
  setToStorage(KEYS.SALES, sales);
  broadcastLocalChange('vendas', sale);
  directUpsertSale(sale).catch((err) =>
    console.warn('[DirectSupabase] Falha ao atualizar venda:', err)
  );
}

// Verificação de permissões para cancelamento
export function canCancelSale(
  sale: Sale,
  user: User
): { canCancel: boolean; reason?: string } {
  if (sale.status === 'CANCELADA') {
    return { canCancel: false, reason: 'Esta venda já foi cancelada anteriormente.' };
  }

  if (user.role === 'ADMINISTRADOR' || user.role === 'GERENTE') {
    const saleTime = new Date(sale.createdAt).getTime();
    const nowTime = Date.now();
    const diffInMinutes = (nowTime - saleTime) / (1000 * 60);

    if (diffInMinutes <= 60) {
      return { canCancel: true };
    } else {
      const minutesPassed = Math.round(diffInMinutes);
      return {
        canCancel: false,
        reason: `Cancelamento não autorizado: Tanto Administradores quanto Gerentes só podem cancelar vendas efetuadas em até 1 hora (60 minutos) da emissão. Esta venda ocorreu há ${minutesPassed} minutos.`,
      };
    }
  }

  return {
    canCancel: false,
    reason: 'Vendedores não têm permissão para cancelar vendas. Solicite a um Gerente ou Administrador.',
  };
}

// Cancelamento de venda com restauração de estoque
export function cancelSale(
  saleId: string,
  user: User,
  cancellationReason: string
): { success: boolean; error?: string } {
  const sales = getSales();
  const sale = sales.find((s) => s.id === saleId);
  if (!sale) return { success: false, error: 'Venda não encontrada.' };

  const check = canCancelSale(sale, user);
  if (!check.canCancel) {
    return { success: false, error: check.reason };
  }

  // Restaura estoque
  const products = getProducts();
  for (const item of sale.items) {
    const prod = products.find((p) => p.id === item.productId);
    if (prod) {
      prod.stock += item.quantity;
      prod.updatedAt = new Date().toISOString();
    }
  }
  setToStorage(KEYS.PRODUCTS, products);

  // Atualiza estado da venda
  sale.status = 'CANCELADA';
  sale.cancelledAt = new Date().toISOString();
  sale.cancelledBy = `${user.name} (${user.role})`;
  sale.cancellationReason = cancellationReason || 'Cancelamento aprovado';
  sale.syncedToSupabase = true;
  sale.sincronizado = true;

  setToStorage(KEYS.SALES, sales);
  addToSyncQueue('cancelamentos', 'UPDATE', {
    id: sale.id,
    status: 'CANCELADA',
    cancelledAt: sale.cancelledAt,
    cancelledBy: sale.cancelledBy,
    cancellationReason: sale.cancellationReason,
  });

  broadcastLocalChange('all', { saleCancelled: sale });

  // Disparo direto e imediato para a nuvem
  directCancelSale(sale.id, sale.cancelledAt, sale.cancelledBy, sale.cancellationReason).catch(
    (err) => console.warn('[DirectSupabase] Falha ao cancelar venda no Supabase:', err)
  );
  for (const item of sale.items) {
    const p = products.find((prod) => prod.id === item.productId);
    if (p) {
      directUpsertProduct(p).catch((err) =>
        console.warn('[DirectSupabase] Falha ao sincronizar retorno de estoque:', err)
      );
    }
  }

  return { success: true };
}

// ─── DESPESAS & PERDAS ──────────────────────────────────────────────────────

export function getExpenses(): Expense[] {
  return getFromStorage<Expense[]>(KEYS.EXPENSES, []);
}

export function addExpense(expense: Omit<Expense, 'id' | 'createdAt' | 'syncedToSupabase'>): Expense {
  const newExp: Expense = {
    ...expense,
    id: `exp-${Date.now()}`,
    createdAt: new Date().toISOString(),
    syncedToSupabase: true,
  };
  const list = getExpenses();
  list.unshift(newExp);
  setToStorage(KEYS.EXPENSES, list);
  addToSyncQueue('despesas', 'INSERT', newExp);
  broadcastLocalChange('despesas', newExp);

  // Disparo direto e imediato para a nuvem
  directUpsertExpense(newExp).catch((err) =>
    console.warn('[DirectSupabase] Falha ao enviar despesa:', err)
  );
  return newExp;
}

export function updateExpense(expense: Expense): void {
  const list = getExpenses();
  const index = list.findIndex((e) => e.id === expense.id);
  if (index >= 0) {
    list[index] = expense;
    setToStorage(KEYS.EXPENSES, list);
    addToSyncQueue('despesas', 'UPDATE', expense);
    broadcastLocalChange('despesas', expense);

    directUpsertExpense(expense).catch((err) =>
      console.warn('[DirectSupabase] Falha ao atualizar despesa:', err)
    );
  }
}

export function deleteExpense(expenseId: string): void {
  const list = getExpenses();
  const filtered = list.filter((e) => e.id !== expenseId);
  setToStorage(KEYS.EXPENSES, filtered);
  addToSyncQueue('despesas', 'DELETE', { id: expenseId });
  broadcastLocalChange('despesas', { id: expenseId, deleted: true });

  directDeleteExpense(expenseId).catch((err) =>
    console.warn('[DirectSupabase] Falha ao excluir despesa:', err)
  );
}

// ─── FILA DE SINCRONIZAÇÃO ──────────────────────────────────────────────────

export function getSyncQueue(): SyncQueueItem[] {
  return getFromStorage<SyncQueueItem[]>(KEYS.SYNC_QUEUE, []);
}

export function addToSyncQueue(
  table: 'vendas' | 'produtos' | 'despesas' | 'cancelamentos' | 'movimentacoes_estoque',
  action: 'INSERT' | 'UPDATE' | 'DELETE',
  data: any
): void {
  const queue = getSyncQueue();
  queue.push({
    id: `sync-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
    table: table as any,
    action,
    data,
    createdAt: new Date().toISOString(),
    attempts: 0,
  });
  setToStorage(KEYS.SYNC_QUEUE, queue);
}

export function removeSyncQueueItem(id: string): void {
  const queue = getSyncQueue();
  const filtered = queue.filter((item) => item.id !== id);
  setToStorage(KEYS.SYNC_QUEUE, filtered);
}

export function removeSyncQueueItemsForSale(saleId: string): void {
  const queue = getSyncQueue();
  const filtered = queue.filter(
    (item) => !(item.table === 'vendas' && (item.data?.id === saleId || item.data === saleId))
  );
  if (filtered.length !== queue.length) {
    setToStorage(KEYS.SYNC_QUEUE, filtered);
  }
}

export function clearSyncQueue(): void {
  setToStorage(KEYS.SYNC_QUEUE, []);
}

export function getUnsyncedSales(): Sale[] {
  const sales = getSales();
  return sales.filter(
    (s) => s.syncedToSupabase === false || s.sincronizado === false || (!s.syncedToSupabase && !s.sincronizado)
  );
}

export function markSalesAsSynced(saleIds: string[]): void {
  if (!saleIds || saleIds.length === 0) return;
  const sales = getSales();
  let changed = false;
  for (const s of sales) {
    if (saleIds.includes(s.id)) {
      s.syncedToSupabase = true;
      s.sincronizado = true;
      changed = true;
    }
  }
  if (changed) {
    setToStorage(KEYS.SALES, sales);
  }
}

// Supabase Connection Settings
export interface SupabaseConfig {
  url: string;
  anonKey: string;
  autoSync: boolean;
  lastSyncTime?: string;
}

export function getSupabaseConfig(): SupabaseConfig {
  const envUrl = ((import.meta as any).env?.VITE_SUPABASE_URL || '').trim();
  const envKey = ((import.meta as any).env?.VITE_SUPABASE_ANON_KEY || '').trim();
  const saved = getFromStorage<SupabaseConfig>(KEYS.SUPABASE_CONFIG, {
    url: envUrl,
    anonKey: envKey,
    autoSync: true,
  });
  return {
    ...saved,
    url: saved.url || envUrl,
    anonKey: saved.anonKey || envKey,
    autoSync: saved.autoSync !== undefined ? saved.autoSync : true,
  };
}

export function saveSupabaseConfig(config: SupabaseConfig): void {
  setToStorage(KEYS.SUPABASE_CONFIG, config);
}
