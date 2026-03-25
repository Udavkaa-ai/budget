import { getChartData } from './storage.js';
import { config } from './config.js';

const QUICKCHART_URL = 'https://quickchart.io/chart';

/**
 * Превращает массив дневных значений в кумулятивный (нарастающий итог)
 */
function cumulative(arr) {
  const result = [];
  let sum = 0;
  for (const val of arr) {
    sum += val;
    result.push(sum);
  }
  return result;
}

/**
 * Генерирует PNG-диаграмму расходов семьи
 * Столбцы (stacked) — кумулятивные расходы по каждому члену семьи
 * Линия — кумулятивный план нарастающим итогом
 * @param {boolean} excludeFixed - исключить постоянные расходы
 */
export async function generateChartImage(month = null, year = null, excludeFixed = false) {
  const { labels, userExpenses, daysInMonth, monthName } = getChartData(month, year, config.trackingStartDay, excludeFixed);

  if (labels.length === 0) {
    return null;
  }

  // При исключении постоянных — план только по переменным расходам
  const variableMonthly = config.plannedMonthly - config.plannedFixed;
  const variableDaily = variableMonthly / daysInMonth;
  const fixedDay = config.fixedExpensesDay;

  const datasets = [];
  const colors = ['#4e79a7', '#f28e2b', '#76b7b2', '#59a14f'];
  let i = 0;

  for (const [user, amounts] of Object.entries(userExpenses)) {
    // Сумма за период для подписи в легенде
    const periodTotal = amounts.reduce((s, v) => s + v, 0);
    datasets.push({
      label: `${user}: ${periodTotal.toLocaleString('ru-RU')} ₽`,
      data: cumulative(amounts),
      backgroundColor: colors[i % colors.length],
    });
    i++;
  }

  // Кумулятивная линия плана
  const plannedCumulative = labels.map((dayLabel) => {
    const day = parseInt(dayLabel);
    let planned = Math.round(variableDaily * day);
    // Фиксированные расходы добавляем на линию плана только если не исключаем их
    if (!excludeFixed && day >= fixedDay) {
      planned += config.plannedFixed;
    }
    return planned;
  });
  const totalPlanned = plannedCumulative[plannedCumulative.length - 1];

  datasets.push({
    label: `План (${totalPlanned.toLocaleString('ru-RU')} ₽)`,
    data: plannedCumulative,
    type: 'line',
    borderColor: '#e15759',
    borderWidth: 2,
    borderDash: [6, 4],
    fill: false,
    pointRadius: 2,
    pointBackgroundColor: '#e15759',
  });

  const titleSuffix = excludeFixed ? ' (без постоянных)' : '';

  const chartConfig = {
    type: 'bar',
    data: { labels, datasets },
    options: {
      title: {
        display: true,
        text: `Расходы семьи — ${monthName}${titleSuffix} (нарастающий итог)`,
        fontSize: 16,
      },
      scales: {
        yAxes: [{
          ticks: { beginAtZero: true },
          scaleLabel: { display: true, labelString: 'Сумма (₽)' },
          stacked: true,
        }],
        xAxes: [{
          scaleLabel: { display: true, labelString: 'Число месяца' },
          stacked: true,
        }],
      },
      legend: { position: 'bottom' },
    },
  };

  const response = await fetch(QUICKCHART_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chart: chartConfig,
      width: 800,
      height: 450,
      backgroundColor: 'white',
      format: 'png',
    }),
  });

  if (!response.ok) {
    throw new Error(`QuickChart API error: ${response.status}`);
  }

  return Buffer.from(await response.arrayBuffer());
}
