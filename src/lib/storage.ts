import { supabase } from './supabase';

export const storage = {
  // 1. PRODUTOS
  produtos: {
    async getAll() {
      const { data, error } = await supabase.from('produtos').select('*').order('nome', { ascending: true });
      if (error) throw error;
      return data || [];
    },
    async save(produto: any) {
      // Garante que os dados vão em português e com fallback para evitar null
      const payload = {
        id: produto.id,
        nome: produto.nome || '',
        barcode: produto.barcode || '',
        categoria: produto.categoria || 'Geral',
        preco_custo: Number(produto.preco_custo) || 0,
        preco_venda: Number(produto.preco_venda) || 0,
        quantidade: Number(produto.quantidade) || 0,
        estoque_minimo: Number(produto.estoque_minimo) || 5,
        unit: produto.unit || 'un',
        imageUrl: produto.imageUrl || null
      };
      const { data, error } = await supabase.from('produtos').upsert(payload).select();
      if (error) throw error;
      return data?.[0];
    },
    async delete(id: string) {
      const { error } = await supabase.from('produtos').delete().eq('id', id);
      if (error) throw error;
      return true;
    }
  },

  // 2. VENDAS
  vendas: {
    async getAll() {
      const { data, error } = await supabase.from('vendas').select('*').order('createdAt', { ascending: false });
      if (error) throw error;
      return data || [];
    },
    async save(venda: any) {
      const { data, error } = await supabase.from('vendas').insert(venda).select();
      if (error) throw error;
      return data?.[0];
    }
  },

  // 3. MOVIMENTAÇÕES DE ESTOQUE
  movimentacoes: {
    async getAll() {
      const { data, error } = await supabase.from('movimentacoes_estoque').select('*').order('createdAt', { ascending: false });
      if (error) throw error;
      return data || [];
    },
    async log(movimento: any) {
      const { data, error } = await supabase.from('movimentacoes_estoque').insert(movimento).select();
      if (error) throw error;
      return data?.[0];
    }
  },

  // 4. DESPESAS
  despesas: {
    async getAll() {
      const { data, error } = await supabase.from('despesas').select('*').order('date', { ascending: false });
      if (error) throw error;
      return data || [];
    },
    async save(despesa: any) {
      const { data, error } = await supabase.from('despesas').insert(despesa).select();
      if (error) throw error;
      return data?.[0];
    }
  }
};
// Legacy compatibility stubs required by supabase.ts
export function getSupabaseConfig() {
  return { url: '', anonKey: '' };
}
export function getSales() {
  return [];
}
export function getSyncQueue() {
  return [];
}
export function getUnsyncedSales() {
  return [];
}
export function markSalesAsSynced(_ids: string[]) {
  // no-op
}
export function removeSyncQueueItem(_id: string) {
  // no-op
}
export function removeSyncQueueItemsForSale(_saleId: string) {
  // no-op
}
export function saveSupabaseConfig(_config: any) {
  // no-op
}
