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
    version: '0.14.7',
    date: '2026-08-12',
    items: [
      {
        kind: 'improved',
        text: 'Se a sessão for encerrada inesperadamente, agora aparece um aviso explicando o motivo antes de voltar para a tela de login.',
      },
      {
        kind: 'fixed',
        text: 'Corrigido: abrir o aplicativo duas vezes ao mesmo tempo podia travar a segunda janela em vez de simplesmente trazer a primeira para frente.',
      },
    ],
  },
  {
    version: '0.14.6',
    date: '2026-08-12',
    items: [
      {
        kind: 'fixed',
        text: 'Corrigido: em alguns casos, a sessão podia cair logo depois de entrar, mesmo com login e senha certos, obrigando a entrar de novo.',
      },
    ],
  },
  {
    version: '0.14.5',
    date: '2026-08-12',
    items: [
      {
        kind: 'improved',
        text: 'Melhoria interna: mais um passo no diagnóstico enviado ao suporte, continuando a investigação de um problema de sessão relatado nesta semana.',
      },
    ],
  },
  {
    version: '0.14.4',
    date: '2026-08-12',
    items: [
      {
        kind: 'improved',
        text: 'Melhoria interna: mais detalhes no diagnóstico enviado ao suporte, para continuar investigando um problema de sessão relatado nesta semana.',
      },
    ],
  },
  {
    version: '0.14.3',
    date: '2026-08-12',
    items: [
      {
        kind: 'improved',
        text: 'Melhoria interna: o diagnóstico enviado ao suporte agora registra mais detalhes sobre falhas de login e de recuperação de senha, para agilizar o atendimento em caso de problema.',
      },
    ],
  },
  {
    version: '0.14.2',
    date: '2026-08-12',
    items: [
      { kind: 'improved', text: 'Reforços de segurança na recuperação de senha e no envio de diagnóstico ao suporte, sem mudanças na forma de uso.' },
      { kind: 'improved', text: 'O envio de diagnóstico agora filtra automaticamente CPF, telefone e e-mail do trecho enviado, como proteção extra.' },
    ],
  },
  {
    version: '0.14.1',
    date: '2026-08-11',
    items: [
      { kind: 'fixed', text: 'Corrigido: o botão de diagnóstico ficava sobreposto ao rodapé do menu lateral (nome do usuário e sair).' },
      { kind: 'fixed', text: 'Corrigido: algumas instalações mais antigas podiam ser bloqueadas por engano ao verificar a chave do produto.' },
    ],
  },
  {
    version: '0.14.0',
    date: '2026-08-11',
    headline: 'Recuperação de senha e diagnóstico com um clique.',
    items: [
      { kind: 'new', text: 'Esqueceu a senha? Agora dá para recuperar o acesso com um código gerado no cadastro, sem perder nenhum dado.' },
      { kind: 'new', text: 'Se o código também se perder, o suporte pode liberar um novo acesso remotamente.' },
      { kind: 'new', text: 'Botão de diagnóstico: envia o log do aplicativo para o suporte com um clique, direto da tela de login ou das Configurações.' },
      { kind: 'fixed', text: 'Corrigido: uma falha ao entrar podia deixar a tela travada sem nenhuma mensagem de erro.' },
    ],
  },
  {
    version: '0.13.0',
    date: '2026-08-06',
    items: [
      { kind: 'new', text: '"Assinar remotamente" virou um botão principal do contrato, em vez de ficar escondido no menu "•••".' },
      { kind: 'new', text: 'Pagamentos: em vez de definir parcelas fixas por data, agora é só registrar o que a cliente pagou e quando — e editar ou apagar depois, sem restrição de data.' },
      { kind: 'new', text: 'Peças disponíveis agora avisam quando já têm uma reserva futura, com data, cliente e contrato.' },
      { kind: 'improved', text: 'O "a receber" do painel deixou de ter janela de datas: mostra tudo que ainda falta, com link direto para os contratos.' },
    ],
  },
  {
    version: '0.12.2',
    date: '2026-08-05',
    items: [
      { kind: 'fixed', text: 'Corrigido: o seletor de fotos ainda não abria no Linux, mesmo depois da correção da versão anterior.' },
    ],
  },
  {
    version: '0.12.1',
    date: '2026-08-05',
    items: [
      { kind: 'fixed', text: 'Corrigido: o aplicativo de computador não abria corretamente em algumas instalações, e o seletor de fotos não respondia ao clique.' },
    ],
  },
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
