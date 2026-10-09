// Разбор банковских сообщений (СМС, пуши, «Поделиться») прямо на телефоне.
// Текст сообщения никуда не отправляется: наружу уходят только сумма, место
// и время — как будто расход внесли вручную.
//
// Форматы сняты с реальных сообщений:
//   Сбер (900): «Счёт карты MIR-0717 13:12 Покупка 50р CAPUCHINOFF Баланс: 212 851.2р»
//   ВТБ:        «Списание 10р Счет*0745 Алексей К. Баланс 198731.78р 14:29»
//   ВТБ (3-DS): «Для оплаты в METRO 3460.00 RUB Карта *8539 введите код: 9523» — НЕ покупка

export type BankKind = 'purchase' | 'transfer' | 'income' | 'ignore' | 'unknown';

export interface ParsedBank {
  kind: BankKind;
  bank: string;          // 'Сбер' | 'ВТБ' | 'Яндекс' | ...
  amount?: number;
  merchant?: string;
  card?: string;         // последние 4 цифры
  time?: string;         // HH:MM, если есть в тексте
  reason?: string;       // почему пропущено / не распознано
  balance?: number;      // «Баланс 127075.94р» — для поиска списаний без уведомления
}

// Всё, что похоже на код подтверждения, отбрасываем целиком — даже если там
// есть сумма и магазин (3-DS «Для оплаты … введите код» — это не покупка).
const SENSITIVE = /(никому\s+не\s+сообщайте|не\s+сообщайте|введите\s+код|код\s+(подтверждения|для|:)|\bкод\b\s*[:\-]?\s*\d{3,}|парол|password|\bcode\b|\bOTP\b)/i;
export function isSensitive(text: string): boolean {
  return SENSITIVE.test(text);
}

// «212 851.2р», «3460.00 RUB», «1 250,50 ₽» → число
export function parseAmount(raw: string): number | undefined {
  const s = raw.replace(/[\s  ]/g, '').replace(',', '.');
  const n = parseFloat(s);
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : undefined;
}

// \b в JS не понимает кириллицу, поэтому границу «р» задаём явно
const AMT = '(\\d[\\d\\s\\u00a0\\u202f]*(?:[.,]\\d{1,2})?)\\s*(?:руб\\.?|р\\.?(?![а-яёa-z])|RUB|₽)';
const TIME = '(\\d{1,2}:\\d{2})';

function bankOf(sender: string, text: string): string {
  const s = `${sender} ${text}`.toLowerCase();
  if (/^900$|sber|сбер|ru\.sberbank/.test(sender.toLowerCase()) || /сбер/.test(s)) return 'Сбер';
  if (/vtb|втб/.test(s)) return 'ВТБ';
  if (/yandex|яндекс/.test(s)) return 'Яндекс';
  if (/tinkoff|тинькофф|т-банк|tbank/.test(s)) return 'Т-Банк';
  if (/alfa|альфа/.test(s)) return 'Альфа';
  return 'Банк';
}

// Похоже на человека («Алексей К.», «BELKANOV A.») — значит, перевод, а не магазин
function looksLikePerson(name: string): boolean {
  return /^[А-ЯЁA-Z][а-яёa-z]+\s+[А-ЯЁA-Z]\.?$/.test(name.trim())
    || /^[A-ZА-ЯЁ]{3,}\s+[A-ZА-ЯЁ]\.?$/.test(name.trim());
}

const clean = (m: string) => m
  .replace(/^(?:Баланс|Доступно|Остаток)(?![а-яё]).*$/i, '')
  .replace(/[,;]?\s*(?:карта|карты|сч[её]т)\s*\*?\d{4}.*$/i, '')   // хвост «, карта *8539»
  .replace(/\s*\d{2}\.\d{2}\.\d{4}.*$/, '')                          // хвост «09.10.2026 07:22. Доступно …»
  .replace(/\s+/g, ' ').replace(/[.,;:\s·•]+$/, '').trim();

export function parseBankMessage(text: string, sender = ''): ParsedBank {
  const p = parseCore(text, sender);
  if (p.amount && p.balance == null) {
    const t = (text || '').replace(/\s+/g, ' ');
    const b = t.match(new RegExp(`(?:Баланс|Доступно|Остаток)(?![а-яё])[:\\s]*${AMT}`, 'i'));
    if (b) p.balance = parseAmount(b[1]);
  }
  return p;
}

function parseCore(text: string, sender: string): ParsedBank {
  const t = (text || '').replace(/\s+/g, ' ').trim();
  const bank = bankOf(sender, t);
  if (!t) return { kind: 'ignore', bank, reason: 'пусто' };
  if (isSensitive(t)) return { kind: 'ignore', bank, reason: 'код подтверждения' };

  // ── Сбер: «Счёт карты MIR-0717 13:12 Покупка 50р CAPUCHINOFF Баланс: …»
  let m = t.match(new RegExp(`(?:карты|счёт|счет)\\s+[A-ZА-Я]*-?(\\d{4})\\s+${TIME}\\s+(Покупка|Оплата|Списание|Перевод|Зачисление|Поступление|Отмена покупки|Возврат)\\s+${AMT}\\s*(.*?)(?:\\s+Баланс|$)`, 'i'));
  if (m) {
    const [, card, time, op, amt, rest] = m;
    const amount = parseAmount(amt);
    const merchant = clean(rest || '');
    const o = op.toLowerCase();
    if (/зачисл|поступ|возврат|отмена/.test(o)) return { kind: 'income', bank, amount, merchant, card, time, reason: op };
    if (/перевод/.test(o) || (/списание/.test(o) && looksLikePerson(merchant))) return { kind: 'transfer', bank, amount, merchant, card, time };
    return { kind: 'purchase', bank, amount, merchant, card, time };
  }

  // ── ВТБ: «Списание 10р Счет*0745 Алексей К. Баланс 198731.78р 14:29»
  //         «Оплата 450р Карта*8539 PYATEROCHKA Баланс …»
  m = t.match(new RegExp(`(Списание|Оплата|Покупка|Перевод|Поступление|Зачисление)\\s+${AMT}\\s+(?:Сч[её]т|Карта)\\s*\\*?(\\d{4})\\s+(.*?)(?:\\s+Баланс|$)`, 'i'));
  if (m) {
    const [, op, amt, card, rest] = m;
    const amount = parseAmount(amt);
    const merchant = clean(rest || '');
    const time = t.match(new RegExp(`${TIME}\\s*$`))?.[1];
    const o = op.toLowerCase();
    if (/поступ|зачисл/.test(o)) return { kind: 'income', bank, amount, merchant, card, time, reason: op };
    // «Списание» человеку («Алексей К.») — перевод; «Покупка/Оплата» у ИП с именем — покупка
    if (/перевод/.test(o) || (/списание/.test(o) && looksLikePerson(merchant))) return { kind: 'transfer', bank, amount, merchant, card, time };
    return { kind: 'purchase', bank, amount, merchant, card, time };
  }

  // ── Сбер, пуш без слов: «➖ 362 ₽ Rostic's  📉 382 101,25 ₽ •• 0717»
  //    ➖ — списание, ➕ — зачисление, 📉/📈 — остаток на карте
  m = t.match(new RegExp(`^([➖➕−+\\-])\\s*${AMT}\\s*(.*?)\\s*(?:📉|📈)\\s*${AMT}\\s*(?:[•·*]+\\s*(\\d{4}))?`));
  if (m) {
    const [, sign, amt, rest, bal, card] = m;
    const amount = parseAmount(amt);
    const merchant = clean(rest || '');
    const balance = parseAmount(bal);
    const time = t.match(new RegExp(TIME))?.[1];
    if (sign === '➕' || sign === '+') return { kind: 'income', bank, amount, merchant, card, time, balance, reason: 'зачисление' };
    if (/перевод/i.test(merchant) || looksLikePerson(merchant)) return { kind: 'transfer', bank, amount, merchant: merchant.replace(/^перевод\s*/i, ''), card, time, balance };
    return { kind: 'purchase', bank, amount, merchant, card, time, balance };
  }

  // ── Общий случай (пуши банковских приложений): «Покупка 450 ₽ · Пятёрочка»,
  //    «Оплата в METRO 3 460 ₽», «−581 ₽ ВкусноИТочка»
  const amtM = t.match(new RegExp(`[−\\-]?\\s*${AMT}`, 'i'));
  if (amtM) {
    const amount = parseAmount(amtM[1]);
    // Признаки дохода проверяем первыми: у Яндекса заголовок «Входящий перевод»,
    // а суть — «Пополнение на 100 RUB»; слово «перевод» иначе делало его расходом
    const incomeOp = t.match(/(входящий\s+перевод|перевод\s+от|зачисление|поступление|пополнение|возврат|кешб[эе]к|cashback)/i)?.[1]?.toLowerCase();
    const op = incomeOp ? 'зачисление' : t.match(/(покупка|оплата|списание|перевод)/i)?.[1]?.toLowerCase() || '';
    // место: «в X», «X» после суммы или заголовок пуша (первая строка)
    let merchant = t.match(/(?:оплата|покупка)\s+(?:в|на)\s+(.+?)(?:\s+\d|\s+на сумму|[.,]|$)/i)?.[1]
      || t.slice((amtM.index ?? 0) + amtM[0].length).replace(/^[\s·•,.:\-—]+/, '').split(/\s+(?:Баланс|Доступно|Остаток)(?![а-яё])/i)[0]
      || '';
    merchant = clean(merchant).slice(0, 60);
    const card = t.match(/(?:\*|·|карт[аы]\s*)(\d{4})\b/i)?.[1];
    const time = t.match(new RegExp(TIME))?.[1];
    if (/зачисл|поступ|пополн|возврат|кешб|cashback/.test(op)) return { kind: 'income', bank, amount, merchant, card, time, reason: op };
    if (/перевод/.test(op) || (/списание/.test(op) && looksLikePerson(merchant))) return { kind: 'transfer', bank, amount, merchant, card, time };
    if (/покупка|оплата|списание/.test(op) || /^[−\-]/.test(amtM[0].trim())) return { kind: 'purchase', bank, amount, merchant, card, time };
    return { kind: 'unknown', bank, amount, merchant, card, time, reason: 'нет слова «покупка/оплата»' };
  }
  return { kind: 'unknown', bank, reason: 'не нашлась сумма' };
}
