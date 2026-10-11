import React, { useState, useEffect } from 'react';
import { Volume2, VolumeX, Music } from 'lucide-react';
import { soundManager } from '@/services/sound/soundManager';

export const AudioControls: React.FC<{ className?: string }> = ({ className = '' }) => {
  const [musicMuted, setMusicMuted] = useState(soundManager.getMusicMuted());
  const [sfxMuted, setSfxMuted] = useState(soundManager.getSfxMuted());

  useEffect(() => {
    // Inicia música suave após a primeira interação do usuário (respeitando autoplay policies)
    const handleFirstInteraction = () => {
      soundManager.startBackgroundMusic();
      window.removeEventListener('click', handleFirstInteraction);
      window.removeEventListener('keydown', handleFirstInteraction);
      window.removeEventListener('touchstart', handleFirstInteraction);
    };

    window.addEventListener('click', handleFirstInteraction);
    window.addEventListener('keydown', handleFirstInteraction);
    window.addEventListener('touchstart', handleFirstInteraction);

    return () => {
      window.removeEventListener('click', handleFirstInteraction);
      window.removeEventListener('keydown', handleFirstInteraction);
      window.removeEventListener('touchstart', handleFirstInteraction);
    };
  }, []);

  const toggleMusic = () => {
    const next = !musicMuted;
    setMusicMuted(next);
    soundManager.setMusicMuted(next);
    if (!next) {
      soundManager.startBackgroundMusic();
    }
  };

  const toggleSfx = () => {
    const next = !sfxMuted;
    setSfxMuted(next);
    soundManager.setSfxMuted(next);
  };

  return (
    <div className={`flex items-center gap-1.5 ${className}`}>
      {/* Botão de Música de Fundo */}
      <button
        type="button"
        onClick={toggleMusic}
        title={musicMuted ? 'Ativar música de fundo' : 'Mutar música de fundo'}
        className={`p-1.5 rounded-lg border transition-colors flex items-center justify-center ${
          musicMuted
            ? 'bg-slate-900/80 border-slate-800 text-slate-500 hover:text-slate-300'
            : 'bg-indigo-950/40 border-indigo-700/50 text-indigo-300 hover:bg-indigo-900/50'
        }`}
        aria-label={musicMuted ? 'Ativar música de fundo' : 'Mutar música de fundo'}
      >
        <Music className="w-3.5 h-3.5" />
      </button>

      {/* Botão de Efeitos Sonoros */}
      <button
        type="button"
        onClick={toggleSfx}
        title={sfxMuted ? 'Ativar efeitos sonoros' : 'Mutar efeitos sonoros'}
        className={`p-1.5 rounded-lg border transition-colors flex items-center justify-center ${
          sfxMuted
            ? 'bg-slate-900/80 border-slate-800 text-slate-500 hover:text-slate-300'
            : 'bg-emerald-950/40 border-emerald-700/50 text-emerald-300 hover:bg-emerald-900/50'
        }`}
        aria-label={sfxMuted ? 'Ativar efeitos sonoros' : 'Mutar efeitos sonoros'}
      >
        {sfxMuted ? <VolumeX className="w-3.5 h-3.5" /> : <Volume2 className="w-3.5 h-3.5" />}
      </button>
    </div>
  );
};
