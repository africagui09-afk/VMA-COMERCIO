import { useState, useEffect, useCallback, useMemo } from 'react';
import { getSupabaseClient } from './supabase';
import { getProducts, getSales, getExpenses } from './storage';
import { calculateAnalyticsMetrics, AnalyticsPeriod, UnifiedAnalyticsData } from './analyticsRepository';
import { subscribeToRealtimeSync } from './realtimeSync';
import { Product, Sale, Expense } from '../types';

/**
 * Hook Centralizado: usePainelAnalitico
 * 
 * Garante que Desktop, Tablet e Mobile recebam rigorosamente as mesmas métricas,
 * gráficos e demonstrativos financeiros calculados a partir dos dados em tempo real,
 * sem requerer recarga de página (F5).
 */
export function usePainelAnalitico(initialPeriod: AnalyticsPeriod = 'TUDO') {
  const [period, setPeriod] = useState<AnalyticsPeriod>(initialPeriod);
  const [sales, setSales] = useState<Sale[]>(() => getSales());
  const [products, setProducts] = useState<Product[]>(() => getProducts());
  const [expenses, setExpenses] = useState<Expense[]>(() => getExpenses());
  const [isSyncing, setIsSyncing] = useState<boolean>(false);

  // Recarrega os dados do storage local sincronizado
  const refreshLocalState = useCallback(() => {
    setSales(getSales());
    setProducts(getProducts());
    setExpenses(getExpenses());
  }, []);

  useEffect(() => {
    // Escuta em tempo real unificada (Supabase Realtime WebSocket + BroadcastChannel)
    const unsubscribe = subscribeToRealtimeSync((entity) => {
      if (entity === 'all' || entity === 'vendas' || entity === 'produtos' || entity === 'despesas') {
        refreshLocalState();
      }
    });

    setIsSyncing(true);

    return () => {
      unsubscribe();
    };
  }, [refreshLocalState]);

  // Cálculo das métricas pelo repositório unificado
  const data: UnifiedAnalyticsData = useMemo(() => {
    return calculateAnalyticsMetrics(sales, expenses, products, period);
  }, [sales, expenses, products, period]);

  return {
    period,
    setPeriod,
    data,
    metrics: data.metrics,
    filteredSales: data.filteredSales,
    filteredExpenses: data.filteredExpenses,
    paymentBreakdown: data.paymentBreakdown,
    topProducts: data.topProducts,
    categoryBreakdown: data.categoryBreakdown,
    isSyncing,
    refreshManual: refreshLocalState,
  };
}
