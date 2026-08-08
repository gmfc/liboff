/**
 * EAN-13 encoder, used by the browser tests to synthesise the exact barcode
 * that is printed on the back of a book so the scanner can be tested for real
 * rather than mocked.
 *
 * An EAN-13 symbol is 95 modules: a 101 guard, six left digits, a 01010 centre
 * guard, six right digits, and a closing 101 guard. The first digit is not
 * drawn at all — it is encoded in which parity table each of the six left
 * digits uses.
 */

const L = ['0001101', '0011001', '0010011', '0111101', '0100011', '0110001', '0101111', '0111011', '0110111', '0001011'];
const G = ['0100111', '0110011', '0011011', '0100001', '0011101', '0111001', '0000101', '0010001', '0001001', '0010111'];
const R = ['1110010', '1100110', '1101100', '1000010', '1011100', '1001110', '1010000', '1000100', '1001000', '1110100'];

/** Which parity table each of the six left digits uses, per leading digit. */
const PARITY = [
  'LLLLLL', 'LLGLGG', 'LLGGLG', 'LLGGGL', 'LGLLGG',
  'LGGLLG', 'LGGGLL', 'LGLGLG', 'LGLGGL', 'LGGLGL',
];

export function ean13CheckDigit(twelveDigits) {
  let sum = 0;
  for (let i = 0; i < 12; i += 1) sum += Number(twelveDigits[i]) * (i % 2 === 0 ? 1 : 3);
  return String((10 - (sum % 10)) % 10);
}

/**
 * @param {string} code 12 or 13 digits; a 12-digit code gets its check digit.
 * @returns {{code: string, modules: number[]}} 95 modules, 1 = bar, 0 = space.
 */
export function encodeEan13(code) {
  const digits = String(code).replace(/\D/g, '');
  const full = digits.length === 12 ? digits + ean13CheckDigit(digits) : digits;
  if (full.length !== 13) throw new Error(`EAN-13 needs 12 or 13 digits, got ${digits.length}`);
  if (ean13CheckDigit(full) !== full[12]) throw new Error(`bad check digit in ${full}`);

  const parity = PARITY[Number(full[0])];
  let bits = '101';
  for (let i = 0; i < 6; i += 1) {
    const digit = Number(full[i + 1]);
    bits += parity[i] === 'L' ? L[digit] : G[digit];
  }
  bits += '01010';
  for (let i = 7; i < 13; i += 1) bits += R[Number(full[i])];
  bits += '101';

  return { code: full, modules: [...bits].map(Number) };
}
