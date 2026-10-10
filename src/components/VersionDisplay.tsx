import React, { useState, useEffect, useCallback } from 'react';

interface VersionInfo {
  version: string;
  commit: string;
  buildTime: string;
  environment: string;
}

export const VersionDisplay: React.FC = () => {
  const [versionInfo, setVersionInfo] = useState<VersionInfo | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);

  const fetchVersion = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      const response = await fetch('/version.json?t=' + Date.now()); // cache busting
      if (!response.ok) throw new Error('Falha ao carregar versão');
      const data = await response.json();
      setVersionInfo(data);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchVersion();
  }, [fetchVersion]);

  return (
    <div className="text-[10px] text-slate-600 flex flex-col items-center sm:items-start gap-1">
      {loading ? (
        <span>Carregando versão...</span>
      ) : error ? (
        <button onClick={fetchVersion} className="hover:text-slate-400">
          Erro ao carregar versão. Tentar novamente.
        </button>
      ) : versionInfo ? (
        <div className="flex flex-wrap items-center justify-center gap-2">
          <span>v{versionInfo.version}</span>
          <span>·</span>
          <span title={`Commit: ${versionInfo.commit}`}>
            {versionInfo.commit.substring(0, 7)}
          </span>
          <span>·</span>
          <span>{new Date(versionInfo.buildTime).toLocaleDateString()}</span>
          <span className="hidden sm:inline">·</span>
          <span className="hidden sm:inline capitalize">{versionInfo.environment}</span>
        </div>
      ) : null}
    </div>
  );
};
