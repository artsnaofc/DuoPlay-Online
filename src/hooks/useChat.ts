// ============================================================================
// React Hook: useChat — DuoPlay-Online
// Phase: Fase 15 — Comunicação Entre Jogadores (Chat Privado 1:1 Entre Amigos)
// Description: Hook reativo para gerenciamento de conversas, envio/recebimento
//              em tempo real via Realtime, histórico paginado e contadores de não lidas.
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

  // Carrega lista de conversas
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
          setConversations(res.data);
          setError(null);
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
    [currentUserId, isAuthenticated, isAuthLoading]
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

        // Carrega primeiras 30 mensagens
        const msgRes = await getConversationMessages(convData.conversation_id, 30);
        if (!isMountedRef.current) return false;

        if (msgRes.success && msgRes.data) {
          setMessages(msgRes.data.messages);
          setHasMoreMessages(msgRes.data.has_more);
        } else {
          setMessages([]);
          setHasMoreMessages(false);
        }

        // Marca como lida no backend
        markConversationRead(convData.conversation_id).catch(() => {});

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
    [currentUserId, isAuthenticated]
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

      try {
        const msgRes = await getConversationMessages(conversationId, 30);
        if (!isMountedRef.current) return false;

        if (msgRes.success && msgRes.data) {
          setMessages(msgRes.data.messages);
          setHasMoreMessages(msgRes.data.has_more);
        } else {
          setMessages([]);
          setHasMoreMessages(false);
        }

        markConversationRead(conversationId).catch(() => {});

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
    [currentUserId, isAuthenticated, conversations]
  );

  // Fecha conversa ativa
  const closeActiveConversation = useCallback(() => {
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

        // Deduplica mensagens pelo ID
        setMessages((prev) => {
          const existingIds = new Set(prev.map((m) => m.id));
          const uniqueOlder = older.filter((m) => !existingIds.has(m.id));
          return [...uniqueOlder, ...prev];
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

  // Envio de mensagem com reconciliação e tratamento otimista seguro
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

      const res = await sendChatMessage(convId, trimmed);

      if (!isMountedRef.current) return res;

      if (res.success && res.data) {
        const officialMsg = res.data;
        // Substitui mensagem otimista pela oficial do PostgreSQL
        setMessages((prev) =>
          prev.map((m) => (m.id === optimisticId ? { ...officialMsg, delivery_status: 'sent' } : m))
        );

        // Atualiza a prévia de conversa
        setConversations((prev) =>
          prev.map((c) =>
            c.conversation_id === convId
              ? {
                  ...c,
                  last_message_at: officialMsg.created_at,
                  last_message: {
                    id: officialMsg.id,
                    sender_id: officialMsg.sender_id,
                    body: officialMsg.body,
                    created_at: officialMsg.created_at,
                  },
                }
              : c
          )
        );

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
    [activeConversation, currentUserId]
  );

  // Inscrição Realtime global para novas mensagens e atualizações de conversas
  useEffect(() => {
    if (!isSupabaseConfigured || !currentUserId || !isAuthenticated) return;

    const subId = Math.random().toString(36).slice(2, 9) + '_' + Date.now();
    const channelName = `chat_user_${currentUserId}_${subId}`;

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

          // Se a mensagem for da conversa aberta no momento
          if (currentActive && currentActive.conversation_id === newMsgRow.conversation_id) {
            setMessages((prev) => {
              // Deduplica se já existir
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
                delivery_status: 'sent',
              };
              return [...prev, incomingMsg];
            });

            // Se a mensagem veio do outro jogador e o chat está aberto, marca como lida
            if (newMsgRow.sender_id !== currentUserId) {
              markConversationRead(newMsgRow.conversation_id).catch(() => {});
            }
          }

          // Atualiza lista de conversas
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
      .subscribe();

    // Sincronização periódica da lista de conversas a cada 15s
    const chatInterval = setInterval(() => {
      if (typeof document !== 'undefined' && document.visibilityState === 'visible') {
        fetchConversations(true);
      }
    }, 15_000);

    return () => {
      clearInterval(chatInterval);
      supabase.removeChannel(channel);
    };
  }, [currentUserId, isAuthenticated, fetchConversations]);

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
  };
}
