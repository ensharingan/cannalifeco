/**
 * Linear regression over [x, y] points.
 * Returns { slope, intercept } where y = slope * x + intercept
 */
function linearRegression(points) {
  const n = points.length;
  if (n < 2) return { slope: 0, intercept: points[0]?.[1] ?? 0 };
  const sumX = points.reduce((s, [x]) => s + x, 0);
  const sumY = points.reduce((s, [, y]) => s + y, 0);
  const sumXY = points.reduce((s, [x, y]) => s + x * y, 0);
  const sumXX = points.reduce((s, [x]) => s + x * x, 0);
  const denom = n * sumXX - sumX * sumX;
  if (denom === 0) return { slope: 0, intercept: sumY / n };
  const slope = (n * sumXY - sumX * sumY) / denom;
  const intercept = (sumY - slope * sumX) / n;
  return { slope, intercept };
}

/**
 * Given a salesByDay map { "YYYY-MM-DD": qty } for one product,
 * build a 60-day daily history, apply linear regression,
 * and project the next 30 days.
 *
 * Returns:
 *  - dailyRate:      recent average (last 30 days)
 *  - growthRate:     daily slope as a fraction of avg (e.g. 0.02 = 2%/day growth)
 *  - projectedTotal: sum of predicted units over next 30 days (growth-adjusted)
 *  - suggestedReorder: ceil(projectedTotal) + safety buffer
 *  - forecastPoints: array of { date, predicted } for next 30 days
 *  - historyPoints:  array of { date, actual } for last 60 days (for chart)
 */
export function forecastProduct(salesByDayForProduct = {}) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // Build 60-day history array as [dayIndex, qty]
  const historyDays = 60;
  const historyPoints = [];
  const regressionPoints = [];

  for (let i = historyDays - 1; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    const key = d.toISOString().slice(0, 10);
    const qty = salesByDayForProduct[key] || 0;
    const x = historyDays - 1 - i; // 0 = oldest, 59 = yesterday
    historyPoints.push({ date: key, actual: qty });
    regressionPoints.push([x, qty]);
  }

  const { slope, intercept } = linearRegression(regressionPoints);

  // Daily rate: average of last 30 days
  const last30 = historyPoints.slice(-30);
  const last30Total = last30.reduce((s, p) => s + p.actual, 0);
  const dailyRate = last30Total / 30;

  // Growth rate as fraction of daily rate
  const growthRate = dailyRate > 0 ? slope / dailyRate : 0;

  // Project next 30 days
  const forecastPoints = [];
  let projectedTotal = 0;
  for (let i = 1; i <= 30; i++) {
    const d = new Date(today);
    d.setDate(d.getDate() + i);
    const x = historyDays - 1 + i; // continue regression index
    const raw = intercept + slope * x;
    const predicted = Math.max(0, Math.round(raw * 10) / 10);
    projectedTotal += predicted;
    forecastPoints.push({ date: d.toISOString().slice(0, 10), predicted });
  }

  // Suggested reorder = projected demand + 20% safety buffer
  const suggestedReorder = Math.ceil(projectedTotal * 1.2);

  return { dailyRate, growthRate, projectedTotal, suggestedReorder, forecastPoints, historyPoints };
}

/**
 * Build a combined 30-day demand forecast chart for top N products.
 * Returns array of { date, [productName]: predictedQty, ... } for recharts.
 */
export function buildForecastChart(enrichedProducts, topN = 5) {
  const top = enrichedProducts
    .filter(p => p.forecastPoints?.length > 0 && p.projectedTotal > 0)
    .sort((a, b) => b.projectedTotal - a.projectedTotal)
    .slice(0, topN);

  if (!top.length) return [];

  // All forecast dates (30 days)
  const dates = top[0].forecastPoints.map(f => f.date);

  return dates.map((date, i) => {
    const point = { date: date.slice(5) }; // MM-DD
    top.forEach(p => {
      point[p.name?.slice(0, 16)] = p.forecastPoints[i]?.predicted ?? 0;
    });
    return point;
  });
}