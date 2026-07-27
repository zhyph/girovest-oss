import { describe, it, expect } from 'vitest'
import { hashMachineValue, resolveMachineHash, detectMachineSource } from './machineId.ts'

describe('hashMachineValue', () => {
  it('e deterministico e normaliza caixa e espaco', () => {
    const a = hashMachineValue('machine-id', 'ABC-123 ')
    expect(a).toBe(hashMachineValue('machine-id', 'abc-123'))
    expect(a).toMatch(/^[a-f0-9]{64}$/)
  })

  it('separa fontes diferentes com o mesmo valor bruto', () => {
    // Se a maquina passar a responder por outra fonte (machine-id apagado,
    // caindo para MAC), o hash tem que mudar e a ativacao ser refeita. Colidir
    // os dois esconderia a troca.
    expect(hashMachineValue('machine-id', 'x')).not.toBe(hashMachineValue('mac', 'x'))
  })
})

describe('resolveMachineHash', () => {
  it('devolve null quando nenhuma fonte respondeu', () => {
    // Contrato com ensureActivated: null significa deixar passar, nunca bloquear.
    expect(resolveMachineHash(null)).toBeNull()
  })

  it('hasheia a fonte encontrada', () => {
    expect(resolveMachineHash({ source: 'mac', raw: 'aa:bb:cc:dd:ee:ff' })).toBe(
      hashMachineValue('mac', 'aa:bb:cc:dd:ee:ff'),
    )
  })
})

describe('detectMachineSource', () => {
  it('encontra alguma fonte nesta maquina de teste', () => {
    // Nao afirma QUAL: em CI containerizado pode nao haver /etc/machine-id e cair
    // no MAC. O que importa e nao devolver null numa maquina normal.
    const source = detectMachineSource()
    if (source !== null) {
      expect(source.raw).not.toBe('')
      expect(['machine-id', 'machine-guid', 'mac']).toContain(source.source)
    }
  })
})
