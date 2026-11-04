// 7x7 pixel glyphs for the landing timeline, in the logo's cell language. "S" is the one signal cell.
export const PIXELS = {
  passkey: [
    "0111000",
    "11S1100",
    "1000100",
    "1101100",
    "0111111",
    "0000101",
    "0000101",
  ],
  passport: [
    "1111111",
    "1000001",
    "1011101",
    "101S101",
    "1011101",
    "1000001",
    "1111111",
  ],
  email: [
    "1111111",
    "1100011",
    "1010101",
    "100S001",
    "1000001",
    "1000001",
    "1111111",
  ],
  login: [
    "0000000",
    "000000S",
    "0000011",
    "1000110",
    "1101100",
    "0111000",
    "0010000",
  ],
  recover: [
    "0011100",
    "0100010",
    "1000001",
    "100011S",
    "1000000",
    "0100010",
    "0011100",
  ],
} as const;

export type PixelName = keyof typeof PIXELS;
