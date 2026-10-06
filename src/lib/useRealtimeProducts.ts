import { useState, useEffect, useCallback, useRef } from 'react';
import { getSupabaseClient } from './supabase';
import { getProducts, saveProduct, deleteProduct } from './storage';
import { Product } from '../types';
import { subscribeToRealtimeSync } from './realtimeSync';
import { directUpsertProduct, directDeleteProduct } from './supabaseDirect';

export interface UseRealtimeProductsReturn {
  products: Product[];
  isLoading: boolean;
  isOnline: boolean;
  statusConexao: 'CONECTANDO' | 'ONLINE' | 'OFFLINE' | 'RECONECTANDO';
  updateStockOptimistic: (productId: string, newStock: number) => Promise<boolean>;
  upsertProductOptimistic: (product: Product) => Promise<boolean>;
  deleteProductOptimistic: (productId: string) => Promise<boolean>;
  refreshManual: () => Promise<void>;
}

/**
 * Hook de Produção para Sincronização em Tempo Real de Produtos (Supabase Realtime)
 * 
 * - WebSocket Client-Side direto e compartilhado via Singleton
 * - Optimistic Updates para resposta instantânea (0ms no ecrã ativo)
 * - Propagação em tempo real para Desktop, Tablet e Telemóvel
 */
export function useRealtimeProducts(): UseRealtimeProductsReturn {
  const [products, setProducts] = useState<Product[]>(() => getProducts());
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [statusConexao, setStatusConexao] = useState<'CONECTANDO' | 'ONLINE' | 'OFFLINE' | 'RECONECTANDO'>('ONLINE');
  
  const productsRef = useRef<Product[]>(products);
  productsRef.current = products;

  // 1. Carregamento e sincronização
  const refreshFromLocal = useCallback(() => {
    setProducts(getProducts());
  }, []);

  const refreshManual = useCallback(async () => {
    setIsLoading(true);
    const supabase = getSupabaseClient();
    if (supabase) {
      try {
        const { data, error } = await supabase
          .from('produtos')
          .select('*');

        if (!error && Array.isArray(data)) {
          const mapped: Product[] = data.map((r: any) => ({
            id: String(r.id),
            name: r.name || r.nome || 'Sem nome',
            barcode: r.barcode || '',
            category: r.category || r.categoria || 'Geral',
            price: Number(r.price ?? r.preco ?? 0),
            costPrice: Number(r.costPrice ?? r.preco_custo ?? r.precoCusto ?? 0),
            stock: Number(r.stock ?? r.estoque ?? 0),
            minStock: Number(r.minStock ?? r.estoque_minimo ?? r.estoqueMinimo ?? 5),
            unit: r.unit || r.unidade || 'un',
            imageUrl: r.imageUrl || r.imagem_url || undefined,
            updatedAt: r.updatedAt || r.atualizado_em || new Date().toISOString(),
          }));
          mapped.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
          setProducts(mapped);
        } else {
          refreshFromLocal();
        }
      } catch {
        refreshFromLocal();
      }
    } else {
      refreshFromLocal();
    }
    setIsLoading(false);
  }, [refreshFromLocal]);

  // 2. Subscrição ao Master Realtime
  useEffect(() => {
    refreshManual();

    const unsubscribe = subscribeToRealtimeSync((entity) => {
      if (entity === 'produtos' || entity === 'all') {
        refreshFromLocal();
      }
    });

    return () => {
      unsubscribe();
    };
  }, [refreshManual, refreshFromLocal]);

  // 3. Atualização Otimista para Stock
  const updateStockOptimistic = useCallback(
    async (productId: string, newStock: number): Promise<boolean> => {
      const previousProducts = [...productsRef.current];
      const targetProduct = previousProducts.find((p) => String(p.id) === String(productId));
      if (!targetProduct) return false;

      const updatedProduct: Product = {
        ...targetProduct,
        stock: newStock,
        updatedAt: new Date().toISOString(),
      };

      setProducts((current) =>
        current.map((p) => (String(p.id) === String(productId) ? updatedProduct : p))
      );
      saveProduct(updatedProduct);

      const success = await directUpsertProduct(updatedProduct);
      if (!success) {
        console.warn('[RealtimeProducts] Revertendo alteração de stock...');
        setProducts(previousProducts);
        saveProduct(targetProduct);
        return false;
      }
      return true;
    },
    []
  );

  // 4. Upsert Otimista de Produto
  const upsertProductOptimistic = useCallback(
    async (product: Product): Promise<boolean> => {
      const previousProducts = [...productsRef.current];

      setProducts((current) => {
        const exists = current.some((p) => String(p.id) === String(product.id));
        if (exists) {
          return current.map((p) => (String(p.id) === String(product.id) ? product : p));
        }
        return [product, ...current];
      });
      saveProduct(product);

      const success = await directUpsertProduct(product);
      if (!success) {
        setProducts(previousProducts);
        return false;
      }
      return true;
    },
    []
  );

  // 5. Delete Otimista de Produto
  const deleteProductOptimistic = useCallback(
    async (productId: string): Promise<boolean> => {
      const previousProducts = [...productsRef.current];

      setProducts((current) => current.filter((p) => String(p.id) !== String(productId)));
      deleteProduct(productId);

      const success = await directDeleteProduct(productId);
      if (!success) {
        setProducts(previousProducts);
        return false;
      }
      return true;
    },
    []
  );

  return {
    products,
    isLoading,
    isOnline: typeof navigator !== 'undefined' ? navigator.onLine : true,
    statusConexao,
    updateStockOptimistic,
    upsertProductOptimistic,
    deleteProductOptimistic,
    refreshManual,
  };
}
