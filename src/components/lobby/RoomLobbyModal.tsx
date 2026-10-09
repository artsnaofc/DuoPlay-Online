// ============================================================================
// Component: RoomLobbyModal — DuoPlay-Online
// Phase: Fase 20 — Carta Duo 🃏
// Description: Modal de criação, entrada por código e espera de sala.
//              Gerencia estados explícitos de carregamento, erro e espera.
//              Suporta salas de qualquer jogo da plataforma, com suporte a
//              regras de jogos específicas (ex: Carta Duo) e de 2 a 6 jogadores.
// ============================================================================

import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
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
  UserPlus,
  Minimize2,
  Sparkles,
} from 'lucide-react';
import {
  createRoom,
  joinRoomByCode,
  setMemberReady,
  startMatch,
  leaveRoom,
  getRoomDetails,
  RoomWithMembers,
  updateRoomConfig,
} from '@/services/rooms';
import { useAuth } from '@/hooks/useAuth';
import { InviteFriendsToRoomModal } from '@/components/social/InviteFriendsToRoomModal';
import { getGameDefinition } from '@/multiplayer/registry/index';

interface RoomLobbyModalProps {
  isOpen: boolean;
  initialCode?: string | null;
  initialMode?: 'options' | 'join' | 'waiting' | 'create';
  defaultGameId?: string; // Permite definir qual jogo criar
  onClose: () => void;
  onMatchStarted: (matchId: string) => void;
}

export const RoomLobbyModal: React.FC<RoomLobbyModalProps> = ({
  isOpen,
  initialCode,
  initialMode = 'options',
  defaultGameId = 'tic_tac_toe',
  onClose,
  onMatchStarted,
}) => {
  const { user } = useAuth();
  const currentUserId = user?.id || null;

  const [mode, setMode] = useState<'options' | 'join' | 'waiting'>(
    initialMode === 'create' || initialMode === 'waiting' ? 'waiting' : initialMode
  );
  const [joinCode, setJoinCode] = useState(initialCode || '');
  const [currentRoom, setCurrentRoom] = useState<RoomWithMembers | null>(null);
  const [pendingRoomId, setPendingRoomId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [isInviteFriendsOpen, setIsInviteFriendsOpen] = useState(false);

  const pollingRef = useRef<number | null>(null);
  const lastLoadedCodeRef = useRef<string | null>(null);
  const autoCreateTriggeredRef = useRef<boolean>(false);

  // Deriva o jogo atual do lobby
  const gameDef = useMemo(() => {
    const gameId = currentRoom?.game_id || defaultGameId;
    return getGameDefinition(gameId);
  }, [currentRoom?.game_id, defaultGameId]);

  const gameTitle = gameDef?.title || 'Jogo';
  const maxPlayers = gameDef?.maxPlayers || 2;
  const isHost = currentRoom?.host_id === currentUserId;

  // Limpar erro ao mudar de modo
  const changeMode = (newMode: 'options' | 'join' | 'waiting') => {
    setErrorMessage(null);
    setMode(newMode);
  };

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

  // Auto-Entrada / Carregamento Direto ao abrir com código inicial (ex: "Voltar para a Sala")
  const handleAutoJoin = useCallback(async (codeToJoin: string) => {
    setIsLoading(true);
    setErrorMessage(null);
    setMode('waiting');

    // Se a sala já está carregada e o código é idêntico, recarrega os detalhes diretamente
    if (currentRoom && currentRoom.code === codeToJoin) {
      await loadRoom(currentRoom.id);
      return;
    }

    const result = await joinRoomByCode(codeToJoin);
    if (result.success && result.data?.room?.id) {
      const roomId = result.data.room.id;
      setPendingRoomId(roomId);
      await loadRoom(roomId);
    } else {
      setIsLoading(false);
      // Se a sala não existe ou foi encerrada, mantém o modo 'waiting' com tela de erro
      setCurrentRoom(null);
      setErrorMessage(result.error || 'Esta sala foi encerrada ou não foi encontrada.');
    }
  }, [currentRoom, loadRoom]);

  // Se receber código inicial via prop, carrega e abre a sala de espera diretamente
  useEffect(() => {
    if (!isOpen) {
      lastLoadedCodeRef.current = null;
      return;
    }

    if (initialCode && initialCode.trim()) {
      const cleanCode = initialCode.trim().toUpperCase();
      if (lastLoadedCodeRef.current !== cleanCode) {
        lastLoadedCodeRef.current = cleanCode;
        setJoinCode(cleanCode);
        handleAutoJoin(cleanCode);
      }
    } else {
      if (currentRoom && currentRoom.game_id !== defaultGameId) {
        setCurrentRoom(null);
        setPendingRoomId(null);
        setMode('options');
      } else if (mode === 'waiting' && !currentRoom) {
        setMode('options');
      }
    }
  }, [isOpen, initialCode, defaultGameId, handleAutoJoin, mode, currentRoom]);

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
  const handleCreateRoom = useCallback(async () => {
    if (isLoading) return;
    setIsLoading(true);
    setErrorMessage(null);

    const targetGameDef = getGameDefinition(defaultGameId);
    const targetGameTitle = targetGameDef?.title || 'Jogo';
    const result = await createRoom(defaultGameId, `${targetGameTitle} Multiplayer`);

    if (result.success && result.data?.room?.id) {
      const roomId = result.data.room.id;
      setPendingRoomId(roomId);

      // Se for Carta Duo, salva as regras padrão na criação da sala
      if (defaultGameId === 'carta_duo' || defaultGameId === 'carta-duo') {
        try {
          await updateRoomConfig(roomId, {
            initial_cards: 7,
            cumulative_draw: true,
            force_draw: true,
            play_immediately: true,
            turn_timer: 30,
          });
        } catch {
          // Silencia falhas transitórias de configuração inicial
        }
      }

      const loaded = await loadRoom(roomId);
      if (!loaded) {
        setMode('waiting');
      }
    } else {
      setIsLoading(false);
      setErrorMessage(result.error || 'Não foi possível criar a sala.');
      setMode('options');
    }
  }, [isLoading, defaultGameId, loadRoom]);

  // Se o modo inicial for 'create' e não houver código inicial, cria e abre imediatamente a sala
  useEffect(() => {
    if (!isOpen) {
      autoCreateTriggeredRef.current = false;
      return;
    }

    if (
      initialMode === 'create' &&
      !initialCode &&
      !currentRoom &&
      !autoCreateTriggeredRef.current
    ) {
      autoCreateTriggeredRef.current = true;
      handleCreateRoom();
    }
  }, [isOpen, initialMode, initialCode, currentRoom, handleCreateRoom]);

  // 2. Ação: Entrar na Sala com código
  const handleJoinRoom = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isLoading || !joinCode.trim()) return;

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
    if (isLoading || !currentRoom || !currentUserId) return;
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
    if (isLoading || !currentRoom || !canStartMatch) return;

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

  // 5. Ação: Sair Realmente da Sala
  const handleLeaveRoom = async () => {
    const targetRoomId = currentRoom?.id || pendingRoomId;
    if (pollingRef.current) clearInterval(pollingRef.current);

    setCurrentRoom(null);
    setPendingRoomId(null);
    setErrorMessage(null);
    setMode('options');

    if (targetRoomId) {
      try {
        await leaveRoom(targetRoomId);
      } catch {
        // Silencia falhas no encerramento da sala
      }
    }
    onClose();
  };

  const copyCodeToClipboard = () => {
    if (!currentRoom?.code) return;
    navigator.clipboard.writeText(currentRoom.code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // 6. Atualiza as configurações personalizadas da sala (Host apenas)
  const handleUpdateRule = async (key: string, value: any) => {
    if (!currentRoom || !isHost) return;
    const currentConfig = (currentRoom.config as Record<string, any>) || {};
    const newConfig = {
      ...currentConfig,
      [key]: value,
    };
    setIsLoading(true);
    const result = await updateRoomConfig(currentRoom.id, newConfig);
    setIsLoading(false);
    if (result.success) {
      await refreshRoom(currentRoom.id);
    } else {
      setErrorMessage(result.error || 'Não foi possível atualizar as configurações da sala.');
    }
  };

  if (!isOpen) return null;

  const myMember = currentRoom?.members.find((m) => m.user_id === currentUserId);
  const playerMembers = currentRoom?.members.filter((m) => m.role === 'player') || [];
  const guestMember = currentRoom?.members.find((m) => m.user_id !== currentRoom?.host_id);

  // Partida pode ser iniciada se houver a quantidade mínima regulamentar e todos estiverem prontos
  const minPlayersRequired = gameDef?.minPlayers || 2;
  const allPlayersReady = playerMembers.length >= minPlayersRequired && playerMembers.every((m) => m.is_ready);
  const canStartMatch = isHost && playerMembers.length >= minPlayersRequired && allPlayersReady;

  return (
    <div
      role="dialog"
      aria-modal="true"
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          onClose(); // Minimiza sem fechar sala
        }
      }}
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-950/80 backdrop-blur-sm animate-in fade-in duration-200 cursor-pointer"
    >
      <div className="relative w-full max-w-md max-h-[90vh] overflow-y-auto rounded-2xl bg-slate-900 border border-slate-800 shadow-2xl p-5 sm:p-6 cursor-default">
        {/* Header */}
        <div className="flex items-center justify-between pb-4 mb-4 border-b border-slate-800">
          <div className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-full bg-blue-500 animate-pulse" />
            <h2 className="text-base font-bold text-white tracking-tight">
              {mode === 'waiting' ? `Lobby — ${gameTitle}` : `Multiplayer — ${gameTitle}`}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors flex items-center gap-1.5"
            title={mode === 'waiting' ? 'Minimizar Sala (manter ativa)' : 'Fechar'}
            aria-label={mode === 'waiting' ? 'Minimizar Sala' : 'Fechar'}
          >
            {mode === 'waiting' ? (
              <>
                <span className="text-[11px] font-bold text-blue-400 hidden sm:inline">Minimizar</span>
                <Minimize2 className="w-4 h-4 text-blue-400" />
              </>
            ) : (
              <X className="w-5 h-5" />
            )}
          </button>
        </div>

        {/* Global Error banner if in options or join mode */}
        {errorMessage && (
          <div className="mb-4 p-3 rounded-xl bg-red-950/60 border border-red-800/80 text-red-200 text-xs flex items-center gap-2 animate-in fade-in">
            <AlertCircle className="w-4 h-4 shrink-0 text-red-400" />
            <span className="grow">{errorMessage}</span>
            <button type="button" onClick={() => setErrorMessage(null)} className="text-[10px] font-bold text-red-400">OK</button>
          </div>
        )}

        {/* Loading de Criação de Sala */}
        {isLoading && !currentRoom && (
          <div className="flex flex-col items-center justify-center py-12 space-y-4">
            <div className="w-12 h-12 rounded-2xl bg-blue-600/20 border border-blue-500/40 flex items-center justify-center text-blue-400">
              <RotateCw className="w-6 h-6 animate-spin text-blue-400" />
            </div>
            <div className="text-center space-y-1">
              <h3 className="text-sm font-bold text-white">Criando Sala Privada</h3>
              <p className="text-xs text-slate-400">Gerando código exclusivo para {gameTitle}...</p>
            </div>
          </div>
        )}

        {/* 1. MODO: Options (Criar ou Entrar) */}
        {mode === 'options' && !isLoading && (
          <div className="space-y-4">
            <p className="text-xs text-slate-300 leading-relaxed">
              Jogue {gameTitle} em tempo real com amigos. Crie uma nova sala para gerar um código ou entre em uma sala compartilhada por outro jogador.
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
                    <div className="text-[11px] text-blue-200 font-normal">Gera o código privado de {gameTitle}</div>
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
                    <div className="text-[11px] text-slate-400 font-normal">Insira o código de 6 caracteres do amigo</div>
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
            {currentRoom && (
              <div className="space-y-5">
                {/* Room Code Card */}
                <div className="p-4 rounded-xl bg-slate-950 border border-slate-800 text-center space-y-3">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                    Código para convidar amigos:
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
                    {copied ? 'Código copiado com sucesso!' : 'Pessoas com este código podem entrar no lobby privado.'}
                  </p>

                  {/* Convites Diretos */}
                  {isHost && currentRoom.members.length < maxPlayers && (
                    <button
                      type="button"
                      onClick={() => setIsInviteFriendsOpen(true)}
                      className="w-full py-2.5 px-4 rounded-xl bg-gradient-to-r from-blue-600/30 to-purple-600/30 hover:from-blue-600/40 hover:to-purple-600/40 border border-blue-500/40 text-blue-200 font-bold text-xs transition-all flex items-center justify-center gap-2 shadow-sm"
                    >
                      <UserPlus className="w-4 h-4 text-blue-400" />
                      <span>Convidar Amigos Online</span>
                    </button>
                  )}
                </div>

                {/* Lista Dinâmica de Membros */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-xs text-slate-400 font-semibold px-1">
                    <span>Participantes ({currentRoom.members.length}/{maxPlayers})</span>
                    <Users className="w-3.5 h-3.5" />
                  </div>

                  <div className="space-y-2 max-h-[12rem] overflow-y-auto pr-1">
                    {currentRoom.members.map((member) => {
                      const isMemberHost = member.user_id === currentRoom.host_id;
                      return (
                        <div
                          key={member.id}
                          className="p-3 rounded-xl bg-slate-800/60 border border-slate-750 flex items-center justify-between"
                        >
                          <div className="flex items-center gap-2.5">
                            <div className="w-7 h-7 rounded-lg bg-slate-900 border border-slate-700/60 text-slate-300 font-black text-xs flex items-center justify-center">
                              {member.slot_number || '?'}
                            </div>
                            <div>
                              <div className="text-xs font-bold text-white flex items-center gap-1.5">
                                <span className="truncate max-w-[8rem]">{member.display_name}</span>
                                {member.user_id === currentUserId && (
                                  <span className="text-[10px] text-slate-400 font-normal">(Você)</span>
                                )}
                                {isMemberHost && <Crown className="w-3.5 h-3.5 text-amber-400 shrink-0" />}
                              </div>
                              <div className="text-[10px] text-slate-400">
                                {isMemberHost ? 'Slot 1 · Host' : `Slot ${member.slot_number} · Convidado`}
                              </div>
                            </div>
                          </div>

                          <span
                            className={`text-[11px] font-bold flex items-center gap-1 ${
                              member.is_ready ? 'text-emerald-400' : 'text-amber-400'
                            }`}
                          >
                            {member.is_ready ? (
                              <>
                                <UserCheck className="w-3.5 h-3.5" /> Pronto
                              </>
                            ) : (
                              <>
                                <UserX className="w-3.5 h-3.5" /> Preparando
                              </>
                            )}
                          </span>
                        </div>
                      );
                    })}

                    {/* Vaga pendente */}
                    {currentRoom.members.length < maxPlayers && (
                      <div className="p-3 rounded-xl border border-dashed border-slate-800 bg-slate-950/20 text-center">
                        <p className="text-xs text-slate-500 animate-pulse">
                          Aguardando mais competidores ({currentRoom.members.length}/{maxPlayers})...
                        </p>
                      </div>
                    )}
                  </div>
                </div>

                {/* SEÇÃO DE CONFIGURAÇÕES DE REGRAS EXCLUSIVAS (CARTA DUO) */}
                {(currentRoom.game_id === 'carta_duo' || currentRoom.game_id === 'carta-duo') && (
                  <div className="p-4 rounded-xl bg-slate-950 border border-slate-850/80 space-y-3">
                    <h3 className="text-xs font-black uppercase text-blue-400 tracking-wider flex items-center gap-1.5">
                      <Sparkles className="w-3.5 h-3.5" />
                      <span>Regras de Carta Duo</span>
                    </h3>

                    <div className="grid grid-cols-1 gap-3 text-xs text-slate-300">
                      {/* 1. Cartas Iniciais */}
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-semibold text-slate-400">Cartas Iniciais:</span>
                        {isHost ? (
                          <select
                            id="rule-initial-cards"
                            value={(currentRoom.config as any)?.initial_cards ?? 7}
                            onChange={(e) => handleUpdateRule('initial_cards', Number(e.target.value))}
                            className="bg-slate-900 border border-slate-700 rounded px-2.5 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-blue-500 font-bold"
                          >
                            <option value={5}>5 cartas</option>
                            <option value={7}>7 cartas (Padrão)</option>
                            <option value={10}>10 cartas</option>
                            <option value={12}>12 cartas</option>
                            <option value={15}>15 cartas</option>
                          </select>
                        ) : (
                          <span className="font-extrabold text-white">{(currentRoom.config as any)?.initial_cards ?? 7} cartas</span>
                        )}
                      </div>

                      {/* 2. Acúmulo de Cartas */}
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-semibold text-slate-400">Acúmulo de Compra (+2/+4):</span>
                        {isHost ? (
                          <select
                            id="rule-cumulative-draw"
                            value={String((currentRoom.config as any)?.cumulative_draw ?? true)}
                            onChange={(e) => handleUpdateRule('cumulative_draw', e.target.value === 'true')}
                            className="bg-slate-900 border border-slate-700 rounded px-2.5 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-blue-500 font-bold"
                          >
                            <option value="true">Ativado (Acumular)</option>
                            <option value="false">Desativado</option>
                          </select>
                        ) : (
                          <span className="font-extrabold text-white">
                            {((currentRoom.config as any)?.cumulative_draw ?? true) ? 'Ativado' : 'Desativado'}
                          </span>
                        )}
                      </div>

                      {/* 3. Compra Forçada */}
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-semibold text-slate-400">Comprar sem jogada:</span>
                        {isHost ? (
                          <select
                            id="rule-force-draw"
                            value={String((currentRoom.config as any)?.force_draw ?? true)}
                            onChange={(e) => handleUpdateRule('force_draw', e.target.value === 'true')}
                            className="bg-slate-900 border border-slate-700 rounded px-2.5 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-blue-500 font-bold"
                          >
                            <option value="true">Apenas sem jogada</option>
                            <option value="false">Livre (Qualquer hora)</option>
                          </select>
                        ) : (
                          <span className="font-extrabold text-white">
                            {((currentRoom.config as any)?.force_draw ?? true) ? 'Apenas sem jogada' : 'Livre'}
                          </span>
                        )}
                      </div>

                      {/* 4. Jogar Imediato */}
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-semibold text-slate-400">Jogar ao comprar:</span>
                        {isHost ? (
                          <select
                            id="rule-play-immediately"
                            value={String((currentRoom.config as any)?.play_immediately ?? true)}
                            onChange={(e) => handleUpdateRule('play_immediately', e.target.value === 'true')}
                            className="bg-slate-900 border border-slate-700 rounded px-2.5 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-blue-500 font-bold"
                          >
                            <option value="true">Permitido jogar na hora</option>
                            <option value="false">Não (Perde a vez)</option>
                          </select>
                        ) : (
                          <span className="font-extrabold text-white">
                            {((currentRoom.config as any)?.play_immediately ?? true) ? 'Permitido jogar' : 'Perde a vez'}
                          </span>
                        )}
                      </div>

                      {/* 5. Tempo do Turno */}
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-semibold text-slate-400">Tempo do Turno:</span>
                        {isHost ? (
                          <select
                            id="rule-turn-timer"
                            value={(currentRoom.config as any)?.turn_timer ?? 30}
                            onChange={(e) => handleUpdateRule('turn_timer', Number(e.target.value))}
                            className="bg-slate-900 border border-slate-700 rounded px-2.5 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-blue-500 font-bold"
                          >
                            <option value={15}>15 segundos</option>
                            <option value={30}>30 segundos</option>
                            <option value={45}>45 segundos</option>
                            <option value={60}>60 segundos</option>
                          </select>
                        ) : (
                          <span className="font-extrabold text-white">{(currentRoom.config as any)?.turn_timer ?? 30} segundos</span>
                        )}
                      </div>
                    </div>
                  </div>
                )}

                {/* Mensagens de Alerta de Prontidão */}
                {playerMembers.length >= minPlayersRequired && !allPlayersReady && (
                  <div className="p-3 bg-amber-950/70 border border-amber-800/80 text-amber-200 text-xs flex items-center gap-2.5 rounded-xl animate-in fade-in">
                    <AlertCircle className="w-4 h-4 text-amber-400 shrink-0" />
                    <div>
                      <span className="font-bold block text-amber-300">Aguardando Prontidão de Todos</span>
                      <span className="text-[11px] text-amber-200/90 leading-tight block">
                        Todos os competidores do lobby precisam clicar em "Estou Pronto!" antes de começar.
                      </span>
                    </div>
                  </div>
                )}

                {playerMembers.length >= minPlayersRequired && allPlayersReady && (
                  <div className="p-3 bg-emerald-950/70 border border-emerald-800/80 text-emerald-200 text-xs flex items-center gap-2.5 rounded-xl animate-in fade-in">
                    <UserCheck className="w-4 h-4 text-emerald-400 shrink-0" />
                    <div>
                      <span className="font-bold block text-emerald-300">Todos Prontos para Jogar!</span>
                      <span className="text-[11px] text-emerald-200/90 leading-tight block">
                        {isHost
                          ? 'Todos confirmaram prontidão. Clique em "Iniciar Partida" para começar!'
                          : 'Aguardando o Anfitrião clicar em "Iniciar Partida"...'}
                      </span>
                    </div>
                  </div>
                )}

                {playerMembers.length < minPlayersRequired && (
                  <div className="p-3 bg-slate-800/40 border border-slate-700/60 text-slate-300 text-xs flex items-center gap-2.5 rounded-xl">
                    <AlertCircle className="w-4 h-4 text-slate-400 shrink-0" />
                    <span className="text-[11px] text-slate-400">
                      Você precisa de pelo menos <strong>{minPlayersRequired} jogadores</strong> no lobby para iniciar.
                    </span>
                  </div>
                )}

                {/* Action buttons */}
                <div className="pt-2 flex flex-col gap-2">
                  {isHost ? (
                    <>
                      {!myMember?.is_ready ? (
                        <button
                          type="button"
                          onClick={handleToggleReady}
                          disabled={isLoading}
                          className="w-full py-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs shadow-md shadow-emerald-900/30 transition-all flex items-center justify-center gap-2"
                        >
                          {isLoading && <RotateCw className="w-4 h-4 animate-spin" />}
                          <span>Confirmar Minha Prontidão ("Estou Pronto!")</span>
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={handleStartMatch}
                          disabled={isLoading || !canStartMatch}
                          className="w-full py-3 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-bold text-xs shadow-md shadow-blue-900/40 transition-all flex items-center justify-center gap-2 disabled:opacity-40"
                        >
                          {isLoading ? <RotateCw className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
                          <span>
                            {canStartMatch
                              ? 'Iniciar Partida Agora'
                              : playerMembers.length >= minPlayersRequired
                              ? 'Aguardando Convidado Ficar Pronto'
                              : `Aguardando ${minPlayersRequired} Jogadores`}
                          </span>
                        </button>
                      )}
                    </>
                  ) : (
                    <button
                      type="button"
                      onClick={handleToggleReady}
                      disabled={isLoading}
                      className={`w-full py-3 rounded-xl font-bold text-xs transition-all flex items-center justify-center gap-2 ${
                        myMember?.is_ready
                          ? 'bg-slate-800 text-slate-200 hover:bg-slate-750 border border-slate-700'
                          : 'bg-emerald-600 hover:bg-emerald-500 text-white shadow-md shadow-emerald-900/30'
                      }`}
                    >
                      {isLoading && <RotateCw className="w-4 h-4 animate-spin" />}
                      <span>{myMember?.is_ready ? 'Cancelar Minha Prontidão' : 'Estou Pronto para Jogar!'}</span>
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

            {/* Carregamento inicial */}
            {!currentRoom && isLoading && (
              <div className="py-12 flex flex-col items-center justify-center space-y-3 text-center">
                <RefreshCw className="w-8 h-8 animate-spin text-blue-400" />
                <p className="text-sm font-semibold text-white">Carregando dados da sala...</p>
                <p className="text-xs text-slate-400">Sincronizando participantes e regras oficiais.</p>
              </div>
            )}

            {/* Falha de leitura da sala */}
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

        {/* Submodal de Convites */}
        {currentRoom && (
          <InviteFriendsToRoomModal
            isOpen={isInviteFriendsOpen}
            roomId={currentRoom.id}
            roomCode={currentRoom.code}
            currentRoom={currentRoom}
            onClose={() => setIsInviteFriendsOpen(false)}
          />
        )}
      </div>
    </div>
  );
};
