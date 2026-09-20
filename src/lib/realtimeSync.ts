import { getSupabaseClient } from './supabase';
import {
  getProducts,
  getSales,
  getExpenses,
  getStockMovements,
  getFromStorage,
  setToStorage,
  KEYS,
} from './storage';
import { getBroadcastBus, broadcastLocalChange } from './realtimeBus';
export { broadcastLocalChange };
import { Product, Sale, Expense, StockMovement } from '../types';
import { ClienteFiado, HistoricoFiado } from './fiadoService';

export type ChangeEntity = 'produtos' | 'vendas' | 'despesas' | 'fiado' | 'movimentacoes_estoque' | 'all';

export interface SyncSummary {
  produtos: number;
  vendas: number;
  despesas: number;
  fiados: number;
  movimentacoes: number;
}

// Helpers para Fiado
const FIADO_CLIENTS_KEY = 'kwanzapos_fiado_clientes';
const FIADO_HISTORY_KEY = 'kwanzapos_fiado_historico';

function getClientesLocais(): ClienteFiado[] {
  return getFromStorage<ClienteFiado[]>(FIADO_CLIENTS_KEY, []);
}

function saveClientesLocais(clientes: ClienteFiado[]): void {
  setToStorage(FIADO_CLIENTS_KEY, clientes);
}

function getHistoricoLocais(): HistoricoFiado[] {
  return getFromStorage<HistoricoFiado[]>(FIADO_HISTORY_KEY, []);
}

function saveHistoricoLocais(historico: HistoricoFiado[]): void {
  setToStorage(FIADO_HISTORY_KEY, historico);
}

/**
 * Puxa todos os dados do Supabase e reconcilia com os dados locais
 * de forma atômica e segura (útil na inicialização e após reconexão de rede).
 */
export async function pullAndMergeRemoteData(): Promise<SyncSummary> {
  const summary: SyncSummary = { produtos: 0, vendas: 0, despesas: 0, fiados: 0 };
  const client = getSupabaseClient();
  if (!client || (typeof navigator !== 'undefined' && !navigator.onLine)) {
    return summary;
  }

  try {
    // 1. Reconcilia Produtos
    const { data: remoteProducts, error: prodErr } = await client.from('produtos').select('*');
    if (!prodErr && Array.isArray(remoteProducts) && remoteProducts.length > 0) {
      const localProducts = getProducts();
      const mergedMap = new Map<string, Product>();

      localProducts.forEach((p) => mergedMap.set(p.id, p));

      remoteProducts.forEach((r: any) => {
        const remoteProd: Product = {
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
        };

        const existing = mergedMap.get(remoteProd.id);
        if (!existing || new Date(remoteProd.updatedAt) >= new Date(existing.updatedAt)) {
          mergedMap.set(remoteProd.id, remoteProd);
        }
      });

      const updatedList = Array.from(mergedMap.values());
      setToStorage(KEYS.PRODUCTS, updatedList);
      summary.produtos = updatedList.length;
    }

    // 2. Reconcilia Despesas
    const { data: remoteExpenses, error: expErr } = await client.from('despesas').select('*');
    if (!expErr && Array.isArray(remoteExpenses) && remoteExpenses.length > 0) {
      const localExpenses = getExpenses();
      const mergedExp = new Map<string, Expense>();

      localExpenses.forEach((e) => mergedExp.set(e.id, e));

      remoteExpenses.forEach((r: any) => {
        const exp: Expense = {
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
        };
        mergedExp.set(exp.id, exp);
      });

      const updatedExpList = Array.from(mergedExp.values());
      setToStorage(KEYS.EXPENSES, updatedExpList);
      summary.despesas = updatedExpList.length;
    }

    // 3. Reconcilia Clientes de Fiado e Histórico
    const { data: remoteFiado, error: fiadoErr } = await client.from('clientes_fiado').select('*');
    if (!fiadoErr && Array.isArray(remoteFiado) && remoteFiado.length > 0) {
      const localClients = getClientesLocais();
      const clientMap = new Map<string, ClienteFiado>();

      localClients.forEach((c) => clientMap.set(c.id, c));

      remoteFiado.forEach((r: any) => {
        const cli: ClienteFiado = {
          id: String(r.id),
          nome: r.nome || '',
          telefone: r.telefone || '',
          nif: r.nif || '',
          endereco: r.endereco || '',
          limite_credito: Number(r.limite_credito) || 0,
          saldo_devedor: Number(r.saldo_devedor) || 0,
          status: r.status || 'ATIVO',
          criado_em: r.criado_em || r.created_at || new Date().toISOString(),
          atualizado_em: r.atualizado_em || r.updated_at || new Date().toISOString(),
        };
        const existing = clientMap.get(cli.id);
        if (!existing || new Date(cli.atualizado_em) >= new Date(existing.atualizado_em)) {
          clientMap.set(cli.id, cli);
        }
      });

      saveClientesLocais(Array.from(clientMap.values()));
      summary.fiados = clientMap.size;
    }

    // 4. Reconcilia Vendas
    const { data: remoteSales, error: salesErr } = await client
      .from('vendas')
      .select('*')
      .order('createdAt', { ascending: false })
      .limit(150);

    if (!salesErr && Array.isArray(remoteSales) && remoteSales.length > 0) {
      const localSales = getSales();
      const salesMap = new Map<string, Sale>();

      localSales.forEach((s) => salesMap.set(s.id, s));

      remoteSales.forEach((r: any) => {
        const sale: Sale = {
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
        };
        salesMap.set(sale.id, sale);
      });

      const updatedSales = Array.from(salesMap.values()).sort(
        (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      );
      setToStorage(KEYS.SALES, updatedSales);
      summary.vendas = updatedSales.length;
    }

    // 5. Reconcilia Movimentações de Estoque
    const { data: remoteMovs, error: movsErr } = await client
      .from('movimentacoes_estoque')
      .select('*')
      .order('createdAt', { ascending: false })
      .limit(100);

    if (!movsErr && Array.isArray(remoteMovs) && remoteMovs.length > 0) {
      const localMovs = getStockMovements();
      const movsMap = new Map<string, StockMovement>();

      localMovs.forEach((m) => movsMap.set(m.id, m));

      remoteMovs.forEach((r: any) => {
        const mov: StockMovement = {
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
        };
        movsMap.set(mov.id, mov);
      });

      const updatedMovs = Array.from(movsMap.values()).sort(
        (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      );
      setToStorage(KEYS.STOCK_MOVEMENTS, updatedMovs);
      summary.movimentacoes = updatedMovs.length;
    }
  } catch (err) {
    console.warn('Erro ao reconciliar dados com Supabase:', err);
  }

  return summary;
}

/**
 * MASTER REALTIME COORDINATOR (SINGLETON)
 * 
 * Centraliza o WebSocket do Supabase para evitar vazamento de memória (Memory Leaks),
 * conflitos de canais com mesmo nome e concorrência no React 18+.
 * Todos os componentes e telas (PDV, Estoque, Vendas, Despesas, Painel Analítico, Fiados)
 * compartilham essa infraestrutura resiliente.
 */
class MasterRealtimeCoordinator {
  private subscribers = new Set<(entity: ChangeEntity) => void>();
  private activeChannel: any = null;
  private isConnecting = false;
  private heartbeatTimer: any = null;
  private reconnectTimeout: any = null;
  private isInitialized = false;

  constructor() {
    this.setupWindowListeners();
  }

  private setupWindowListeners() {
    if (typeof window === 'undefined') return;

    // 1. BroadcastChannel entre abas do mesmo dispositivo
    const bus = getBroadcastBus();
    if (bus) {
      bus.addEventListener('message', (event: MessageEvent) => {
        if (event.data && event.data.type === 'KWANZA_DATA_CHANGED') {
          this.notifySubscribers(event.data.entity || 'all');
        }
      });
    }

    // 2. Storage event para compatibilidade
    window.addEventListener('storage', (event: StorageEvent) => {
      if (event.key && event.key.startsWith('kwanzapos_')) {
        this.notifySubscribers('all');
      }
    });

    // 3. Reconexão em Dispositivos Móveis e Tablets ao desbloquear a tela ou focar na aba
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') {
        console.log('[KwanzaRealtime] Dispositivo acordou/aba visível. Reconciliando dados...');
        this.reconnectChannel();
        pullAndMergeRemoteData().then((stats) => {
          if (stats.produtos > 0 || stats.despesas > 0 || stats.fiados > 0 || stats.vendas > 0) {
            this.notifySubscribers('all');
          }
        });
      }
    });

    // 4. Reconexão de rede (Wi-Fi / Dados Móveis)
    window.addEventListener('online', () => {
      console.log('[KwanzaRealtime] Rede restabelecida (Online). Reassumindo WebSocket...');
      this.reconnectChannel();
      pullAndMergeRemoteData().then(() => this.notifySubscribers('all'));
    });
  }

  private notifySubscribers(entity: ChangeEntity) {
    this.subscribers.forEach((cb) => {
      try {
        cb(entity);
      } catch (err) {
        console.error('[KwanzaRealtime] Erro no listener do subscriber:', err);
      }
    });
  }

  public subscribe(callback: (entity: ChangeEntity) => void): () => void {
    this.subscribers.add(callback);

    if (!this.isInitialized) {
      this.isInitialized = true;
      this.initChannel();
      // Puxa dados remotos na inicialização
      pullAndMergeRemoteData().then((stats) => {
        if (stats.produtos > 0 || stats.despesas > 0 || stats.fiados > 0 || stats.vendas > 0) {
          this.notifySubscribers('all');
        }
      });
    }

    return () => {
      this.subscribers.delete(callback);
      if (this.subscribers.size === 0) {
        this.teardownChannel();
        this.isInitialized = false;
      }
    };
  }

  private initChannel() {
    const supabase = getSupabaseClient();
    if (!supabase || this.isConnecting) return;

    this.isConnecting = true;
    try {
      if (this.activeChannel) {
        try {
          supabase.removeChannel(this.activeChannel);
        } catch {
          // ignore
        }
        this.activeChannel = null;
      }

      // Nome do canal único por sessão para evitar colisão
      const channelName = `kwanza_master_realtime_${Date.now()}`;
      const channel = supabase.channel(channelName, {
        config: {
          broadcast: { self: false },
          presence: { key: 'kwanzapos_client' },
        },
      });

      // ==========================================
      // 1. PRODUTOS (Estoque Instantâneo)
      // ==========================================
      channel.on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'produtos' },
        (payload: any) => {
          try {
            const currentProds = getProducts();
            if (payload.new && payload.new.id) {
              const updatedProd: Product = {
                id: String(payload.new.id),
                name: payload.new.name || 'Sem nome',
                barcode: payload.new.barcode || '',
                category: payload.new.category || 'Geral',
                price: Number(payload.new.price) || 0,
                costPrice: Number(payload.new.costPrice) || 0,
                stock: Number(payload.new.stock) || 0,
                minStock: Number(payload.new.minStock) || 5,
                unit: payload.new.unit || 'un',
                imageUrl: payload.new.imageUrl || undefined,
                updatedAt: payload.new.updatedAt || new Date().toISOString(),
              };

              const idx = currentProds.findIndex((p) => p.id === updatedProd.id);
              if (idx >= 0) {
                currentProds[idx] = updatedProd;
              } else {
                currentProds.unshift(updatedProd);
              }
              // Grava direto no storage sem loop de eco
              setToStorage(KEYS.PRODUCTS, currentProds);
            } else if (payload.eventType === 'DELETE' && payload.old?.id) {
              const filtered = currentProds.filter((p) => p.id !== String(payload.old.id));
              setToStorage(KEYS.PRODUCTS, filtered);
            }
          } catch (err) {
            console.warn('[KwanzaRealtime] Erro ao aplicar mudança de produto:', err);
          }
          this.notifySubscribers('produtos');
        }
      );

      // ==========================================
      // 2. VENDAS (Frente de Caixa e Histórico)
      // ==========================================
      channel.on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'vendas' },
        (payload: any) => {
          try {
            const currentSales = getSales();
            if (payload.new && payload.new.id) {
              const sale: Sale = {
                id: String(payload.new.id),
                invoiceNumber: payload.new.invoiceNumber || '',
                items: Array.isArray(payload.new.items) ? payload.new.items : [],
                subtotal: Number(payload.new.subtotal) || 0,
                discountTotal: Number(payload.new.discountTotal) || 0,
                total: Number(payload.new.total) || 0,
                totalCost: Number(payload.new.totalCost) || 0,
                payments: Array.isArray(payload.new.payments) ? payload.new.payments : [],
                amountReceived: payload.new.amountReceived !== null && payload.new.amountReceived !== undefined ? Number(payload.new.amountReceived) : undefined,
                change: Number(payload.new.change) || 0,
                sellerId: payload.new.sellerId || '',
                sellerName: payload.new.sellerName || '',
                sellerRole: payload.new.sellerRole || 'VENDEDOR',
                customerName: payload.new.customerName || undefined,
                customerNif: payload.new.customerNif || undefined,
                notes: payload.new.notes || undefined,
                status: payload.new.status || 'CONCLUIDA',
                cancelledAt: payload.new.cancelledAt || undefined,
                cancelledBy: payload.new.cancelledBy || undefined,
                cancellationReason: payload.new.cancellationReason || undefined,
                createdAt: payload.new.createdAt || new Date().toISOString(),
                syncedToSupabase: true,
                sincronizado: true,
              };

              const idx = currentSales.findIndex((s) => s.id === sale.id);
              if (idx >= 0) {
                currentSales[idx] = sale;
              } else {
                currentSales.unshift(sale);
              }
              // Ordena decrescente por data
              currentSales.sort(
                (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
              );
              setToStorage(KEYS.SALES, currentSales);
            }
          } catch (err) {
            console.warn('[KwanzaRealtime] Erro ao aplicar mudança de venda:', err);
          }
          this.notifySubscribers('vendas');
        }
      );

      // ==========================================
      // 3. DESPESAS
      // ==========================================
      channel.on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'despesas' },
        (payload: any) => {
          try {
            const currentExpenses = getExpenses();
            if (payload.new && payload.new.id) {
              const exp: Expense = {
                id: String(payload.new.id),
                description: payload.new.description || '',
                type: payload.new.type || 'FIXA',
                category: payload.new.category || 'Outros',
                amount: Number(payload.new.amount) || 0,
                dueDate: payload.new.dueDate || payload.new.date,
                date: payload.new.date || new Date().toISOString().split('T')[0],
                status: payload.new.status || 'PAGO',
                registeredBy: payload.new.registeredBy || 'Sistema',
                notes: payload.new.notes || undefined,
                createdAt: payload.new.createdAt || payload.new.created_at || new Date().toISOString(),
              };
              const idx = currentExpenses.findIndex((e) => e.id === exp.id);
              if (idx >= 0) {
                currentExpenses[idx] = exp;
              } else {
                currentExpenses.unshift(exp);
              }
              setToStorage(KEYS.EXPENSES, currentExpenses);
            } else if (payload.eventType === 'DELETE' && payload.old?.id) {
              const filtered = currentExpenses.filter((e) => e.id !== String(payload.old.id));
              setToStorage(KEYS.EXPENSES, filtered);
            }
          } catch (err) {
            console.warn('[KwanzaRealtime] Erro ao aplicar mudança de despesa:', err);
          }
          this.notifySubscribers('despesas');
        }
      );

      // ==========================================
      // 4. CLIENTES DE FIADO
      // ==========================================
      channel.on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'clientes_fiado' },
        (payload: any) => {
          try {
            if (payload.new && payload.new.id) {
              const clients = getClientesLocais();
              const idx = clients.findIndex((c) => c.id === String(payload.new.id));
              const updatedClient: ClienteFiado = {
                id: String(payload.new.id),
                nome: payload.new.nome || '',
                telefone: payload.new.telefone || '',
                nif: payload.new.nif || '',
                endereco: payload.new.endereco || '',
                limite_credito: Number(payload.new.limite_credito) || 0,
                saldo_devedor: Number(payload.new.saldo_devedor) || 0,
                status: payload.new.status || 'ATIVO',
                criado_em: payload.new.criado_em || payload.new.created_at || new Date().toISOString(),
                atualizado_em: payload.new.atualizado_em || payload.new.updated_at || new Date().toISOString(),
              };
              if (idx >= 0) {
                clients[idx] = updatedClient;
              } else {
                clients.push(updatedClient);
              }
              saveClientesLocais(clients);
            }
          } catch (err) {
            console.warn('[KwanzaRealtime] Erro ao aplicar mudança de cliente fiado:', err);
          }
          this.notifySubscribers('fiado');
        }
      );

      // ==========================================
      // 5. HISTÓRICO DE FIADO
      // ==========================================
      channel.on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'historico_fiado' },
        (payload: any) => {
          try {
            if (payload.new && payload.new.id) {
              const historico = getHistoricoLocais();
              const exists = historico.some((h) => h.id === String(payload.new.id));
              if (!exists) {
                const hItem: HistoricoFiado = {
                  id: String(payload.new.id),
                  cliente_id: String(payload.new.cliente_id),
                  cliente_nome: payload.new.cliente_nome || '',
                  venda_id: payload.new.venda_id || undefined,
                  invoice_number: payload.new.invoice_number || undefined,
                  tipo: payload.new.tipo || 'COMPRA_FIADO',
                  valor: Number(payload.new.valor) || 0,
                  saldo_anterior: Number(payload.new.saldo_anterior) || 0,
                  saldo_posterior: Number(payload.new.saldo_posterior) || 0,
                  data: payload.new.data || new Date().toISOString(),
                  registrado_por: payload.new.registrado_por || '',
                  observacoes: payload.new.observacoes || undefined,
                };
                historico.unshift(hItem);
                saveHistoricoLocais(historico);
              }
            }
          } catch (err) {
            console.warn('[KwanzaRealtime] Erro ao aplicar histórico de fiado:', err);
          }
          this.notifySubscribers('fiado');
        }
      );

      // ==========================================
      // 6. MOVIMENTAÇÕES DE ESTOQUE
      // ==========================================
      channel.on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'movimentacoes_estoque' },
        (payload: any) => {
          try {
            if (payload.new && payload.new.id) {
              const movs = getStockMovements();
              const existingIdx = movs.findIndex((m) => m.id === String(payload.new.id));
              const newMov: StockMovement = {
                id: String(payload.new.id),
                productId: String(payload.new.productId || payload.new.produtoId || ''),
                tipo: payload.new.type || payload.new.tipo || 'AJUSTE',
                quantity: Number(payload.new.quantity || payload.new.quantidade) || 0,
                previousStock: Number(payload.new.previousStock || payload.new.estoqueAnterior) || 0,
                resultingStock: Number(payload.new.resultingStock || payload.new.estoqueResultante) || 0,
                reason: payload.new.reason || payload.new.motivo,
                userId: String(payload.new.userId || payload.new.responsavelId || ''),
                userName: String(payload.new.userName || payload.new.responsavelNome || ''),
                createdAt: payload.new.createdAt || payload.new.criadoEm || new Date().toISOString(),
                updatedAt: payload.new.updatedAt || payload.new.atualizadoEm || new Date().toISOString(),
                sincronizado: true,
              };
              if (existingIdx >= 0) {
                movs[existingIdx] = newMov;
              } else {
                movs.unshift(newMov);
              }
              setToStorage(KEYS.STOCK_MOVEMENTS, movs);
            }
          } catch (err) {
            console.warn('[KwanzaRealtime] Erro ao aplicar movimentação de estoque:', err);
          }
          this.notifySubscribers('produtos');
        }
      );

      // Subscrição com tratamento de status e reconexão automática
      channel.subscribe((status: string, err?: Error) => {
        this.isConnecting = false;
        if (status === 'SUBSCRIBED') {
          console.log('[KwanzaRealtime] WebSocket Conectado com Sucesso!');
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
          console.warn(`[KwanzaRealtime] Status do canal: ${status}`, err);
          this.scheduleReconnect();
        }
      });

      this.activeChannel = channel;
      this.startHeartbeat();
    } catch (err) {
      this.isConnecting = false;
      console.warn('[KwanzaRealtime] Falha ao criar canal Supabase:', err);
      this.scheduleReconnect();
    }
  }

  private scheduleReconnect() {
    if (this.reconnectTimeout) return;
    this.reconnectTimeout = setTimeout(() => {
      this.reconnectTimeout = null;
      if (this.subscribers.size > 0) {
        this.initChannel();
      }
    }, 4000);
  }

  private reconnectChannel() {
    if (this.subscribers.size > 0) {
      this.initChannel();
    }
  }

  private startHeartbeat() {
    this.stopHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      if (this.activeChannel && this.activeChannel.state !== 'joined') {
        console.log('[KwanzaRealtime] Heartbeat detectou canal desconectado. Reconectando...');
        this.reconnectChannel();
      }
    }, 25000);
  }

  private stopHeartbeat() {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  private teardownChannel() {
    this.stopHeartbeat();
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }

    const supabase = getSupabaseClient();
    if (supabase && this.activeChannel) {
      try {
        supabase.removeChannel(this.activeChannel);
      } catch {
        // ignore
      }
      this.activeChannel = null;
    }
  }
}

// Instância Singleton única na aplicação
const coordinator = new MasterRealtimeCoordinator();

/**
 * Hook/Função Principal de Subscrição em Tempo Real:
 * Utilizada por todos os componentes do sistema.
 */
export function subscribeToRealtimeSync(onDataChange: (entity: ChangeEntity) => void): () => void {
  return coordinator.subscribe(onDataChange);
}
