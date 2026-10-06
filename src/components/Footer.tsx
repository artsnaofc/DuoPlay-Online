import React from 'react';
import { Gamepad2, ShieldCheck, Cpu, Database } from 'lucide-react';

export const Footer: React.FC = () => {
  return (
    <footer className="border-t border-slate-800/80 bg-slate-950 mt-20 text-slate-400">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-8 mb-8">
          {/* Brand Column */}
          <div className="md:col-span-2 space-y-3">
            <div className="flex items-center gap-2">
              <div className="flex items-center justify-center w-7 h-7 rounded-md bg-blue-600 text-white">
                <Gamepad2 className="w-4 h-4" />
              </div>
              <span className="text-sm font-bold text-white tracking-tight">
                DuoPlay<span className="text-blue-400">-Online</span>
              </span>
            </div>
            <p className="text-xs text-slate-400 max-w-sm leading-relaxed">
              Plataforma web de jogos multiplayer projetada com arquitetura modular, desacoplada e serverless. 
              Preparada para múltiplos jogos casuais e competitivos em tempo real.
            </p>
            <div className="flex items-center gap-3 text-[11px] text-slate-500 pt-1">
              <span>React + Vite</span>
              <span aria-hidden="true">·</span>
              <span>Tailwind CSS</span>
              <span aria-hidden="true">·</span>
              <span>PWA Ready</span>
            </div>
          </div>

          {/* Architecture Pillars Column */}
          <div className="space-y-2">
            <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-200">
              Camadas da Arquitetura
            </h4>
            <ul className="space-y-1.5 text-xs text-slate-400">
              <li className="flex items-center gap-1.5">
                <Gamepad2 className="w-3.5 h-3.5 text-blue-400 shrink-0" />
                <span>Camada de Jogos (Agnóstica)</span>
              </li>
              <li className="flex items-center gap-1.5">
                <Cpu className="w-3.5 h-3.5 text-purple-400 shrink-0" />
                <span>Network Engine (SDK)</span>
              </li>
              <li className="flex items-center gap-1.5">
                <Database className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                <span>Supabase PostgreSQL + Realtime</span>
              </li>
            </ul>
          </div>

          {/* Status & Scope Notice */}
          <div className="space-y-2">
            <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-200">
              Status do Projeto
            </h4>
            <div className="p-3 rounded-lg bg-slate-900/80 border border-slate-800 text-[11px] space-y-1">
              <div className="flex items-center gap-1.5 font-semibold text-emerald-400">
                <ShieldCheck className="w-3.5 h-3.5" />
                <span>Fase 1: Fundação Frontend</span>
              </div>
              <p className="text-slate-400">
                Lógica multiplayer, autenticação e salas serão introduzidas nas fases seguintes conforme o planejamento oficial.
              </p>
            </div>
          </div>
        </div>

        <div className="pt-8 border-t border-slate-900 flex flex-col sm:flex-row items-center justify-between gap-4 text-[11px] text-slate-500">
          <p>© {new Date().getFullYear()} DuoPlay-Online. Todos os direitos reservados.</p>
          <div className="flex items-center gap-4">
            <span>DuoPlay Architecture v1.0</span>
            <span aria-hidden="true">·</span>
            <span>Mobile-First & PWA</span>
          </div>
        </div>
      </div>
    </footer>
  );
};
