// ============================================================================
// Component: ReceivedGameInviteModal — DuoPlay-Online
// Phase: Fase 14.2 & Auditoria Crítica — Convites de Partida em Tempo Real
// Description: Modal de resposta a convite com prazo autoritativo de 15 segundos,
//              indicador visual de contagem regressiva e áudio suave com Web Audio API.
// ============================================================================

import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  Gamepad2,
  Check,
  X,
  RotateCw,
  Clock,
  AlertCircle,
  Play,
} from 'lucide-react';
import { PlayerAvatar } from '@/components/profile/PlayerAvatar';
import type { GameInvite } from '@/types/invites';

interface ReceivedGameInviteModalProps {
  invite: GameInvite | null;
  onAccept: (inviteId: string) => Promise<{ success: boolean; data?: { room: { id: string; code: string } }; error?: string }>;
  onDecline: (inviteId: string) => Promise<{ success: boolean; error?: string }>;
  onClose?: () => void;
}

// Reprodutor de áudio suave para sinalizar convite pendente dentro do prazo de 15s
class InviteChimePlayer {
  private audioCtx: AudioContext | null = null;
  private intervalId: number | null = null;
  private isDestroyed = false;

  private getContext(): AudioContext | null {
    if (typeof window === 'undefined') return null;
    try {
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!AudioCtx) return null;
      if (!this.audioCtx || this.audioCtx.state === 'closed') {
        this.audioCtx = new AudioCtx();
      }
      if (this.audioCtx.state === 'suspended') {
        this.audioCtx.resume().catch(() => {});
      }
      return this.audioCtx;
    } catch {
      return null;
    }
  }

  private playChime() {
    if (this.isDestroyed) return;
    const ctx = this.getContext();
    if (!ctx || ctx.state !== 'running') return;

    try {
      const now = ctx.currentTime;
      // Duas notas suaves tipo campainha digital (D5 587Hz -> A5 880Hz) com volume discreto
      const osc1 = ctx.createOscillator();
      const gain1 = ctx.createGain();
      osc1.type = 'sine';
      osc1.frequency.setValueAtTime(587.33, now);
      gain1.gain.setValueAtTime(0.04, now);
      gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.3);
      osc1.connect(gain1);
      gain1.connect(ctx.destination);
      osc1.start(now);
      osc1.stop(now + 0.3);

      const osc2 = ctx.createOscillator();
      const gain2 = ctx.createGain();
      osc2.type = 'sine';
      osc2.frequency.setValueAtTime(880, now + 0.12);
      gain2.gain.setValueAtTime(0.045, now + 0.12);
      gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.45);
      osc2.connect(gain2);
      gain2.connect(ctx.destination);
      osc2.start(now + 0.12);
      osc2.stop(now + 0.45);
    } catch {
      // Ignora exceções de áudio
    }
  }

  public start() {
    this.isDestroyed = false;
    this.playChime();
    this.intervalId = window.setInterval(() => {
      this.playChime();
    }, 3200);
  }

  public stop() {
    this.isDestroyed = true;
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    if (this.audioCtx && this.audioCtx.state !== 'closed') {
      try {
        this.audioCtx.close().catch(() => {});
      } catch {}
      this.audioCtx = null;
    }
  }
}

export const ReceivedGameInviteModal: React.FC<ReceivedGameInviteModalProps> = ({
  invite,
  onAccept,
  onDecline,
}) => {
  const [isAccepting, setIsAccepting] = useState(false);
  const [isDeclining, setIsDeclining] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [secondsRemaining, setSecondsRemaining] = useState<number>(15);

  const chimeRef = useRef<InviteChimePlayer | null>(null);

  const expiresAtMs = useMemo(() => {
    if (!invite?.expires_at) return 0;
    return new Date(invite.expires_at).getTime();
  }, [invite?.expires_at]);

  // Ciclo de vida do áudio discreto: para imediatamente se aceitar, recusar ou desmontar
  useEffect(() => {
    if (!invite) {
      chimeRef.current?.stop();
      chimeRef.current = null;
      return;
    }

    const player = new InviteChimePlayer();
    chimeRef.current = player;
    player.start();

    return () => {
      player.stop();
      if (chimeRef.current === player) {
        chimeRef.current = null;
      }
    };
  }, [invite?.invite_id]);

  useEffect(() => {
    if (!invite) return;

    setErrorMessage(null);
    setIsAccepting(false);
    setIsDeclining(false);

    const updateTimer = () => {
      const now = Date.now();
      const diff = Math.max(0, Math.floor((expiresAtMs - now) / 1000));
      // Garante teto de 15 segundos
      setSecondsRemaining(Math.min(15, diff));
      if (diff <= 0) {
        chimeRef.current?.stop();
      }
    };

    updateTimer();
    const interval = setInterval(updateTimer, 1000);

    return () => clearInterval(interval);
  }, [invite, expiresAtMs]);

  if (!invite || secondsRemaining <= 0) return null;

  const handleAcceptClick = async () => {
    if (isAccepting || isDeclining) return;
    chimeRef.current?.stop();
    setIsAccepting(true);
    setErrorMessage(null);

    const res = await onAccept(invite.invite_id);
    if (!res.success) {
      setErrorMessage(res.error || 'Não foi possível aceitar o convite.');
      setIsAccepting(false);
    }
  };

  const handleDeclineClick = async () => {
    if (isAccepting || isDeclining) return;
    chimeRef.current?.stop();
    setIsDeclining(true);
    setErrorMessage(null);

    const res = await onDecline(invite.invite_id);
    if (!res.success) {
      setErrorMessage(res.error || 'Não foi possível recusar o convite.');
      setIsDeclining(false);
    }
  };

  // Percentual restante para a barra de progresso (base de 15 segundos)
  const progressPercent = Math.min(100, Math.max(0, (secondsRemaining / 15) * 100));

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-in fade-in duration-200">
      <div
        className="w-full max-w-sm bg-slate-900 border-2 border-blue-500/50 rounded-2xl shadow-2xl overflow-hidden flex flex-col animate-in zoom-in-95 duration-200"
        role="dialog"
        aria-modal="true"
        aria-labelledby="received-invite-title"
      >
        {/* Header Bar */}
        <div className="px-4 py-3 bg-gradient-to-r from-blue-900/60 to-purple-900/60 border-b border-blue-500/30 flex items-center justify-between">
          <div className="flex items-center gap-2 text-blue-400 font-bold text-xs uppercase tracking-wider">
            <Gamepad2 className="w-4 h-4 animate-bounce" />
            <span>Convite para Jogar</span>
          </div>
          <div className="flex items-center gap-1.5 text-xs font-mono text-blue-300 font-bold">
            <Clock className="w-3.5 h-3.5" />
            <span>{secondsRemaining}s</span>
          </div>
        </div>

        {/* Progress bar countdown */}
        <div className="w-full bg-slate-800 h-1">
          <div
            className="bg-blue-500 h-full transition-all duration-1000"
            style={{ width: `${progressPercent}%` }}
          />
        </div>

        {/* Body */}
        <div className="p-6 text-center space-y-4">
          <div className="relative inline-block mx-auto">
            <PlayerAvatar
              avatarUrl={invite.sender_avatar_url}
              displayName={invite.sender_display_name}
              size="lg"
            />
            <span className="absolute -bottom-1 -right-1 p-1 bg-blue-600 rounded-full text-white border-2 border-slate-900">
              <Play className="w-3 h-3 fill-current" />
            </span>
          </div>

          <div>
            <h3 id="received-invite-title" className="text-lg font-bold text-white leading-tight">
              {invite.sender_display_name}
            </h3>
            <p className="text-xs text-slate-400 font-medium">@{invite.sender_username}</p>
            <p className="text-xs text-blue-400 mt-2 font-semibold">
              Convidou você para jogar uma partida de{' '}
              <span className="text-white">{invite.game_title}</span>!
            </p>
          </div>

          {/* Error Message */}
          {errorMessage && (
            <div className="p-3 rounded-xl bg-red-950/70 border border-red-800/80 text-red-200 text-xs flex items-center gap-2 text-left">
              <AlertCircle className="w-4 h-4 shrink-0 text-red-400" />
              <span>{errorMessage}</span>
            </div>
          )}

          {/* Action Buttons */}
          <div className="grid grid-cols-2 gap-3 pt-2">
            <button
              type="button"
              disabled={isAccepting || isDeclining}
              onClick={handleDeclineClick}
              className="py-2.5 px-4 rounded-xl bg-slate-800 hover:bg-slate-750 text-slate-300 font-bold text-xs transition-colors disabled:opacity-50 flex items-center justify-center gap-1.5 focus-visible:outline-2 focus-visible:outline-slate-400"
            >
              {isDeclining ? (
                <RotateCw className="w-4 h-4 animate-spin" />
              ) : (
                <X className="w-4 h-4" />
              )}
              <span>Recusar</span>
            </button>

            <button
              type="button"
              disabled={isAccepting || isDeclining}
              onClick={handleAcceptClick}
              className="py-2.5 px-4 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-bold text-xs shadow-lg shadow-blue-900/40 transition-all transform active:scale-95 disabled:opacity-50 flex items-center justify-center gap-1.5 focus-visible:outline-2 focus-visible:outline-blue-400"
            >
              {isAccepting ? (
                <RotateCw className="w-4 h-4 animate-spin" />
              ) : (
                <Check className="w-4 h-4" />
              )}
              <span>Aceitar e Jogar</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

