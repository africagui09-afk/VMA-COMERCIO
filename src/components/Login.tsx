import React, { useState, useEffect } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  Eye,
  EyeOff,
  KeyRound,
  Lock,
  Mail,
  Shield,
  ShieldAlert,
  ShieldCheck,
  Store,
  UserCheck,
  UserPlus,
  Users,
  LogIn,
  BadgePercent,
  Briefcase,
  ShieldCheck as ShieldAdmin,
} from 'lucide-react';
import {
  authenticateWithEmailPassword,
  registerUserWithEmailPassword,
  getStoredProfiles,
  syncProfilesFromSupabase,
  Profile,
} from '../lib/auth';
import { User, UserRole } from '../types';

interface LoginProps {
  onLoginSuccess?: (user: User) => void;
  onLoginSucesso?: (user?: User) => void;
  theme?: 'dark' | 'light';
  lockoutMessage?: string | null;
}

export const Login: React.FC<LoginProps> = ({
  onLoginSuccess,
  onLoginSucesso,
  theme = 'dark',
  lockoutMessage,
}) => {
  const [modoAba, setModoAba] = useState<'LOGIN' | 'CADASTRO'>('LOGIN');

  // Estados do Formulário de Login
  const [email, setEmail] = useState<string>('victorabreu528@gmail.com');
  const [password, setPassword] = useState<string>('vma2026');
  const [showPassword, setShowPassword] = useState<boolean>(false);

  // Estados do Formulário de Cadastro de Novo Operador
  const [novoNome, setNovoNome] = useState<string>('');
  const [novoEmail, setNovoEmail] = useState<string>('');
  const [novaSenha, setNovaSenha] = useState<string>('');
  const [novoCargo, setNovoCargo] = useState<UserRole>('VENDEDOR');

  // Estados de Controle e Feedback
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(lockoutMessage || null);
  const [infoMessage, setInfoMessage] = useState<string | null>(null);
  const [sucessoMessage, setSucessoMessage] = useState<string | null>(null);

  // Lista dinâmica de operadores
  const [profilesList, setProfilesList] = useState<Profile[]>(() => getStoredProfiles());

  useEffect(() => {
    // Sincroniza com Supabase ao abrir a tela
    syncProfilesFromSupabase().then((list) => {
      if (list && list.length > 0) {
        setProfilesList(list);
      }
    });
  }, []);

  // Submissão de Login
  const handleLoginSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);
    setInfoMessage(null);
    setSucessoMessage(null);

    if (!email.trim()) {
      setErrorMessage('Por favor, informe o seu e-mail corporativo.');
      return;
    }

    if (!password.trim()) {
      setErrorMessage('Acesso Bloqueado: A senha de acesso é obrigatória.');
      return;
    }

    setIsLoading(true);
    try {
      const result = await authenticateWithEmailPassword(email, password);
      if (result.success && result.user) {
        if (onLoginSuccess) onLoginSuccess(result.user);
        if (onLoginSucesso) onLoginSucesso(result.user);
      } else {
        setErrorMessage(result.error || 'Acesso Negado: Credenciais inválidas.');
      }
    } catch (err: any) {
      setErrorMessage(err?.message || 'Erro inesperado ao conectar ao serviço de autenticação.');
    } finally {
      setIsLoading(false);
    }
  };

  // Submissão de Cadastro de Novo Operador
  const handleCadastroSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);
    setInfoMessage(null);
    setSucessoMessage(null);

    if (!novoNome.trim()) {
      setErrorMessage('Informe o Nome Completo do colaborador.');
      return;
    }

    if (!novoEmail.trim() || !novoEmail.includes('@')) {
      setErrorMessage('Informe um e-mail válido para o operador.');
      return;
    }

    if (!novaSenha.trim() || novaSenha.length < 6) {
      setErrorMessage('A senha de acesso deve conter pelo menos 6 caracteres.');
      return;
    }

    setIsLoading(true);
    try {
      const result = await registerUserWithEmailPassword(novoNome, novoEmail, novaSenha, novoCargo);
      if (result.success && result.user) {
        setSucessoMessage(`Operador "${result.user.name}" cadastrado com sucesso! A iniciar sessão...`);
        // Atualiza a lista local de perfis
        setProfilesList(getStoredProfiles());
        setTimeout(() => {
          if (onLoginSuccess) onLoginSuccess(result.user!);
          if (onLoginSucesso) onLoginSucesso(result.user!);
        }, 1200);
      } else {
        setErrorMessage(result.error || 'Falha ao registrar novo colaborador.');
      }
    } catch (err: any) {
      setErrorMessage(err?.message || 'Erro inesperado ao registrar operador no Supabase.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleSelectQuickUser = (profileEmail: string, profileName: string) => {
    setEmail(profileEmail);
    setPassword('');
    setErrorMessage(null);
    setInfoMessage(`Operador "${profileName}" selecionado. Digite a sua palavra-passe para entrar.`);
    const pwdInput = document.getElementById('login-password');
    if (pwdInput) pwdInput.focus();
  };

  const isLight = theme === 'light';

  // Contagem dinâmica de níveis de acesso
  const countAdmin = profilesList.filter((p) => p.role === 'ADMINISTRADOR').length;
  const countGerente = profilesList.filter((p) => p.role === 'GERENTE').length;
  const countOperadores = profilesList.filter((p) => p.role === 'VENDEDOR').length;

  return (
    <div
      className={`min-h-screen flex items-center justify-center p-4 transition-colors duration-200 ${
        isLight ? 'bg-slate-100 text-slate-900' : 'bg-[#0a0d14] text-zinc-100'
      }`}
    >
      <div className="w-full max-w-lg">
        {/* Card Principal */}
        <div
          className={`rounded-2xl border shadow-2xl overflow-hidden transition-all duration-200 ${
            isLight
              ? 'bg-white border-slate-200 shadow-slate-300/40'
              : 'bg-[#111620] border-zinc-800 shadow-black/80'
          }`}
        >
          {/* Cabeçalho */}
          <div
            className={`p-6 text-center border-b ${
              isLight ? 'bg-slate-50 border-slate-200' : 'bg-[#0d131d] border-zinc-800'
            }`}
          >
            <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-gradient-to-tr from-emerald-600 to-emerald-400 text-zinc-950 font-black mb-3 shadow-lg shadow-emerald-500/20">
              <Store className="w-7 h-7 text-zinc-950" />
            </div>
            <h1
              className={`text-xl font-black tracking-tight ${
                isLight ? 'text-slate-900' : 'text-white'
              }`}
            >
              VMA Comercial Lda
            </h1>
            <p className="text-xs font-semibold text-emerald-500 uppercase tracking-wider mt-0.5">
              KwanzaPOS • Saurimo, Angola
            </p>
            <p className={`text-xs mt-1.5 ${isLight ? 'text-slate-500' : 'text-zinc-400'}`}>
              Autenticação Segura Supabase Auth & Gestão de Níveis de Acesso
            </p>

            {/* Badges de Estrutura de Acesso */}
            <div className="mt-3.5 flex items-center justify-center gap-2 flex-wrap">
              <span className="text-[10px] font-bold px-2.5 py-0.5 rounded-full bg-purple-500/15 text-purple-400 border border-purple-500/30">
                👑 1 Administrador ({countAdmin})
              </span>
              <span className="text-[10px] font-bold px-2.5 py-0.5 rounded-full bg-blue-500/15 text-blue-400 border border-blue-500/30">
                👔 1 Gerente ({countGerente})
              </span>
              <span className="text-[10px] font-bold px-2.5 py-0.5 rounded-full bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">
                🛒 {countOperadores} Operadores de Caixa
              </span>
            </div>
          </div>

          {/* Abas Alternadoras: Entrar vs Criar Acesso */}
          <div className={`flex border-b text-xs font-bold ${isLight ? 'bg-slate-100 border-slate-200' : 'bg-[#0a0e16] border-zinc-800'}`}>
            <button
              type="button"
              onClick={() => {
                setModoAba('LOGIN');
                setErrorMessage(null);
                setInfoMessage(null);
                setSucessoMessage(null);
              }}
              className={`flex-1 py-3 px-4 flex items-center justify-center gap-2 border-b-2 transition-all cursor-pointer ${
                modoAba === 'LOGIN'
                  ? 'border-emerald-500 text-emerald-500 bg-emerald-500/5 font-black'
                  : 'border-transparent text-zinc-400 hover:text-zinc-200'
              }`}
            >
              <LogIn className="w-4 h-4" />
              <span>Entrar no Sistema</span>
            </button>
            <button
              type="button"
              onClick={() => {
                setModoAba('CADASTRO');
                setErrorMessage(null);
                setInfoMessage(null);
                setSucessoMessage(null);
              }}
              className={`flex-1 py-3 px-4 flex items-center justify-center gap-2 border-b-2 transition-all cursor-pointer ${
                modoAba === 'CADASTRO'
                  ? 'border-emerald-500 text-emerald-500 bg-emerald-500/5 font-black'
                  : 'border-transparent text-zinc-400 hover:text-zinc-200'
              }`}
            >
              <UserPlus className="w-4 h-4" />
              <span>Criar Acesso / Novo Operador</span>
            </button>
          </div>

          {/* Mensagens de Feedback */}
          <div className="p-6 pb-0 space-y-3">
            {errorMessage && (
              <div className="p-3.5 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-500 text-xs flex items-start gap-2.5 animate-shake">
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                <div className="font-medium leading-relaxed">{errorMessage}</div>
              </div>
            )}

            {sucessoMessage && (
              <div className="p-3.5 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-500 text-xs flex items-start gap-2.5">
                <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
                <div className="font-medium leading-relaxed">{sucessoMessage}</div>
              </div>
            )}

            {infoMessage && (
              <div className="p-3 rounded-xl bg-blue-500/10 border border-blue-500/30 text-blue-400 text-xs flex items-start gap-2">
                <Shield className="w-4 h-4 shrink-0 mt-0.5 text-blue-400" />
                <div className="font-medium leading-relaxed">{infoMessage}</div>
              </div>
            )}
          </div>

          {/* ABA 1: LOGIN */}
          {modoAba === 'LOGIN' && (
            <div>
              <form onSubmit={handleLoginSubmit} className="p-6 space-y-4">
                {/* Campo E-mail */}
                <div className="space-y-1.5">
                  <label
                    htmlFor="login-email"
                    className={`text-xs font-bold uppercase tracking-wider ${
                      isLight ? 'text-slate-700' : 'text-zinc-300'
                    }`}
                  >
                    E-mail Corporativo
                  </label>
                  <div className="relative">
                    <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-zinc-400">
                      <Mail className="w-4 h-4" />
                    </div>
                    <input
                      id="login-email"
                      type="email"
                      required
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="operador@vma.co.ao"
                      className={`w-full pl-10 pr-3.5 py-2.5 rounded-xl text-sm font-medium border focus:outline-none focus:ring-2 focus:ring-emerald-500 transition-all ${
                        isLight
                          ? 'bg-slate-50 border-slate-300 text-slate-900 placeholder:text-slate-400'
                          : 'bg-[#0a0d14] border-zinc-700 text-zinc-100 placeholder:text-zinc-500'
                      }`}
                    />
                  </div>
                </div>

                {/* Campo Senha */}
                <div className="space-y-1.5">
                  <label
                    htmlFor="login-password"
                    className={`text-xs font-bold uppercase tracking-wider ${
                      isLight ? 'text-slate-700' : 'text-zinc-300'
                    }`}
                  >
                    Palavra-Passe / Senha
                  </label>
                  <div className="relative">
                    <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-zinc-400">
                      <Lock className="w-4 h-4" />
                    </div>
                    <input
                      id="login-password"
                      type={showPassword ? 'text' : 'password'}
                      required
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="••••••••"
                      className={`w-full pl-10 pr-10 py-2.5 rounded-xl text-sm font-medium border focus:outline-none focus:ring-2 focus:ring-emerald-500 transition-all ${
                        isLight
                          ? 'bg-slate-50 border-slate-300 text-slate-900 placeholder:text-slate-400'
                          : 'bg-[#0a0d14] border-zinc-700 text-zinc-100 placeholder:text-zinc-500'
                      }`}
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute inset-y-0 right-0 pr-3 flex items-center text-zinc-400 hover:text-zinc-200"
                      tabIndex={-1}
                    >
                      {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>

                {/* Botão de Entrar */}
                <button
                  type="submit"
                  disabled={isLoading}
                  className="w-full py-3 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-500 active:scale-[0.99] text-zinc-950 font-black text-sm shadow-lg shadow-emerald-700/20 transition-all flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
                >
                  {isLoading ? (
                    <>
                      <div className="w-4 h-4 border-2 border-zinc-950/30 border-t-zinc-950 rounded-full animate-spin" />
                      <span>Validando no Supabase Auth...</span>
                    </>
                  ) : (
                    <>
                      <KeyRound className="w-4 h-4" />
                      <span>Entrar no KwanzaPOS</span>
                    </>
                  )}
                </button>
              </form>

              {/* Lista Rápida de Operadores Ativos */}
              <div
                className={`p-5 border-t text-xs ${
                  isLight ? 'bg-slate-50 border-slate-200' : 'bg-[#0e131b] border-zinc-800'
                }`}
              >
                <div className="flex items-center justify-between mb-2.5">
                  <span
                    className={`font-bold uppercase tracking-wider text-[11px] flex items-center gap-1.5 ${
                      isLight ? 'text-slate-700' : 'text-zinc-300'
                    }`}
                  >
                    <UserCheck className="w-3.5 h-3.5 text-emerald-500" />
                    <span>Equipa & Operadores Registados:</span>
                  </span>
                  <span className="text-[10px] text-zinc-400">Clique para selecionar</span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-48 overflow-y-auto">
                  {profilesList.map((p) => {
                    const isSelected = email.toLowerCase() === p.email.toLowerCase();
                    const roleBadgeColor =
                      p.role === 'ADMINISTRADOR'
                        ? 'bg-purple-950/40 text-purple-400 border-purple-800'
                        : p.role === 'GERENTE'
                        ? 'bg-blue-950/40 text-blue-400 border-blue-800'
                        : 'bg-emerald-950/40 text-emerald-400 border-emerald-800';

                    return (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => handleSelectQuickUser(p.email, p.name)}
                        className={`p-2.5 rounded-xl border text-left flex items-center justify-between transition-all cursor-pointer ${
                          isSelected
                            ? isLight
                              ? 'bg-emerald-50 border-emerald-400 text-slate-900 shadow-sm'
                              : 'bg-[#15231c] border-emerald-500 text-white'
                            : isLight
                            ? 'bg-white border-slate-200 hover:border-slate-300 text-slate-800'
                            : 'bg-[#111620] border-zinc-800 hover:border-zinc-700 text-zinc-300'
                        }`}
                      >
                        <div className="truncate pr-1">
                          <div className="font-bold flex items-center gap-1 text-xs truncate">
                            <span className="truncate">{p.name}</span>
                            {isSelected && <CheckCircle2 className="w-3 h-3 text-emerald-500 shrink-0" />}
                          </div>
                          <div className="text-[10px] text-zinc-400 font-mono truncate">{p.email}</div>
                        </div>
                        <span
                          className={`text-[9px] font-black uppercase px-1.5 py-0.5 rounded border shrink-0 ${roleBadgeColor}`}
                        >
                          {p.role === 'ADMINISTRADOR' ? 'ADMIN' : p.role === 'GERENTE' ? 'GERENTE' : 'CAIXA'}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          )}

          {/* ABA 2: CADASTRO DE NOVO OPERADOR */}
          {modoAba === 'CADASTRO' && (
            <form onSubmit={handleCadastroSubmit} className="p-6 space-y-4">
              <div className="p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 text-xs">
                <span className="font-bold">✨ Autocadastro de Colaborador:</span>
                <p className="mt-0.5 text-[11px] leading-relaxed text-zinc-300">
                  Novos colaboradores podem criar o seu próprio login. O perfil é automaticamente gravado no Supabase e associado sem bloquear vendas ou histórico de operadores anteriores.
                </p>
              </div>

              {/* Nome Completo */}
              <div className="space-y-1.5">
                <label
                  className={`text-xs font-bold uppercase tracking-wider ${
                    isLight ? 'text-slate-700' : 'text-zinc-300'
                  }`}
                >
                  Nome Completo do Operador
                </label>
                <input
                  type="text"
                  required
                  value={novoNome}
                  onChange={(e) => setNovoNome(e.target.value)}
                  placeholder="Ex: Teresa Caixa"
                  className={`w-full px-3.5 py-2.5 rounded-xl text-sm font-medium border focus:outline-none focus:ring-2 focus:ring-emerald-500 transition-all ${
                    isLight
                      ? 'bg-slate-50 border-slate-300 text-slate-900 placeholder:text-slate-400'
                      : 'bg-[#0a0d14] border-zinc-700 text-zinc-100 placeholder:text-zinc-500'
                  }`}
                />
              </div>

              {/* E-mail */}
              <div className="space-y-1.5">
                <label
                  className={`text-xs font-bold uppercase tracking-wider ${
                    isLight ? 'text-slate-700' : 'text-zinc-300'
                  }`}
                >
                  E-mail de Acesso
                </label>
                <input
                  type="email"
                  required
                  value={novoEmail}
                  onChange={(e) => setNovoEmail(e.target.value)}
                  placeholder="teresa.caixa@vma.co.ao"
                  className={`w-full px-3.5 py-2.5 rounded-xl text-sm font-medium border focus:outline-none focus:ring-2 focus:ring-emerald-500 transition-all ${
                    isLight
                      ? 'bg-slate-50 border-slate-300 text-slate-900 placeholder:text-slate-400'
                      : 'bg-[#0a0d14] border-zinc-700 text-zinc-100 placeholder:text-zinc-500'
                  }`}
                />
              </div>

              {/* Senha */}
              <div className="space-y-1.5">
                <label
                  className={`text-xs font-bold uppercase tracking-wider ${
                    isLight ? 'text-slate-700' : 'text-zinc-300'
                  }`}
                >
                  Criar Palavra-Passe (mínimo 6 caracteres)
                </label>
                <input
                  type="password"
                  required
                  value={novaSenha}
                  onChange={(e) => setNovaSenha(e.target.value)}
                  placeholder="••••••••"
                  className={`w-full px-3.5 py-2.5 rounded-xl text-sm font-medium border focus:outline-none focus:ring-2 focus:ring-emerald-500 transition-all ${
                    isLight
                      ? 'bg-slate-50 border-slate-300 text-slate-900 placeholder:text-slate-400'
                      : 'bg-[#0a0d14] border-zinc-700 text-zinc-100 placeholder:text-zinc-500'
                  }`}
                />
              </div>

              {/* Nível de Acesso (Cargo) */}
              <div className="space-y-1.5">
                <label
                  className={`text-xs font-bold uppercase tracking-wider ${
                    isLight ? 'text-slate-700' : 'text-zinc-300'
                  }`}
                >
                  Nível de Acesso (Perfil RBAC)
                </label>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                  <button
                    type="button"
                    onClick={() => setNovoCargo('VENDEDOR')}
                    className={`p-3 rounded-xl border text-left transition-all cursor-pointer ${
                      novoCargo === 'VENDEDOR'
                        ? 'bg-emerald-500/15 border-emerald-500 ring-1 ring-emerald-500 text-emerald-400'
                        : isLight
                        ? 'bg-slate-50 border-slate-200 text-slate-700'
                        : 'bg-[#0a0d14] border-zinc-700 text-zinc-400'
                    }`}
                  >
                    <div className="font-bold text-xs">🛒 Operador</div>
                    <div className="text-[10px] mt-0.5 opacity-80">Frente de Caixa + Histórico</div>
                  </button>

                  <button
                    type="button"
                    onClick={() => setNovoCargo('GERENTE')}
                    className={`p-3 rounded-xl border text-left transition-all cursor-pointer ${
                      novoCargo === 'GERENTE'
                        ? 'bg-blue-500/15 border-blue-500 ring-1 ring-blue-500 text-blue-400'
                        : isLight
                        ? 'bg-slate-50 border-slate-200 text-slate-700'
                        : 'bg-[#0a0d14] border-zinc-700 text-zinc-400'
                    }`}
                  >
                    <div className="font-bold text-xs">👔 Gerente</div>
                    <div className="text-[10px] mt-0.5 opacity-80">Stock + Relatórios</div>
                  </button>

                  <button
                    type="button"
                    onClick={() => setNovoCargo('ADMINISTRADOR')}
                    className={`p-3 rounded-xl border text-left transition-all cursor-pointer ${
                      novoCargo === 'ADMINISTRADOR'
                        ? 'bg-purple-500/15 border-purple-500 ring-1 ring-purple-500 text-purple-400'
                        : isLight
                        ? 'bg-slate-50 border-slate-200 text-slate-700'
                        : 'bg-[#0a0d14] border-zinc-700 text-zinc-400'
                    }`}
                  >
                    <div className="font-bold text-xs">👑 Administrador</div>
                    <div className="text-[10px] mt-0.5 opacity-80">Acesso Total</div>
                  </button>
                </div>
              </div>

              {/* Botão de Registro */}
              <button
                type="submit"
                disabled={isLoading}
                className="w-full py-3.5 px-4 rounded-xl bg-emerald-500 hover:bg-emerald-400 active:scale-[0.99] text-zinc-950 font-black text-sm shadow-lg shadow-emerald-500/20 transition-all flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50 mt-2"
              >
                {isLoading ? (
                  <>
                    <div className="w-4 h-4 border-2 border-zinc-950/30 border-t-zinc-950 rounded-full animate-spin" />
                    <span>Criando Acesso no Supabase...</span>
                  </>
                ) : (
                  <>
                    <UserPlus className="w-4 h-4" />
                    <span>Criar Conta e Iniciar Sessão</span>
                  </>
                )}
              </button>
            </form>
          )}

          {/* Rodapé de Segurança */}
          <div
            className={`p-4 border-t text-[11px] flex items-center justify-between ${
              isLight ? 'bg-slate-100 text-slate-600 border-slate-200' : 'bg-[#0a0d14] text-zinc-400 border-zinc-800'
            }`}
          >
            <div className="flex items-center gap-1.5">
              <ShieldCheck className="w-4 h-4 text-emerald-500" />
              <span>Sessão Persistente & Criptografia Supabase Auth</span>
            </div>
            <span className="font-mono text-[10px]">VMA Saurimo</span>
          </div>
        </div>
      </div>
    </div>
  );
};
