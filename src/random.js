import { createHmac } from "node:crypto";
// Versioned, platform-independent deterministic stream keyed by the private seed.
export function randomSource(seed) {
  let counter = 0;
  const bytes = () =>
    createHmac("sha256", seed).update(`am-i-nerfed/v1/${counter++}`).digest();
  const integer = (n) => {
    if (!Number.isSafeInteger(n) || n < 1) throw Error("Invalid random bound");
    const limit = 0x100000000 - (0x100000000 % n);
    let x;
    do {
      x = bytes().readUInt32BE(0);
    } while (x >= limit);
    return x % n;
  };
  return {
    integer,
    hex: () => bytes().toString("hex"),
    choose: (values) => values[integer(values.length)],
    shuffle: (values) => {
      const out = [...values];
      for (let i = out.length - 1; i > 0; i--) {
        const j = integer(i + 1);
        [out[i], out[j]] = [out[j], out[i]];
      }
      return out;
    },
  };
}
