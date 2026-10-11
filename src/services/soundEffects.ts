// ============================================================================
// Service: Web Audio API Sound Effects — DuoPlay-Online
// Description: Gerenciador centralizado de efeitos sonoros sintetizados para jogos
//              (Tic-Tac-Toe, Snake, Carta Duo e microinterações da plataforma).
// ============================================================================

class SoundEffectsService {
  private ctx: AudioContext | null = null;
  private muted: boolean = false;

  constructor() {
    // Carrega preferência de mudo do localStorage se disponível
    if (typeof window !== 'undefined') {
      const storedMute = localStorage.getItem('duoplay_sound_muted');
      if (storedMute === 'true') {
        this.muted = true;
      }
    }
  }

  private getContext(): AudioContext | null {
    if (this.muted) return null;
    if (typeof window === 'undefined') return null;
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (AudioCtx) {
        this.ctx = new AudioCtx();
      }
    }
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }
    return this.ctx;
  }

  public setMuted(mute: boolean) {
    this.muted = mute;
    if (typeof window !== 'undefined') {
      localStorage.setItem('duoplay_sound_muted', String(mute));
    }
  }

  public isMuted(): boolean {
    return this.muted;
  }

  public play(effect: 'click' | 'place' | 'eat' | 'crash' | 'card' | 'win' | 'lose' | 'draw' | 'countdown') {
    const ctx = this.getContext();
    if (!ctx) return;

    try {
      const now = ctx.currentTime;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);

      if (effect === 'click') {
        osc.frequency.setValueAtTime(400, now);
        osc.frequency.exponentialRampToValueAtTime(600, now + 0.05);
        gain.gain.setValueAtTime(0.1, now);
        gain.gain.exponentialRampToValueAtTime(0.01, now + 0.05);
        osc.start(now);
        osc.stop(now + 0.05);
      } else if (effect === 'place') {
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(300, now);
        osc.frequency.exponentialRampToValueAtTime(500, now + 0.1);
        gain.gain.setValueAtTime(0.15, now);
        gain.gain.exponentialRampToValueAtTime(0.01, now + 0.1);
        osc.start(now);
        osc.stop(now + 0.1);
      } else if (effect === 'eat') {
        osc.type = 'sine';
        osc.frequency.setValueAtTime(440, now);
        osc.frequency.setValueAtTime(880, now + 0.08);
        gain.gain.setValueAtTime(0.12, now);
        gain.gain.exponentialRampToValueAtTime(0.01, now + 0.15);
        osc.start(now);
        osc.stop(now + 0.15);
      } else if (effect === 'crash') {
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(180, now);
        osc.frequency.exponentialRampToValueAtTime(60, now + 0.25);
        gain.gain.setValueAtTime(0.25, now);
        gain.gain.exponentialRampToValueAtTime(0.01, now + 0.25);
        osc.start(now);
        osc.stop(now + 0.25);
      } else if (effect === 'card') {
        osc.type = 'sine';
        osc.frequency.setValueAtTime(520, now);
        osc.frequency.exponentialRampToValueAtTime(780, now + 0.12);
        gain.gain.setValueAtTime(0.15, now);
        gain.gain.exponentialRampToValueAtTime(0.01, now + 0.12);
        osc.start(now);
        osc.stop(now + 0.12);
      } else if (effect === 'win') {
        // Sequência triunfante de arpejo
        const notes = [440, 554, 659, 880];
        notes.forEach((freq, idx) => {
          const t = now + idx * 0.1;
          const o = ctx.createOscillator();
          const g = ctx.createGain();
          o.connect(g);
          g.connect(ctx.destination);
          o.frequency.setValueAtTime(freq, t);
          g.gain.setValueAtTime(0.15, t);
          g.gain.exponentialRampToValueAtTime(0.01, t + 0.3);
          o.start(t);
          o.stop(t + 0.3);
        });
      } else if (effect === 'lose') {
        // Sequência descendente melancólica
        const notes = [330, 294, 261, 220];
        notes.forEach((freq, idx) => {
          const t = now + idx * 0.12;
          const o = ctx.createOscillator();
          const g = ctx.createGain();
          o.connect(g);
          g.connect(ctx.destination);
          o.type = 'sawtooth';
          o.frequency.setValueAtTime(freq, t);
          g.gain.setValueAtTime(0.15, t);
          g.gain.exponentialRampToValueAtTime(0.01, t + 0.25);
          o.start(t);
          o.stop(t + 0.25);
        });
      } else if (effect === 'draw') {
        osc.frequency.setValueAtTime(350, now);
        osc.frequency.setValueAtTime(350, now + 0.15);
        gain.gain.setValueAtTime(0.15, now);
        gain.gain.exponentialRampToValueAtTime(0.01, now + 0.3);
        osc.start(now);
        osc.stop(now + 0.3);
      } else if (effect === 'countdown') {
        osc.frequency.setValueAtTime(800, now);
        gain.gain.setValueAtTime(0.1, now);
        gain.gain.exponentialRampToValueAtTime(0.01, now + 0.08);
        osc.start(now);
        osc.stop(now + 0.08);
      }
    } catch {
      // Ignora erros de áudio se navegador bloquear
    }
  }

  private bgmInterval: ReturnType<typeof setInterval> | null = null;
  private bgmPlaying: boolean = false;

  public startBgm() {
    if (this.bgmPlaying || this.muted) return;
    this.bgmPlaying = true;

    const playArpeggioLoop = () => {
      const ctx = this.getContext();
      if (!ctx || !this.bgmPlaying) return;
      try {
        const melody = [261.63, 329.63, 392.00, 523.25, 392.00, 329.63];
        melody.forEach((freq, idx) => {
          const t = ctx.currentTime + idx * 0.28;
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.type = 'triangle';
          osc.connect(gain);
          gain.connect(ctx.destination);
          osc.frequency.setValueAtTime(freq, t);
          gain.gain.setValueAtTime(0.03, t);
          gain.gain.exponentialRampToValueAtTime(0.001, t + 0.22);
          osc.start(t);
          osc.stop(t + 0.22);
        });
      } catch {}
    };

    playArpeggioLoop();
    this.bgmInterval = setInterval(playArpeggioLoop, 3200);
  }

  public stopBgm() {
    this.bgmPlaying = false;
    if (this.bgmInterval) {
      clearInterval(this.bgmInterval);
      this.bgmInterval = null;
    }
  }

  public toggleBgm(): boolean {
    if (this.bgmPlaying) {
      this.stopBgm();
      return false;
    } else {
      this.startBgm();
      return true;
    }
  }

  public isBgmPlaying(): boolean {
    return this.bgmPlaying;
  }
}

export const soundService = new SoundEffectsService();
