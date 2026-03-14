import { getChartData } from './storage.js';
import { config } from './config.js';

const QUICKCHART_URL = 'https://quickchart.io/chart';

/**
 * Генерирует PNG-диаграмму расходов семьи по дням
 * Столбцы — фактические расходы по каждому члену семьи
 * Пунктирная линия — запланированный дневной расход
 */
export async function generateChartImage(month = null, year = null) {
  const { labels, userExpenses, trackingDays, monthName } = getChartData(month, year, config.trackingStartDay);

  if (labels.length === 0) {
    return null;
  }

  const plannedDaily = Math.round(config.plannedMonthly / trackingDays);

  const datasets = [];
  const colors = ['#4e79a7', '#f28e2b', '#76b7b2', '#e15759'];
  let i = 0;

  for (const [user, amounts] of Object.entries(userExpenses)) {
    datasets.push({
      label: user,
      data: amounts,
      backgroundColor: colors[i % colors.length],
    });
    i++;
  }

  // Линия планового расхода
  datasets.push({
    label: `План (${plannedDaily.toLocaleString('ru-RU')} ₽/день)`,
    data: labels.map(() => plannedDaily),
    type: 'line',
    borderColor: '#e15759',
    borderWidth: 2,
    borderDash: [6, 4],
    fill: false,
    pointRadius: 0,
  });

  const chartConfig = {
    type: 'bar',
    data: { labels, datasets },
    options: {
      title: {
        display: true,
        text: `Расходы семьи по дням — ${monthName}`,
        fontSize: 16,
      },
      scales: {
        yAxes: [{
          ticks: { beginAtZero: true },
          scaleLabel: { display: true, labelString: 'Сумма (₽)' },
        }],
        xAxes: [{
          scaleLabel: { display: true, labelString: 'Число месяца' },
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
