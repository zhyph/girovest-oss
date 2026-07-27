import { useEffect, useState } from 'react'

/**
 * Identificador desta instalação, lido do processo main via ponte do preload.
 *
 * Existe só no app desktop: é o arquivo `userData/install-id` criado no
 * primeiro run. No build web hospedado não há `window.girovest`, e o hook
 * devolve null, que é a resposta certa lá (não existe "instalação" a
 * identificar).
 *
 * Serve para suporte: a lojista lê o código na tela de Configurações e passa
 * por telefone, e é por ele que se revoga a atualização de uma instalação
 * específica sem afetar as outras (docs/update-proxy-runbook.md, seção 3).
 */
type InstallBridge = { getInstallId?: () => Promise<string | null> }

export function useInstallId(): string | null {
  const [installId, setInstallId] = useState<string | null>(null)

  useEffect(() => {
    const bridge = (window as Window & { girovest?: InstallBridge }).girovest
    if (bridge?.getInstallId == null) return

    // Guarda de desmontagem: o invoke é assíncrono e a tela pode sair antes da
    // resposta chegar.
    let active = true
    bridge
      .getInstallId()
      .then((value) => {
        if (active) setInstallId(value)
      })
      // Falha aqui não é erro de usuário e não tem ação possível: a tela apenas
      // não mostra a seção, do mesmo jeito que no build web.
      .catch(() => undefined)
    return () => {
      active = false
    }
  }, [])

  return installId
}
