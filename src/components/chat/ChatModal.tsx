// ============================================================================
// Component: ChatModal — DuoPlay-Online
// Phase: Fase 15 — Comunicação Entre Jogadores (Chat Privado 1:1 Entre Amigos)
// Description: Central de mensagens e interface de conversa privada 1:1,
//              responsivo (mobile-first e layout 2-colunas no desktop),
//              com histórico paginado, status online/offline e suporte a Realtime.
// ============================================================================

import React, { useState, useEffect, useRef } from 'react';
import {
  X,
  Send,
  MessageSquare,
  ArrowLeft,
  Search,
  Check,
  Clock,
  AlertCircle,
  RotateCw,
} from 'lucide-react';
import type { UseChatReturn } from '@/hooks/useChat';

export interface ChatModalProps {
  isOpen: boolean;
  onClose: () => void;
  chat: UseChatReturn;
  onOpenFriends?: () => void;
}

export const ChatModal: React.FC<ChatModalProps> = ({
  isOpen,
  onClose,
  chat,
  onOpenFriends,
}) => {
  const {
    conversations,
    activeConversation,
    messages,
    isLoadingConversations,
    isLoadingMessages,
    isLoadingOlderMessages,
    hasMoreMessages,
    openConversationById,
    closeActiveConversation,
    loadOlderMessages,
    sendMessage,
  } = chat;

  const [searchQuery, setSearchQuery] = useState('');
  const [inputText, setInputText] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Rolagem para o fim respeitando a posição do usuário ao ler histórico
  const scrollToBottom = (behavior: ScrollBehavior = 'smooth') => {
    messagesEndRef.current?.scrollIntoView({ behavior });
  };

  const prevConvIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (!activeConversation || messages.length === 0) return;

    const isNewConv = prevConvIdRef.current !== activeConversation.conversation_id;
    prevConvIdRef.current = activeConversation.conversation_id;

    const container = messagesContainerRef.current;
    if (!container) {
      scrollToBottom('auto');
      return;
    }

    const isNearBottom =
      container.scrollHeight - container.scrollTop - container.clientHeight < 150;

    if (isNewConv || isNearBottom) {
      scrollToBottom(isNewConv ? 'auto' : 'smooth');
    }
  }, [activeConversation?.conversation_id, messages.length]);

  // Foca no input ao abrir a conversa
  useEffect(() => {
    if (activeConversation) {
      inputRef.current?.focus();
    }
  }, [activeConversation]);

  if (!isOpen) return null;

  const filteredConversations = conversations.filter((c) => {
    const q = searchQuery.toLowerCase().trim();
    if (!q) return true;
    return (
      c.other_user.display_name.toLowerCase().includes(q) ||
      c.other_user.username.toLowerCase().includes(q) ||
      (c.last_message && c.last_message.body.toLowerCase().includes(q))
    );
  });

  const handleSend = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const text = inputText.trim();
    if (!text || isSending || !activeConversation) return;

    setIsSending(true);
    setSendError(null);

    const res = await sendMessage(text);
    setIsSending(false);

    if (res.success) {
      setInputText('');
      setTimeout(() => scrollToBottom('smooth'), 50);
    } else {
      setSendError(res.error || 'Erro ao enviar mensagem.');
    }
  };

  const formatMessageTime = (isoString: string) => {
    try {
      const d = new Date(isoString);
      return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    } catch {
      return '';
    }
  };

  const formatConversationTime = (isoString: string) => {
    try {
      const d = new Date(isoString);
      const now = new Date();
      const diffMinutes = Math.floor((now.getTime() - d.getTime()) / (1000 * 60));

      if (diffMinutes < 1) return 'Agora';
      if (diffMinutes < 60) return `${diffMinutes}m`;
      const diffHours = Math.floor(diffMinutes / 60);
      if (diffHours < 24) return `${diffHours}h`;
      const diffDays = Math.floor(diffHours / 24);
      if (diffDays < 7) return `${diffDays}d`;
      return d.toLocaleDateString([], { day: '2-digit', month: '2-digit' });
    } catch {
      return '';
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-0 md:p-4 bg-black/80 backdrop-blur-sm animate-fadeIn"
      role="dialog"
      aria-modal="true"
      aria-labelledby="chat-modal-title"
    >
      <div className="flex flex-col w-full h-full md:h-[620px] md:max-w-4xl bg-slate-900 border-0 md:border md:border-slate-800 md:rounded-2xl shadow-2xl overflow-hidden text-slate-100">
        {/* Header Principal do Modal */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-800 bg-slate-950/60">
          <div className="flex items-center gap-2">
            <div className="p-2 rounded-xl bg-violet-500/10 text-violet-400">
              <MessageSquare className="w-5 h-5" />
            </div>
            <div>
              <h2 id="chat-modal-title" className="text-base font-bold text-white leading-tight">
                Mensagens
              </h2>
              <p className="text-xs text-slate-400">Chat privado entre amigos</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
            aria-label="Fechar modal de mensagens"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Corpo: Duas colunas em Desktop / alternância em Mobile */}
        <div className="flex-1 flex overflow-hidden">
          {/* ================================================================= */}
          {/* COLUNA ESQUERDA: LISTA DE CONVERSAS */}
          {/* ================================================================= */}
          <div
            className={`w-full md:w-80 md:border-r border-slate-800 flex flex-col bg-slate-900 ${
              activeConversation ? 'hidden md:flex' : 'flex'
            }`}
          >
            {/* Barra de Busca de Conversas */}
            <div className="p-3 border-b border-slate-800/80 bg-slate-950/30">
              <div className="relative">
                <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Buscar amigos ou conversas..."
                  className="w-full pl-9 pr-3 py-1.5 text-xs rounded-xl bg-slate-800/80 border border-slate-700/60 text-white placeholder-slate-400 focus:outline-none focus:border-violet-500 transition-colors"
                />
              </div>
            </div>

            {/* Lista com Scroll */}
            <div className="flex-1 overflow-y-auto divide-y divide-slate-800/40">
              {isLoadingConversations && conversations.length === 0 ? (
                <div className="flex flex-col items-center justify-center p-8 text-center text-slate-400">
                  <RotateCw className="w-6 h-6 animate-spin text-violet-400 mb-2" />
                  <p className="text-xs">Carregando conversas...</p>
                </div>
              ) : filteredConversations.length === 0 ? (
                <div className="flex flex-col items-center justify-center p-8 text-center text-slate-400">
                  <div className="w-12 h-12 rounded-full bg-slate-800 flex items-center justify-center mb-3">
                    <MessageSquare className="w-6 h-6 text-slate-400" />
                  </div>
                  <p className="text-sm font-semibold text-slate-300 mb-1">
                    {searchQuery ? 'Nenhum resultado' : 'Nenhuma conversa ativa'}
                  </p>
                  <p className="text-xs text-slate-400 max-w-[200px] mb-4">
                    {searchQuery
                      ? 'Nenhuma conversa coincide com a sua busca.'
                      : 'Inicie uma conversa diretamente pela lista de amigos.'}
                  </p>
                  {onOpenFriends && !searchQuery && (
                    <button
                      onClick={() => {
                        onClose();
                        onOpenFriends();
                      }}
                      className="px-3 py-1.5 rounded-lg bg-violet-600 hover:bg-violet-500 text-xs font-semibold text-white transition-colors"
                    >
                      Ver Amigos
                    </button>
                  )}
                </div>
              ) : (
                filteredConversations.map((conv) => {
                  const isSelected = activeConversation?.conversation_id === conv.conversation_id;
                  const hasUnread = conv.unread_count > 0;

                  return (
                    <button
                      key={conv.conversation_id}
                      onClick={() => openConversationById(conv.conversation_id)}
                      className={`w-full flex items-center gap-3 p-3 text-left transition-colors ${
                        isSelected
                          ? 'bg-violet-950/40 border-l-4 border-violet-500'
                          : 'hover:bg-slate-800/50'
                      }`}
                    >
                      {/* Avatar com Indicador de Presença */}
                      <div className="relative shrink-0">
                        {conv.other_user.avatar_url ? (
                          <img
                            src={conv.other_user.avatar_url}
                            alt={conv.other_user.display_name}
                            className="w-11 h-11 rounded-full object-cover border border-slate-700"
                          />
                        ) : (
                          <div className="w-11 h-11 rounded-full bg-slate-800 flex items-center justify-center font-bold text-sm text-slate-300 border border-slate-700">
                            {conv.other_user.display_name.charAt(0).toUpperCase()}
                          </div>
                        )}
                        <span
                          className={`absolute bottom-0 right-0 w-3 h-3 rounded-full border-2 border-slate-900 ${
                            conv.other_user.is_online ? 'bg-emerald-500' : 'bg-slate-500'
                          }`}
                          title={conv.other_user.is_online ? 'Online' : 'Offline'}
                        />
                      </div>

                      {/* Informações da conversa */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between mb-0.5">
                          <span
                            className={`text-sm truncate ${
                              hasUnread ? 'font-bold text-white' : 'font-semibold text-slate-200'
                            }`}
                          >
                            {conv.other_user.display_name}
                          </span>
                          <span className="text-[10px] text-slate-400 shrink-0 ml-1">
                            {formatConversationTime(conv.last_message_at)}
                          </span>
                        </div>
                        <div className="flex items-center justify-between gap-1">
                          <p
                            className={`text-xs truncate ${
                              hasUnread ? 'text-violet-300 font-medium' : 'text-slate-400'
                            }`}
                          >
                            {conv.last_message ? conv.last_message.body : 'Conversa iniciada'}
                          </p>
                          {hasUnread && (
                            <span className="shrink-0 px-1.5 py-0.5 text-[10px] font-bold rounded-full bg-violet-600 text-white min-w-[18px] text-center">
                              {conv.unread_count}
                            </span>
                          )}
                        </div>
                      </div>
                    </button>
                  );
                })
              )}
            </div>
          </div>

          {/* ================================================================= */}
          {/* COLUNA DIREITA: CONVERSA ATIVA */}
          {/* ================================================================= */}
          <div
            className={`flex-1 flex flex-col bg-slate-950/40 ${
              !activeConversation ? 'hidden md:flex' : 'flex'
            }`}
          >
            {activeConversation ? (
              <>
                {/* Header da Conversa Ativa */}
                <div className="flex items-center justify-between px-4 py-3 border-b border-slate-800 bg-slate-900/80">
                  <div className="flex items-center gap-3">
                    {/* Botão voltar no mobile */}
                    <button
                      onClick={closeActiveConversation}
                      className="md:hidden p-1.5 -ml-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800"
                      aria-label="Voltar para lista de conversas"
                    >
                      <ArrowLeft className="w-5 h-5" />
                    </button>

                    {/* Avatar do Amigo */}
                    <div className="relative">
                      {activeConversation.other_user.avatar_url ? (
                        <img
                          src={activeConversation.other_user.avatar_url}
                          alt={activeConversation.other_user.display_name}
                          className="w-10 h-10 rounded-full object-cover border border-slate-700"
                        />
                      ) : (
                        <div className="w-10 h-10 rounded-full bg-slate-800 flex items-center justify-center font-bold text-sm text-slate-300 border border-slate-700">
                          {activeConversation.other_user.display_name.charAt(0).toUpperCase()}
                        </div>
                      )}
                      <span
                        className={`absolute bottom-0 right-0 w-2.5 h-2.5 rounded-full border-2 border-slate-900 ${
                          activeConversation.other_user.is_online
                            ? 'bg-emerald-500'
                            : 'bg-slate-500'
                        }`}
                      />
                    </div>

                    <div>
                      <h3 className="text-sm font-bold text-white leading-tight">
                        {activeConversation.other_user.display_name}
                      </h3>
                      <p className="text-[11px] flex items-center gap-1.5 text-slate-400">
                        <span>@{activeConversation.other_user.username}</span>
                        <span>•</span>
                        <span
                          className={
                            activeConversation.other_user.is_online
                              ? 'text-emerald-400 font-medium'
                              : 'text-slate-400'
                          }
                        >
                          {activeConversation.other_user.is_online ? 'Online' : 'Offline'}
                        </span>
                      </p>
                    </div>
                  </div>
                </div>

                {/* Área de Mensagens com Scroll */}
                <div
                  ref={messagesContainerRef}
                  className="flex-1 overflow-y-auto p-4 space-y-3 flex flex-col"
                >
                  {/* Botão Carregar Mensagens Anteriores */}
                  {hasMoreMessages && (
                    <div className="text-center py-1">
                      <button
                        onClick={loadOlderMessages}
                        disabled={isLoadingOlderMessages}
                        className="px-3 py-1 rounded-full text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white border border-slate-700 transition-colors inline-flex items-center gap-1.5"
                      >
                        {isLoadingOlderMessages && <RotateCw className="w-3 h-3 animate-spin" />}
                        Carregar mensagens anteriores
                      </button>
                    </div>
                  )}

                  {isLoadingMessages && messages.length === 0 ? (
                    <div className="flex-1 flex flex-col items-center justify-center text-center text-slate-400">
                      <RotateCw className="w-6 h-6 animate-spin text-violet-400 mb-2" />
                      <p className="text-xs">Carregando histórico...</p>
                    </div>
                  ) : messages.length === 0 ? (
                    <div className="flex-1 flex flex-col items-center justify-center text-center text-slate-400 p-6">
                      <div className="w-12 h-12 rounded-full bg-slate-800 flex items-center justify-center mb-2">
                        <MessageSquare className="w-6 h-6 text-slate-400" />
                      </div>
                      <p className="text-sm font-medium text-slate-300 mb-1">
                        Diga um "Oi" para {activeConversation.other_user.display_name}!
                      </p>
                      <p className="text-xs text-slate-400 max-w-xs">
                        Suas mensagens são persistidas e chegam em tempo real.
                      </p>
                    </div>
                  ) : (
                    messages.map((msg) => {
                      const isMe = msg.is_mine;

                      return (
                        <div
                          key={msg.id}
                          className={`flex flex-col ${isMe ? 'items-end' : 'items-start'}`}
                        >
                          <div
                            className={`max-w-[80%] md:max-w-[70%] rounded-2xl px-4 py-2.5 text-sm shadow-sm break-words ${
                              isMe
                                ? 'bg-gradient-to-r from-violet-600 to-indigo-600 text-white rounded-br-xs'
                                : 'bg-slate-800 text-slate-100 rounded-bl-xs border border-slate-700/60'
                            }`}
                          >
                            <p className="whitespace-pre-wrap leading-relaxed">{msg.body}</p>
                            <div
                              className={`flex items-center gap-1 mt-1 text-[10px] ${
                                isMe ? 'justify-end text-violet-200/80' : 'justify-start text-slate-400'
                              }`}
                            >
                              <span>{formatMessageTime(msg.created_at)}</span>
                              {isMe && (
                                <>
                                  {msg.delivery_status === 'pending' && (
                                    <Clock className="w-3 h-3 animate-pulse text-violet-300" />
                                  )}
                                  {msg.delivery_status === 'failed' && (
                                    <AlertCircle className="w-3 h-3 text-red-300" />
                                  )}
                                  {(!msg.delivery_status || msg.delivery_status === 'sent') && (
                                    <Check className="w-3 h-3 text-violet-200" />
                                  )}
                                </>
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    })
                  )}
                  <div ref={messagesEndRef} />
                </div>

                {/* Feedback de erro de envio */}
                {sendError && (
                  <div className="px-4 py-1.5 bg-red-950/80 border-t border-red-800/80 text-red-300 text-xs flex items-center justify-between">
                    <span>{sendError}</span>
                    <button
                      onClick={() => setSendError(null)}
                      className="text-red-400 hover:text-white text-xs font-bold"
                    >
                      ✕
                    </button>
                  </div>
                )}

                {/* Campo de Envio de Mensagem */}
                <form
                  onSubmit={handleSend}
                  className="p-3 border-t border-slate-800 bg-slate-900/90 flex items-center gap-2"
                >
                  <input
                    ref={inputRef}
                    type="text"
                    value={inputText}
                    onChange={(e) => setInputText(e.target.value)}
                    placeholder={`Enviar mensagem para ${activeConversation.other_user.display_name}...`}
                    maxLength={2000}
                    disabled={isSending}
                    className="flex-1 px-4 py-2 text-sm rounded-xl bg-slate-800 border border-slate-700 text-white placeholder-slate-400 focus:outline-none focus:border-violet-500 transition-colors disabled:opacity-50"
                  />
                  <button
                    type="submit"
                    disabled={!inputText.trim() || isSending}
                    className="p-2.5 rounded-xl bg-violet-600 hover:bg-violet-500 disabled:bg-slate-800 disabled:text-slate-600 text-white font-semibold shadow-lg shadow-violet-600/20 transition-all active:scale-95 flex items-center justify-center shrink-0"
                    aria-label="Enviar mensagem"
                  >
                    {isSending ? (
                      <RotateCw className="w-4 h-4 animate-spin" />
                    ) : (
                      <Send className="w-4 h-4" />
                    )}
                  </button>
                </form>
              </>
            ) : (
              /* Estado Vazio no Desktop quando nenhuma conversa está aberta */
              <div className="flex-1 flex flex-col items-center justify-center text-center p-8 text-slate-400">
                <div className="w-16 h-16 rounded-2xl bg-slate-900 border border-slate-800 flex items-center justify-center mb-4">
                  <MessageSquare className="w-8 h-8 text-violet-400" />
                </div>
                <h3 className="text-base font-bold text-white mb-1">Central de Comunicação</h3>
                <p className="text-xs text-slate-400 max-w-sm mb-4">
                  Selecione uma conversa na lista ao lado ou inicie um chat direto através da sua lista de amigos.
                </p>
                {onOpenFriends && (
                  <button
                    onClick={() => {
                      onClose();
                      onOpenFriends();
                    }}
                    className="px-4 py-2 rounded-xl bg-violet-600 hover:bg-violet-500 text-xs font-semibold text-white transition-colors"
                  >
                    Abrir Lista de Amigos
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
