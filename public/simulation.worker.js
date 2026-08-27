/* FireOps training engine.
 * Rothermel (1972) surface-fire spread terms, with Scott & Burgan-style fuel inputs.
 * The browser worker keeps scenario computation local and off the UI thread.
 */

const FUELS = {
  TU5: { load: 0.071, depth: 0.6, savr: 1800, moistureExtinction: 0.25 },
  TL3: { load: 0.034, depth: 0.3, savr: 1600, moistureExtinction: 0.20 },
  SH7: { load: 0.092, depth: 1.2, savr: 1700, moistureExtinction: 0.30 },
};

const clamp = (value, minimum, maximum) => Math.max(minimum, Math.min(maximum, value));

function rothermelRateOfSpread(input) {
  const fuel = FUELS[input.fuelModel] || FUELS.TU5;
  const sigma = fuel.savr;
  const beta = clamp(fuel.load / (fuel.depth * 32), 0.001, 0.12);
  const betaOpt = 3.348 * Math.pow(sigma, -0.8189);
  const ratio = beta / betaOpt;
  const exponentA = 133 * Math.pow(sigma, -0.7913);
  const gammaMax = Math.pow(sigma, 1.5) / (495 + 0.0594 * Math.pow(sigma, 1.5));
  const gamma = gammaMax * Math.pow(ratio, exponentA) * Math.exp(exponentA * (1 - ratio));
  const moistureRatio = clamp(input.moisture / fuel.moistureExtinction, 0, 1.5);
  const moistureDamping = clamp(1 - 2.59 * moistureRatio + 5.11 * moistureRatio ** 2 - 3.52 * moistureRatio ** 3, 0, 1);
  const mineralDamping = 0.174 * Math.pow(0.01, -0.19);
  const reactionIntensity = gamma * fuel.load * 8000 * moistureDamping * mineralDamping;
  const windMph = input.windKph * 0.621371;
  const windFpm = windMph * 88;
  const windC = 7.47 * Math.exp(-0.133 * Math.pow(sigma, 0.55));
  const windB = 0.02526 * Math.pow(sigma, 0.54);
  const windE = 0.715 * Math.exp(-3.59e-4 * sigma);
  const windFactor = windC * Math.pow(Math.max(0, windFpm), windB) * Math.pow(ratio, -windE);
  const slopeFactor = 5.275 * Math.pow(beta, -0.3) * Math.tan((input.slopeDegrees * Math.PI) / 180) ** 2;
  const propagatingFlux = Math.exp((0.792 + 0.681 * Math.sqrt(sigma)) * (beta + 0.1)) / (192 + 0.2595 * sigma);
  const effectiveHeating = Math.exp(-138 / sigma);
  const heatOfPreignition = 250 + 1116 * input.moisture;
  const bulkDensity = fuel.load / fuel.depth;
  const feetPerMinute = (reactionIntensity * propagatingFlux * (1 + windFactor + slopeFactor))
    / Math.max(0.001, bulkDensity * effectiveHeating * heatOfPreignition);
  return clamp(feetPerMinute * 0.3048, 0.05, 95);
}

function simulate(input) {
  const rosMetersPerMinute = rothermelRateOfSpread(input);
  const duration = clamp(input.minutes || 60, 5, 360);
  const suppression = clamp(input.suppression || 0, 0, 0.82);
  const effectiveRos = rosMetersPerMinute * (1 - suppression);
  const lengthToBreadth = clamp(1 + 0.25 * input.windKph * 0.621371, 1, 8);
  const headDistance = effectiveRos * duration;
  const breadth = headDistance / lengthToBreadth;
  const ellipseAreaHa = Math.PI * (headDistance / 2) * (breadth / 2) / 10000;
  return {
    model: 'Rothermel 1972',
    shape: 'wind-oriented ellipse',
    fuelModel: input.fuelModel || 'TU5',
    gridMeters: input.gridMeters || 90,
    rateOfSpreadMetersPerMinute: Number(effectiveRos.toFixed(2)),
    lengthToBreadth: Number(lengthToBreadth.toFixed(2)),
    totalBurnedHa: Math.round(ellipseAreaHa),
  };
}

self.onmessage = (event) => {
  const message = event.data || {};
  try {
    self.postMessage({ id: message.id, ok: true, result: simulate(message) });
  } catch (error) {
    self.postMessage({ id: message.id, ok: false, error: error instanceof Error ? error.message : 'Simulation worker error' });
  }
};
