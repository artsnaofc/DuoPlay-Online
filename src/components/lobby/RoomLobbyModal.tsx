// ============================================================================
// Component: RoomLobbyModal — DuoPlay-Online
// Phase: Fase 7.0.2 — Correção do RLS e Carregamento do Lobby
// Description: Modal de criação, entrada por código e espera de sala.
//              Gerencia estados explícitos de carregamento, erro e espera,
//              garantindo que erros de RLS ou rede não gerem telas vazias.
// ============================================================================

import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  X,
  Plus,
  LogIn,
  Copy,
  Check,
  Users,
  Play,
  RotateCw,
  AlertCircle,
  Crown,
  UserCheck,
  UserX,
  ArrowLeft,
  RefreshCw,
} from 'lucide-react';
import {
  createRoom,
  joinRoomByCode,
  setMemberReady,
  startMatch,
  leaveRoom,
  getRoomDetails,
  RoomWithMembers,
} from '@/services/rooms';
import { useAuth } from '@/hooks/useAuth';

interface RoomLobbyModalProps {
  isOpen: boolean;
  initialCode?: string | null;
  onClose: () => void;
  onMatchStarted: (matchId: string) => void;
}

export const RoomLobbyModal: React.FC<RoomLobbyModalProps> = ({
  isOpen,
  initialCode,
  onClose,
  onMatchStarted,
}) => {
  const { user } = useAuth();
  const currentUserId = user?.id || null;

  const [mode, setMode] = useState<'options' | 'join' | 'waiting'>('options');
  const [joinCode, setJoinCode] = useState(initialCode || '');
  const [currentRoom, setCurrentRoom] = useState<RoomWithMembers | null>(null);
  const [pendingRoomId, setPendingRoomId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const pollingRef = useRef<number | null>(null);

  // Limpar erro ao mudar de modo
  const changeMode = (newMode: 'options' | 'join' | 'waiting') => {
    setErrorMessage(null);
    setMode(newMode);
  };

  // Se receber código inicial via prop (ex: URL ?room=XYZ), abre direto no modo join
  useEffect(() => {
    if (initialCode && initialCode.trim()) {
      setJoinCode(initialCode.trim().toUpperCase());
      setMode('join');
    }
  }, [initialCode]);

  // Carrega ou recarrega os detalhes da sala de forma idempotente (sem criar nova sala)
  const loadRoom = useCallback(async (roomId: string) => {
    setIsLoading(true);
    setErrorMessage(null);

    const result = await getRoomDetails(roomId);
    setIsLoading(false);

    if (result.success && result.data) {
      setCurrentRoom(result.data);
      setPendingRoomId(roomId);
      setMode('waiting');
      return true;
    } else {
      setErrorMessage(result.error || 'Não foi possível carregar os dados da sala.');
      setPendingRoomId(roomId);
      return false;
    }
  }, []);

  // Polling para sincronização periódica da sala enquanto estiver em espera
  const refreshRoom = useCallback(async (roomId: string) => {
    const result = await getRoomDetails(roomId);
    if (!result.success || !result.data) return;

    setCurrentRoom(result.data);

    // Se o status da sala mudou para in_game e temos o ID da partida, transitar automaticamente!
    if (result.data.status === 'in_game' && result.data.current_match_id) {
      if (pollingRef.current) clearInterval(pollingRef.current);
      onMatchStarted(result.data.current_match_id);
    }
  }, [onMatchStarted]);

  useEffect(() => {
    if (mode === 'waiting' && currentRoom?.id) {
      // Polling a cada 2 segundos para sincronizar entrada de novos jogadores e início da partida
      pollingRef.current = window.setInterval(() => {
        refreshRoom(currentRoom.id);
      }, 2000);

      return () => {
        if (pollingRef.current) clearInterval(pollingRef.current);
      };
    }
  }, [mode, currentRoom?.id, refreshRoom]);

  // 1. Ação: Criar Sala
  const handleCreateRoom = async () => {
    setIsLoading(true);
    setErrorMessage(null);

    const result = await createRoom('tic_tac_toe', 'Jogo da Velha Multiplayer');

    if (result.success && result.data?.room?.id) {
      const roomId = result.data.room.id;
      setPendingRoomId(roomId);
      const loaded = await loadRoom(roomId);
      if (!loaded) {
        // Se a leitura inicial falhar, entra em waiting para exibir o erro e botão de retry
        setMode('waiting');
      }
    } else {
      setIsLoading(false);
      setErrorMessage(result.error || 'Não foi possível criar a sala.');
    }
  };

  // 2. Ação: Entrar na Sala com código
  const handleJoinRoom = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!joinCode.trim()) return;

    setIsLoading(true);
    setErrorMessage(null);

    const result = await joinRoomByCode(joinCode.trim());

    if (result.success && result.data?.room?.id) {
      const roomId = result.data.room.id;
      setPendingRoomId(roomId);
      const loaded = await loadRoom(roomId);
      if (!loaded) {
        setMode('waiting');
      }
    } else {
      setIsLoading(false);
      setErrorMessage(result.error || 'Código de sala inválido ou sala cheia.');
    }
  };

  // 3. Ação: Alterar Prontidão (Ready)
  const handleToggleReady = async () => {
    if (!currentRoom || !currentUserId) return;
    const myMember = currentRoom.members.find((m) => m.user_id === currentUserId);
    if (!myMember) return;

    setIsLoading(true);
    const newReadyState = !myMember.is_ready;
    const result = await setMemberReady(currentRoom.id, newReadyState);
    setIsLoading(false);

    if (result.success) {
      await refreshRoom(currentRoom.id);
    } else {
      setErrorMessage(result.error || 'Erro ao alterar prontidão.');
    }
  };

  // 4. Ação: Iniciar Partida (Apenas Host)
  const handleStartMatch = async () => {
    if (!currentRoom) return;

    setIsLoading(true);
    setErrorMessage(null);

    const result = await startMatch(currentRoom.id);
    setIsLoading(false);

    if (result.success && result.data?.matchId) {
      if (pollingRef.current) clearInterval(pollingRef.current);
      onMatchStarted(result.data.matchId);
    } else {
      setErrorMessage(result.error || 'Não foi possível iniciar a partida.');
    }
  };

  // 5. Ação: Sair da Sala
  const handleLeaveRoom = async () => {
    const targetRoomId = currentRoom?.id || pendingRoomId;
    if (targetRoomId) {
      await leaveRoom(targetRoomId);
    }
    if (pollingRef.current) clearInterval(pollingRef.current);
    setCurrentRoom(null);
    setPendingRoomId(null);
    setErrorMessage(null);
    setMode('options');
  };

  const copyCodeToClipboard = () => {
    if (!currentRoom?.code) return;
    navigator.clipboard.writeText(currentRoom.code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (!isOpen) return null;

  const isHost = currentRoom?.host_id === currentUserId;
  const myMember = currentRoom?.members.find((m) => m.user_id === currentUserId);
  const guestMember = currentRoom?.members.find((m) => m.user_id !== currentRoom?.host_id);
  const canStartMatch = isHost && (currentRoom?.members.length || 0) >= 2;

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-in fade-in duration-200"
    >
      <div className="relative w-full max-w-md rounded-2xl bg-slate-900 border border-slate-800 shadow-2xl p-6 overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between pb-4 mb-4 border-b border-slate-800">
          <div className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-full bg-blue-500" />
            <h2 className="text-base font-bold text-white tracking-tight">
              {mode === 'waiting' ? 'Sala de Espera' : 'Multiplayer — Jogo da Velha'}
            </h2>
          </div>
          <button
            onClick={() => {
              if (mode === 'waiting') handleLeaveRoom();
              onClose();
            }}
            className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
            aria-label="Fechar"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Global Error banner if in options or join mode */}
        {errorMessage && mode !== 'waiting' && (
          <div className="mb-4 p-3 rounded-xl bg-red-950/60 border border-red-800/80 text-red-200 text-xs flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0 text-red-400" />
            <span className="grow">{errorMessage}</span>
          </div>
        )}

        {/* 1. MODO: Options (Criar ou Entrar) */}
        {mode === 'options' && (
          <div className="space-y-4">
            <p className="text-xs text-slate-300 leading-relaxed">
              Jogue em tempo real com um amigo. Crie uma nova sala para gerar um código ou entre em uma sala existente.
            </p>

            <div className="grid grid-cols-1 gap-3 pt-2">
              <button
                onClick={handleCreateRoom}
                disabled={isLoading}
                className="w-full flex items-center justify-between p-4 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-bold text-sm shadow-md shadow-blue-900/30 transition-all active:scale-[0.98] disabled:opacity-50"
              >
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-lg bg-blue-700/60 flex items-center justify-center">
                    <Plus className="w-5 h-5 text-white" />
                  </div>
                  <div className="text-left">
                    <div className="leading-tight">Criar Nova Sala</div>
                    <div className="text-[11px] text-blue-200 font-normal">Gere um código para convidar um amigo</div>
                  </div>
                </div>
                {isLoading && <RotateCw className="w-4 h-4 animate-spin text-white" />}
              </button>

              <button
                onClick={() => changeMode('join')}
                disabled={isLoading}
                className="w-full flex items-center justify-between p-4 rounded-xl bg-slate-850 hover:bg-slate-800 border border-slate-700/80 text-slate-200 font-bold text-sm transition-all active:scale-[0.98]"
              >
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-lg bg-slate-800 flex items-center justify-center text-slate-300">
                    <LogIn className="w-5 h-5" />
                  </div>
                  <div className="text-left">
                    <div className="leading-tight">Entrar com Código</div>
                    <div className="text-[11px] text-slate-400 font-normal">Insira o código de uma sala existente</div>
                  </div>
                </div>
              </button>
            </div>
          </div>
        )}

        {/* 2. MODO: Join (Inserir Código) */}
        {mode === 'join' && (
          <form onSubmit={handleJoinRoom} className="space-y-4">
            <div>
              <label htmlFor="room-code-input" className="block text-xs font-semibold text-slate-300 mb-1.5">
                Código da Sala (6 caracteres)
              </label>
              <input
                id="room-code-input"
                type="text"
                maxLength={8}
                value={joinCode}
                onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
                placeholder="Ex: ABC123"
                className="w-full px-4 py-3 rounded-xl bg-slate-950 border border-slate-800 text-white font-mono text-center tracking-widest text-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent uppercase"
                autoFocus
              />
            </div>

            <div className="flex gap-2 pt-2">
              <button
                type="button"
                onClick={() => changeMode('options')}
                className="w-1/3 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-750 text-slate-300 font-semibold text-xs transition-colors"
              >
                Voltar
              </button>
              <button
                type="submit"
                disabled={isLoading || joinCode.trim().length < 4}
                className="w-2/3 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-bold text-xs shadow-md shadow-blue-900/30 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {isLoading && <RotateCw className="w-4 h-4 animate-spin" />}
                <span>Entrar na Sala</span>
              </button>
            </div>
          </form>
        )}

        {/* 3. MODO: Waiting Room (Sala de Espera) */}
        {mode === 'waiting' && (
          <>
            {/* Caso 1: Sala carregada com sucesso */}
            {currentRoom && (
              <div className="space-y-5">
                {/* Room Code Card */}
                <div className="p-4 rounded-xl bg-slate-950 border border-slate-800 text-center space-y-2">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                    Código para convidar amigo:
                  </span>
                  <div className="flex items-center justify-center gap-3">
                    <span className="text-2xl sm:text-3xl font-mono font-black text-blue-400 tracking-wider">
                      {currentRoom.code}
                    </span>
                    <button
                      type="button"
                      onClick={copyCodeToClipboard}
                      className="p-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 transition-colors"
                      title="Copiar Código"
                    >
                      {copied ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
                    </button>
                  </div>
                  <p className="text-[11px] text-slate-500">
                    {copied ? 'Código copiado para a área de transferência!' : 'Compartilhe este código com quem vai jogar'}
                  </p>
                </div>

                {/* Players list */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-xs text-slate-400 font-semibold px-1">
                    <span>Participantes ({currentRoom.members.length}/2)</span>
                    <Users className="w-3.5 h-3.5" />
                  </div>

                  {/* Slot 1: Host */}
                  <div className="p-3 rounded-xl bg-slate-800/60 border border-slate-750 flex items-center justify-between">
                    <div className="flex items-center gap-2.5">
                      <div className="w-7 h-7 rounded-lg bg-blue-600/30 border border-blue-500/40 text-blue-400 font-black text-xs flex items-center justify-center">
                        X
                      </div>
                      <div>
                        <div className="text-xs font-bold text-white flex items-center gap-1.5">
                          <span>{currentRoom.members[0]?.display_name || 'Anfitrião'}</span>
                          {currentRoom.members[0]?.user_id === currentUserId && (
                            <span className="text-[10px] text-slate-400 font-normal">(Você)</span>
                          )}
                          <Crown className="w-3 h-3 text-amber-400 shrink-0" />
                        </div>
                        <div className="text-[10px] text-slate-400">Slot 1 · Host</div>
                      </div>
                    </div>
                    <span className="text-[11px] font-bold text-emerald-400 flex items-center gap-1">
                      <UserCheck className="w-3.5 h-3.5" /> Pronto
                    </span>
                  </div>

                  {/* Slot 2: Guest */}
                  {guestMember ? (
                    <div className="p-3 rounded-xl bg-slate-800/60 border border-slate-750 flex items-center justify-between">
                      <div className="flex items-center gap-2.5">
                        <div className="w-7 h-7 rounded-lg bg-purple-600/30 border border-purple-500/40 text-purple-400 font-black text-xs flex items-center justify-center">
                          O
                        </div>
                        <div>
                          <div className="text-xs font-bold text-white flex items-center gap-1.5">
                            <span>{guestMember.display_name}</span>
                            {guestMember.user_id === currentUserId && (
                              <span className="text-[10px] text-slate-400 font-normal">(Você)</span>
                            )}
                          </div>
                          <div className="text-[10px] text-slate-400">Slot 2 · Convidado</div>
                        </div>
                      </div>
                      <span
                        className={`text-[11px] font-bold flex items-center gap-1 ${
                          guestMember.is_ready ? 'text-emerald-400' : 'text-amber-400'
                        }`}
                      >
                        {guestMember.is_ready ? (
                          <>
                            <UserCheck className="w-3.5 h-3.5" /> Pronto
                          </>
                        ) : (
                          <>
                            <UserX className="w-3.5 h-3.5" /> Preparando...
                          </>
                        )}
                      </span>
                    </div>
                  ) : (
                    <div className="p-3.5 rounded-xl border border-dashed border-slate-800 bg-slate-950/40 text-center">
                      <p className="text-xs text-slate-400 animate-pulse">
                        Aguardando entrada do segundo jogador...
                      </p>
                    </div>
                  )}
                </div>

                {/* Action buttons */}
                <div className="pt-2 flex flex-col gap-2">
                  {isHost ? (
                    <button
                      onClick={handleStartMatch}
                      disabled={isLoading || !canStartMatch}
                      className="w-full py-3 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-bold text-xs shadow-md shadow-blue-900/40 transition-all flex items-center justify-center gap-2 disabled:opacity-40"
                    >
                      {isLoading ? <RotateCw className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
                      <span>{canStartMatch ? 'Iniciar Partida Agora' : 'Aguardando 2º Jogador'}</span>
                    </button>
                  ) : (
                    <button
                      onClick={handleToggleReady}
                      disabled={isLoading}
                      className={`w-full py-3 rounded-xl font-bold text-xs transition-all flex items-center justify-center gap-2 ${
                        myMember?.is_ready
                          ? 'bg-slate-800 text-slate-200 hover:bg-slate-750'
                          : 'bg-emerald-600 hover:bg-emerald-500 text-white shadow-md shadow-emerald-900/30'
                      }`}
                    >
                      {isLoading && <RotateCw className="w-4 h-4 animate-spin" />}
                      <span>{myMember?.is_ready ? 'Cancelar Prontidão' : 'Estou Pronto para Jogar!'}</span>
                    </button>
                  )}

                  <button
                    onClick={handleLeaveRoom}
                    className="w-full py-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-slate-400 hover:text-slate-200 font-semibold text-xs transition-colors border border-slate-800"
                  >
                    Sair da Sala
                  </button>
                </div>
              </div>
            )}

            {/* Caso 2: Em carregamento inicial da sala */}
            {!currentRoom && isLoading && (
              <div className="py-12 flex flex-col items-center justify-center space-y-3 text-center">
                <RefreshCw className="w-8 h-8 animate-spin text-blue-400" />
                <p className="text-sm font-semibold text-white">Carregando dados da sala...</p>
                <p className="text-xs text-slate-400">Sincronizando participantes e estado oficial.</p>
              </div>
            )}

            {/* Caso 3: Falha de carregamento da sala (Nunca renderiza modal vazio) */}
            {!currentRoom && !isLoading && (
              <div className="p-4 rounded-xl bg-slate-950 border border-slate-800 text-center space-y-4">
                <div className="w-10 h-10 rounded-full bg-red-950/60 border border-red-800/80 text-red-400 flex items-center justify-center mx-auto">
                  <AlertCircle className="w-5 h-5" />
                </div>
                <div className="space-y-1">
                  <h3 className="text-sm font-bold text-white">Falha ao carregar a sala</h3>
                  <p className="text-xs text-slate-400">
                    {errorMessage || 'A sala foi criada, mas não foi possível carregar seus dados no momento.'}
                  </p>
                </div>
                <div className="flex gap-2 pt-2">
                  <button
                    type="button"
                    onClick={handleLeaveRoom}
                    className="w-1/3 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-750 text-slate-300 font-semibold text-xs transition-colors flex items-center justify-center gap-1.5"
                  >
                    <ArrowLeft className="w-3.5 h-3.5" />
                    <span>Voltar</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => pendingRoomId && loadRoom(pendingRoomId)}
                    disabled={!pendingRoomId}
                    className="w-2/3 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-bold text-xs transition-colors flex items-center justify-center gap-2"
                  >
                    <RotateCw className="w-3.5 h-3.5" />
                    <span>Tentar Novamente</span>
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
};
