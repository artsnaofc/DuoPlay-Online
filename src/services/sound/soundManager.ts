// ============================================================================
// Service: Sound & Background Music Engine — DuoPlay-Online
// Description: Gerenciador de efeitos sonoros e música de fundo generativa suave
//              utilizando a Web Audio API pura, sem dependência de assets externos.
// ============================================================================

class SoundManager {
  private ctx: AudioContext | null = null;
  private musicGainNode: GainNode | null = null;
  private sfxGainNode: GainNode | null = null;
  private isMusicPlaying = false;
  private isMusicMuted = false;
  private isSfxMuted = false;
  private musicTimer: number | null = null;
  private stepIndex = 0;

  constructor() {
    // Carrega preferências salvas do usuário se existirem
    if (typeof window !== 'undefined') {
      try {
        const musicPref = localStorage.getItem('duoplay_music_muted');
        const sfxPref = localStorage.getItem('duoplay_sfx_muted');
        if (musicPref !== null) this.isMusicMuted = musicPref === 'true';
        if (sfxPref !== null) this.isSfxMuted = sfxPref === 'true';
      } catch {
        // Ignora erros de localStorage
      }
    }
  }

  private getAudioContext(): AudioContext | null {
    if (typeof window === 'undefined') return null;
    if (!this.ctx) {
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (AudioCtx) {
        this.ctx = new AudioCtx();
      }
    }
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }
    return this.ctx;
  }

  public getMusicMuted(): boolean {
    return this.isMusicMuted;
  }

  public getSfxMuted(): boolean {
    return this.isSfxMuted;
  }

  public setMusicMuted(muted: boolean): void {
    this.isMusicMuted = muted;
    try {
      localStorage.setItem('duoplay_music_muted', String(muted));
    } catch {}
    if (this.musicGainNode) {
      this.musicGainNode.gain.value = muted ? 0 : 0.04;
    }
  }

  public setSfxMuted(muted: boolean): void {
    this.isSfxMuted = muted;
    try {
      localStorage.setItem('duoplay_sfx_muted', String(muted));
    } catch {}
  }

  /**
   * Inicia a música de fundo ambiente sutil (lo-fi pentatônica calma, volume super baixo 0.04)
   * NUNCA invasiva ou chamativa, criando uma atmosfera imersiva agradável.
   */
  public startBackgroundMusic(): void {
    if (this.isMusicPlaying) return;
    const ctx = this.getAudioContext();
    if (!ctx) return;

    this.isMusicPlaying = true;

    if (!this.musicGainNode) {
      this.musicGainNode = ctx.createGain();
      this.musicGainNode.gain.setValueAtTime(this.isMusicMuted ? 0 : 0.04, ctx.currentTime);
      this.musicGainNode.connect(ctx.destination);
    }

    // Progressão suave de notas pentatônicas calmas (Lofi chill/lounge):
    // C4, D4, E4, G4, A4, C5, D5, E5
    const notes = [261.63, 293.66, 329.63, 392.00, 440.00, 523.25, 587.33, 659.25];
    const bassNotes = [130.81, 164.81, 174.61, 196.00];

    const playChordStep = () => {
      if (!this.isMusicPlaying || !this.ctx || !this.musicGainNode) return;

      const now = this.ctx.currentTime;
      const bassFreq = bassNotes[this.stepIndex % bassNotes.length];
      const noteFreq = notes[(this.stepIndex * 3 + 1) % notes.length];
      const harmonyFreq = notes[(this.stepIndex * 2 + 4) % notes.length];

      // Bass pad suave com filtro passa-baixas
      try {
        const bassOsc = this.ctx.createOscillator();
        const bassGain = this.ctx.createGain();
        const filter = this.ctx.createBiquadFilter();

        filter.type = 'lowpass';
        filter.frequency.setValueAtTime(280, now);

        bassOsc.type = 'triangle';
        bassOsc.frequency.setValueAtTime(bassFreq, now);

        bassGain.gain.setValueAtTime(0.001, now);
        bassGain.gain.linearRampToValueAtTime(0.06, now + 0.8);
        bassGain.gain.exponentialRampToValueAtTime(0.001, now + 3.2);

        bassOsc.connect(filter);
        filter.connect(bassGain);
        bassGain.connect(this.musicGainNode);

        bassOsc.start(now);
        bassOsc.stop(now + 3.2);
      } catch {}

      // Melodia calma (sino/chime quente)
      try {
        const leadOsc = this.ctx.createOscillator();
        const leadGain = this.ctx.createGain();

        leadOsc.type = 'sine';
        leadOsc.frequency.setValueAtTime(noteFreq, now + 0.4);

        leadGain.gain.setValueAtTime(0.001, now + 0.4);
        leadGain.gain.linearRampToValueAtTime(0.04, now + 0.9);
        leadGain.gain.exponentialRampToValueAtTime(0.001, now + 2.8);

        leadOsc.connect(leadGain);
        leadGain.connect(this.musicGainNode);

        leadOsc.start(now + 0.4);
        leadOsc.stop(now + 2.8);
      } catch {}

      // Harmonia secundária sutil
      if (this.stepIndex % 2 === 0) {
        try {
          const harmOsc = this.ctx.createOscillator();
          const harmGain = this.ctx.createGain();

          harmOsc.type = 'sine';
          harmOsc.frequency.setValueAtTime(harmonyFreq, now + 1.2);

          harmGain.gain.setValueAtTime(0.001, now + 1.2);
          harmGain.gain.linearRampToValueAtTime(0.03, now + 1.6);
          harmGain.gain.exponentialRampToValueAtTime(0.001, now + 3.0);

          harmOsc.connect(harmGain);
          harmGain.connect(this.musicGainNode);

          harmOsc.start(now + 1.2);
          harmOsc.stop(now + 3.0);
        } catch {}
      }

      this.stepIndex = (this.stepIndex + 1) % 16;
    };

    // Executa primeiro acorde
    playChordStep();
    // Alterna compasso suavemente a cada 3.2 segundos
    this.musicTimer = window.setInterval(playChordStep, 3200);
  }

  public stopBackgroundMusic(): void {
    this.isMusicPlaying = false;
    if (this.musicTimer !== null) {
      clearInterval(this.musicTimer);
      this.musicTimer = null;
    }
  }

  // ==========================================
  // EFEITOS SONOROS (SFX)
  // ==========================================

  /**
   * Som de clique / jogada de peça no Jogo da Velha (X ou O)
   */
  public playTttPlaceMark(symbol: 'X' | 'O' | string): void {
    if (this.isSfxMuted) return;
    const ctx = this.getAudioContext();
    if (!ctx) return;

    try {
      const now = ctx.currentTime;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);

      if (symbol === 'X') {
        // Tom mais claro e rápido
        osc.type = 'sine';
        osc.frequency.setValueAtTime(587.33, now); // D5
        osc.frequency.exponentialRampToValueAtTime(880, now + 0.12);
        gain.gain.setValueAtTime(0.18, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.12);
        osc.start(now);
        osc.stop(now + 0.12);
      } else {
        // Tom suave arredondado
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(440, now); // A4
        osc.frequency.exponentialRampToValueAtTime(523.25, now + 0.14);
        gain.gain.setValueAtTime(0.18, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.14);
        osc.start(now);
        osc.stop(now + 0.14);
      }
    } catch {}
  }

  /**
   * Som de virada de turno (alerta suave de que agora é sua vez)
   */
  public playTurnNotification(): void {
    if (this.isSfxMuted) return;
    const ctx = this.getAudioContext();
    if (!ctx) return;

    try {
      const now = ctx.currentTime;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.type = 'sine';
      osc.frequency.setValueAtTime(440, now);
      osc.frequency.setValueAtTime(659.25, now + 0.08); // Mi alto
      gain.gain.setValueAtTime(0.12, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.22);
      osc.start(now);
      osc.stop(now + 0.22);
    } catch {}
  }

  /**
   * Som de término de tempo de turno (timeout / bip descendente de alerta)
   */
  public playTurnTimeout(): void {
    if (this.isSfxMuted) return;
    const ctx = this.getAudioContext();
    if (!ctx) return;

    try {
      const now = ctx.currentTime;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(400, now);
      osc.frequency.exponentialRampToValueAtTime(150, now + 0.3);
      gain.gain.setValueAtTime(0.18, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.3);
      osc.start(now);
      osc.stop(now + 0.3);
    } catch {}
  }

  /**
   * Cobrinha comeu maçã / comida (blip alegre clássico)
   */
  public playSnakeEatFood(): void {
    if (this.isSfxMuted) return;
    const ctx = this.getAudioContext();
    if (!ctx) return;

    try {
      const now = ctx.currentTime;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.type = 'sine';
      osc.frequency.setValueAtTime(600, now);
      osc.frequency.exponentialRampToValueAtTime(1050, now + 0.09);
      gain.gain.setValueAtTime(0.2, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.1);
      osc.start(now);
      osc.stop(now + 0.1);
    } catch {}
  }

  /**
   * Mudança de direção da cobrinha (micro click táctil)
   */
  public playSnakeTurn(): void {
    if (this.isSfxMuted) return;
    const ctx = this.getAudioContext();
    if (!ctx) return;

    try {
      const now = ctx.currentTime;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.type = 'sine';
      osc.frequency.setValueAtTime(320, now);
      gain.gain.setValueAtTime(0.05, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.04);
      osc.start(now);
      osc.stop(now + 0.04);
    } catch {}
  }

  /**
   * Colisão / Morte na Cobrinha (impacto retrô)
   */
  public playSnakeCrash(): void {
    if (this.isSfxMuted) return;
    const ctx = this.getAudioContext();
    if (!ctx) return;

    try {
      const now = ctx.currentTime;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(180, now);
      osc.frequency.exponentialRampToValueAtTime(45, now + 0.35);
      gain.gain.setValueAtTime(0.25, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.35);
      osc.start(now);
      osc.stop(now + 0.35);
    } catch {}
  }

  /**
   * Fanfarra triunfante de Vitória
   */
  public playVictoryFanfare(): void {
    if (this.isSfxMuted) return;
    const ctx = this.getAudioContext();
    if (!ctx) return;

    try {
      const now = ctx.currentTime;
      const notes = [523.25, 659.25, 783.99, 1046.5]; // C5, E5, G5, C6
      notes.forEach((freq, i) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(ctx.destination);

        osc.type = 'triangle';
        osc.frequency.setValueAtTime(freq, now + i * 0.1);
        gain.gain.setValueAtTime(0.2, now + i * 0.1);
        gain.gain.exponentialRampToValueAtTime(0.001, now + i * 0.1 + (i === 3 ? 0.8 : 0.25));
        osc.start(now + i * 0.1);
        osc.stop(now + i * 0.1 + (i === 3 ? 0.8 : 0.25));
      });
    } catch {}
  }

  /**
   * Som de Derrota sutil e respeitoso
   */
  public playDefeatSound(): void {
    if (this.isSfxMuted) return;
    const ctx = this.getAudioContext();
    if (!ctx) return;

    try {
      const now = ctx.currentTime;
      const notes = [392.00, 369.99, 329.63, 293.66]; // Sol, Fá#, Mi, Ré
      notes.forEach((freq, i) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(ctx.destination);

        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, now + i * 0.16);
        gain.gain.setValueAtTime(0.18, now + i * 0.16);
        gain.gain.exponentialRampToValueAtTime(0.001, now + i * 0.16 + 0.35);
        osc.start(now + i * 0.16);
        osc.stop(now + i * 0.16 + 0.35);
      });
    } catch {}
  }
}

export const soundManager = new SoundManager();
