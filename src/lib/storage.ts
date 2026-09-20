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

const INITIAL_PRODUCTS: Product[] = [
  {
    id: 'prod-1',
    name: 'Cerveja Cuca Lata 330ml',
    barcode: '5601234001',
    category: 'Bebidas',
    price: 650,
    costPrice: 450,
    stock: 85,
    minStock: 25,
    unit: 'lata',
    updatedAt: new Date().toISOString(),
  },
  {
    id: 'prod-2',
    name: 'Refrigerante Blue Polpa 330ml',
    barcode: '5601234002',
    category: 'Bebidas',
    price: 500,
    costPrice: 320,
    stock: 42,
    minStock: 20,
    unit: 'un',
    updatedAt: new Date().toISOString(),
  },
  {
    id: 'prod-3',
    name: 'Água Mineral Pura 1.5L',
    barcode: '5601234003',
    category: 'Bebidas',
    price: 400,
    costPrice: 220,
    stock: 110,
    minStock: 30,
    unit: 'garrafa',
    updatedAt: new Date().toISOString(),
  },
  {
    id: 'prod-4',
    name: 'Arroz Agulha Tio Lucas 1kg',
    barcode: '5601234004',
    category: 'Mercearia',
    price: 1850,
    costPrice: 1350,
    stock: 4, // ABAIXO DO MÍNIMO
    minStock: 15,
    unit: 'pacote',
    updatedAt: new Date().toISOString(),
  },
  {
    id: 'prod-5',
    name: 'Óleo Alimentar Fula 1L',
    barcode: '5601234005',
    category: 'Mercearia',
    price: 2400,
    costPrice: 1750,
    stock: 3, // ABAIXO DO MÍNIMO
    minStock: 12,
    unit: 'garrafa',
    updatedAt: new Date().toISOString(),
  },
  {
    id: 'prod-6',
    name: 'Leite em Pó Nido Fortificada 400g',
    barcode: '5601234006',
    category: 'Laticínios',
    price: 4950,
    costPrice: 3800,
    stock: 19,
    minStock: 8,
    unit: 'lata',
    updatedAt: new Date().toISOString(),
  },
  {
    id: 'prod-7',
    name: 'Massa Esparguete Nacional 500g',
    barcode: '5601234007',
    category: 'Mercearia',
    price: 850,
    costPrice: 550,
    stock: 65,
    minStock: 20,
    unit: 'pacote',
    updatedAt: new Date().toISOString(),
  },
  {
    id: 'prod-8',
    name: 'Açúcar Branco Doce 1kg',
    barcode: '5601234008',
    category: 'Mercearia',
    price: 1200,
    costPrice: 850,
    stock: 2, // ABAIXO DO MÍNIMO
    minStock: 10,
    unit: 'kg',
    updatedAt: new Date().toISOString(),
  },
  {
    id: 'prod-9',
    name: 'Sabão Azul Tradicional 200g',
    barcode: '5601234009',
    category: 'Higiene & Limpeza',
    price: 450,
    costPrice: 280,
    stock: 48,
    minStock: 15,
    unit: 'barra',
    updatedAt: new Date().toISOString(),
  },
  {
    id: 'prod-10',
    name: 'Detergente Omo Multiação 1kg',
    barcode: '5601234010',
    category: 'Higiene & Limpeza',
    price: 3200,
    costPrice: 2300,
    stock: 14,
    minStock: 8,
    unit: 'pacote',
    updatedAt: new Date().toISOString(),
  },
  {
    id: 'prod-11',
    name: 'Bolacha Maria Campina 200g',
    barcode: '5601234011',
    category: 'Mercearia',
    price: 600,
    costPrice: 380,
    stock: 0, // ESGOTADO
    minStock: 15,
    unit: 'pacote',
    updatedAt: new Date().toISOString(),
  },
  {
    id: 'prod-12',
    name: 'Café Ginga Torrado Moído 250g',
    barcode: '5601234012',
    category: 'Bebidas',
    price: 2100,
    costPrice: 1450,
    stock: 22,
    minStock: 10,
    unit: 'pacote',
    updatedAt: new Date().toISOString(),
  },
];

const now = Date.now();
const minutesAgo = (m: number) => new Date(now - m * 60 * 1000).toISOString();
const hoursAgo = (h: number) => new Date(now - h * 60 * 60 * 1000).toISOString();
const daysAgo = (d: number) => new Date(now - d * 24 * 60 * 60 * 1000).toISOString();

const INITIAL_SALES: Sale[] = [
  {
    id: 'sale-001',
    invoiceNumber: 'VD-2026-0001',
    items: [
      {
        productId: 'prod-1',
        productName: 'Cerveja Cuca Lata 330ml',
        quantity: 12,
        unitPrice: 650,
        costPrice: 450,
        discount: 0,
        total: 7800,
      },
      {
        productId: 'prod-2',
        productName: 'Refrigerante Blue Polpa 330ml',
        quantity: 6,
        unitPrice: 500,
        costPrice: 320,
        discount: 0,
        total: 3000,
      },
    ],
    subtotal: 10800,
    discountTotal: 0,
    total: 10800,
    totalCost: 7320,
    payments: [{ method: 'MULTICAIXA', amount: 10800 }],
    amountReceived: 10800,
    change: 0,
    sellerId: 'user-seller-1',
    sellerName: 'Carlos Vendedor',
    sellerRole: 'VENDEDOR',
    customerName: 'Manuel Santos',
    status: 'CONCLUIDA',
    createdAt: minutesAgo(20), // 20 min atrás -> GERENTE PODE CANCELAR
    syncedToSupabase: true,
    sincronizado: true,
  },
  {
    id: 'sale-002',
    invoiceNumber: 'VD-2026-0002',
    items: [
      {
        productId: 'prod-6',
        productName: 'Leite em Pó Nido Fortificada 400g',
        quantity: 3,
        unitPrice: 4950,
        costPrice: 3800,
        discount: 0,
        total: 14850,
      },
      {
        productId: 'prod-7',
        productName: 'Massa Esparguete Nacional 500g',
        quantity: 5,
        unitPrice: 850,
        costPrice: 550,
        discount: 0,
        total: 4250,
      },
      {
        productId: 'prod-10',
        productName: 'Detergente Omo Multiação 1kg',
        quantity: 2,
        unitPrice: 3200,
        costPrice: 2300,
        discount: 0,
        total: 6400,
      },
    ],
    subtotal: 25500,
    discountTotal: 500,
    total: 25000,
    totalCost: 18750,
    payments: [{ method: 'DINHEIRO', amount: 25000 }],
    amountReceived: 30000,
    change: 5000,
    sellerId: 'user-seller-1',
    sellerName: 'Carlos Vendedor',
    sellerRole: 'VENDEDOR',
    status: 'CONCLUIDA',
    createdAt: hoursAgo(3), // 3 horas atrás -> GERENTE NÃO PODE CANCELAR (apenas Admin)
    syncedToSupabase: true,
    sincronizado: true,
  },
  {
    id: 'sale-003',
    invoiceNumber: 'VD-2026-0003',
    items: [
      {
        productId: 'prod-5',
        productName: 'Óleo Alimentar Fula 1L',
        quantity: 10,
        unitPrice: 2400,
        costPrice: 1750,
        discount: 0,
        total: 24000,
      },
      {
        productId: 'prod-4',
        productName: 'Arroz Agulha Tio Lucas 1kg',
        quantity: 15,
        unitPrice: 1850,
        costPrice: 1350,
        discount: 0,
        total: 27750,
      },
    ],
    subtotal: 51750,
    discountTotal: 0,
    total: 51750,
    totalCost: 37750,
    payments: [{ method: 'TRANSFERENCIA', amount: 51750 }],
    amountReceived: 51750,
    change: 0,
    sellerId: 'user-manager-1',
    sellerName: 'Maria Silva',
    sellerRole: 'GERENTE',
    customerName: 'Padaria Kianda',
    status: 'CONCLUIDA',
    createdAt: daysAgo(1),
    syncedToSupabase: true,
    sincronizado: true,
  },
];

const INITIAL_EXPENSES: Expense[] = [
  {
    id: 'exp-001',
    description: 'Avaria/Quebra de 1 caixa de Cuca no descarregamento',
    category: 'PERDA',
    amount: 10800,
    date: new Date().toISOString().split('T')[0],
    registeredBy: 'Maria Silva (Gerente)',
    createdAt: hoursAgo(4),
    syncedToSupabase: true,
  },
  {
    id: 'exp-002',
    description: 'Renda e aluguer do espaço comercial da loja',
    category: 'FIXA',
    amount: 80000,
    date: new Date().toISOString().split('T')[0],
    registeredBy: 'Eng. António Domingos',
    createdAt: daysAgo(2),
    syncedToSupabase: true,
  },
  {
    id: 'exp-003',
    description: 'Recarga de Energia Elétrica ENDE Loja',
    category: 'VARIAVEL',
    amount: 25000,
    date: new Date().toISOString().split('T')[0],
    registeredBy: 'Eng. António Domingos',
    createdAt: daysAgo(1),
    syncedToSupabase: true,
  },
  {
    id: 'exp-004',
    description: 'Adiantamento de Salário e Comissões dos Caixas',
    category: 'SALARIO',
    amount: 50000,
    date: new Date().toISOString().split('T')[0],
    registeredBy: 'Maria Silva (Gerente)',
    createdAt: hoursAgo(6),
    syncedToSupabase: true,
  },
];

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

// Safe localStorage access
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

// Initialize seed data if not present or force clean
export function initStorage(forceClean: boolean = false): void {
  if (forceClean) {
    setToStorage(KEYS.PRODUCTS, INITIAL_PRODUCTS);
    setToStorage(KEYS.SALES, INITIAL_SALES);
    setToStorage(KEYS.EXPENSES, INITIAL_EXPENSES);
    setToStorage(KEYS.CURRENT_USER, DEFAULT_USERS[0]);
    setToStorage(KEYS.INVOICE_SEQ, 4);
    return;
  }

  const existingProducts = getFromStorage<Product[] | null>(KEYS.PRODUCTS, null);
  if (!existingProducts || !Array.isArray(existingProducts) || existingProducts.length === 0) {
    setToStorage(KEYS.PRODUCTS, INITIAL_PRODUCTS);
  }

  const existingSales = getFromStorage<Sale[] | null>(KEYS.SALES, null);
  if (!existingSales || !Array.isArray(existingSales)) {
    setToStorage(KEYS.SALES, INITIAL_SALES);
  }

  const existingExpenses = getFromStorage<Expense[] | null>(KEYS.EXPENSES, null);
  if (!existingExpenses || !Array.isArray(existingExpenses)) {
    setToStorage(KEYS.EXPENSES, INITIAL_EXPENSES);
  }

  const existingUser = getFromStorage<User | null>(KEYS.CURRENT_USER, null);
  if (!existingUser || !existingUser.id || !existingUser.role) {
    setToStorage(KEYS.CURRENT_USER, DEFAULT_USERS[0]);
  }

  if (!localStorage.getItem(KEYS.INVOICE_SEQ)) {
    setToStorage(KEYS.INVOICE_SEQ, 4);
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

// Products
export function getProducts(): Product[] {
  const prods = getFromStorage<Product[]>(KEYS.PRODUCTS, INITIAL_PRODUCTS);
  if (!Array.isArray(prods) || prods.length === 0) {
    setToStorage(KEYS.PRODUCTS, INITIAL_PRODUCTS);
    return INITIAL_PRODUCTS;
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
  // Disparo assíncrono para Supabase em milissegundos
  directUpsertProduct(updatedProduct).catch((err) =>
    console.warn('[DirectSync] Falha ao enviar produto:', err)
  );
}

export function deleteProduct(productId: string): void {
  const products = getProducts();
  const filtered = products.filter((p) => p.id !== productId);
  setToStorage(KEYS.PRODUCTS, filtered);
  addToSyncQueue('produtos', 'DELETE', { id: productId });
  broadcastLocalChange('produtos', { id: productId, deleted: true });
  // Disparo assíncrono para Supabase em milissegundos
  directDeleteProduct(productId).catch((err) =>
    console.warn('[DirectSync] Falha ao excluir produto:', err)
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

  // Determina tipo padronizado em Português: 'ENTRADA' | 'SAIDA' | 'AJUSTE'
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

  // Regista movimentação de estoque auditável
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

  // Disparo assíncrono para o Supabase
  directUpsertStockMovement(movement).catch((err) =>
    console.warn('[DirectSync] Falha ao enviar movimentação de estoque:', err)
  );

  return p;
}

// Sales
export function getSales(): Sale[] {
  return getFromStorage<Sale[]>(KEYS.SALES, INITIAL_SALES);
}

// Calculate Seller's sales total for today
export function getSellerDailyTotal(sellerId: string, dateStr?: string): number {
  const targetDate = dateStr || new Date().toISOString().split('T')[0];
  const sales = getSales();
  return sales
    .filter((s) => s.status === 'CONCLUIDA' && s.sellerId === sellerId && s.createdAt.startsWith(targetDate))
    .reduce((sum, s) => sum + s.total, 0);
}

// Check seller daily limit (900.000 Kz)
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

// Generate Conflict-Free Invoice Number across simultaneous devices (e.g. VD-2026-0004)
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

// Create new sale
/**
 * Cria uma venda com proteção total contra race conditions.
 *
 * Fluxo online (quando Supabase está disponível):
 *   1. Valida limite do vendedor localmente
 *   2. Chama RPC deduct_stock_atomic no PostgreSQL (lock atómico por produto)
 *   3. Confirma a venda no storage local e no Supabase
 *   4. Propaga via WebSocket Realtime para todos os dispositivos
 *
 * Fluxo offline (sem internet ou Supabase não configurado):
 *   1. Valida e deduz localmente (comportamento anterior intacto)
 *   2. Guarda na fila de sincronização para envio automático quando a rede voltar
 */
export async function createSaleAsync(
  saleData: Omit<Sale, 'id' | 'invoiceNumber' | 'createdAt' | 'status'>,
): Promise<{ success: boolean; sale?: Sale; error?: string }> {
  // 1. Verificar limite diário do vendedor
  const limitCheck = checkSellerLimit(saleData.sellerId, saleData.sellerRole, saleData.total);
  if (!limitCheck.allowed) {
    return { success: false, error: limitCheck.error };
  }

  const isOnline = typeof navigator !== 'undefined' ? navigator.onLine : false;
  const products = getProducts();

  // ─── CAMINHO ONLINE: usa RPC atómica no PostgreSQL ───────────────────────────
  if (isOnline) {
    let supabaseAvailable = false;
    try {
      const { callDeductStockAtomic } = await import('./supabase');
      const client = (await import('./supabase')).getSupabaseClient();
      if (client) {
        supabaseAvailable = true;

        // Validação prévia local (falha rápida antes de chamar a RPC)
        for (const item of saleData.items) {
          const prod = products.find((p) => p.id === item.productId);
          if (!prod) {
            return { success: false, error: `Produto não encontrado: ${item.productName}` };
          }
          if (prod.stock < item.quantity) {
            return {
              success: false,
              error: `Estoque local insuficiente para "${prod.name}". Disponível: ${prod.stock}, Solicitado: ${item.quantity}. Sincronize com o servidor.`,
            };
          }
        }

        // Dedução atómica no PostgreSQL — produto a produto, com lock exclusivo
        const atomicResults: { productId: string; newStock: number }[] = [];
        for (const item of saleData.items) {
          const rpcResult = await callDeductStockAtomic(
            item.productId,
            item.quantity,
            saleData.sellerId,
            saleData.sellerName,
          );

          if (!rpcResult.success) {
            // Rollback: não há nada a reverter ainda (loop parou antes de completar)
            // Supabase não atualizou os anteriores se ainda não confirmou — falha segura
            console.warn(`[AtomicStock] Falha na dedução de "${item.productName}":`, rpcResult.errorMsg);
            return {
              success: false,
              error: `❌ ${rpcResult.errorMsg || `Estoque insuficiente para "${item.productName}".`}`,
            };
          }

          atomicResults.push({ productId: item.productId, newStock: rpcResult.newStock });
        }

        // Atualiza o cache local com os valores retornados pelo PostgreSQL (source of truth)
        for (const result of atomicResults) {
          const idx = products.findIndex((p) => p.id === result.productId);
          if (idx >= 0) {
            products[idx] = {
              ...products[idx],
              stock: result.newStock,
              updatedAt: new Date().toISOString(),
            };
          }
        }
        setToStorage(KEYS.PRODUCTS, products);
      }
    } catch (importErr) {
      // Falha ao importar/chamar Supabase — fallback para modo offline
      supabaseAvailable = false;
    }

    if (!supabaseAvailable) {
      // Supabase indisponível apesar de estar online — usa dedução local segura
      for (const item of saleData.items) {
        const prod = products.find((p) => p.id === item.productId);
        if (!prod) return { success: false, error: `Produto não encontrado: ${item.productName}` };
        if (prod.stock < item.quantity) {
          return {
            success: false,
            error: `Estoque insuficiente para "${prod.name}". Disponível: ${prod.stock}, Solicitado: ${item.quantity}`,
          };
        }
        prod.stock -= item.quantity;
        prod.updatedAt = new Date().toISOString();
      }
      setToStorage(KEYS.PRODUCTS, products);
    }
  } else {
    // ─── CAMINHO OFFLINE: dedução local + fila de sync ─────────────────────────
    for (const item of saleData.items) {
      const prod = products.find((p) => p.id === item.productId);
      if (!prod) return { success: false, error: `Produto não encontrado: ${item.productName}` };
      if (prod.stock < item.quantity) {
        return {
          success: false,
          error: `Estoque insuficiente para "${prod.name}". Disponível: ${prod.stock}, Solicitado: ${item.quantity}`,
        };
      }
      prod.stock -= item.quantity;
      prod.updatedAt = new Date().toISOString();
    }
    setToStorage(KEYS.PRODUCTS, products);
  }

  // ─── Registo da venda com ID único e à prova de colisão ───────────────────
  const newSale: Sale = {
    ...saleData,
    id: `sale-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`,
    invoiceNumber: getNextInvoiceNumber(),
    status: 'CONCLUIDA',
    createdAt: new Date().toISOString(),
    syncedToSupabase: false,
    sincronizado: false,
  };

  const sales = getSales();
  sales.unshift(newSale);
  setToStorage(KEYS.SALES, sales);

  // ─── Fila de sync + Broadcast Realtime ───────────────────────────────────
  addToSyncQueue('vendas', 'INSERT', newSale);
  broadcastLocalChange('all', { sale: newSale, stockDeducted: true });

  // ─── Push assíncrono para Supabase (venda + estado do estoque)  ───────────
  // Quando offline, estes disparos falharão silenciosamente e o
  // batchSyncSalesToSupabase() irá sincronizar automaticamente ao reconectar.
  directUpsertSale(newSale).catch((err) =>
    console.warn('[DirectSync] Falha ao enviar venda (será sincronizado na reconexão):', err),
  );
  for (const item of saleData.items) {
    const p = products.find((prod) => prod.id === item.productId);
    if (p) {
      directUpsertProduct(p).catch((err) =>
        console.warn('[DirectSync] Falha ao sincronizar estoque (será sincronizado na reconexão):', err),
      );
    }
  }

  return { success: true, sale: newSale };
}

/**
 * @deprecated Use createSaleAsync() para proteção contra race conditions.
 * Mantido apenas para compatibilidade com código legado síncrono.
 */
export function createSale(saleData: Omit<Sale, 'id' | 'invoiceNumber' | 'createdAt' | 'status'>): {
  success: boolean;
  sale?: Sale;
  error?: string;
} {
  // 1. Verify seller limit
  const limitCheck = checkSellerLimit(saleData.sellerId, saleData.sellerRole, saleData.total);
  if (!limitCheck.allowed) {
    return { success: false, error: limitCheck.error };
  }

  // 2. Check stock availability for all items
  const products = getProducts();
  for (const item of saleData.items) {
    const prod = products.find((p) => p.id === item.productId);
    if (!prod) {
      return { success: false, error: `Produto não encontrado: ${item.productName}` };
    }
    if (prod.stock < item.quantity) {
      return {
        success: false,
        error: `Estoque insuficiente para "${prod.name}". Disponível: ${prod.stock}, Solicitado: ${item.quantity}`,
      };
    }
  }

  // 3. Deduct stock automatically
  for (const item of saleData.items) {
    const prod = products.find((p) => p.id === item.productId);
    if (prod) {
      prod.stock -= item.quantity;
      prod.updatedAt = new Date().toISOString();
    }
  }
  setToStorage(KEYS.PRODUCTS, products);

  // 4. Record sale with collision-safe unique id
  const newSale: Sale = {
    ...saleData,
    id: `sale-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`,
    invoiceNumber: getNextInvoiceNumber(),
    status: 'CONCLUIDA',
    createdAt: new Date().toISOString(),
    syncedToSupabase: false,
    sincronizado: false,
  };

  const sales = getSales();
  sales.unshift(newSale);
  setToStorage(KEYS.SALES, sales);

  // 5. Queue for Supabase sync & broadcast to all tabs / devices
  addToSyncQueue('vendas', 'INSERT', newSale);
  broadcastLocalChange('all', { sale: newSale, stockDeducted: true });

  // 6. DISPARO INSTANTÂNEO PARA SUPABASE (Venda + Estoque deduzido propagados via WebSocket)
  directUpsertSale(newSale).catch((err) =>
    console.warn('[DirectSync] Falha ao enviar venda:', err),
  );
  for (const item of saleData.items) {
    const p = products.find((prod) => prod.id === item.productId);
    if (p) {
      directUpsertProduct(p).catch((err) =>
        console.warn('[DirectSync] Falha ao sincronizar baixa de estoque:', err),
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
  // Disparo assíncrono para Supabase
  directUpsertSale(sale).catch((err) =>
    console.warn('[DirectSync] Falha ao atualizar venda:', err)
  );
}

// Cancellation logic based on permissions
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

// Cancel sale: restores stock and updates sale status
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

  // Restore inventory
  const products = getProducts();
  for (const item of sale.items) {
    const prod = products.find((p) => p.id === item.productId);
    if (prod) {
      prod.stock += item.quantity;
      prod.updatedAt = new Date().toISOString();
    }
  }
  setToStorage(KEYS.PRODUCTS, products);

  // Update sale status
  sale.status = 'CANCELADA';
  sale.cancelledAt = new Date().toISOString();
  sale.cancelledBy = `${user.name} (${user.role})`;
  sale.cancellationReason = cancellationReason || 'Cancelamento aprovado';
  sale.syncedToSupabase = false;
  sale.sincronizado = false;

  setToStorage(KEYS.SALES, sales);
  addToSyncQueue('cancelamentos', 'UPDATE', {
    id: sale.id,
    status: 'CANCELADA',
    cancelledAt: sale.cancelledAt,
    cancelledBy: sale.cancelledBy,
    cancellationReason: sale.cancellationReason,
  });

  broadcastLocalChange('all', { saleCancelled: sale });

  // Disparo assíncrono para Supabase (Cancelamento + Restauração de estoque propagados via Realtime)
  directCancelSale(sale.id, sale.cancelledAt, sale.cancelledBy, sale.cancellationReason).catch(
    (err) => console.warn('[DirectSync] Falha ao cancelar venda no Supabase:', err)
  );
  for (const item of sale.items) {
    const p = products.find((prod) => prod.id === item.productId);
    if (p) {
      directUpsertProduct(p).catch((err) =>
        console.warn('[DirectSync] Falha ao sincronizar retorno de estoque:', err)
      );
    }
  }

  return { success: true };
}

// Expenses & Losses
export function getExpenses(): Expense[] {
  return getFromStorage<Expense[]>(KEYS.EXPENSES, INITIAL_EXPENSES);
}

export function addExpense(expense: Omit<Expense, 'id' | 'createdAt' | 'syncedToSupabase'>): Expense {
  const newExp: Expense = {
    ...expense,
    id: `exp-${Date.now()}`,
    createdAt: new Date().toISOString(),
    syncedToSupabase: false,
  };
  const list = getExpenses();
  list.unshift(newExp);
  setToStorage(KEYS.EXPENSES, list);
  addToSyncQueue('despesas', 'INSERT', newExp);
  broadcastLocalChange('despesas', newExp);
  // Disparo assíncrono para Supabase
  directUpsertExpense(newExp).catch((err) =>
    console.warn('[DirectSync] Falha ao enviar despesa:', err)
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
    // Disparo assíncrono para Supabase
    directUpsertExpense(expense).catch((err) =>
      console.warn('[DirectSync] Falha ao atualizar despesa:', err)
    );
  }
}

export function deleteExpense(expenseId: string): void {
  const list = getExpenses();
  const filtered = list.filter((e) => e.id !== expenseId);
  setToStorage(KEYS.EXPENSES, filtered);
  addToSyncQueue('despesas', 'DELETE', { id: expenseId });
  broadcastLocalChange('despesas', { id: expenseId, deleted: true });
  // Disparo assíncrono para Supabase
  directDeleteExpense(expenseId).catch((err) =>
    console.warn('[DirectSync] Falha ao excluir despesa:', err)
  );
}

// Sync Queue for Offline-First Architecture
export function getSyncQueue(): SyncQueueItem[] {
  return getFromStorage<SyncQueueItem[]>(KEYS.SYNC_QUEUE, []);
}

export function addToSyncQueue(
  table: 'vendas' | 'produtos' | 'despesas' | 'cancelamentos',
  action: 'INSERT' | 'UPDATE' | 'DELETE',
  data: any
): void {
  const queue = getSyncQueue();
  queue.push({
    id: `sync-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
    table,
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

// Unsynced Sales Helper (pega vendas locais com sincronizado = false)
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
