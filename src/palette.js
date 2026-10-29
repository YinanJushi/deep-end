// Fixed 64-colour palette. Every output pixel is snapped to one of these in OKLab.
export const PALETTE = [
  // blue-blacks and greys
  '#07131d', '#0b0d17', '#151a2b', '#232a42', '#343c57', '#4d566f', '#6d758c', '#9399ab',
  '#bcc0cc', '#dfe1e8', '#fbf8ef',
  // warm concrete
  '#3b3733', '#5a544d', '#7c746a', '#a39a8b', '#c9bfac', '#e2d9c3',
  // water / tile blues
  '#0b2b52', '#0e4373', '#135f98', '#1a7dba', '#2a9bd1', '#4fb6e0', '#84d0ee', '#b6e6f5',
  // teal
  '#12303a', '#1d4f57', '#0f6a73', '#1b8f93', '#3fb5ae', '#7fd6c8',
  // greens
  '#0f2f1f', '#17492a', '#23652f', '#3a8a3a', '#62ad48', '#93cc5e', '#c4e48a',
  // earth
  '#2a1c16', '#432c20', '#5f3f2a', '#80573a', '#a07448', '#c19a64', '#dbbc88',
  // reds / oranges / yellows
  '#5b1a22', '#8e2a2d', '#c9403a', '#ee6b57', '#b4561c', '#e67e22', '#f6a63a', '#fbd15a', '#fff0a0', '#ffd98a',
  // pinks / purples / indigo
  '#f3a6a0', '#b9567a', '#6c3b73', '#3a2650', '#3b4fa6',
  // skin
  '#a86a4d', '#d39a76', '#efc19c', '#f8dcc0',
];

const lin = (c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));

export function linearToOklab(r, g, b) {
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

export function hexToRgb01(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255];
}

export function buildPaletteData() {
  const list = PALETTE.slice(0, 64);
  while (list.length < 64) list.push(list[list.length - 1]);
  const lab = [], rgb = [];
  for (const hex of list) {
    const [r, g, b] = hexToRgb01(hex);
    lab.push(linearToOklab(lin(r), lin(g), lin(b)));
    rgb.push([r, g, b]);
  }
  return { lab, rgb };
}
