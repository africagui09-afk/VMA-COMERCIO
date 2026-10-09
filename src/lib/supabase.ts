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
 * Sanitiza a movimentação de estoque para o schema do Supabase (public.movimentacoes_estoque).
 * TODOS os campos em português, conforme o schema definitivo KwanzaPOS.
 */
export function sanitizeStockMovementForSupabase(mov: any) {
  return {
    id: String(mov.id),
    produto_id: String(mov.produto_id || mov.productId || mov.produtoId || ''),
    tipo: normalizeStockMovementType(mov.tipo || mov.type),
    quantidade: Number(mov.quantidade || mov.quantity) || 0,
    motivo: mov.motivo || mov.reason || 'Ajuste de estoque',
    criado_em: mov.criado_em || mov.createdAt || new Date().toISOString(),
  };
}

/**
 * Sanitiza o produto para o schema da tabela public.produtos no Supabase.
 * TODOS os campos em português, conforme o schema definitivo KwanzaPOS.
 */
export function sanitizeProductForSupabase(product: any) {
  return {
    id: String(product.id),
    nome: String(product.nome || product.name || 'Sem nome').trim(),
    barcode: String(product.barcode || ''),
    categoria: String(product.categoria || product.category || 'Geral'),
    preco_custo: Number(product.preco_custo ?? product.costPrice ?? product.precoCusto ?? 0),
    preco_venda: Number(product.preco_venda ?? product.price ?? product.preco ?? 0),
    quantidade: Number(product.quantidade ?? product.stock ?? product.estoque ?? 0),
    estoque_minimo: Number(product.estoque_minimo ?? product.minStock ?? product.estoqueMinimo ?? 5),
    atualizado_em: product.atualizado_em || product.updatedAt || new Date().toISOString(),
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
      auth: { 
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
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

export const supabase = getSupabaseClient() as SupabaseClient;


export interface SyncResult {
  success: boolean;
  syncedCount: number;
  remainingCount: number;
  message: string;
  simulated?: boolean;
}

/**
 * Sanitiza a venda para o schema da tabela public.vendas no Supabase.
 * TODOS os campos em português, conforme o schema definitivo KwanzaPOS.
 */
export function sanitizeSaleForSupabase(sale: any) {
  return {
    id: String(sale.id),
    numero_fatura: String(sale.numero_fatura || sale.invoiceNumber || ''),
    itens: Array.isArray(sale.itens) ? sale.itens : (Array.isArray(sale.items) ? sale.items : []),
    subtotal: Number(sale.subtotal) || 0,
    total: Number(sale.total) || 0,
    operador_id: String(sale.operador_id || sale.sellerId || ''),
    operador_nome: String(sale.operador_nome || sale.sellerName || ''),
    criado_em: sale.criado_em || sale.createdAt || new Date().toISOString(),
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
        const prodData = sanitizeProductForSupabase(item.data);
        let { error } = await client.from('produtos').upsert(prodData, { onConflict: 'id' });
        if (error && error.message && error.message.includes("'name'")) {
          const fallback: any = { ...prodData };
          delete fallback.name;
          fallback.nome = prodData.name;
          const res = await client.from('produtos').upsert(fallback, { onConflict: 'id' });
          error = res.error;
        }
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
    const prodData = sanitizeProductForSupabase(product);
    let { error } = await client.from('produtos').upsert(prodData, { onConflict: 'id' });
    if (error && error.message && error.message.includes("'name'")) {
      const fallback: any = { ...prodData };
      delete fallback.name;
      fallback.nome = prodData.name;
      const res = await client.from('produtos').upsert(fallback, { onConflict: 'id' });
      error = res.error;
    }
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

export const SUPABASE_SQL_SCHEMA = `-- ==============================================================================
-- KWANZAPOS / VMA COMÉRCIO LDA: SCRIPT SQL DEFINITIVO (CAMPOS EM PORTUGUÊS)
-- Execute este script no SQL Editor do Painel do Supabase.
-- Base de dados LIMPA e ZERADA — modo 100% ONLINE.
-- ==============================================================================

-- 1. TABELA DE PRODUTOS (ESTOQUE) — campos em português
create table if not exists public.produtos (
  id text primary key,
  nome text not null default 'Sem nome',
  barcode text default '',
  categoria text default 'Geral',
  preco_custo numeric not null default 0,
  preco_venda numeric not null default 0,
  quantidade numeric not null default 0,
  estoque_minimo numeric not null default 5,
  atualizado_em timestamp with time zone default now()
);

-- Garantia de colunas caso a tabela 'produtos' já existisse previamente:
alter table public.produtos add column if not exists nome text default 'Sem nome';
alter table public.produtos add column if not exists barcode text default '';
alter table public.produtos add column if not exists categoria text default 'Geral';
alter table public.produtos add column if not exists preco_custo numeric not null default 0;
alter table public.produtos add column if not exists preco_venda numeric not null default 0;
alter table public.produtos add column if not exists quantidade numeric not null default 0;
alter table public.produtos add column if not exists estoque_minimo numeric not null default 5;
alter table public.produtos add column if not exists atualizado_em timestamp with time zone default now();

-- 2. TABELA DE VENDAS (FRENTE DE CAIXA) — campos em português
create table if not exists public.vendas (
  id text primary key,
  numero_fatura text not null default '',
  itens jsonb not null default '[]'::jsonb,
  subtotal numeric not null default 0,
  total numeric not null default 0,
  operador_id text not null default '',
  operador_nome text not null default '',
  criado_em timestamp with time zone default now()
);

-- Garantia de colunas:
alter table public.vendas add column if not exists numero_fatura text default '';
alter table public.vendas add column if not exists itens jsonb not null default '[]'::jsonb;
alter table public.vendas add column if not exists subtotal numeric not null default 0;
alter table public.vendas add column if not exists total numeric not null default 0;
alter table public.vendas add column if not exists operador_id text not null default '';
alter table public.vendas add column if not exists operador_nome text not null default '';
alter table public.vendas add column if not exists criado_em timestamp with time zone default now();

-- 3. TABELA DE MOVIMENTAÇÕES DE ESTOQUE — campos em português
create table if not exists public.movimentacoes_estoque (
  id text primary key,
  produto_id text not null default '',
  tipo text not null default 'AJUSTE',
  quantidade numeric not null default 0,
  motivo text,
  criado_em timestamp with time zone default now()
);

-- Garantia de colunas:
alter table public.movimentacoes_estoque add column if not exists produto_id text not null default '';
alter table public.movimentacoes_estoque add column if not exists tipo text not null default 'AJUSTE';
alter table public.movimentacoes_estoque add column if not exists quantidade numeric not null default 0;
alter table public.movimentacoes_estoque add column if not exists motivo text;
alter table public.movimentacoes_estoque add column if not exists criado_em timestamp with time zone default now();

-- 4. TABELA DE DESPESAS (GESTÃO FINANCEIRA)
create table if not exists public.despesas (
  id text primary key,
  description text not null,
  category text not null default 'Outros',
  amount numeric not null default 0,
  date date not null default current_date,
  "registeredBy" text not null default 'Sistema',
  "createdAt" timestamp with time zone default now()
);

alter table public.despesas add column if not exists description text not null default '';
alter table public.despesas add column if not exists category text not null default 'Outros';
alter table public.despesas add column if not exists amount numeric not null default 0;
alter table public.despesas add column if not exists date date not null default current_date;
alter table public.despesas add column if not exists "registeredBy" text not null default 'Sistema';
alter table public.despesas add column if not exists "createdAt" timestamp with time zone default now();

-- 5. TABELA DE CLIENTES DE FIADO
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

alter table public.clientes_fiado add column if not exists nome text not null default '';
alter table public.clientes_fiado add column if not exists telefone text default '';
alter table public.clientes_fiado add column if not exists nif text default '';
alter table public.clientes_fiado add column if not exists endereco text default '';
alter table public.clientes_fiado add column if not exists limite_credito numeric not null default 0;
alter table public.clientes_fiado add column if not exists saldo_devedor numeric not null default 0;
alter table public.clientes_fiado add column if not exists status text not null default 'ATIVO';
alter table public.clientes_fiado add column if not exists criado_em timestamp with time zone default now();
alter table public.clientes_fiado add column if not exists atualizado_em timestamp with time zone default now();

-- 6. TABELA DE HISTÓRICO DE FIADO
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

alter table public.historico_fiado add column if not exists cliente_id text not null default '';
alter table public.historico_fiado add column if not exists cliente_nome text default '';
alter table public.historico_fiado add column if not exists venda_id text;
alter table public.historico_fiado add column if not exists invoice_number text;
alter table public.historico_fiado add column if not exists tipo text not null default 'COMPRA_FIADO';
alter table public.historico_fiado add column if not exists valor numeric not null default 0;
alter table public.historico_fiado add column if not exists saldo_anterior numeric not null default 0;
alter table public.historico_fiado add column if not exists saldo_posterior numeric not null default 0;
alter table public.historico_fiado add column if not exists data timestamp with time zone default now();
alter table public.historico_fiado add column if not exists registrado_por text default '';
alter table public.historico_fiado add column if not exists observacoes text;

-- 7. TABELA DE PERFIS DE UTILIZADORES
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

alter table public.profiles add column if not exists email text not null default '';
alter table public.profiles add column if not exists name text not null default '';
alter table public.profiles add column if not exists role text not null default 'VENDEDOR';
alter table public.profiles add column if not exists pin text default '2026';
alter table public.profiles add column if not exists active boolean not null default true;
alter table public.profiles add column if not exists last_login timestamp with time zone;
alter table public.profiles add column if not exists created_at timestamp with time zone default now();
alter table public.profiles add column if not exists updated_at timestamp with time zone default now();

-- Índices de Alta Performance
create index if not exists idx_produtos_barcode on public.produtos (barcode);
create index if not exists idx_produtos_categoria on public.produtos (categoria);
create index if not exists idx_vendas_numero on public.vendas (numero_fatura);
create index if not exists idx_vendas_criado_em on public.vendas (criado_em desc);
create index if not exists idx_vendas_operador on public.vendas (operador_id);
create index if not exists idx_mov_produto on public.movimentacoes_estoque (produto_id);
create index if not exists idx_despesas_date on public.despesas (date desc);
create index if not exists idx_fiado_cliente on public.historico_fiado (cliente_id);

-- ==============================================================================
-- REPLICA IDENTITY FULL (para Realtime WebSocket)
-- ==============================================================================
alter table public.produtos replica identity full;
alter table public.vendas replica identity full;
alter table public.despesas replica identity full;
alter table public.clientes_fiado replica identity full;
alter table public.historico_fiado replica identity full;
alter table public.movimentacoes_estoque replica identity full;
alter table public.profiles replica identity full;

-- ==============================================================================
-- PUBLICAÇÃO REALTIME (idempotente)
-- ==============================================================================
do $$
declare
  tbl text;
  tables_to_add text[] := array[
    'produtos',
    'vendas',
    'despesas',
    'clientes_fiado',
    'historico_fiado',
    'movimentacoes_estoque',
    'profiles'
  ];
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;

  foreach tbl in array tables_to_add
  loop
    if not exists (
      select 1 from pg_publication_tables 
      where pubname = 'supabase_realtime' 
        and schemaname = 'public' 
        and tablename = tbl
    ) then
      execute format('alter publication supabase_realtime add table public.%I;', tbl);
    end if;
  end loop;
end $$;

-- ==============================================================================
-- ROW LEVEL SECURITY (RLS)
-- ==============================================================================
alter table public.produtos enable row level security;
alter table public.vendas enable row level security;
alter table public.despesas enable row level security;
alter table public.clientes_fiado enable row level security;
alter table public.historico_fiado enable row level security;
alter table public.movimentacoes_estoque enable row level security;
alter table public.profiles enable row level security;

drop policy if exists "kwanzapos_produtos_all" on public.produtos;
drop policy if exists "kwanzapos_vendas_all" on public.vendas;
drop policy if exists "kwanzapos_despesas_all" on public.despesas;
drop policy if exists "kwanzapos_clientes_fiado_all" on public.clientes_fiado;
drop policy if exists "kwanzapos_historico_fiado_all" on public.historico_fiado;
drop policy if exists "kwanzapos_movimentacoes_estoque_all" on public.movimentacoes_estoque;
drop policy if exists "kwanzapos_profiles_all" on public.profiles;

create policy "kwanzapos_produtos_all" on public.produtos for all using (true) with check (true);
create policy "kwanzapos_vendas_all" on public.vendas for all using (true) with check (true);
create policy "kwanzapos_despesas_all" on public.despesas for all using (true) with check (true);
create policy "kwanzapos_clientes_fiado_all" on public.clientes_fiado for all using (true) with check (true);
create policy "kwanzapos_historico_fiado_all" on public.historico_fiado for all using (true) with check (true);
create policy "kwanzapos_movimentacoes_estoque_all" on public.movimentacoes_estoque for all using (true) with check (true);
create policy "kwanzapos_profiles_all" on public.profiles for all using (true) with check (true);

-- Seed inicial dos perfis VMA Comercial Lda
insert into public.profiles (id, email, name, role, pin, active)
values
  ('usr-admin-victor',     'victorabreu528@gmail.com',    'Victor Abreu',   'ADMINISTRADOR', '2026', true),
  ('usr-gerente-mauro',   'mauro.jorge@vma.co.ao',       'Mauro Jorge',    'GERENTE',       '2026', true),
  ('usr-vendedor-daniel', 'daniel.muzala@vma.co.ao',     'Daniel Muzala',  'VENDEDOR',      '2026', true),
  ('usr-vendedor-alberto','alberto.lito@vma.co.ao',      'Alberto Lito',   'VENDEDOR',      '2026', true)
on conflict (email) do nothing;

-- ==============================================================================
-- RECARREGAR SCHEMA CACHE DO SUPABASE (POSTGREST)
-- ==============================================================================
notify pgrst, 'reload schema';

-- ==============================================================================
-- RPC: DEDUÇÃO ATÓMICA DE ESTOQUE (anti race-condition)
-- Usa os campos em português: quantidade, atualizado_em
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
  select quantidade, nome
  into   v_current_stock, v_product_name
  from   public.produtos
  where  id = p_product_id
  for    update;

  if v_current_stock is null then
    return query select
      false,
      0,
      format('Produto [%s] não encontrado.', p_product_id);
    return;
  end if;

  if v_current_stock < p_quantity then
    return query select
      false,
      v_current_stock,
      format(
        'Estoque insuficiente para "%s": disponível %s, solicitado %s.',
        v_product_name, v_current_stock, p_quantity
      );
    return;
  end if;

  update public.produtos
  set
    quantidade    = quantidade - p_quantity,
    atualizado_em = now()
  where id = p_product_id;

  return query select
    true,
    (v_current_stock - p_quantity),
    ''::text;
end;
$$;

-- ==============================================================================
-- RPC: RESTAURAÇÃO ATÓMICA DE ESTOQUE (cancelamento de venda)
-- Usa os campos em português: quantidade, atualizado_em, itens
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
  select status into v_sale_status
  from   public.vendas
  where  id = p_sale_id
  for    update;

  if v_sale_status is null then
    return query select false, 'Venda não encontrada.'::text;
    return;
  end if;

  if v_sale_status = 'CANCELADA' then
    return query select false, 'Esta venda já foi cancelada.'::text;
    return;
  end if;

  for v_item in select * from jsonb_array_elements(p_items) loop
    v_product_id := v_item->>'productId';
    v_quantity   := (v_item->>'quantity')::integer;

    if v_product_id is not null and v_quantity > 0 then
      update public.produtos
      set
        quantidade    = quantidade + v_quantity,
        atualizado_em = now()
      where id = v_product_id;
    end if;
  end loop;

  update public.vendas
  set status = 'CANCELADA'
  where id = p_sale_id;

  return query select true, ''::text;
end;
$$;
`;



-- Garantia de colunas caso a tabela 'produtos' já existisse previamente:
alter table public.produtos add column if not exists name text default 'Sem nome';
alter table public.produtos add column if not exists barcode text default '';
alter table public.produtos add column if not exists category text default 'Geral';
alter table public.produtos add column if not exists price numeric not null default 0;
alter table public.produtos add column if not exists "costPrice" numeric not null default 0;
alter table public.produtos add column if not exists stock numeric not null default 0;
alter table public.produtos add column if not exists "minStock" numeric not null default 5;
alter table public.produtos add column if not exists unit text default 'un';
alter table public.produtos add column if not exists "imageUrl" text;
alter table public.produtos add column if not exists "updatedAt" timestamp with time zone default now();

-- Compatibilidade automática com bancos antigos que usavam 'nome':
do $$
begin
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'produtos' and column_name = 'nome') then
    update public.produtos set name = nome where name is null or name = '' or name = 'Sem nome';
  end if;
end $$;

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

-- Garantia de colunas caso a tabela 'vendas' já existisse previamente:
alter table public.vendas add column if not exists "invoiceNumber" text default '';
alter table public.vendas add column if not exists items jsonb not null default '[]'::jsonb;
alter table public.vendas add column if not exists subtotal numeric not null default 0;
alter table public.vendas add column if not exists "discountTotal" numeric default 0;
alter table public.vendas add column if not exists total numeric not null default 0;
alter table public.vendas add column if not exists "totalCost" numeric not null default 0;
alter table public.vendas add column if not exists payments jsonb not null default '[]'::jsonb;
alter table public.vendas add column if not exists "amountReceived" numeric;
alter table public.vendas add column if not exists change numeric default 0;
alter table public.vendas add column if not exists "sellerId" text not null default '';
alter table public.vendas add column if not exists "sellerName" text not null default '';
alter table public.vendas add column if not exists "sellerRole" text not null default 'VENDEDOR';
alter table public.vendas add column if not exists "customerName" text;
alter table public.vendas add column if not exists "customerNif" text;
alter table public.vendas add column if not exists notes text;
alter table public.vendas add column if not exists status text not null default 'CONCLUIDA';
alter table public.vendas add column if not exists "cancelledAt" timestamp with time zone;
alter table public.vendas add column if not exists "cancelledBy" text;
alter table public.vendas add column if not exists "cancellationReason" text;
alter table public.vendas add column if not exists "createdAt" timestamp with time zone default now();

-- 3. TABELA DE MOVIMENTAÇÕES DE ESTOQUE (HISTÓRICO AUDITÁVEL)
create table if not exists public.movimentacoes_estoque (
  id text primary key,
  "productId" text not null,
  type text not null default 'AJUSTE',
  quantity numeric not null default 0,
  "previousStock" numeric not null default 0,
  "resultingStock" numeric not null default 0,
  reason text,
  "userId" text not null default '',
  "userName" text not null default '',
  "createdAt" timestamp with time zone default now(),
  "updatedAt" timestamp with time zone default now()
);

-- Garantia de colunas caso a tabela 'movimentacoes_estoque' já existisse previamente:
alter table public.movimentacoes_estoque add column if not exists "productId" text not null default '';
alter table public.movimentacoes_estoque add column if not exists type text not null default 'AJUSTE';
alter table public.movimentacoes_estoque add column if not exists quantity numeric not null default 0;
alter table public.movimentacoes_estoque add column if not exists "previousStock" numeric not null default 0;
alter table public.movimentacoes_estoque add column if not exists "resultingStock" numeric not null default 0;
alter table public.movimentacoes_estoque add column if not exists reason text;
alter table public.movimentacoes_estoque add column if not exists "userId" text not null default '';
alter table public.movimentacoes_estoque add column if not exists "userName" text not null default '';
alter table public.movimentacoes_estoque add column if not exists "createdAt" timestamp with time zone default now();
alter table public.movimentacoes_estoque add column if not exists "updatedAt" timestamp with time zone default now();

-- 4. TABELA DE DESPESAS (GESTÃO FINANCEIRA)
create table if not exists public.despesas (
  id text primary key,
  description text not null,
  category text not null default 'Outros',
  amount numeric not null default 0,
  date date not null default current_date,
  "registeredBy" text not null default 'Sistema',
  "createdAt" timestamp with time zone default now()
);

alter table public.despesas add column if not exists description text not null default '';
alter table public.despesas add column if not exists category text not null default 'Outros';
alter table public.despesas add column if not exists amount numeric not null default 0;
alter table public.despesas add column if not exists date date not null default current_date;
alter table public.despesas add column if not exists "registeredBy" text not null default 'Sistema';
alter table public.despesas add column if not exists "createdAt" timestamp with time zone default now();

-- 5. TABELA DE CLIENTES DE FIADO (GESTÃO DE CRÉDITO)
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

alter table public.clientes_fiado add column if not exists nome text not null default '';
alter table public.clientes_fiado add column if not exists telefone text default '';
alter table public.clientes_fiado add column if not exists nif text default '';
alter table public.clientes_fiado add column if not exists endereco text default '';
alter table public.clientes_fiado add column if not exists limite_credito numeric not null default 0;
alter table public.clientes_fiado add column if not exists saldo_devedor numeric not null default 0;
alter table public.clientes_fiado add column if not exists status text not null default 'ATIVO';
alter table public.clientes_fiado add column if not exists criado_em timestamp with time zone default now();
alter table public.clientes_fiado add column if not exists atualizado_em timestamp with time zone default now();

-- 6. TABELA DE HISTÓRICO DE FIADO (EXTRATO DE DÍVIDAS E PAGAMENTOS)
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

alter table public.historico_fiado add column if not exists cliente_id text not null default '';
alter table public.historico_fiado add column if not exists cliente_nome text default '';
alter table public.historico_fiado add column if not exists venda_id text;
alter table public.historico_fiado add column if not exists invoice_number text;
alter table public.historico_fiado add column if not exists tipo text not null default 'COMPRA_FIADO';
alter table public.historico_fiado add column if not exists valor numeric not null default 0;
alter table public.historico_fiado add column if not exists saldo_anterior numeric not null default 0;
alter table public.historico_fiado add column if not exists saldo_posterior numeric not null default 0;
alter table public.historico_fiado add column if not exists data timestamp with time zone default now();
alter table public.historico_fiado add column if not exists registrado_por text default '';
alter table public.historico_fiado add column if not exists observacoes text;

-- 7. TABELA DE PERFIS DE UTILIZADORES (AUTENTICAÇÃO E GESTÃO DE ACESSOS)
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

alter table public.profiles add column if not exists email text not null default '';
alter table public.profiles add column if not exists name text not null default '';
alter table public.profiles add column if not exists role text not null default 'VENDEDOR';
alter table public.profiles add column if not exists pin text default '2026';
alter table public.profiles add column if not exists active boolean not null default true;
alter table public.profiles add column if not exists last_login timestamp with time zone;
alter table public.profiles add column if not exists created_at timestamp with time zone default now();
alter table public.profiles add column if not exists updated_at timestamp with time zone default now();

-- Índices de Alta Performance para Consultas Rápidas
create index if not exists idx_produtos_barcode on public.produtos (barcode);
create index if not exists idx_produtos_category on public.produtos (category);
create index if not exists idx_vendas_invoice on public.vendas ("invoiceNumber");
create index if not exists idx_vendas_created_at on public.vendas ("createdAt" desc);
create index if not exists idx_vendas_seller on public.vendas ("sellerId");
create index if not exists idx_mov_estoque_prod on public.movimentacoes_estoque ("productId");
create index if not exists idx_despesas_date on public.despesas (date desc);
create index if not exists idx_fiado_cliente on public.historico_fiado (cliente_id);

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
alter table public.profiles replica identity full;

-- ==============================================================================
-- PUBLICAÇÃO REALTIME (SUPABASE_REALTIME - 100% IDEMPOTENTE)
-- Adiciona apenas as tabelas que ainda não forem membros da publicação,
-- evitando qualquer erro caso o Realtime já tenha sido ativado no painel.
-- ==============================================================================
do $$
declare
  tbl text;
  tables_to_add text[] := array[
    'produtos',
    'vendas',
    'despesas',
    'clientes_fiado',
    'historico_fiado',
    'movimentacoes_estoque',
    'profiles'
  ];
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;

  foreach tbl in array tables_to_add
  loop
    if not exists (
      select 1 from pg_publication_tables 
      where pubname = 'supabase_realtime' 
        and schemaname = 'public' 
        and tablename = tbl
    ) then
      execute format('alter publication supabase_realtime add table public.%I;', tbl);
    end if;
  end loop;
end $$;

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
alter table public.profiles enable row level security;

-- Remove políticas antigas se existirem para evitar duplicidade
drop policy if exists "kwanzapos_produtos_all" on public.produtos;
drop policy if exists "kwanzapos_vendas_all" on public.vendas;
drop policy if exists "kwanzapos_despesas_all" on public.despesas;
drop policy if exists "kwanzapos_clientes_fiado_all" on public.clientes_fiado;
drop policy if exists "kwanzapos_historico_fiado_all" on public.historico_fiado;
drop policy if exists "kwanzapos_movimentacoes_estoque_all" on public.movimentacoes_estoque;
drop policy if exists "kwanzapos_profiles_all" on public.profiles;

create policy "kwanzapos_produtos_all" on public.produtos for all using (true) with check (true);
create policy "kwanzapos_vendas_all" on public.vendas for all using (true) with check (true);
create policy "kwanzapos_despesas_all" on public.despesas for all using (true) with check (true);
create policy "kwanzapos_clientes_fiado_all" on public.clientes_fiado for all using (true) with check (true);
create policy "kwanzapos_historico_fiado_all" on public.historico_fiado for all using (true) with check (true);
create policy "kwanzapos_movimentacoes_estoque_all" on public.movimentacoes_estoque for all using (true) with check (true);
create policy "kwanzapos_profiles_all" on public.profiles for all using (true) with check (true);

-- Seed inicial dos perfis da VMA Comercial Lda
insert into public.profiles (id, email, name, role, pin, active)
values
  ('usr-admin-victor',     'victorabreu528@gmail.com',    'Victor Abreu',   'ADMINISTRADOR', '2026', true),
  ('usr-gerente-mauro',   'mauro.jorge@vma.co.ao',       'Mauro Jorge',    'GERENTE',       '2026', true),
  ('usr-vendedor-daniel', 'daniel.muzala@vma.co.ao',     'Daniel Muzala',  'VENDEDOR',      '2026', true),
  ('usr-vendedor-alberto','alberto.lito@vma.co.ao',      'Alberto Lito',   'VENDEDOR',      '2026', true)
on conflict (email) do nothing;

-- ==============================================================================
-- RECARREGAR SCHEMA CACHE DO SUPABASE (POSTGREST)
-- ==============================================================================
notify pgrst, 'reload schema';

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

