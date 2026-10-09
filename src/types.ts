export type UserRole = 'VENDEDOR' | 'GERENTE' | 'ADMINISTRADOR';

export interface User {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  pin?: string;
  avatarUrl?: string;
}

// ============================================================
// PRODUTO — todos os campos em português, espelhando o Supabase
// ============================================================
export interface Product {
  id: string;
  nome: string;
  barcode: string;
  categoria: string;
  preco_custo: number;   // Preço de custo em Kz
  preco_venda: number;   // Preço de venda em Kz
  quantidade: number;    // Quantidade em estoque
  estoque_minimo: number; // Alerta de estoque mínimo
  atualizado_em: string; // ISO timestamp
  // Campos opcionais de compatibilidade (legado)
  unit?: string;
  imageUrl?: string;
}

export interface CartItem {
  product: Product;
  quantity: number;
  discount: number; // desconto em Kz
}

export type PaymentMethod = 'DINHEIRO' | 'MULTICAIXA' | 'TRANSFERENCIA' | 'MISTO' | 'FIADO';

export interface PaymentDetail {
  method: PaymentMethod;
  amount: number; // em Kz
}

export interface SaleItem {
  productId: string;
  productName: string;
  quantity: number;
  unitPrice: number;  // em Kz
  costPrice: number;  // em Kz
  discount: number;   // em Kz
  total: number;      // em Kz
}

// ============================================================
// VENDA — campos em português, espelhando o Supabase
// ============================================================
export interface Sale {
  id: string;
  numero_fatura: string;      // ex: VD-2026-0001
  itens: SaleItem[];
  subtotal: number;           // em Kz
  desconto_total?: number;    // em Kz
  total: number;              // em Kz
  custo_total?: number;       // em Kz
  pagamentos?: PaymentDetail[];
  valor_recebido?: number;    // para dinheiro
  troco?: number;             // em Kz
  operador_id: string;
  operador_nome: string;
  operador_cargo?: UserRole;
  nome_cliente?: string;
  nif_cliente?: string;
  cliente_fiado_id?: string;
  cliente_fiado_nome?: string;
  observacoes?: string;
  status: 'CONCLUIDA' | 'CANCELADA';
  cancelado_em?: string;
  cancelado_por?: string;
  motivo_cancelamento?: string;
  criado_em: string;          // ISO string
}

export type ExpenseType = 'FIXA' | 'VARIAVEL';
export type ExpenseStatus = 'PAGO' | 'PENDENTE';
export type ExpenseCategory =
  | 'Salários' | 'Renda' | 'Energia / ENDE' | 'Água / EPAL'
  | 'Internet & Comunicação' | 'Manutenção' | 'Transporte'
  | 'Mercadorias' | 'Outros' | 'FIXA' | 'VARIAVEL' | 'SALARIO' | 'PERDA';

export interface Expense {
  id: string;
  description: string;
  type?: ExpenseType;
  category: ExpenseCategory | string;
  amount: number;
  dueDate?: string;
  date: string;
  status?: ExpenseStatus;
  registeredBy: string;
  notes?: string;
  createdAt: string;
}

export interface DailySellerLimit {
  maxLimit: number;
  currentTotal: number;
  remaining: number;
  percentageUsed: number;
}

export type StockMovementType = 'ENTRADA' | 'SAIDA' | 'AJUSTE' | 'VENDA' | 'CANCELAMENTO';

// ============================================================
// MOVIMENTAÇÃO DE ESTOQUE — campos em português
// ============================================================
export interface StockMovement {
  id: string;
  produto_id: string;
  produto_nome?: string;
  tipo: StockMovementType;
  quantidade: number;
  motivo?: string;
  criado_em: string;
}

export interface SyncQueueItem {
  id: string;
  table: 'vendas' | 'produtos' | 'despesas' | 'cancelamentos' | 'movimentacoes_estoque';
  action: 'INSERT' | 'UPDATE' | 'DELETE';
  data: any;
  createdAt: string;
  attempts: number;
}
