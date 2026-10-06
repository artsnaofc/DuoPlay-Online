import React, { useState } from 'react';
import { Download, Share2, X, Smartphone } from 'lucide-react';
import { usePWAInstall } from '@/hooks/usePWAInstall';

export const PWAInstallButton: React.FC = () => {
  const { isInstallable, isInstalled, isIOS, install } = usePWAInstall();
  const [showIOSModal, setShowIOSModal] = useState(false);

  // If already running standalone or installed, hide prompt button
  if (isInstalled) {
    return null;
  }

  // Standard Chromium / Android / Desktop prompt
  if (isInstallable) {
    return (
      <button
        onClick={install}
        className="inline-flex items-center gap-2 px-3 py-1.5 text-xs font-semibold rounded-lg bg-blue-600 hover:bg-blue-500 text-white shadow-sm transition-colors focus-visible:outline-2 focus-visible:outline-blue-400 focus-visible:outline-offset-2"
        aria-label="Instalar DuoPlay-Online como aplicativo"
      >
        <Download className="w-3.5 h-3.5" aria-hidden="true" />
        <span>Instalar App</span>
      </button>
    );
  }

  // iOS Safari flow
  if (isIOS) {
    return (
      <>
        <button
          onClick={() => setShowIOSModal(true)}
          className="inline-flex items-center gap-2 px-3 py-1.5 text-xs font-semibold rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition-colors focus-visible:outline-2 focus-visible:outline-blue-400 focus-visible:outline-offset-2"
          aria-label="Instruções de instalação para iOS"
        >
          <Smartphone className="w-3.5 h-3.5" aria-hidden="true" />
          <span>Instalar no iOS</span>
        </button>

        {showIOSModal && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-xs p-4"
            role="dialog"
            aria-modal="true"
            aria-labelledby="ios-install-title"
          >
            <div className="w-full max-w-sm rounded-xl bg-slate-900 border border-slate-800 p-6 shadow-2xl text-slate-100">
              <div className="flex items-center justify-between pb-3 border-b border-slate-800">
                <h3 id="ios-install-title" className="text-sm font-semibold flex items-center gap-2 text-white">
                  <Smartphone className="w-4 h-4 text-blue-400" />
                  Instalar no iPhone / iPad
                </h3>
                <button
                  onClick={() => setShowIOSModal(false)}
                  className="p-1 text-slate-400 hover:text-white rounded-lg transition-colors focus-visible:outline-2 focus-visible:outline-blue-400"
                  aria-label="Fechar"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="mt-4 space-y-3 text-xs text-slate-300">
                <div className="flex items-start gap-3 p-2.5 rounded-lg bg-slate-800/60 border border-slate-800">
                  <span className="flex items-center justify-center w-5 h-5 rounded-full bg-blue-600/30 text-blue-400 font-bold shrink-0">1</span>
                  <p>
                    No Safari, toque no ícone de <strong className="text-white">Compartilhar</strong> (<Share2 className="w-3 h-3 inline mx-0.5 text-blue-400" />) na barra inferior.
                  </p>
                </div>
                <div className="flex items-start gap-3 p-2.5 rounded-lg bg-slate-800/60 border border-slate-800">
                  <span className="flex items-center justify-center w-5 h-5 rounded-full bg-blue-600/30 text-blue-400 font-bold shrink-0">2</span>
                  <p>
                    Role o menu para baixo e selecione <strong className="text-white">Adicionar à Tela de Início</strong>.
                  </p>
                </div>
                <div className="flex items-start gap-3 p-2.5 rounded-lg bg-slate-800/60 border border-slate-800">
                  <span className="flex items-center justify-center w-5 h-5 rounded-full bg-blue-600/30 text-blue-400 font-bold shrink-0">3</span>
                  <p>
                    Confirme em <strong className="text-white">Adicionar</strong> no canto superior direito.
                  </p>
                </div>
              </div>

              <button
                onClick={() => setShowIOSModal(false)}
                className="mt-5 w-full py-2 text-xs font-semibold rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 transition-colors"
              >
                Entendi
              </button>
            </div>
          </div>
        )}
      </>
    );
  }

  return null;
};
