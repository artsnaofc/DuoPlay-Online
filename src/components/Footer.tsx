import React from 'react';
import { Gamepad2, ShieldCheck, Smartphone, Users } from 'lucide-react';

export const Footer: React.FC = () => {
  return (
    <footer className="border-t border-slate-800/80 bg-slate-950 mt-24 text-slate-400">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8 mb-8">
          {/* Brand Column */}
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <div className="flex items-center justify-center w-7 h-7 rounded-md bg-blue-600 text-white">
                <Gamepad2 className="w-4 h-4" />
              </div>
              <span className="text-sm font-bold text-white tracking-tight">
                DuoPlay<span className="text-blue-400">-Online</span>
              </span>
            </div>
            <p className="text-xs text-slate-400 max-w-sm leading-relaxed">
              Plataforma web de jogos multiplayer em tempo real. Desafie amigos em partidas rápidas e leves diretamente pelo navegador, sem necessidade de downloads.
            </p>
          </div>

          {/* Platform Highlights */}
          <div className="space-y-2">
            <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-200">
              Destaques
            </h4>
            <ul className="space-y-1.5 text-xs text-slate-400">
              <li className="flex items-center gap-2">
                <Users className="w-3.5 h-3.5 text-blue-400 shrink-0" />
                <span>Salas privadas e convites fáceis</span>
              </li>
              <li className="flex items-center gap-2">
                <Smartphone className="w-3.5 h-3.5 text-purple-400 shrink-0" />
                <span>Compatível com celular e computador</span>
              </li>
              <li className="flex items-center gap-2">
                <ShieldCheck className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                <span>Proteção contra oscilações de conexão</span>
              </li>
            </ul>
          </div>

          {/* Quick Info */}
          <div className="space-y-2">
            <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-200">
              Sobre a Plataforma
            </h4>
            <p className="text-xs text-slate-400 leading-relaxed">
              Desenvolvida para oferecer a melhor experiência multiplayer casual e competitiva na web, com tecnologia moderna e foco em jogabilidade instantânea.
            </p>
          </div>
        </div>

        <div className="pt-8 border-t border-slate-900 flex flex-col sm:flex-row items-center justify-between gap-4 text-[11px] text-slate-500">
          <p>© {new Date().getFullYear()} DuoPlay-Online. Todos os direitos reservados.</p>
          <div className="flex items-center gap-4">
            <span>Jogos Multiplayer Web</span>
            <span aria-hidden="true">·</span>
            <span>Mobile & Desktop</span>
          </div>
        </div>
      </div>
    </footer>
  );
};
