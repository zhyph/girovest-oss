import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import fs from 'fs'
import os from 'os'

/**
 * Impressao digital da maquina, usada para amarrar a ativacao a um computador.
 *
 * O valor bruto NUNCA sai daqui: o que trafega e o sha256 dele. O servidor nao
 * precisa saber qual e a maquina, so precisa reconhecer que e a mesma de antes,
 * e um hash resolve isso sem transportar identificador de hardware.
 *
 * FALHA PARA O LADO SEGURO. Se nenhuma fonte responder, `resolveMachineHash`
 * devolve null e o chamador deixa o app abrir. Bloquear por falha de leitura
 * transformaria uma peculiaridade de sistema operacional (SELinux, container,
 * imagem clonada sem machine-id) em loja parada num sabado. O risco aceito e
 * que alguem apague o identificador de proposito para escapar da trava; contra
 * esse alguem a trava nunca ia funcionar mesmo, porque a verificacao roda no
 * cliente.
 */

/** Fontes em ordem de preferencia: estaveis primeiro, derivadas depois. */
function readLinuxMachineId(): string | null {
  for (const file of ['/etc/machine-id', '/var/lib/dbus/machine-id']) {
    try {
      const value = fs.readFileSync(file, 'utf-8').trim()
      if (value !== '') return value
    } catch {
      // Arquivo ausente e normal em varias distribuicoes; tenta a proxima.
    }
  }
  return null
}

function readWindowsMachineGuid(): string | null {
  try {
    // Nao existe API de registro no Node; `reg query` e a forma sem dependencia
    // nativa. execFileSync (nao exec) para nao passar por shell.
    const out = execFileSync(
      'reg',
      ['query', 'HKLM\\SOFTWARE\\Microsoft\\Cryptography', '/v', 'MachineGuid'],
      { encoding: 'utf-8', windowsHide: true, timeout: 5_000 },
    )
    const match = /MachineGuid\s+REG_SZ\s+(\S+)/i.exec(out)
    return match ? (match[1] as string) : null
  } catch {
    return null
  }
}

/**
 * Ultimo recurso: MAC da primeira interface fisica.
 *
 * Menos estavel que o machine-id (troca de placa de rede muda), mas melhor que
 * desistir: sem ele, apagar /etc/machine-id bastaria para escapar da trava.
 * Interfaces virtuais ficam de fora porque docker0/veth mudam a cada reboot e
 * existem identicas em maquinas diferentes.
 */
function readPrimaryMac(): string | null {
  const virtuais = /^(docker|veth|br-|virbr|vmnet|vboxnet|tun|tap|wg|tailscale|zt|lo)/i
  const candidatos: string[] = []
  for (const [name, infos] of Object.entries(os.networkInterfaces())) {
    if (virtuais.test(name)) continue
    for (const info of infos ?? []) {
      if (info.internal) continue
      if (info.mac && info.mac !== '00:00:00:00:00:00') candidatos.push(info.mac)
    }
  }
  // Ordena para nao depender da ordem de enumeracao do sistema, que varia entre
  // boots quando ha mais de uma interface.
  candidatos.sort()
  return candidatos[0] ?? null
}

export interface MachineSource {
  readonly source: 'machine-id' | 'machine-guid' | 'mac'
  readonly raw: string
}

/** Primeira fonte disponivel, ja identificada (util para log e suporte). */
export function detectMachineSource(platform: NodeJS.Platform = process.platform): MachineSource | null {
  if (platform === 'win32') {
    const guid = readWindowsMachineGuid()
    if (guid !== null) return { source: 'machine-guid', raw: guid }
  } else {
    const id = readLinuxMachineId()
    if (id !== null) return { source: 'machine-id', raw: id }
  }
  const mac = readPrimaryMac()
  return mac === null ? null : { source: 'mac', raw: mac }
}

/** sha256 hex do identificador bruto, ou null quando nenhuma fonte respondeu. */
export function resolveMachineHash(source: MachineSource | null = detectMachineSource()): string | null {
  if (source === null) return null
  return hashMachineValue(source.source, source.raw)
}

/**
 * O prefixo com a fonte entra no hash de proposito: se a mesma maquina passar a
 * responder por outra fonte (machine-id apagado, caindo para MAC), o hash muda e
 * a ativacao e refeita. O contrario -- colidir os dois -- esconderia a troca.
 */
export function hashMachineValue(source: MachineSource['source'], raw: string): string {
  return createHash('sha256').update(`${source}:${raw.trim().toLowerCase()}`).digest('hex')
}
