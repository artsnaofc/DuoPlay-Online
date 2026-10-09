// ============================================================================
// Component: JoinRoomByCodeModal — DuoPlay-Online
// Phase: Padronização do Fluxo de Salas
// Description: Modal exclusivo e centralizado para entrar em salas privadas
//              através de código alfanumérico de 6 caracteres, agnóstico ao jogo.
// ============================================================================

import React, { useState, useEffect, useRef } from 'react';
import { KeyRound, X, RotateCw, AlertCircle, LogIn, ArrowRight } from 'lucide-react';
import { joinRoomByCode, getRoomDetails, type RoomWithMembers } from '@/services/rooms';

export interface JoinRoomByCodeModalProps {
  isOpen: boolean;
  onClose: () => void;
  onJoinSuccess: (room: RoomWithMembers) => void;
}

const ROOM_CODE_REGEX = /^[A-Z0-9]{6}$/;

export const JoinRoomByCodeModal: React.FC<JoinRoomByCodeModalProps> = ({
  isOpen,
  onClose,
  onJoinSuccess,
}) => {
  const [code, setCode] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const isSubmittingRef = useRef(false);

  useEffect(() => {
    if (isOpen) {
      setCode('');
      setErrorMessage(null);
      setValidationError(null);
      isSubmittingRef.current = false;
      // Autofocus no input ao abrir
      const timer = setTimeout(() => {
        inputRef.current?.focus();
      }, 50);
      return () => clearTimeout(timer);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleCodeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const rawVal = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (rawVal.length <= 6) {
      setCode(rawVal);
      if (validationError) setValidationError(null);
      if (errorMessage) setErrorMessage(null);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isLoading || isSubmittingRef.current) return;

    const cleanCode = code.trim().toUpperCase();

    // 1. Validação estrita de formato no cliente (6 caracteres alfanuméricos)
    if (cleanCode.length !== 6 || !ROOM_CODE_REGEX.test(cleanCode)) {
      setValidationError('O código deve conter exatamente 6 letras e números.');
      return;
    }

    setValidationError(null);
    setErrorMessage(null);
    setIsLoading(true);
    isSubmittingRef.current = true;

    try {
      const result = await joinRoomByCode(cleanCode);

      if (result.success && result.data?.room) {
        const roomId = result.data.room.id;
        // Busca os detalhes completos com a lista de membros e o jogo identificado
        const detailsRes = await getRoomDetails(roomId);

        const roomData: RoomWithMembers = detailsRes.success && detailsRes.data
          ? detailsRes.data
          : {
              ...result.data.room,
              members: [result.data.member],
            };

        setIsLoading(false);
        isSubmittingRef.current = false;
        onJoinSuccess(roomData);
        onClose();
      } else {
        setIsLoading(false);
        isSubmittingRef.current = false;
        setErrorMessage(
          result.error || 'Não foi possível entrar na sala. Verifique o código e tente novamente.'
        );
      }
    } catch (err: unknown) {
      setIsLoading(false);
      isSubmittingRef.current = false;
      const msg = err instanceof Error ? err.message : 'Erro inesperado ao conectar com a sala.';
      setErrorMessage(msg);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="join-room-title"
      onClick={(e) => {
        if (e.target === e.currentTarget && !isLoading) {
          onClose();
        }
      }}
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-950/80 backdrop-blur-sm animate-in fade-in duration-200 cursor-pointer"
    >
      <div className="relative w-full max-w-md rounded-2xl bg-slate-900 border border-slate-800 shadow-2xl p-5 sm:p-6 cursor-default overflow-hidden">
        {/* Glow Superior */}
        <div className="absolute top-0 inset-x-0 h-1 bg-gradient-to-r from-blue-500 via-indigo-500 to-purple-500" />

        {/* Header */}
        <div className="flex items-center justify-between pb-4 mb-4 border-b border-slate-800">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-blue-600/20 border border-blue-500/30 flex items-center justify-center text-blue-400 shrink-0">
              <LogIn className="w-5 h-5" />
            </div>
            <div>
              <h2 id="join-room-title" className="text-base sm:text-lg font-extrabold text-white">
                Entrar com Código
              </h2>
              <p className="text-xs text-slate-400">
                Acesse a sala privada de qualquer jogo com o código de 6 caracteres.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={isLoading}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors disabled:opacity-40"
            aria-label="Fechar modal"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Mensagem de Erro do Servidor */}
        {errorMessage && (
          <div className="mb-4 p-3 rounded-xl bg-red-950/60 border border-red-800/80 text-red-200 text-xs flex items-center gap-2.5 animate-in fade-in">
            <AlertCircle className="w-4 h-4 shrink-0 text-red-400" />
            <span className="grow leading-relaxed">{errorMessage}</span>
          </div>
        )}

        {/* Formulário de Código */}
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label
              htmlFor="join-room-code-input"
              className="block text-xs font-bold text-slate-300 mb-1.5"
            >
              Código da Sala (6 caracteres)
            </label>
            <div className="relative">
              <input
                ref={inputRef}
                id="join-room-code-input"
                type="text"
                maxLength={6}
                value={code}
                onChange={handleCodeChange}
                disabled={isLoading}
                placeholder="EX: 89KLMN"
                autoComplete="off"
                spellCheck="false"
                className={`w-full px-4 py-3.5 rounded-xl bg-slate-950 border text-white font-mono text-center tracking-widest text-xl font-black uppercase transition-all focus:outline-none focus:ring-2 ${
                  validationError
                    ? 'border-red-500 focus:ring-red-500/50'
                    : 'border-slate-800 focus:border-blue-500 focus:ring-blue-500/50'
                } disabled:opacity-50`}
              />
              <div className="absolute right-3.5 top-1/2 -translate-y-1/2 pointer-events-none">
                <span className="text-[11px] font-mono text-slate-500 tabular-nums">
                  {code.length}/6
                </span>
              </div>
            </div>

            {validationError && (
              <p className="mt-1.5 text-xs text-red-400 font-medium flex items-center gap-1.5">
                <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                <span>{validationError}</span>
              </p>
            )}

            <p className="mt-2 text-[11px] text-slate-400 leading-relaxed">
              O jogo é identificado automaticamente pela sala. Não é necessário selecionar o título com antecedência.
            </p>
          </div>

          <div className="flex items-center justify-end gap-2.5 pt-2">
            <button
              type="button"
              onClick={onClose}
              disabled={isLoading}
              className="py-2.5 px-4 rounded-xl bg-slate-800 hover:bg-slate-750 text-slate-300 font-bold text-xs transition-colors disabled:opacity-40"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={isLoading || code.length !== 6}
              className="py-2.5 px-5 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white font-extrabold text-xs shadow-md shadow-blue-950/40 transition-all flex items-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed active:scale-95"
            >
              {isLoading ? (
                <>
                  <RotateCw className="w-4 h-4 animate-spin" />
                  <span>Entrando na Sala...</span>
                </>
              ) : (
                <>
                  <span>Entrar na Sala</span>
                  <ArrowRight className="w-4 h-4" />
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
