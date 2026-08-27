export const DEFAULT_CONTRACT_CLAUSES: string[] = [
  'O material ora locado descrito na especificação das peças será entregue ao cliente, lavado e passado, um dia antes do evento a partir das 16:30 horas.',
  'Fica estabelecido que o locatário(a) deverá entregar todo o material até o 2º dia após o evento, pois caso ocorra atraso na devolução, será cobrada multa de 10% ao dia do valor do contrato, calculado a partir da data do contrato, mais 01 (um) valor do aluguel pago.',
  'Caso ocorram danos em quaisquer peças ora locadas, deverão ser ressarcidos pelo locatário em seu valor integral.',
  // Referred to "a última parcela" of a fixed installment schedule that this
  // product no longer has — it was replaced by the free-form Payment ledger,
  // so the client signed a commitment to something the contract never states.
  // The obligation is unchanged (settle by pickup day); it now names the
  // figure the sheet actually prints.
  //
  // This is the DEFAULT, so it applies to shops set up from here on. A shop
  // already running keeps the clause stored against its own location and can
  // edit it in Configurações — changing that text is the shop's decision, not
  // a migration's.
  'O saldo a pagar deverá ser quitado no máximo até o dia da retirada dos materiais locados.',
  'Após a assinatura do contrato não haverá em hipótese alguma a devolução ou parte do valor do aluguel.',
  'Roupa com excesso de sujeira será cobrada uma taxa de lavanderia.',
]
