// ============================================================================
// Unit Tests: Room Orchestration & Code Validation — DuoPlay-Online
// Phase: Fase 7.0.1 — Correção da Geração do Código da Sala
// ============================================================================

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { translateRoomError, joinRoomByCode } from '@/services/rooms';

describe('Fase 7.0.1: Tradução e Mapeamento de Erros de Sala', () => {
  it('1. Deve mapear P0001 para mensagem e código UNAUTHORIZED', () => {
    const res = translateRoomError({ message: 'UNAUTHORIZED: Usuário não autenticado.', code: 'P0001' });
    assert.equal(res.code, 'UNAUTHORIZED');
    assert.match(res.message, /Você precisa estar logado/);
  });

  it('2. Deve mapear P0005 para mensagem e código ROOM_NOT_FOUND', () => {
    const res = translateRoomError({ message: 'ROOM_NOT_FOUND: Sala não encontrada.', code: 'P0005' });
    assert.equal(res.code, 'ROOM_NOT_FOUND');
    assert.match(res.message, /Sala não encontrada/);
  });

  it('3. Deve mapear P0007 para ROOM_FULL', () => {
    const res = translateRoomError({ message: 'ROOM_FULL: Limite máximo atingido.', code: 'P0007' });
    assert.equal(res.code, 'ROOM_FULL');
    assert.match(res.message, /limite máximo/);
  });

  it('4. Deve tratar erros desconhecidos e objetos nulos com segurança', () => {
    const resNull = translateRoomError(null);
    assert.equal(resNull.code, 'UNKNOWN_ERROR');

    const resGeneric = translateRoomError({ message: 'Erro aleatório de rede' });
    assert.equal(resGeneric.code, 'UNKNOWN_ERROR');
    assert.equal(resGeneric.message, 'Erro aleatório de rede');
  });
});

describe('Fase 7.0.1: Validação de Formato e Código de Sala', () => {
  const roomCodeRegex = /^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{6}$/;

  it('5. Validador do formato Base32 rejeita códigos inválidos (tamanho ou caracteres ambíguos)', () => {
    // Códigos válidos
    assert.ok(roomCodeRegex.test('ABC234'));
    assert.ok(roomCodeRegex.test('89KLMN'));
    assert.ok(roomCodeRegex.test('XYZ789'));

    // Códigos inválidos: caracteres ambíguos (0, 1, I, O)
    assert.equal(roomCodeRegex.test('ABC012'), false, 'Não deve aceitar 0 ou 1');
    assert.equal(roomCodeRegex.test('ABCIO2'), false, 'Não deve aceitar I ou O');

    // Códigos com tamanho incorreto
    assert.equal(roomCodeRegex.test('ABC'), false, 'Menor que 6');
    assert.equal(roomCodeRegex.test('ABCDEFG'), false, 'Maior que 6');
  });

  it('6. joinRoomByCode rejeita códigos vazios ou com tamanho inadequado no cliente', async () => {
    const resShort = await joinRoomByCode('AB');
    assert.equal(resShort.success, false);
    assert.equal(resShort.code, 'INVALID_CODE');

    const resLong = await joinRoomByCode('TOOLONGCODE99');
    assert.equal(resLong.success, false);
    assert.equal(resLong.code, 'INVALID_CODE');
  });
});
