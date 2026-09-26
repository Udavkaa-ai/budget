// Иконки нижней панели — свои, в стиле Финика (1:1 с вебом: public/index.html).
// viewBox 0 0 32 32. Цвета — токены var(--ti-*), подставляются по состоянию:
// активная вкладка — фирменная палитра, неактивная — приглушённый силуэт, где
// светлые детали становятся цветом фона панели (аккуратные «вырезы»).
export type TabIconName = "budget" | "month" | "chart" | "settings" | "goals";

export const TAB_ICONS: Record<TabIconName, string> = {
  budget: "<path d=\"M7.6 13.8 Q16 9.4 24.4 13.8 C28.6 17.2 29 25 25.4 28 C22.2 30.4 9.8 30.4 6.6 28 C3 25 3.4 17.2 7.6 13.8 Z\" fill=\"var(--ti-p)\"/><path d=\"M8.6 18 C7.2 20.2 7.3 23.6 8.6 25.2 C9.4 26 10.6 25.4 10.4 24 C10.1 22.2 10.4 20.4 11.2 19 C11.7 17.8 9.6 16.8 8.6 18 Z\" fill=\"var(--ti-w)\" opacity=\"0.4\"/><path d=\"M14.6 11.6 L17.6 7.9 M17.4 11.6 L14.4 7.9\" stroke=\"var(--ti-gd)\" stroke-width=\"1.7\" stroke-linecap=\"round\"/><circle cx=\"13.9\" cy=\"6.9\" r=\"2.4\" fill=\"var(--ti-g)\"/><circle cx=\"18.1\" cy=\"6.9\" r=\"2.4\" fill=\"var(--ti-g)\"/><path d=\"M6.9 13.9 Q16 9.3 25.1 13.9\" stroke=\"var(--ti-g)\" stroke-width=\"3.3\" stroke-linecap=\"round\" fill=\"none\"/><circle cx=\"12.6\" cy=\"20.2\" r=\"2.7\" fill=\"var(--ti-w)\"/><circle cx=\"19.4\" cy=\"20.2\" r=\"2.7\" fill=\"var(--ti-w)\"/><circle cx=\"13\" cy=\"20.6\" r=\"1.35\" fill=\"var(--ti-i)\"/><circle cx=\"19.8\" cy=\"20.6\" r=\"1.35\" fill=\"var(--ti-i)\"/>",
  month: "<rect x=\"4.6\" y=\"7.4\" width=\"22.8\" height=\"20.6\" rx=\"5.2\" fill=\"var(--ti-l)\" stroke=\"var(--ti-p)\" stroke-width=\"2\"/><path d=\"M4.6 12.6 A5.2 5.2 0 0 1 9.8 7.4 H22.2 A5.2 5.2 0 0 1 27.4 12.6 V14 H4.6 Z\" fill=\"var(--ti-p)\"/><rect x=\"9.7\" y=\"4\" width=\"2.8\" height=\"6.4\" rx=\"1.4\" fill=\"var(--ti-g)\"/><rect x=\"19.5\" y=\"4\" width=\"2.8\" height=\"6.4\" rx=\"1.4\" fill=\"var(--ti-g)\"/><rect x=\"8.6\" y=\"17\" width=\"3.6\" height=\"3.4\" rx=\"1.1\" fill=\"var(--ti-d)\"/><rect x=\"14.2\" y=\"17\" width=\"3.6\" height=\"3.4\" rx=\"1.1\" fill=\"var(--ti-d)\"/><rect x=\"19.8\" y=\"17\" width=\"3.6\" height=\"3.4\" rx=\"1.1\" fill=\"var(--ti-d)\"/><rect x=\"8.6\" y=\"22\" width=\"3.6\" height=\"3.4\" rx=\"1.1\" fill=\"var(--ti-d)\"/><rect x=\"14.2\" y=\"22\" width=\"3.6\" height=\"3.4\" rx=\"1.1\" fill=\"var(--ti-d)\"/><rect x=\"19.4\" y=\"21.6\" width=\"4.4\" height=\"4.2\" rx=\"1.4\" fill=\"var(--ti-g)\"/>",
  chart: "<rect x=\"4.6\" y=\"5.4\" width=\"22.8\" height=\"22.6\" rx=\"6\" fill=\"var(--ti-l)\" stroke=\"var(--ti-p)\" stroke-width=\"2\"/><rect x=\"9\" y=\"18.6\" width=\"3.6\" height=\"6\" rx=\"1.3\" fill=\"var(--ti-p)\"/><rect x=\"14.2\" y=\"15\" width=\"3.6\" height=\"9.6\" rx=\"1.3\" fill=\"var(--ti-p)\"/><rect x=\"19.4\" y=\"12\" width=\"3.6\" height=\"12.6\" rx=\"1.3\" fill=\"var(--ti-p)\"/><path d=\"M8.2 16.6 L13 12.6 L16.6 14.6 L23.2 8.6\" stroke=\"var(--ti-g)\" stroke-width=\"2.6\" stroke-linecap=\"round\" stroke-linejoin=\"round\" fill=\"none\"/><path d=\"M19.8 8.4 L23.6 8.2 L23.4 12\" stroke=\"var(--ti-g)\" stroke-width=\"2.6\" stroke-linecap=\"round\" stroke-linejoin=\"round\" fill=\"none\"/>",
  settings: "<path d=\"M17.24 3.96 L19.66 4.44 L20.53 8.03 L22.09 9.08 L25.74 8.51 L27.11 10.56 L25.19 13.71 L25.55 15.56 L28.54 17.74 L28.06 20.16 L24.47 21.03 L23.42 22.59 L23.99 26.24 L21.94 27.61 L18.79 25.69 L16.94 26.05 L14.76 29.04 L12.34 28.56 L11.47 24.97 L9.91 23.92 L6.26 24.49 L4.89 22.44 L6.81 19.29 L6.45 17.44 L3.46 15.26 L3.94 12.84 L7.53 11.97 L8.58 10.41 L8.01 6.76 L10.06 5.39 L13.21 7.31 L15.06 6.95 Z\" fill=\"var(--ti-p)\" stroke=\"var(--ti-p)\" stroke-width=\"1.6\" stroke-linejoin=\"round\"/><circle cx=\"16\" cy=\"16.5\" r=\"5.3\" fill=\"var(--ti-l)\"/><circle cx=\"16\" cy=\"16.5\" r=\"2.4\" fill=\"var(--ti-g)\"/>",
  goals: "<circle cx=\"14.6\" cy=\"17.6\" r=\"11.4\" fill=\"var(--ti-p)\"/><circle cx=\"14.6\" cy=\"17.6\" r=\"8\" fill=\"var(--ti-l)\"/><circle cx=\"14.6\" cy=\"17.6\" r=\"4.9\" fill=\"var(--ti-p)\"/><circle cx=\"14.6\" cy=\"17.6\" r=\"2.1\" fill=\"var(--ti-g)\"/><path d=\"M15.2 17 L26.2 6\" stroke=\"var(--ti-i)\" stroke-width=\"2.2\" stroke-linecap=\"round\"/><path d=\"M24.4 3.6 L25.6 7.8 L29.8 8.8 L26.6 11 L22.4 9.8 L21.4 5.6 Z\" fill=\"var(--ti-g)\"/>",
};

const ACTIVE: Record<string, string> = {
  p: "#7A5CF0", d: "#5947E0", g: "#FFC24B", gd: "#E8A21F", l: "#EDE8FF", w: "#FFFFFF", i: "#2B2160",
};

export function tabIconXml(name: TabIconName, focused: boolean, muted: string, bg: string): string {
  const pal: Record<string, string> = focused
    ? ACTIVE
    : { p: muted, d: muted, g: muted, gd: muted, i: muted, l: bg, w: bg };
  const body = TAB_ICONS[name].replace(/var\(--ti-([a-z]+)\)/g, (_, k: string) => pal[k] ?? muted);
  return `<svg viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg">${body}</svg>`;
}
