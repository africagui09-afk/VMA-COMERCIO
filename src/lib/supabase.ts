import { createClient, SupabaseClient } from '@supabase/supabase-js';
import {
  getSales,
  getSyncQueue,
  getSupabaseConfig,
  getUnsyncedSales,
  markSalesAsSynced,
  removeSyncQueueItem,
  removeSyncQueueItemsForSale,
  saveSupabaseConfig,
} from './storage';
import { Sale, StockMovement, StockMovementType, SyncQueueItem } from '../types';

let cachedClient: SupabaseClient | null = null;
let currentConfigKey = '';

/**
 * Emite alertas e eventos globais de erro de API para a interface
 */
export function notifyApiError(title: string, details?: any): void {
  const message = typeof details === 'string' ? details : details?.message || JSON.stringify(details || '');
  console.warn(`[Supabase API Error] ${title}:`, message);
  if (typeof window !== 'undefined') {
    window.dispatchEvent(
      new CustomEvent('kwanza_api_error', {
        detail: {
          title,
          message: `${title}: ${message || 'Erro de comunicação'}`,
          timestamp: Date.now(),
        },
      })
    );
  }
}

/**
 * Normaliza os termos de movimentação de estoque (Português vs Inglês)
 * Converte 'in' / 'entrada' -> 'ENTRADA', 'out' / 'saida' / 'saída' -> 'SAIDA'
 */
export function normalizeStockMovementType(rawType: any): StockMovementType {
  const t = String(rawType || '').toUpperCase().trim();
  if (t === 'IN' || t === 'ENTRADA' || t === 'COMPRA') return 'ENTRADA';
  if (t === 'OUT' || t === 'SAIDA' || t === 'SAÍDA') return 'SAIDA';
  if (t === 'VENDA') return 'VENDA';
  if (t === 'CANCELAMENTO') return 'CANCELAMENTO';
  return 'AJUSTE';
}

/**
 * Sanitiza a movimentação de estoque para o schema do Supabase (public.movimentacoes_estoque)
 */
export function sanitizeStockMovementForSupabase(mov: any) {
  return {
    id: String(mov.id),
    productId: String(mov.productId || mov.produtoId || ''),
    type: normalizeStockMovementType(mov.tipo || mov.type),
    quantity: Number(mov.quantity || mov.quantidade) || 0,
    previousStock: Number(mov.previousStock || mov.estoqueAnterior) || 0,
    resultingStock: Number(mov.resultingStock || mov.estoqueResultante) || 0,
    reason: mov.reason || mov.motivo || 'Ajuste de estoque',
    userId: String(mov.userId || mov.responsavelId || ''),
    userName: String(mov.userName || mov.responsavelNome || 'Sistema'),
    createdAt: mov.createdAt || mov.criadoEm || new Date().toISOString(),
    updatedAt: mov.updatedAt || mov.atualizadoEm || new Date().toISOString(),
  };
}

/**
 * Obtém o cliente Supabase com prioridade:
 * 1. Variáveis de ambiente VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY (Vercel / .env)
 * 2. Configuração manual guardada no localStorage (SupabaseModal)
 */
export function getSupabaseClient(): SupabaseClient | null {
  // 1. Prioridade máxima: variáveis de ambiente injetadas pelo Vite / Vercel
  const envUrl = ((import.meta as any).env?.VITE_SUPABASE_URL as string | undefined)?.trim();
  const envKey = ((import.meta as any).env?.VITE_SUPABASE_ANON_KEY as string | undefined)?.trim();

  let resolvedUrl: string = '';
  let resolvedKey: string = '';

  if (envUrl && envKey && envUrl.startsWith('http') && envKey.length > 10 && !envKey.includes('COLE_AQUI')) {
    // ✅ Env vars válidas — usa configuração automática (Vercel / .env local)
    resolvedUrl = envUrl;
    resolvedKey = envKey;
  } else {
    // 2. Fallback: configuração manual via SupabaseModal (localStorage)
    const config = getSupabaseConfig();
    if (config.url && config.anonKey) {
      resolvedUrl = config.url.trim();
      resolvedKey = config.anonKey.trim();
    }
  }

  if (!resolvedUrl || !resolvedKey) {
    return null;
  }

  const key = `${resolvedUrl}_${resolvedKey}`;
  if (cachedClient && currentConfigKey === key) {
    return cachedClient;
  }

  try {
    cachedClient = createClient(resolvedUrl, resolvedKey, {
      auth: { persistSession: false },
      realtime: {
        params: { eventsPerSecond: 10 },
      },
    });
    currentConfigKey = key;
    console.log('[Supabase] Cliente inicializado com sucesso:', resolvedUrl);
    return cachedClient;
  } catch (err: any) {
    console.error('[Supabase] Falha ao inicializar cliente:', err);
    notifyApiError('Falha ao inicializar cliente Supabase', err.message);
    return null;
  }
}

export interface SyncResult {
  success: boolean;
  syncedCount: number;
  remainingCount: number;
  message: string;
  simulated?: boolean;
}

/**
 * Sanitiza a venda para o schema da tabela public.vendas no Supabase,
 * prevenindo erros com colunas inexistentes ou tipos incompatíveis.
 */
export function sanitizeSaleForSupabase(sale: any) {
  return {
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
}

/**
 * Executa a sincronização em lote (batch background sync) de todas as vendas locais
 * com 'sincronizado = false' e itens da fila no Supabase.
 * NÃO SIMULA SUCESSO SE FALHAR: Mantém os dados na fila e alerta o usuário em caso de erro.
 */
export async function batchSyncSalesToSupabase(): Promise<SyncResult> {
  const isOnline = typeof navigator !== 'undefined' ? navigator.onLine : true;
  const unsyncedSales = getUnsyncedSales();
  const queue = getSyncQueue();
  const totalPending = unsyncedSales.length + queue.length;

  if (totalPending === 0) {
    return {
      success: true,
      syncedCount: 0,
      remainingCount: 0,
      message: 'Tudo atualizado! Todos os registros locais estão sincronizados.',
    };
  }

  if (!isOnline) {
    return {
      success: false,
      syncedCount: 0,
      remainingCount: totalPending,
      message: 'Sem ligação à Internet. Os registros continuam guardados em segurança no dispositivo.',
    };
  }

  const client = getSupabaseClient();

  // Caso o Supabase não esteja configurado
  if (!client) {
    notifyApiError('Supabase Não Conectado', 'Credenciais VITE_SUPABASE_URL ou VITE_SUPABASE_ANON_KEY não encontradas.');
    return {
      success: false,
      syncedCount: 0,
      remainingCount: totalPending,
      message: 'Supabase não configurado. Verifique as variáveis de ambiente na Vercel ou configure no modal.',
    };
  }

  // Supabase configurado: Execução da injeção real em lote
  let synced = 0;
  const errors: string[] = [];

  // 1. Injeção em lote (Batch Upsert) de vendas com sincronizado = false
  if (unsyncedSales.length > 0) {
    try {
      const sanitizedBatch = unsyncedSales.map(sanitizeSaleForSupabase);
      const { error: batchError } = await client
        .from('vendas')
        .upsert(sanitizedBatch, { onConflict: 'id' });

      if (batchError) {
        console.warn('Erro ao injetar lote de vendas no Supabase:', batchError.message);
        notifyApiError('Erro ao sincronizar vendas no Supabase', batchError.message);
        errors.push(batchError.message);
      } else {
        synced += unsyncedSales.length;
        // Atualiza vendas como sincronizadas localmente SOMENTE com confirmação do servidor
        markSalesAsSynced(unsyncedSales.map((s) => s.id));
        for (const sale of unsyncedSales) {
          removeSyncQueueItemsForSale(sale.id);
        }
      }
    } catch (err: any) {
      const msg = err.message || 'Falha ao sincronizar vendas';
      console.warn('Exceção ao sincronizar lote de vendas:', msg);
      notifyApiError('Falha ao sincronizar vendas', msg);
      errors.push(msg);
    }
  }

  // 2. Processa quaisquer outros itens restantes na fila
  const remainingQueue = getSyncQueue();
  for (const item of remainingQueue) {
    try {
      if (item.table === 'vendas') {
        const sanitized = sanitizeSaleForSupabase(item.data);
        const { error } = await client.from('vendas').upsert(sanitized, { onConflict: 'id' });
        if (error) throw error;
        if (item.data?.id) {
          markSalesAsSynced([item.data.id]);
        }
      } else if (item.table === 'cancelamentos') {
        const { error } = await client
          .from('vendas')
          .update({
            status: 'CANCELADA',
            cancelledAt: item.data.cancelledAt,
            cancelledBy: item.data.cancelledBy,
            cancellationReason: item.data.cancellationReason,
          })
          .eq('id', item.data.id);
        if (error) throw error;
      } else if (item.table === 'despesas') {
        const expData = {
          id: item.data.id,
          description: item.data.description,
          category: item.data.category,
          amount: Number(item.data.amount) || 0,
          date: item.data.date,
          registeredBy: item.data.registeredBy,
          createdAt: item.data.createdAt,
        };
        if (item.action === 'DELETE') {
          const { error } = await client.from('despesas').delete().eq('id', item.data.id);
          if (error) throw error;
        } else {
          const { error } = await client.from('despesas').upsert(expData, { onConflict: 'id' });
          if (error) throw error;
        }
      } else if (item.table === 'produtos') {
        const prodData = {
          id: item.data.id,
          name: item.data.name,
          barcode: item.data.barcode,
          category: item.data.category,
          price: Number(item.data.price) || 0,
          costPrice: Number(item.data.costPrice) || 0,
          stock: Number(item.data.stock) || 0,
          minStock: Number(item.data.minStock) || 5,
          unit: item.data.unit || 'un',
          imageUrl: item.data.imageUrl || null,
          updatedAt: item.data.updatedAt,
        };
        const { error } = await client.from('produtos').upsert(prodData, { onConflict: 'id' });
        if (error) throw error;
      } else if (item.table === 'movimentacoes_estoque') {
        const movData = sanitizeStockMovementForSupabase(item.data);
        const { error } = await client.from('movimentacoes_estoque').upsert(movData, { onConflict: 'id' });
        if (error) throw error;
      }

      removeSyncQueueItem(item.id);
      synced++;
    } catch (err: any) {
      console.warn(`Erro no item da fila [${item.table}/${item.id}]:`, err.message);
      notifyApiError(`Falha ao sincronizar item da fila (${item.table})`, err.message);
      errors.push(err.message || 'Erro no item');
    }
  }

  // Atualiza timestamp da última sincronização se houve sucesso
  const remaining = getSyncQueue().length + getUnsyncedSales().length;
  if (synced > 0) {
    const config = getSupabaseConfig();
    config.lastSyncTime = new Date().toISOString();
    saveSupabaseConfig(config);
  }

  return {
    success: errors.length === 0,
    syncedCount: synced,
    remainingCount: remaining,
    message: errors.length === 0
      ? `Sincronização concluída: ${synced} registros injetados no Supabase!`
      : `Sincronização parcial: ${synced} sincronizados, ${remaining} pendentes.`,
  };
}

/**
 * Funções Diretas de Mutação Imediata para o Supabase (Disparadas em segundo plano para Realtime)
 */

export async function pushProductToSupabase(product: any): Promise<boolean> {
  const client = getSupabaseClient();
  if (!client || (typeof navigator !== 'undefined' && !navigator.onLine)) return false;

  try {
    const prodData = {
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
    const { error } = await client.from('produtos').upsert(prodData, { onConflict: 'id' });
    if (error) {
      console.warn('[Supabase Push] Erro ao sincronizar produto:', error.message);
      return false;
    }
    return true;
  } catch (err) {
    console.warn('[Supabase Push] Exceção ao gravar produto:', err);
    return false;
  }
}

export async function deleteProductFromSupabase(productId: string): Promise<boolean> {
  const client = getSupabaseClient();
  if (!client || (typeof navigator !== 'undefined' && !navigator.onLine)) return false;

  try {
    const { error } = await client.from('produtos').delete().eq('id', productId);
    return !error;
  } catch {
    return false;
  }
}

export async function pushSaleToSupabase(sale: Sale): Promise<boolean> {
  const client = getSupabaseClient();
  if (!client || (typeof navigator !== 'undefined' && !navigator.onLine)) return false;

  try {
    const sanitized = sanitizeSaleForSupabase(sale);
    const { error } = await client.from('vendas').upsert(sanitized, { onConflict: 'id' });
    if (!error) {
      markSalesAsSynced([sale.id]);
      removeSyncQueueItemsForSale(sale.id);
      return true;
    }
    console.warn('[Supabase Push] Erro ao sincronizar venda:', error.message);
    return false;
  } catch (err) {
    console.warn('[Supabase Push] Exceção ao sincronizar venda:', err);
    return false;
  }
}

export async function cancelSaleInSupabase(
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
    return !error;
  } catch {
    return false;
  }
}

export async function pushExpenseToSupabase(expense: any): Promise<boolean> {
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
      notifyApiError('Erro ao enviar despesa para Supabase', error.message);
      return false;
    }
    return true;
  } catch (err: any) {
    notifyApiError('Exceção ao enviar despesa para Supabase', err.message);
    return false;
  }
}

export async function deleteExpenseFromSupabase(expenseId: string): Promise<boolean> {
  const client = getSupabaseClient();
  if (!client || (typeof navigator !== 'undefined' && !navigator.onLine)) return false;

  try {
    const { error } = await client.from('despesas').delete().eq('id', expenseId);
    if (error) {
      notifyApiError('Erro ao excluir despesa do Supabase', error.message);
      return false;
    }
    return true;
  } catch (err: any) {
    notifyApiError('Exceção ao excluir despesa do Supabase', err.message);
    return false;
  }
}

export async function pushStockMovementToSupabase(mov: StockMovement | any): Promise<boolean> {
  const client = getSupabaseClient();
  if (!client || (typeof navigator !== 'undefined' && !navigator.onLine)) return false;

  try {
    const sanitized = sanitizeStockMovementForSupabase(mov);
    const { error } = await client.from('movimentacoes_estoque').upsert(sanitized, { onConflict: 'id' });
    if (error) {
      console.warn('[Supabase Push] Erro ao gravar movimentação de estoque:', error.message);
      notifyApiError('Erro ao gravar movimentação de estoque', error.message);
      return false;
    }
    return true;
  } catch (err: any) {
    console.warn('[Supabase Push] Exceção ao gravar movimentação de estoque:', err);
    notifyApiError('Exceção ao gravar movimentação de estoque', err.message);
    return false;
  }
}

/**
 * Função de sincronização com alias para compatibilidade total
 */
export const syncWithSupabase = batchSyncSalesToSupabase;
export const forceImmediateBatchSync = batchSyncSalesToSupabase;

// SQL Schema script for Supabase tables com REPLICAÇÃO EM TEMPO REAL ATIVA
export const SUPABASE_SQL_SCHEMA = `-- ==============================================================================
-- KWANZAPOS: SCRIPT SQL DEFINITIVO DE REPLICAÇÃO EM TEMPO REAL (SUPABASE REALTIME)
-- Execute este script completo no SQL Editor do Painel do Supabase.
-- Garante WebSocket bi-direcional instantâneo (<100ms) entre Desktop, Tablet e Telemóvel.
-- ==============================================================================

-- 1. TABELA DE PRODUTOS (ESTOQUE)
create table if not exists public.produtos (
  id text primary key,
  name text not null,
  barcode text default '',
  category text default 'Geral',
  price numeric not null default 0,
  "costPrice" numeric not null default 0,
  stock integer not null default 0,
  "minStock" integer not null default 5,
  unit text default 'un',
  "imageUrl" text,
  "updatedAt" timestamp with time zone default now()
);

-- 2. TABELA DE VENDAS (FRENTE DE CAIXA E FATURAS)
create table if not exists public.vendas (
  id text primary key,
  "invoiceNumber" text not null,
  items jsonb not null default '[]'::jsonb,
  subtotal numeric not null default 0,
  "discountTotal" numeric default 0,
  total numeric not null default 0,
  "totalCost" numeric not null default 0,
  payments jsonb not null default '[]'::jsonb,
  "amountReceived" numeric,
  change numeric default 0,
  "sellerId" text not null default '',
  "sellerName" text not null default '',
  "sellerRole" text not null default 'VENDEDOR',
  "customerName" text,
  "customerNif" text,
  notes text,
  status text not null default 'CONCLUIDA',
  "cancelledAt" timestamp with time zone,
  "cancelledBy" text,
  "cancellationReason" text,
  "createdAt" timestamp with time zone default now()
);

-- 3. TABELA DE DESPESAS (GESTÃO FINANCEIRA)
create table if not exists public.despesas (
  id text primary key,
  description text not null,
  category text not null default 'Outros',
  amount numeric not null default 0,
  date date not null default current_date,
  "registeredBy" text not null default 'Sistema',
  "createdAt" timestamp with time zone default now()
);

-- 4. TABELA DE CLIENTES DE FIADO (GESTÃO DE CRÉDITO)
create table if not exists public.clientes_fiado (
  id text primary key,
  nome text not null,
  telefone text default '',
  nif text default '',
  endereco text default '',
  limite_credito numeric not null default 0,
  saldo_devedor numeric not null default 0,
  status text not null default 'ATIVO',
  criado_em timestamp with time zone default now(),
  atualizado_em timestamp with time zone default now()
);

-- 5. TABELA DE HISTÓRICO DE FIADO (EXTRATO DE DÍVIDAS E PAGAMENTOS)
create table if not exists public.historico_fiado (
  id text primary key,
  cliente_id text not null,
  cliente_nome text default '',
  venda_id text,
  invoice_number text,
  tipo text not null default 'COMPRA_FIADO',
  valor numeric not null default 0,
  saldo_anterior numeric not null default 0,
  saldo_posterior numeric not null default 0,
  data timestamp with time zone default now(),
  registrado_por text default '',
  observacoes text
);

-- 6. TABELA DE MOVIMENTAÇÕES DE ESTOQUE (HISTÓRICO AUDITÁVEL)
create table if not exists public.movimentacoes_estoque (
  id text primary key,
  "productId" text not null,
  type text not null default 'AJUSTE',
  quantity integer not null default 0,
  "previousStock" integer not null default 0,
  "resultingStock" integer not null default 0,
  reason text,
  "userId" text not null default '',
  "userName" text not null default '',
  "createdAt" timestamp with time zone default now(),
  "updatedAt" timestamp with time zone default now()
);

-- ==============================================================================
-- ATIVAÇÃO DA REPLICAÇÃO COMPLETA (REPLICA IDENTITY FULL)
-- Obriga o PostgreSQL a transmitir o registo anterior e o novo em UPDATE e DELETE
-- ==============================================================================
alter table public.produtos replica identity full;
alter table public.vendas replica identity full;
alter table public.despesas replica identity full;
alter table public.clientes_fiado replica identity full;
alter table public.historico_fiado replica identity full;
alter table public.movimentacoes_estoque replica identity full;

-- ==============================================================================
-- PUBLICAÇÃO REALTIME (SUPABASE_REALTIME)
-- Insere todas as tabelas na publicação do WebSocket de mudança de dados
-- ==============================================================================
do $$
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
end $$;

alter publication supabase_realtime add table public.produtos;
alter publication supabase_realtime add table public.vendas;
alter publication supabase_realtime add table public.despesas;
alter publication supabase_realtime add table public.clientes_fiado;
alter publication supabase_realtime add table public.historico_fiado;
alter publication supabase_realtime add table public.movimentacoes_estoque;

-- ==============================================================================
-- POLÍTICAS DE ACESSO (ROW LEVEL SECURITY - RLS)
-- Permite leitura e gravação bi-direcional sem bloqueios silenciosos no WebSocket
-- ==============================================================================
alter table public.produtos enable row level security;
alter table public.vendas enable row level security;
alter table public.despesas enable row level security;
alter table public.clientes_fiado enable row level security;
alter table public.historico_fiado enable row level security;
alter table public.movimentacoes_estoque enable row level security;

-- Remove políticas antigas se existirem para evitar duplicidade
drop policy if exists "kwanzapos_produtos_all" on public.produtos;
drop policy if exists "kwanzapos_vendas_all" on public.vendas;
drop policy if exists "kwanzapos_despesas_all" on public.despesas;
drop policy if exists "kwanzapos_clientes_fiado_all" on public.clientes_fiado;
drop policy if exists "kwanzapos_historico_fiado_all" on public.historico_fiado;
drop policy if exists "kwanzapos_movimentacoes_estoque_all" on public.movimentacoes_estoque;

create policy "kwanzapos_produtos_all" on public.produtos for all using (true) with check (true);
create policy "kwanzapos_vendas_all" on public.vendas for all using (true) with check (true);
create policy "kwanzapos_despesas_all" on public.despesas for all using (true) with check (true);
create policy "kwanzapos_clientes_fiado_all" on public.clientes_fiado for all using (true) with check (true);
create policy "kwanzapos_historico_fiado_all" on public.historico_fiado for all using (true) with check (true);
create policy "kwanzapos_movimentacoes_estoque_all" on public.movimentacoes_estoque for all using (true) with check (true);

create policy "kwanzapos_produtos_all" on public.produtos for all using (true) with check (true);
create policy "kwanzapos_vendas_all" on public.vendas for all using (true) with check (true);
create policy "kwanzapos_despesas_all" on public.despesas for all using (true) with check (true);
create policy "kwanzapos_clientes_fiado_all" on public.clientes_fiado for all using (true) with check (true);
create policy "kwanzapos_historico_fiado_all" on public.historico_fiado for all using (true) with check (true);

-- ==============================================================================
-- 6. TABELA DE PERFIS DE UTILIZADORES (AUTENTICAÇÃO E GESTÃO DE ACESSOS)
-- ==============================================================================
create table if not exists public.profiles (
  id text primary key,
  email text not null unique,
  name text not null,
  role text not null default 'VENDEDOR',
  pin text default '2026',
  active boolean not null default true,
  last_login timestamp with time zone,
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now()
);

alter table public.profiles replica identity full;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.profiles;
  end if;
end $$;

alter table public.profiles enable row level security;
drop policy if exists "kwanzapos_profiles_all" on public.profiles;
create policy "kwanzapos_profiles_all" on public.profiles for all using (true) with check (true);

-- Seed inicial dos perfis da VMA Comercial Lda
insert into public.profiles (id, email, name, role, pin, active)
values
  ('usr-admin-victor',    'victorabreu528@gmail.com',    'Victor Abreu',   'ADMINISTRADOR', '2026', true),
  ('usr-gerente-mauro',  'mauro.jorge@vma.co.ao',       'Mauro Jorge',    'GERENTE',       '2026', true),
  ('usr-vendedor-daniel','daniel.muzala@vma.co.ao',     'Daniel Muzala',  'VENDEDOR',      '2026', true),
  ('usr-vendedor-alberto','alberto.lito@vma.co.ao',     'Alberto Lito',   'VENDEDOR',      '2026', true)
on conflict (email) do nothing;

-- ==============================================================================
-- 7. FUNÇÃO RPC: DEDUÇÃO ATÓMICA DE ESTOQUE (ANTI RACE-CONDITION)
-- ==============================================================================
-- Usa SELECT ... FOR UPDATE para bloquear a linha do produto durante a transação,
-- impedindo que dois caixas vendam o mesmo produto simultaneamente e gerem furos.
-- Chamada pelo frontend ANTES de confirmar a venda quando o dispositivo está online.
-- ==============================================================================
create or replace function public.deduct_stock_atomic(
  p_product_id text,
  p_quantity    integer,
  p_seller_id   text default '',
  p_seller_name text default ''
)
returns table (
  success    boolean,
  new_stock  integer,
  error_msg  text
)
language plpgsql
security definer
as $$
declare
  v_current_stock integer;
  v_product_name  text;
begin
  -- Lock exclusivo na linha do produto (bloqueia outras transações concorrentes)
  select stock, name
  into   v_current_stock, v_product_name
  from   public.produtos
  where  id = p_product_id
  for    update;

  -- Produto não encontrado
  if v_current_stock is null then
    return query select
      false,
      0,
      format('Produto [%s] não encontrado no banco de dados.', p_product_id);
    return;
  end if;

  -- Estoque insuficiente
  if v_current_stock < p_quantity then
    return query select
      false,
      v_current_stock,
      format(
        'Estoque insuficiente para "%s": disponível %s, solicitado %s. Outro caixa pode ter vendido ao mesmo tempo.',
        v_product_name, v_current_stock, p_quantity
      );
    return;
  end if;

  -- Dedução atómica com timestamp
  update public.produtos
  set
    stock       = stock - p_quantity,
    "updatedAt" = now()
  where id = p_product_id;

  -- Retorna sucesso com o novo saldo
  return query select
    true,
    (v_current_stock - p_quantity),
    ''::text;
end;
$$;

-- ==============================================================================
-- 8. FUNÇÃO RPC: RESTAURAÇÃO ATÓMICA DE ESTOQUE (CANCELAMENTO DE VENDA)
-- ==============================================================================
-- Garante que o cancelamento devolve o estoque de forma atómica e segura,
-- sem duplicar unidades caso dois administradores cancelem a mesma venda.
-- ==============================================================================
create or replace function public.restore_stock_on_cancel(
  p_sale_id      text,
  p_items        jsonb,
  p_cancelled_by text default 'Sistema',
  p_reason       text default 'Cancelamento aprovado'
)
returns table (
  success   boolean,
  error_msg text
)
language plpgsql
security definer
as $$
declare
  v_item         jsonb;
  v_product_id   text;
  v_quantity     integer;
  v_sale_status  text;
begin
  -- Verifica se a venda já foi cancelada (idempotência — evita dupla restauração)
  select status into v_sale_status
  from   public.vendas
  where  id = p_sale_id
  for    update;

  if v_sale_status is null then
    return query select false, 'Venda não encontrada.'::text;
    return;
  end if;

  if v_sale_status = 'CANCELADA' then
    return query select false, 'Esta venda já foi cancelada anteriormente.'::text;
    return;
  end if;

  -- Itera nos itens da venda e restaura estoque atomicamente
  for v_item in select * from jsonb_array_elements(p_items) loop
    v_product_id := v_item->>'productId';
    v_quantity   := (v_item->>'quantity')::integer;

    if v_product_id is not null and v_quantity > 0 then
      update public.produtos
      set
        stock       = stock + v_quantity,
        "updatedAt" = now()
      where id = v_product_id;
    end if;
  end loop;

  -- Marca a venda como cancelada
  update public.vendas
  set
    status               = 'CANCELADA',
    "cancelledAt"        = now(),
    "cancelledBy"        = p_cancelled_by,
    "cancellationReason" = p_reason
  where id = p_sale_id;

  return query select true, ''::text;
end;
$$;
`;

/**
 * Chama a RPC de dedução atômica de estoque no PostgreSQL.
 * Retorna { success, newStock, errorMsg } com proteção total contra race conditions.
 * Deve ser chamada ANTES de confirmar qualquer venda quando o dispositivo está online.
 */
export async function callDeductStockAtomic(
  productId: string,
  quantity: number,
  sellerId: string = '',
  sellerName: string = ''
): Promise<{ success: boolean; newStock: number; errorMsg: string }> {
  const client = getSupabaseClient();
  if (!client) {
    return { success: false, newStock: 0, errorMsg: 'Supabase não disponível — modo offline.' };
  }

  try {
    const { data, error } = await client.rpc('deduct_stock_atomic', {
      p_product_id: productId,
      p_quantity: quantity,
      p_seller_id: sellerId,
      p_seller_name: sellerName,
    });

    if (error) {
      console.warn('[RPC] Erro na dedução atómica:', error.message);
      return { success: false, newStock: 0, errorMsg: error.message };
    }

    if (data && data.length > 0) {
      const result = data[0];
      return {
        success: Boolean(result.success),
        newStock: Number(result.new_stock) || 0,
        errorMsg: result.error_msg || '',
      };
    }

    return { success: false, newStock: 0, errorMsg: 'Resposta inesperada da RPC.' };
  } catch (err: any) {
    console.warn('[RPC] Exceção na dedução atómica:', err);
    return { success: false, newStock: 0, errorMsg: err.message || 'Erro desconhecido.' };
  }
}

/**
 * Chama a RPC de restauração atómica de estoque (cancelamento de venda).
 * Idempotente: não duplica a devolução de estoque caso chamada duas vezes.
 */
export async function callRestoreStockOnCancel(
  saleId: string,
  items: any[],
  cancelledBy: string = 'Sistema',
  reason: string = 'Cancelamento aprovado'
): Promise<{ success: boolean; errorMsg: string }> {
  const client = getSupabaseClient();
  if (!client) {
    return { success: false, errorMsg: 'Supabase não disponível — restauração local apenas.' };
  }

  try {
    const { data, error } = await client.rpc('restore_stock_on_cancel', {
      p_sale_id: saleId,
      p_items: items,
      p_cancelled_by: cancelledBy,
      p_reason: reason,
    });

    if (error) {
      console.warn('[RPC] Erro na restauração de estoque:', error.message);
      return { success: false, errorMsg: error.message };
    }

    if (data && data.length > 0) {
      const result = data[0];
      return {
        success: Boolean(result.success),
        errorMsg: result.error_msg || '',
      };
    }

    return { success: false, errorMsg: 'Resposta inesperada da RPC.' };
  } catch (err: any) {
    console.warn('[RPC] Exceção na restauração de estoque:', err);
    return { success: false, errorMsg: err.message || 'Erro desconhecido.' };
  }
}

