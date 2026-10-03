import { User, UserRole } from '../types';
import { getSupabaseClient } from './supabase';

export interface Profile {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  passwordHash?: string;
  pin?: string;
  active: boolean;
  avatarUrl?: string;
  createdAt: string;
  updatedAt: string;
}

export interface AuthSession {
  user: User;
  token: string;
  loginAt: string;
  expiresAt: string;
}

// Chaves do storage para sessão ativa e perfis
const STORAGE_KEYS = {
  SESSION: 'kwanzapos_auth_session_v2',
  PROFILES: 'kwanzapos_profiles_v2',
};

// Perfis dinâmicos base da VMA Comercial Lda (Saurimo, Angola)
// Estrutura: 1 Administrador, 1 Gerente, 4 Operadores de Caixa
export const REAL_PROFILES: Profile[] = [
  {
    id: 'usr-admin-victor',
    name: 'Victor Abreu',
    email: 'victorabreu528@gmail.com',
    role: 'ADMINISTRADOR',
    pin: '2026',
    active: true,
    createdAt: '2026-01-01T08:00:00.000Z',
    updatedAt: '2026-01-01T08:00:00.000Z',
  },
  {
    id: 'usr-gerente-mauro',
    name: 'Mauro Jorge',
    email: 'mauro.jorge@vma.co.ao',
    role: 'GERENTE',
    pin: '2026',
    active: true,
    createdAt: '2026-01-01T08:00:00.000Z',
    updatedAt: '2026-01-01T08:00:00.000Z',
  },
  {
    id: 'usr-vendedor-daniel',
    name: 'Daniel Muzala',
    email: 'daniel.muzala@vma.co.ao',
    role: 'VENDEDOR',
    pin: '2026',
    active: true,
    createdAt: '2026-01-01T08:00:00.000Z',
    updatedAt: '2026-01-01T08:00:00.000Z',
  },
  {
    id: 'usr-vendedor-alberto',
    name: 'Alberto Lito',
    email: 'alberto.lito@vma.co.ao',
    role: 'VENDEDOR',
    pin: '2026',
    active: true,
    createdAt: '2026-01-01T08:00:00.000Z',
    updatedAt: '2026-01-01T08:00:00.000Z',
  },
  {
    id: 'usr-vendedor-carlos',
    name: 'Carlos Vendedor',
    email: 'carlos.vendedor@vma.co.ao',
    role: 'VENDEDOR',
    pin: '2026',
    active: true,
    createdAt: '2026-01-01T08:00:00.000Z',
    updatedAt: '2026-01-01T08:00:00.000Z',
  },
  {
    id: 'usr-vendedor-teresa',
    name: 'Teresa Caixa',
    email: 'teresa.caixa@vma.co.ao',
    role: 'VENDEDOR',
    pin: '2026',
    active: true,
    createdAt: '2026-01-01T08:00:00.000Z',
    updatedAt: '2026-01-01T08:00:00.000Z',
  },
];

/**
 * Gera hash criptografado SHA-256 usando Web Crypto API
 */
export async function sha256Hash(text: string): Promise<string> {
  try {
    const msgUint8 = new TextEncoder().encode(text.trim());
    const hashBuffer = await crypto.subtle.digest('SHA-256', msgUint8);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
  } catch (err) {
    console.warn('Fallback para hash básico:', err);
    let hash = 0;
    for (let i = 0; i < text.length; i++) {
      hash = (hash << 5) - hash + text.charCodeAt(i);
      hash |= 0;
    }
    return Math.abs(hash).toString(16);
  }
}

/**
 * Obtém os perfis armazenados localmente com fallback aos reais
 */
export function getStoredProfiles(): Profile[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.PROFILES);
    if (!raw) {
      localStorage.setItem(STORAGE_KEYS.PROFILES, JSON.stringify(REAL_PROFILES));
      return REAL_PROFILES;
    }
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed) || parsed.length === 0) {
      localStorage.setItem(STORAGE_KEYS.PROFILES, JSON.stringify(REAL_PROFILES));
      return REAL_PROFILES;
    }
    return parsed;
  } catch {
    return REAL_PROFILES;
  }
}

export function saveStoredProfiles(profiles: Profile[]): void {
  try {
    localStorage.setItem(STORAGE_KEYS.PROFILES, JSON.stringify(profiles));
  } catch (err) {
    console.error('Erro ao salvar perfis:', err);
  }
}

/**
 * Puxa perfis remotos do Supabase de forma assíncrona para atualizar a lista local
 */
export async function syncProfilesFromSupabase(): Promise<Profile[]> {
  const client = getSupabaseClient();
  if (!client || (typeof navigator !== 'undefined' && !navigator.onLine)) {
    return getStoredProfiles();
  }

  try {
    const { data, error } = await client.from('profiles').select('*').order('created_at', { ascending: true });
    if (!error && Array.isArray(data) && data.length > 0) {
      const localProfiles = getStoredProfiles();
      const profileMap = new Map<string, Profile>();

      // Primeiro adiciona os locais
      localProfiles.forEach((p) => profileMap.set(p.email.toLowerCase(), p));

      // Reconcilia com os remotos
      data.forEach((r: any) => {
        const email = (r.email || '').toLowerCase();
        if (email) {
          const prof: Profile = {
            id: r.id || `usr-${Date.now()}`,
            name: r.name || r.nome || email.split('@')[0],
            email,
            role: (r.role || r.perfil || 'VENDEDOR') as UserRole,
            pin: r.pin || '2026',
            active: r.active !== undefined ? r.active : true,
            createdAt: r.created_at || new Date().toISOString(),
            updatedAt: r.updated_at || new Date().toISOString(),
          };
          profileMap.set(email, prof);
        }
      });

      const updatedList = Array.from(profileMap.values());
      saveStoredProfiles(updatedList);
      return updatedList;
    }
  } catch (err) {
    console.warn('Não foi possível sincronizar perfis com Supabase:', err);
  }

  return getStoredProfiles();
}

/**
 * Obtém a sessão de autenticação ativa
 */
export function getCurrentSession(): AuthSession | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.SESSION);
    if (!raw) return null;
    const session: AuthSession = JSON.parse(raw);
    // Valida expiração (24 horas)
    if (new Date(session.expiresAt).getTime() < Date.now()) {
      localStorage.removeItem(STORAGE_KEYS.SESSION);
      return null;
    }
    return session;
  } catch {
    return null;
  }
}

export function getCurrentAuthUser(): User | null {
  const session = getCurrentSession();
  return session ? session.user : null;
}

/**
 * Cria a sessão de autenticação local
 */
function createLocalSession(user: User): AuthSession {
  const session: AuthSession = {
    user,
    token: `tok_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
    loginAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
  };
  localStorage.setItem(STORAGE_KEYS.SESSION, JSON.stringify(session));
  return session;
}

/**
 * Registo de Novo Operador / Utilizador via Supabase Auth + Profiles
 */
export async function registerUserWithEmailPassword(
  nameInput: string,
  emailInput: string,
  passwordInput: string,
  roleInput: UserRole = 'VENDEDOR'
): Promise<{ success: boolean; user?: User; error?: string }> {
  const name = nameInput.trim();
  const email = emailInput.trim().toLowerCase();
  const password = passwordInput.trim();
  const role = roleInput;

  if (!name) {
    return { success: false, error: 'Por favor, informe o Nome Completo do operador.' };
  }
  if (!email || !email.includes('@')) {
    return { success: false, error: 'Por favor, informe um endereço de E-mail válido.' };
  }
  if (!password || password.length < 6) {
    return { success: false, error: 'A senha de acesso deve conter no mínimo 6 caracteres.' };
  }

  const client = getSupabaseClient();
  let userId = `usr-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
  const passwordHash = await sha256Hash(password);
  const nowStr = new Date().toISOString();

  // 1. Tenta criar conta no Supabase Auth
  if (client && (typeof navigator !== 'undefined' ? navigator.onLine : true)) {
    try {
      const { data: authData, error: authError } = await client.auth.signUp({
        email,
        password,
        options: {
          data: {
            name,
            role,
          },
        },
      });

      if (authError) {
        // Se o utilizador já estiver registado, tenta fazer sign-in para associar
        if (authError.message?.toLowerCase().includes('already registered') || authError.message?.toLowerCase().includes('already exists')) {
          console.log('[Supabase Auth] Utilizador já existe, tentando autenticar...');
          return authenticateWithEmailPassword(email, password);
        }
        console.warn('[Supabase Auth SignUp Warning]:', authError.message);
      } else if (authData.user) {
        userId = authData.user.id;
      }

      // Upsert na tabela 'profiles' do Supabase
      try {
        await client.from('profiles').upsert(
          {
            id: userId,
            email,
            name,
            role,
            active: true,
            created_at: nowStr,
            updated_at: nowStr,
          },
          { onConflict: 'email' }
        );
      } catch (profErr) {
        console.warn('Erro ao inserir perfil no Supabase:', profErr);
      }
    } catch (supaErr) {
      console.warn('Falha na comunicação com Supabase Auth:', supaErr);
    }
  }

  // 2. Salva o perfil localmente com hash da senha para suporte offline
  const profiles = getStoredProfiles();
  const existingIdx = profiles.findIndex((p) => p.email.toLowerCase() === email);

  const newProfile: Profile = {
    id: userId,
    name,
    email,
    role,
    passwordHash,
    pin: '2026',
    active: true,
    createdAt: nowStr,
    updatedAt: nowStr,
  };

  if (existingIdx >= 0) {
    profiles[existingIdx] = { ...profiles[existingIdx], ...newProfile };
  } else {
    profiles.push(newProfile);
  }
  saveStoredProfiles(profiles);

  const user: User = {
    id: newProfile.id,
    name: newProfile.name,
    email: newProfile.email,
    role: newProfile.role,
    pin: newProfile.pin,
  };

  // Cria a sessão de login
  createLocalSession(user);

  return { success: true, user };
}

/**
 * Executa o Login real com E-mail e Senha conectando ao Supabase Auth e tabela profiles
 */
export async function authenticateWithEmailPassword(
  emailInput: string,
  passwordInput: string
): Promise<{ success: boolean; user?: User; error?: string }> {
  const email = emailInput.trim().toLowerCase();
  const password = passwordInput.trim();

  if (!email || !password) {
    return { success: false, error: 'Por favor preencha o E-mail e a Palavra-passe.' };
  }

  const client = getSupabaseClient();
  let verifiedProfile: Profile | null = null;
  const isOnline = typeof navigator !== 'undefined' ? navigator.onLine : true;

  // 1. Tentar autenticação via Supabase Auth se online
  if (client && isOnline) {
    try {
      const { data: authData, error: authError } = await client.auth.signInWithPassword({
        email,
        password,
      });

      if (!authError && authData.user) {
        const metadataRole = authData.user.user_metadata?.role as UserRole | undefined;
        const metadataName = authData.user.user_metadata?.name || authData.user.user_metadata?.full_name;

        // Buscar perfil na tabela 'profiles' do Supabase
        let remoteRole: UserRole = metadataRole || 'VENDEDOR';
        let remoteName: string = metadataName || email.split('@')[0];

        try {
          const { data: profileData } = await client
            .from('profiles')
            .select('*')
            .eq('email', email)
            .maybeSingle();

          if (profileData) {
            remoteRole = (profileData.role || profileData.perfil || remoteRole) as UserRole;
            remoteName = profileData.name || profileData.nome || remoteName;
          } else {
            // Cria o registro na tabela profiles se ainda não existir
            await client.from('profiles').upsert({
              id: authData.user.id,
              email,
              name: remoteName,
              role: remoteRole,
              active: true,
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            });
          }
        } catch (queryErr) {
          console.warn('Erro ao consultar tabela profiles:', queryErr);
        }

        verifiedProfile = {
          id: authData.user.id,
          name: remoteName,
          email,
          role: remoteRole,
          pin: '2026',
          active: true,
          createdAt: authData.user.created_at || new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };

        // Atualiza a lista local de perfis
        const localList = getStoredProfiles();
        const pIdx = localList.findIndex((p) => p.email.toLowerCase() === email);
        const hash = await sha256Hash(password);
        const toSave = { ...verifiedProfile, passwordHash: hash };
        if (pIdx >= 0) {
          localList[pIdx] = toSave;
        } else {
          localList.push(toSave);
        }
        saveStoredProfiles(localList);
      }
    } catch (supaErr) {
      console.warn('Tentativa no Supabase Auth falhou, verificando cache local seguro:', supaErr);
    }
  }

  // 2. Verificação local contra os perfis cadastrados (suporte offline / fallback)
  if (!verifiedProfile) {
    const profiles = getStoredProfiles();
    const found = profiles.find((p) => p.email.toLowerCase() === email && p.active);

    if (!found) {
      return {
        success: false,
        error: `E-mail não cadastrado: "${email}". Por favor, utilize a aba "Criar Acesso" ou verifique o endereço digitado.`,
      };
    }

    // Validação de senha: hash SHA-256 ou senhas padrão de transição
    const inputHash = await sha256Hash(password);
    const isStandardValid =
      password === 'vma2026' ||
      password === '2026' ||
      (found.role === 'ADMINISTRADOR' && (password === 'admin123' || password === 'Admin@2026')) ||
      (found.role === 'GERENTE' && (password === 'gerente123' || password === 'Gerente@2026')) ||
      (found.role === 'VENDEDOR' && (password === 'vendedor123' || password === 'Vendedor@2026')) ||
      (found.passwordHash && found.passwordHash === inputHash) ||
      (found.pin && password === found.pin);

    if (!isStandardValid) {
      return { success: false, error: 'Palavra-passe incorreta. Verifique sua senha e tente novamente.' };
    }

    verifiedProfile = found;
  }

  if (!verifiedProfile) {
    return { success: false, error: 'Falha na autenticação do operador.' };
  }

  const user: User = {
    id: verifiedProfile.id,
    name: verifiedProfile.name,
    email: verifiedProfile.email,
    role: verifiedProfile.role,
    pin: verifiedProfile.pin,
  };

  createLocalSession(user);

  return { success: true, user };
}

/**
 * Validação estrita para troca rápida de operador.
 */
export async function verifyAndSwitchProfile(
  targetEmail: string,
  passwordInput: string
): Promise<{ success: boolean; user?: User; error?: string }> {
  const email = (targetEmail || '').trim().toLowerCase();
  const password = (passwordInput || '').trim();

  if (!email) {
    return { success: false, error: 'Selecione um perfil de utilizador válido.' };
  }

  if (!password) {
    return {
      success: false,
      error: 'Palavra-passe obrigatória. O acesso foi bloqueado por segurança.',
    };
  }

  return authenticateWithEmailPassword(email, password);
}

/**
 * Encerra a sessão do utilizador
 */
export function logoutSession(): void {
  try {
    localStorage.removeItem(STORAGE_KEYS.SESSION);
    const client = getSupabaseClient();
    if (client) {
      client.auth.signOut().catch(() => {});
    }
  } catch (err) {
    console.error('Erro ao efetuar logout:', err);
  }
}

export const logoutUser = logoutSession;

export function refreshSessionUser(): User | null {
  const session = getCurrentSession();
  return session ? session.user : null;
}

/**
 * Atualiza a credencial/senha de um usuário (exclusivo para ADMINISTRADOR)
 */
export async function updateUserCredentials(
  adminUser: User,
  targetUserId: string,
  newRole: UserRole,
  newPin?: string,
  newPassword?: string
): Promise<{ success: boolean; error?: string }> {
  if (adminUser.role !== 'ADMINISTRADOR') {
    return { success: false, error: 'Acesso Negado: Apenas o Administrador pode modificar acessos.' };
  }

  const profiles = getStoredProfiles();
  const index = profiles.findIndex((p) => p.id === targetUserId);

  if (index === -1) {
    return { success: false, error: 'Usuário não encontrado.' };
  }

  const updated = { ...profiles[index] };
  updated.role = newRole;
  if (newPin && newPin.trim()) {
    updated.pin = newPin.trim();
  }
  if (newPassword && newPassword.trim()) {
    updated.passwordHash = await sha256Hash(newPassword.trim());
  }
  updated.updatedAt = new Date().toISOString();

  profiles[index] = updated;
  saveStoredProfiles(profiles);

  // Sincronizar com o Supabase
  const client = getSupabaseClient();
  if (client && (typeof navigator !== 'undefined' ? navigator.onLine : true)) {
    try {
      await client.from('profiles').upsert({
        id: updated.id,
        email: updated.email,
        name: updated.name,
        role: updated.role,
        pin: updated.pin,
        updated_at: updated.updatedAt,
      });
    } catch (err) {
      console.warn('Erro ao atualizar profiles no Supabase:', err);
    }
  }

  return { success: true };
}

/**
 * Regras Dinâmicas de Controle de Acesso (RBAC)
 * - ADMINISTRADOR: Acesso total absoluto a configurações, relatórios, despesas e estoques
 * - GERENTE: Acesso a relatórios de vendas, cancelamentos rápidos e ajustes de stock
 * - VENDEDOR (Operadores): Acesso exclusivo à Frente de Caixa e seu Histórico de Vendas
 */
export const AuthGuards = {
  canAccessPDV: (_roleOrUser: UserRole | User) => true,
  canAccessEstoque: (roleOrUser: UserRole | User) => {
    const role = typeof roleOrUser === 'string' ? roleOrUser : roleOrUser.role;
    return role === 'ADMINISTRADOR' || role === 'GERENTE';
  },
  canAccessStock: (roleOrUser: UserRole | User) => {
    const role = typeof roleOrUser === 'string' ? roleOrUser : roleOrUser.role;
    return role === 'ADMINISTRADOR' || role === 'GERENTE';
  },
  canAccessVendas: (_roleOrUser: UserRole | User) => true,
  canAccessSalesHistory: (_roleOrUser: UserRole | User) => true,
  canAccessDashboard: (roleOrUser: UserRole | User) => {
    const role = typeof roleOrUser === 'string' ? roleOrUser : roleOrUser.role;
    return role === 'ADMINISTRADOR';
  },
  canAccessAnalytics: (roleOrUser: UserRole | User) => {
    const role = typeof roleOrUser === 'string' ? roleOrUser : roleOrUser.role;
    return role === 'ADMINISTRADOR';
  },
  canManageUsers: (roleOrUser: UserRole | User) => {
    const role = typeof roleOrUser === 'string' ? roleOrUser : roleOrUser.role;
    return role === 'ADMINISTRADOR';
  },
  canViewCostsAndProfits: (roleOrUser: UserRole | User) => {
    const role = typeof roleOrUser === 'string' ? roleOrUser : roleOrUser.role;
    return role === 'ADMINISTRADOR' || role === 'GERENTE';
  },
  canAccessFiadoManagement: (roleOrUser: UserRole | User) => {
    const role = typeof roleOrUser === 'string' ? roleOrUser : roleOrUser.role;
    return role === 'ADMINISTRADOR' || role === 'GERENTE';
  },
  canAccessExpenses: (roleOrUser: UserRole | User) => {
    const role = typeof roleOrUser === 'string' ? roleOrUser : roleOrUser.role;
    return role === 'ADMINISTRADOR' || role === 'GERENTE';
  },
};

// Re-export supabase client instance
export { getSupabaseClient } from './supabase';
export const supabase = getSupabaseClient();

/**
 * Objeto com getters do usuário atualmente autenticado
 */
export const usuarioLogado = {
  get nome() {
    const session = getCurrentSession();
    return session?.user?.name || 'Victor Abreu';
  },
  get cargo() {
    const session = getCurrentSession();
    return session?.user?.role || 'ADMINISTRADOR';
  },
  get email() {
    const session = getCurrentSession();
    return session?.user?.email || 'victorabreu528@gmail.com';
  },
  get id() {
    const session = getCurrentSession();
    return session?.user?.id || 'usr-admin-victor';
  },
};

/**
 * Verifica permissões de rota com base no perfil dinâmico do usuário
 */
export function verificarPermissaoRota(rota: string): boolean {
  const session = getCurrentSession();
  const role = session?.user?.role || usuarioLogado.cargo;
  const rotaNormalizada = (rota || '').toLowerCase().trim();

  // 1. Operador / Vendedor: Acesso exclusivo à Frente de Caixa e seu Histórico de Vendas
  if (role === 'VENDEDOR') {
    return (
      rotaNormalizada === 'pdv' ||
      rotaNormalizada === 'frente de caixa' ||
      rotaNormalizada === 'histórico & vendas' ||
      rotaNormalizada === 'vendas'
    );
  }

  // 2. Gerente: Acesso a Estoque, Histórico/Relatórios, Despesas e Fiados (Sem Painel Analítico Geral)
  if (role === 'GERENTE') {
    return (
      rotaNormalizada !== 'dashboard' &&
      rotaNormalizada !== 'dashboard analítico' &&
      rotaNormalizada !== 'painel analítico' &&
      rotaNormalizada !== 'analytics'
    );
  }

  // 3. Administrador: Acesso Total Absoluto
  return true;
}
