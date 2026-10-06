// ============================================================================
// Unit Tests: Room Orchestration & Code Validation — DuoPlay-Online
// Phase: Fase 7.0.2 — Correção do RLS e Carregamento do Lobby
// ============================================================================

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { translateRoomError, joinRoomByCode, getRoomDetails } from '@/services/rooms';

describe('Fase 7.0.2: Tradução e Mapeamento de Erros de Sala & RLS', () => {
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

  it('4. Deve mapear erro 42P17 (recursão de RLS) para RLS_RECURSION_ERROR com mensagem clara', () => {
    const res = translateRoomError({
      code: '42P17',
      message: 'infinite recursion detected in policy for relation "room_members"',
    });
    assert.equal(res.code, 'RLS_RECURSION_ERROR');
    assert.match(res.message, /recursão de RLS detectada/i);
  });

  it('5. Deve mapear erro 42501 (permission denied) para PERMISSION_DENIED', () => {
    const res = translateRoomError({
      code: '42501',
      message: 'permission denied for table rooms',
    });
    assert.equal(res.code, 'PERMISSION_DENIED');
    assert.match(res.message, /Permissão negada/i);
  });

  it('6. Deve tratar erros desconhecidos e objetos nulos com segurança', () => {
    const resNull = translateRoomError(null);
    assert.equal(resNull.code, 'UNKNOWN_ERROR');

    const resGeneric = translateRoomError({ message: 'Erro aleatório de rede' });
    assert.equal(resGeneric.code, 'UNKNOWN_ERROR');
    assert.equal(resGeneric.message, 'Erro aleatório de rede');
  });
});

describe('Fase 7.0.2: Validação de Formato e Código de Sala', () => {
  const roomCodeRegex = /^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{6}$/;

  it('7. Validador do formato Base32 rejeita códigos inválidos (tamanho ou caracteres ambíguos)', () => {
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

  it('8. joinRoomByCode rejeita códigos vazios ou com tamanho inadequado no cliente', async () => {
    const resShort = await joinRoomByCode('AB');
    assert.equal(resShort.success, false);
    assert.equal(resShort.code, 'INVALID_CODE');

    const resLong = await joinRoomByCode('TOOLONGCODE99');
    assert.equal(resLong.success, false);
    assert.equal(resLong.code, 'INVALID_CODE');
  });

  it('9. getRoomDetails rejeita identificador de sala nulo ou vazio sem consultar banco', async () => {
    const resEmpty = await getRoomDetails('');
    assert.equal(resEmpty.success, false);
    assert.equal(resEmpty.code, 'INVALID_ID');

    const resSpaces = await getRoomDetails('   ');
    assert.equal(resSpaces.success, false);
    assert.equal(resSpaces.code, 'INVALID_ID');
  });
});
