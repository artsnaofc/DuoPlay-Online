// ============================================================================
// React Hook: useChat — DuoPlay-Online
// Phase: Fase 15.1 — Hardening da Sincronização do Chat (Multi-Sessão & Reconciliação)
// Description: Hook reativo ultrarrobusto para gerenciamento de conversas e mensagens
//              com reconciliação idempotente contra PostgreSQL, prevenção de race conditions,
//              controle de visibilidade, recuperação em reconexão e deduplicação estrita.
// ============================================================================

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useAuth } from './useAuth';
import {
  getMyConversations,
  getOrCreateDirectConversation,
  getConversationMessages,
  sendMessage as sendChatMessage,
  markConversationRead,
  clearChatCache,
  logChatDiagnostic,
} from '@/services/chat';
import type {
  ChatMessage,
  ConversationSummary,
} from '@/types/chat';
import { supabase, isSupabaseConfigured } from '@/lib/supabase';

export interface UseChatReturn {
  conversations: ConversationSummary[];
  totalUnreadCount: number;
  activeConversation: ConversationSummary | null;
  messages: ChatMessage[];
  isLoadingConversations: boolean;
  isLoadingMessages: boolean;
  isLoadingOlderMessages: boolean;
  hasMoreMessages: boolean;
  error: string | null;
  openConversationWithFriend: (friendUserId: string) => Promise<boolean>;
  openConversationById: (conversationId: string) => Promise<boolean>;
  closeActiveConversation: () => void;
  loadOlderMessages: () => Promise<void>;
  sendMessage: (body: string) => Promise<{ success: boolean; error?: string }>;
  refreshConversations: (force?: boolean) => Promise<void>;
  reconcileActiveConversation: (origin?: string) => Promise<void>;
}

export function useChat(): UseChatReturn {
  const { user, isAuthenticated, isLoading: isAuthLoading } = useAuth();
  const currentUserId = user?.id || null;

  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [activeConversation, setActiveConversation] = useState<ConversationSummary | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [hasMoreMessages, setHasMoreMessages] = useState<boolean>(false);

  const [isLoadingConversations, setIsLoadingConversations] = useState<boolean>(false);
  const [isLoadingMessages, setIsLoadingMessages] = useState<boolean>(false);
  const [isLoadingOlderMessages, setIsLoadingOlderMessages] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const isMountedRef = useRef<boolean>(true);
  const activeConvRef = useRef<ConversationSummary | null>(null);
  activeConvRef.current = activeConversation;

  const messagesRef = useRef<ChatMessage[]>([]);
  messagesRef.current = messages;

  // Versão sequencial de requisição para prevencão de race condition entre fetches e Realtime
  const fetchRequestVersionRef = useRef<number>(0);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  // Total de mensagens não lidas
  const totalUnreadCount = useMemo(() => {
    return conversations.reduce((acc, conv) => acc + (conv.unread_count || 0), 0);
  }, [conversations]);

  // Função Oficial de Reconciliação com o PostgreSQL (Fonte da Verdade)
  const reconcileConversationMessages = useCallback(
    async (conversationId: string, origin = 'manual'): Promise<void> => {
      if (!conversationId || !isMountedRef.current) return;

      const reqVersion = ++fetchRequestVersionRef.current;

      logChatDiagnostic('CHAT_RECONCILE', {
        conversationId,
        origin,
        currentMessageCount: messagesRef.current.length,
      });

      try {
        const res = await getConversationMessages(conversationId, 30);
        if (!isMountedRef.current || reqVersion !== fetchRequestVersionRef.current) {
          return;
        }

        if (res.success && res.data) {
          const serverMessages = res.data.messages;
          const serverHasMore = res.data.has_more;

          setHasMoreMessages(serverHasMore);

          setMessages((prev) => {
            const serverMap = new Map<string, ChatMessage>();
            serverMessages.forEach((m) => serverMap.set(m.id, m));

            // Preserva mensagens otimistas pendentes que ainda não foram confirmadas pelo servidor
            const pendingOptimistic = prev.filter(
              (m) =>
                (m.delivery_status === 'pending' || m.delivery_status === 'failed') &&
                m.conversation_id === conversationId
            );

            const combined = [...serverMessages];
            pendingOptimistic.forEach((m) => {
              if (!serverMap.has(m.id)) {
                combined.push(m);
              }
            });

            // Ordenação determinística: created_at ASC, id ASC
            combined.sort((a, b) => {
              const timeDiff = new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
              if (timeDiff !== 0) return timeDiff;
              return a.id.localeCompare(b.id);
            });

            logChatDiagnostic('CHAT_RECONCILE_SUCCESS', {
              conversationId,
              origin,
              beforeCount: prev.length,
              afterCount: combined.length,
            });

            return combined;
          });

          markConversationRead(conversationId).catch(() => {});
        } else if (!res.success) {
          logChatDiagnostic('CHAT_RECONCILE_FAILED', {
            conversationId,
            origin,
            error: res.error,
            code: res.code,
          });
          if (res.error) {
            setError(res.error);
          }
        }
      } catch (err) {
        logChatDiagnostic('CHAT_RECONCILE_ERROR', {
          conversationId,
          origin,
          error: String(err),
        });
      }
    },
    []
  );

  // Carrega lista de conversas e reconcilia conversa ativa caso haja descompasso
  const fetchConversations = useCallback(
    async (force = false) => {
      if (isAuthLoading || !currentUserId || !isAuthenticated) {
        if (isMountedRef.current) {
          setConversations([]);
          setIsLoadingConversations(false);
        }
        return;
      }

      try {
        const res = await getMyConversations(force);
        if (!isMountedRef.current) return;

        if (res.success && res.data) {
          const newConversations = res.data;
          setConversations(newConversations);
          setError(null);

          // VERIFICAÇÃO DE CONSISTÊNCIA ENTRE LISTA LATERAL E PAINEL PRINCIPAL
          const currentActive = activeConvRef.current;
          if (currentActive) {
            const updatedActiveSummary = newConversations.find(
              (c) => c.conversation_id === currentActive.conversation_id
            );

            if (updatedActiveSummary) {
              const lastMsgInSummary = updatedActiveSummary.last_message;
              const currentMessages = messagesRef.current;

              // Se a lista possui mensagem mais recente que não está presente no painel de mensagens
              const isMissingNewMessage =
                lastMsgInSummary &&
                !currentMessages.some((m) => m.id === lastMsgInSummary.id);

              if (isMissingNewMessage) {
                logChatDiagnostic('CHAT_INCONSISTENCY_DETECTED', {
                  conversationId: currentActive.conversation_id,
                  lastMessageInSummary: lastMsgInSummary?.id,
                  currentLocalMessageCount: currentMessages.length,
                });
                reconcileConversationMessages(
                  currentActive.conversation_id,
                  'conversation_summary_mismatch'
                );
              }
            }
          }
        } else if (res.error) {
          setError(res.error);
        }
      } catch {
        if (isMountedRef.current) {
          setError('Erro ao carregar conversas.');
        }
      } finally {
        if (isMountedRef.current) {
          setIsLoadingConversations(false);
        }
      }
    },
    [currentUserId, isAuthenticated, isAuthLoading, reconcileConversationMessages]
  );

  // Inicialização e limpeza ao alternar usuário
  useEffect(() => {
    if (isAuthLoading) return;

    if (!currentUserId || !isAuthenticated) {
      clearChatCache();
      setConversations([]);
      setActiveConversation(null);
      setMessages([]);
      setError(null);
    } else {
      setIsLoadingConversations(true);
      fetchConversations(true);
    }
  }, [currentUserId, isAuthenticated, isAuthLoading, fetchConversations]);

  // Abre conversa através do ID do amigo
  const openConversationWithFriend = useCallback(
    async (friendUserId: string): Promise<boolean> => {
      if (!currentUserId || !isAuthenticated) return false;

      setIsLoadingMessages(true);
      setError(null);

      try {
        const convRes = await getOrCreateDirectConversation(friendUserId);
        if (!isMountedRef.current) return false;

        if (!convRes.success || !convRes.data) {
          setError(convRes.error || 'Não foi possível abrir a conversa.');
          setIsLoadingMessages(false);
          return false;
        }

        const convData = convRes.data;
        setActiveConversation(convData);

        logChatDiagnostic('CHAT_OPEN_FRIEND', {
          friendUserId,
          conversationId: convData.conversation_id,
        });

        // Reconcilia diretamente do PostgreSQL
        await reconcileConversationMessages(convData.conversation_id, 'open_friend');

        // Atualiza contagem local de não lidas para essa conversa
        setConversations((prev) =>
          prev.map((c) =>
            c.conversation_id === convData.conversation_id ? { ...c, unread_count: 0 } : c
          )
        );

        return true;
      } catch {
        if (isMountedRef.current) {
          setError('Erro ao abrir conversa.');
        }
        return false;
      } finally {
        if (isMountedRef.current) {
          setIsLoadingMessages(false);
        }
      }
    },
    [currentUserId, isAuthenticated, reconcileConversationMessages]
  );

  // Abre conversa através do conversation_id existente
  const openConversationById = useCallback(
    async (conversationId: string): Promise<boolean> => {
      if (!currentUserId || !isAuthenticated) return false;

      const target = conversations.find((c) => c.conversation_id === conversationId);
      if (!target) {
        return false;
      }

      setIsLoadingMessages(true);
      setError(null);
      setActiveConversation(target);

      logChatDiagnostic('CHAT_OPEN_BY_ID', { conversationId });

      try {
        await reconcileConversationMessages(conversationId, 'open_by_id');

        setConversations((prev) =>
          prev.map((c) =>
            c.conversation_id === conversationId ? { ...c, unread_count: 0 } : c
          )
        );

        return true;
      } catch {
        if (isMountedRef.current) {
          setError('Erro ao carregar mensagens.');
        }
        return false;
      } finally {
        if (isMountedRef.current) {
          setIsLoadingMessages(false);
        }
      }
    },
    [currentUserId, isAuthenticated, conversations, reconcileConversationMessages]
  );

  // Fecha conversa ativa
  const closeActiveConversation = useCallback(() => {
    logChatDiagnostic('CHAT_CLOSE_CONVERSATION', {
      conversationId: activeConvRef.current?.conversation_id,
    });
    setActiveConversation(null);
    setMessages([]);
    setHasMoreMessages(false);
  }, []);

  // Carrega mensagens mais antigas (Paginação determinística)
  const loadOlderMessages = useCallback(async () => {
    if (!activeConversation || isLoadingOlderMessages || !hasMoreMessages || messages.length === 0) {
      return;
    }

    const oldestMsg = messages[0];
    if (!oldestMsg) return;

    setIsLoadingOlderMessages(true);

    try {
      const res = await getConversationMessages(
        activeConversation.conversation_id,
        30,
        oldestMsg.created_at,
        oldestMsg.id
      );

      if (!isMountedRef.current) return;

      if (res.success && res.data) {
        const older = res.data.messages;
        setHasMoreMessages(res.data.has_more);

        // Deduplica e une mantendo ordem determinística
        setMessages((prev) => {
          const existingIds = new Set(prev.map((m) => m.id));
          const uniqueOlder = older.filter((m) => !existingIds.has(m.id));
          const combined = [...uniqueOlder, ...prev];

          combined.sort((a, b) => {
            const timeDiff = new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
            if (timeDiff !== 0) return timeDiff;
            return a.id.localeCompare(b.id);
          });

          return combined;
        });
      }
    } catch {
      // Ignora falha de paginação silenciosamente
    } finally {
      if (isMountedRef.current) {
        setIsLoadingOlderMessages(false);
      }
    }
  }, [activeConversation, isLoadingOlderMessages, hasMoreMessages, messages]);

  // Envio de mensagem com reconciliação oficial
  const handleSendMessage = useCallback(
    async (body: string): Promise<{ success: boolean; error?: string }> => {
      if (!activeConversation || !currentUserId) {
        return { success: false, error: 'Nenhuma conversa ativa selecionada.' };
      }

      const trimmed = body.trim();
      if (!trimmed) {
        return { success: false, error: 'A mensagem não pode ser vazia.' };
      }

      const convId = activeConversation.conversation_id;
      const optimisticId = `temp_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

      const tempMessage: ChatMessage = {
        id: optimisticId,
        conversation_id: convId,
        sender_id: currentUserId,
        body: trimmed,
        created_at: new Date().toISOString(),
        is_mine: true,
        delivery_status: 'pending',
      };

      // Adiciona temporariamente na UI
      setMessages((prev) => [...prev, tempMessage]);

      logChatDiagnostic('CHAT_MESSAGE_RPC_START', {
        conversationId: convId,
        optimisticId,
      });

      const res = await sendChatMessage(convId, trimmed);

      if (!isMountedRef.current) return res;

      if (res.success && res.data) {
        const officialMsg = res.data;

        logChatDiagnostic('CHAT_MESSAGE_RPC_SUCCESS', {
          conversationId: convId,
          officialId: officialMsg.id,
        });

        // Substitui mensagem otimista pela oficial do PostgreSQL
        setMessages((prev) => {
          const filtered = prev.filter((m) => m.id !== optimisticId && m.id !== officialMsg.id);
          const combined: ChatMessage[] = [...filtered, { ...officialMsg, delivery_status: 'sent' as const }];

          combined.sort((a, b) => {
            const timeDiff = new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
            if (timeDiff !== 0) return timeDiff;
            return a.id.localeCompare(b.id);
          });

          return combined;
        });

        // Dispara reconciliação leve assíncrona para garantia de consistência total
        reconcileConversationMessages(convId, 'send_message_confirm');
        fetchConversations(true);

        return { success: true };
      } else {
        // Marca como falha
        setMessages((prev) =>
          prev.map((m) =>
            m.id === optimisticId ? { ...m, delivery_status: 'failed' } : m
          )
        );
        return { success: false, error: res.error || 'Falha ao enviar mensagem.' };
      }
    },
    [activeConversation, currentUserId, fetchConversations, reconcileConversationMessages]
  );

  // Inscrição Realtime global com acompanhamento de ciclo de vida e recuperação
  useEffect(() => {
    if (!isSupabaseConfigured || !currentUserId || !isAuthenticated) return;

    const subId = Math.random().toString(36).slice(2, 9) + '_' + Date.now();
    const channelName = `chat_user_${currentUserId}_${subId}`;

    logChatDiagnostic('CHAT_SUBSCRIBE', { channelName, currentUserId });

    const channel = supabase
      .channel(channelName)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'messages',
        },
        (payload) => {
          const newMsgRow = payload.new as {
            id: string;
            conversation_id: string;
            sender_id: string;
            body: string;
            created_at: string;
          };

          if (!newMsgRow) return;

          const currentActive = activeConvRef.current;

          logChatDiagnostic('CHAT_MESSAGE_REALTIME', {
            newMsgId: newMsgRow.id,
            conversationId: newMsgRow.conversation_id,
            activeConversationId: currentActive?.conversation_id,
          });

          // Se a mensagem for para a conversa atualmente aberta
          if (currentActive && currentActive.conversation_id === newMsgRow.conversation_id) {
            setMessages((prev) => {
              if (prev.some((m) => m.id === newMsgRow.id)) {
                return prev;
              }
              const incomingMsg: ChatMessage = {
                id: newMsgRow.id,
                conversation_id: newMsgRow.conversation_id,
                sender_id: newMsgRow.sender_id,
                body: newMsgRow.body,
                created_at: newMsgRow.created_at,
                is_mine: newMsgRow.sender_id === currentUserId,
                delivery_status: 'sent' as const,
              };
              const combined = [...prev, incomingMsg];
              combined.sort((a, b) => {
                const timeDiff = new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
                if (timeDiff !== 0) return timeDiff;
                return a.id.localeCompare(b.id);
              });

              return combined;
            });

            if (newMsgRow.sender_id !== currentUserId) {
              markConversationRead(newMsgRow.conversation_id).catch(() => {});
            }

            // Garante snapshot completo para sanar potenciais gapped events
            reconcileConversationMessages(newMsgRow.conversation_id, 'realtime_insert');
          }

          fetchConversations(true);
        }
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'conversations',
        },
        () => {
          fetchConversations(true);
        }
      )
      .subscribe((status) => {
        logChatDiagnostic('CHAT_CHANNEL_STATUS', { status, channelName });

        if (status === 'SUBSCRIBED') {
          logChatDiagnostic('CHAT_SUBSCRIBED', { channelName });
          fetchConversations(true);
          if (activeConvRef.current) {
            reconcileConversationMessages(
              activeConvRef.current.conversation_id,
              'subscribed_recovery'
            );
          }
        } else if (status === 'CLOSED' || status === 'CHANNEL_ERROR') {
          logChatDiagnostic('CHAT_RECONNECT', { status, channelName });
        }
      });

    // Recuperação por visibilitychange, foco da janela e reconexão de rede
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        logChatDiagnostic('CHAT_VISIBILITY_RECOVERY', {
          activeConvId: activeConvRef.current?.conversation_id,
        });
        fetchConversations(true);
        if (activeConvRef.current) {
          reconcileConversationMessages(
            activeConvRef.current.conversation_id,
            'visibility_recovery'
          );
        }
      }
    };

    const handleWindowFocus = () => {
      fetchConversations(true);
      if (activeConvRef.current) {
        reconcileConversationMessages(
          activeConvRef.current.conversation_id,
          'focus_recovery'
        );
      }
    };

    const handleOnline = () => {
      logChatDiagnostic('CHAT_NETWORK_ONLINE_RECOVERY', {
        activeConvId: activeConvRef.current?.conversation_id,
      });
      fetchConversations(true);
      if (activeConvRef.current) {
        reconcileConversationMessages(
          activeConvRef.current.conversation_id,
          'online_recovery'
        );
      }
    };

    window.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('focus', handleWindowFocus);
    window.addEventListener('online', handleOnline);

    return () => {
      window.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('focus', handleWindowFocus);
      window.removeEventListener('online', handleOnline);
      supabase.removeChannel(channel);
    };
  }, [currentUserId, isAuthenticated, fetchConversations, reconcileConversationMessages]);

  // Polling leve de segurança (12 segundos) MENTRE a conversa estiver aberta
  useEffect(() => {
    if (!activeConversation) return;

    const interval = setInterval(() => {
      if (typeof document !== 'undefined' && document.visibilityState === 'visible') {
        if (activeConvRef.current) {
          reconcileConversationMessages(
            activeConvRef.current.conversation_id,
            'safety_poll'
          );
        }
      }
    }, 12_000);

    return () => {
      clearInterval(interval);
    };
  }, [activeConversation?.conversation_id, reconcileConversationMessages]);

  return {
    conversations,
    totalUnreadCount,
    activeConversation,
    messages,
    isLoadingConversations,
    isLoadingMessages,
    isLoadingOlderMessages,
    hasMoreMessages,
    error,
    openConversationWithFriend,
    openConversationById,
    closeActiveConversation,
    loadOlderMessages,
    sendMessage: handleSendMessage,
    refreshConversations: fetchConversations,
    reconcileActiveConversation: (origin = 'manual') => {
      if (activeConvRef.current) {
        return reconcileConversationMessages(activeConvRef.current.conversation_id, origin);
      }
      return Promise.resolve();
    },
  };
}
