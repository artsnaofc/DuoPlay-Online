import React, { useMemo, useState } from 'react';
import { useGameSession } from '@/multiplayer/hooks/useGameSession';
import { useAuth } from '@/hooks/useAuth';
import { ArrowLeft, CheckCircle2, CircleHelp, LoaderCircle, Trophy } from 'lucide-react';

type HangmanState = {
  round?: number; phase?: 'choose_word' | 'guessing' | 'finished';
  category?: string; setter_id?: string; guesser_id?: string;
  masked_word?: string; word_length?: number; guessed_letters?: string[];
  mistakes?: number; max_mistakes?: number; scores?: Record<string, number>;
  last_round_winner_id?: string | null; revealed_word?: string | null;
};
const CATEGORIES = ['Animais','Comidas','Países e cidades','Esportes','Objetos','Natureza','Profissões','Filmes e personagens'];
const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');

export const HangmanGame: React.FC<{matchId:string;onLeave:()=>void}> = ({matchId,onLeave}) => {
  const { user } = useAuth();
  const { snapshot, myPlayer, opponentPlayer, submitAction, isLoading, error } = useGameSession<HangmanState>(matchId);
  const state = snapshot?.state;
  const [word,setWord] = useState('');
  const [category,setCategory] = useState(CATEGORIES[0]);
  const [busy,setBusy] = useState(false);
  const [message,setMessage] = useState('');
  const me = user?.id ?? '';
  const phase = state?.phase ?? 'choose_word';
  const roundForRole = state?.round ?? 1;
  const mySlot = myPlayer?.slot ?? 0;
  const setterSlot = roundForRole % 2 === 1 ? 1 : 2;
  const isSetter = state?.setter_id ? state.setter_id === me : mySlot === setterSlot;
  const isGuesser = state?.guesser_id ? state.guesser_id === me : mySlot !== 0 && mySlot !== setterSlot;
  const used = state?.guessed_letters ?? [];
  const scores = state?.scores ?? {};
  const submit = async (type:string,payload:Record<string,unknown>) => {
    setBusy(true); setMessage('');
    try {
      const result = await submitAction(type,payload);
      if (!result.accepted) setMessage(result.error?.message ?? 'Não foi possível registrar a ação.');
      else { setWord(''); await Promise.resolve(); }
    } catch { setMessage('Falha de conexão. Tente novamente.'); }
    finally { setBusy(false); }
  };
  const playerLabel = (id?:string) => id === me ? 'Você' : 'Adversário';
  const mistakes = Math.max(0,Math.min(6,state?.mistakes ?? 0));
  const drawing = useMemo(() => (
    <svg viewBox="0 0 160 150" className="w-36 h-36 sm:w-44 sm:h-44" role="img" aria-label={`Forca com ${mistakes} erros`}>
      <g stroke="currentColor" strokeWidth="4" strokeLinecap="round" fill="none">
        <path d="M18 136H116M42 136V14H106V28" />
        {mistakes>=1&&<circle cx="106" cy="42" r="13"/>}
        {mistakes>=2&&<path d="M106 55V91"/>}
        {mistakes>=3&&<path d="M106 64L86 79"/>}
        {mistakes>=4&&<path d="M106 64L126 79"/>}
        {mistakes>=5&&<path d="M106 91L88 115"/>}
        {mistakes>=6&&<path d="M106 91L124 115"/>}
      </g>
    </svg>
  ),[mistakes]);
  if (isLoading) return <div className="min-h-[60vh] grid place-items-center text-white"><LoaderCircle className="animate-spin mr-2"/> Carregando partida…</div>;
  if (!snapshot) return <div className="p-6 text-center text-white">Não foi possível carregar a partida. {error?.message}<button onClick={onLeave} className="block mx-auto mt-4 underline">Voltar</button></div>;
  const round = state?.round ?? 1;
  return <main className="min-h-[calc(100dvh-4rem)] bg-slate-950 text-white px-3 py-4 sm:px-6">
    <div className="mx-auto max-w-3xl space-y-4">
      <header className="flex items-center justify-between gap-3">
        <button onClick={onLeave} className="min-h-11 rounded-xl px-3 bg-slate-800 inline-flex items-center gap-2"><ArrowLeft size={18}/> Sair</button>
        <div className="text-center"><p className="text-xs uppercase tracking-widest text-violet-300">Jogo da Forca</p><h1 className="font-black text-xl">Rodada {round} de 5</h1></div>
        <div className="rounded-xl bg-slate-800 px-3 py-2 text-sm font-bold flex items-center gap-1"><Trophy size={16} className="text-amber-300"/>{scores[myPlayer?.userId ?? me] ?? 0} : {scores[opponentPlayer?.userId ?? ''] ?? 0}</div>
      </header>
      <section className="rounded-2xl border border-slate-800 bg-slate-900 p-4 sm:p-6 space-y-4">
        <div className="flex justify-between gap-3 text-sm">
          <div><p className="text-slate-400">Quem escolhe</p><p className="font-semibold">{playerLabel(state?.setter_id)}</p></div>
          <div className="text-right"><p className="text-slate-400">Quem adivinha</p><p className="font-semibold">{playerLabel(state?.guesser_id)}</p></div>
        </div>
        {phase === 'choose_word' && <div className="space-y-4">
          <div><h2 className="text-lg font-bold">{isSetter?'Escolha a palavra do adversário':'Aguardando a palavra'}</h2><p className="text-sm text-slate-400 mt-1">{isSetter?'Digite uma palavra em português de 3 a 16 letras. Ela ficará oculta do adversário.':'O outro jogador está preparando a palavra desta rodada.'}</p></div>
          {isSetter && <form className="space-y-3" onSubmit={e=>{e.preventDefault(); if(word.trim()) void submit('set_word',{word:word.trim(),category});}}>
            <label className="block text-sm text-slate-300">Categoria
              <select value={category} onChange={e=>setCategory(e.target.value)} className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-950 p-3 text-base">
                {CATEGORIES.map(c=><option key={c}>{c}</option>)}
              </select>
            </label>
            <label className="block text-sm text-slate-300">Palavra secreta
              <input value={word} onChange={e=>setWord(e.target.value.replace(/[^a-zA-ZÀ-ÿ]/g,'').slice(0,16))} minLength={3} maxLength={16} required autoComplete="off" className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-950 p-3 text-base" placeholder="Digite a palavra"/>
            </label>
            <button disabled={busy||word.trim().length<3} className="w-full min-h-12 rounded-xl bg-violet-600 font-bold disabled:opacity-50">{busy?'Enviando…':'Enviar palavra secreta'}</button>
          </form>}
        </div>}
        {phase === 'guessing' && <>
          <div className="flex flex-col items-center">
            <span className="text-xs uppercase tracking-widest text-cyan-300">{state?.category}</span>
            {drawing}
            <p className="text-sm text-slate-400">{mistakes} de 6 erros</p>
            <div className="mt-4 text-center font-mono text-2xl sm:text-3xl tracking-[0.25em] font-black" aria-label={`${state?.word_length ?? 0} letras`}>{state?.masked_word ?? ''}</div>
          </div>
          {isGuesser ? <div className="grid grid-cols-7 sm:grid-cols-9 gap-2">
            {LETTERS.map(letter=><button key={letter} disabled={busy||used.includes(letter.toLowerCase())} onClick={()=>void submit('guess_letter',{letter:letter.toLowerCase()})} className="min-h-11 rounded-lg border border-slate-700 bg-slate-800 font-bold hover:bg-violet-700 disabled:opacity-30">{letter}</button>)}
          </div> : <p className="text-center text-slate-300">Sua vez de aguardar: o adversário está tentando descobrir a palavra.</p>}
          {used.length>0&&<p className="text-center text-xs text-slate-400">Letras usadas: {used.map(l=>l.toUpperCase()).join(' · ')}</p>}
        </>}
        {phase === 'finished' && <div className="text-center space-y-3 py-4">
          <CheckCircle2 className="mx-auto text-emerald-400" size={42}/>
          <h2 className="text-2xl font-black">{round>=5?'Partida encerrada':'Rodada concluída'}</h2>
          <p className="text-slate-300">A palavra era <strong className="text-white">{state?.revealed_word}</strong></p>
          <p className="text-slate-400">{state?.last_round_winner_id ? `Ponto para ${playerLabel(state.last_round_winner_id)}` : 'Rodada sem vencedor'}</p>
          {round<5&&<p className="text-sm text-violet-300">A próxima rodada começa quando a sincronização oficial atualizar.</p>}
        </div>}
        {message&&<p role="alert" className="rounded-lg bg-red-950 p-3 text-sm text-red-200">{message}</p>}
        <p className="flex items-center justify-center gap-2 text-xs text-slate-500"><CircleHelp size={14}/> A palavra secreta é validada pelo servidor.</p>
      </section>
    </div>
  </main>;
};
