// ============================================================================
// Service: Multiplayer Performance & Stability Telemetry — DuoPlay-Online
// Description: Instrumentação leve em memória para medição de latência de RPCs,
//              frequência de ticks, atualizações Realtime e estabilidade de conexão.
//              Não armazena nem transmite dados privados, tokens ou credenciais.
// ============================================================================

export interface RpcMetric {
  actionType: string;
  latencyMs: number;
  success: boolean;
  idempotent: boolean;
  timestamp: number;
}

export interface TelemetrySummary {
  matchId: string;
  totalRequests: number;
  acceptedTicks: number;
  idempotentTicks: number;
  failedRequests: number;
  avgLatencyMs: number;
  maxLatencyMs: number;
  minLatencyMs: number;
  realtimeUpdatesCount: number;
  reconnectionsCount: number;
  activeDriverRole: 'primary' | 'fallback' | 'idle';
}

class MultiplayerTelemetryService {
  private rpcMetrics: RpcMetric[] = [];
  private realtimeUpdateCount = 0;
  private reconnectionCount = 0;
  private currentMatchId: string | null = null;
  private driverRole: 'primary' | 'fallback' | 'idle' = 'idle';

  public reset(matchId: string) {
    this.currentMatchId = matchId;
    this.rpcMetrics = [];
    this.realtimeUpdateCount = 0;
    this.reconnectionCount = 0;
    this.driverRole = 'idle';
  }

  public setDriverRole(role: 'primary' | 'fallback' | 'idle') {
    this.driverRole = role;
  }

  public recordRpc(actionType: string, latencyMs: number, success: boolean, idempotent = false) {
    this.rpcMetrics.push({
      actionType,
      latencyMs: Math.max(0, Math.round(latencyMs)),
      success,
      idempotent,
      timestamp: Date.now(),
    });

    // Manter buffer circular de até 500 registros para evitar consumo de memória
    if (this.rpcMetrics.length > 500) {
      this.rpcMetrics.shift();
    }
  }

  public recordRealtimeUpdate() {
    this.realtimeUpdateCount++;
  }

  public recordReconnection() {
    this.reconnectionCount++;
  }

  public getSummary(): TelemetrySummary {
    const ticks = this.rpcMetrics.filter((m) => m.actionType === 'snake_tick');
    const totalRequests = this.rpcMetrics.length;
    const acceptedTicks = ticks.filter((m) => m.success && !m.idempotent).length;
    const idempotentTicks = ticks.filter((m) => m.success && m.idempotent).length;
    const failedRequests = this.rpcMetrics.filter((m) => !m.success).length;

    let totalLatency = 0;
    let minLatency = Infinity;
    let maxLatency = 0;

    for (const m of this.rpcMetrics) {
      totalLatency += m.latencyMs;
      if (m.latencyMs < minLatency) minLatency = m.latencyMs;
      if (m.latencyMs > maxLatency) maxLatency = m.latencyMs;
    }

    const avgLatencyMs = totalRequests > 0 ? Math.round(totalLatency / totalRequests) : 0;

    return {
      matchId: this.currentMatchId || 'none',
      totalRequests,
      acceptedTicks,
      idempotentTicks,
      failedRequests,
      avgLatencyMs,
      maxLatencyMs: maxLatency === 0 && totalRequests === 0 ? 0 : maxLatency,
      minLatencyMs: minLatency === Infinity ? 0 : minLatency,
      realtimeUpdatesCount: this.realtimeUpdateCount,
      reconnectionsCount: this.reconnectionCount,
      activeDriverRole: this.driverRole,
    };
  }
}

export const telemetry = new MultiplayerTelemetryService();
