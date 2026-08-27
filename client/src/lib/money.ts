/**
 * Money comparisons, done in whole centavos.
 *
 * Every monetary column in this app is a `Float`, and centavo amounts have no
 * finite binary expansion: R$ 679,90 + R$ 1.249,90 is 1929.8000000000001819,
 * while typing "1929,80" into CurrencyInput produces 1929.7999999999999545.
 * They differ by 2.27e-13. `formatCurrency` prints both as "R$ 1.929,80", so
 * the drift is invisible — right up to the moment something BRANCHES on it.
 *
 * That is what went wrong: a contract paid to the centavo compared as
 * `outstanding > 0`, so the panel showed Total R$ 1.929,80, Pago R$ 1.929,80,
 * and an urgent "Em aberto R$ 0,00" beside a badge saying the same, while the
 * server kept it in the receivables worklist and the Painel counted it. A
 * worklist of clients who owe nothing and that can never be worked off.
 *
 * So: round to integer centavos FIRST, then add and compare. Never compare
 * two reais floats, and never sum them before rounding — `sumCentavos` rounds
 * each amount before adding precisely so the sum is exact rather than
 * accumulating each item's representation error.
 *
 * The server keeps its own copy of these three functions (server/src/lib/
 * money.ts) because the two workspaces share no package. They must stay
 * identical: the client's panel and the server's worklist decide the same
 * question about the same contract, and disagreeing is the bug.
 */

export function toCentavos(amount: number): number {
  return Math.round(amount * 100)
}

export function fromCentavos(centavos: number): number {
  return centavos / 100
}

export function sumCentavos(amounts: number[]): number {
  return amounts.reduce((sum, amount) => sum + toCentavos(amount), 0)
}
