export type ChangeKind = 'new' | 'improved' | 'fixed'

export interface ChangelogItem {
  kind: ChangeKind
  text: string
}

export interface ChangelogRelease {
  version: string
  /** ISO date (YYYY-MM-DD), formatted through the app's own locale utilities. */
  date: string
  headline?: string
  items: ChangelogItem[]
}

/**
 * Hand-maintained, one entry per release — add the new entry (newest first)
 * in the same commit that bumps the version in package.json, per
 * docs/release-checklist.md. The first entry is always treated as the
 * currently-installed version (see CURRENT_VERSION below): there is no
 * runtime version lookup, so keeping this file and the version bump in step
 * is what makes that true.
 */
export const RELEASES: ChangelogRelease[] = [
  {
    version: '0.12.0',
    date: '2026-08-05',
    headline: 'O aplicativo inteiro foi redesenhado: telas mais claras, fotos em todo lugar, e alguns cálculos que agora fazem sozinhos o que a loja já fazia na mão.',
    items: [
      { kind: 'new', text: 'Clientes e Contratos agora mostram lista e detalhe lado a lado, sem precisar abrir uma janela para ler o cadastro.' },
      { kind: 'new', text: 'Clique em qualquer foto de peça (em Contratos, Clientes ou Produtos) para ampliar e ver tamanho, cor, categoria e situação.' },
      { kind: 'new', text: 'O campo "Fotos" do produto virou um seletor de arquivo de verdade, no lugar do campo de link.' },
      { kind: 'new', text: 'Produtos ganhou um código sequencial por peça, que a loja pode falar em voz alta e buscar direto no contrato.' },
      { kind: 'improved', text: 'Ao adicionar parcelas num contrato novo, o valor de cada uma é sugerido automaticamente dividindo o total — e continua editável a qualquer momento.' },
      { kind: 'improved', text: 'A janela de novo contrato passou a acompanhar o tamanho da tela, em vez de manter sempre o mesmo tamanho fixo.' },
      { kind: 'improved', text: 'A tela de Clientes ficou mais rápida: o total de contratos e o último aluguel de cada cliente agora vêm prontos, sem esperar carregar todos os contratos da loja.' },
      { kind: 'fixed', text: 'O calendário deixou de marcar como atrasada uma peça cuja devolução ainda não chegou.' },
      { kind: 'fixed', text: 'O total do contrato e o resumo de pagamentos deixaram de mostrar valores diferentes um do outro.' },
      { kind: 'fixed', text: 'Contratos cancelados deixaram de contar como dinheiro a receber ou como pendência de assinatura.' },
    ],
  },
]

/** The most recent entry is always "what this build is" — see the file header. */
export const CURRENT_VERSION = RELEASES[0]?.version ?? null
