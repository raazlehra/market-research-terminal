/**
 * Black-Scholes Greeks Calculator
 * Calculates Delta, Gamma, Theta, Vega, and Rho for options
 */

const SQRT_2_PI = Math.sqrt(2 * Math.PI);

function normalPDF(x: number): number {
  return Math.exp(-0.5 * x * x) / SQRT_2_PI;
}

function normalCDF(x: number): number {
  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const p = 0.3275911;

  const sign = x < 0 ? -1 : 1;
  x = Math.abs(x) / Math.sqrt(2);

  const t = 1.0 / (1.0 + p * x);
  const y =
    1.0 -
    ((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t * Math.exp(-x * x);

  return 0.5 * (1.0 + sign * y);
}

export interface GreeksResult {
  delta: number;
  gamma: number;
  theta: number;
  vega: number;
  rho: number;
  price: number;
}

/**
 * Calculate Greeks for an option using Black-Scholes model
 * @param S Spot price
 * @param K Strike price
 * @param T Time to expiration (in years)
 * @param r Risk-free rate (annual)
 * @param sigma Volatility (annual, as decimal: 0.25 = 25%)
 * @param optionType "call" or "put"
 */
export function calculateGreeks(
  S: number,
  K: number,
  T: number,
  r: number,
  sigma: number,
  optionType: "call" | "put"
): GreeksResult {
  if (T <= 0) T = 0.001; // Avoid division by zero
  if (sigma <= 0) sigma = 0.001;

  const sqrtT = Math.sqrt(T);
  const d1 = (Math.log(S / K) + (r + (sigma * sigma) / 2) * T) / (sigma * sqrtT);
  const d2 = d1 - sigma * sqrtT;

  const Nd1 = normalCDF(d1);
  const Nd2 = normalCDF(d2);
  const nd1 = normalPDF(d1);
  const nd1_sqrt = nd1 / sqrtT;

  let delta: number;
  let price: number;

  if (optionType === "call") {
    delta = Nd1;
    price = S * Nd1 - K * Math.exp(-r * T) * Nd2;
  } else {
    delta = Nd1 - 1;
    price = K * Math.exp(-r * T) * normalCDF(-d2) - S * normalCDF(-d1);
  }

  const gamma = nd1_sqrt / S;
  const vega = S * nd1 * sqrtT / 100; // Per 1% change in volatility
  const theta = optionType === "call"
    ? (-S * nd1 * sigma / (2 * sqrtT) - r * K * Math.exp(-r * T) * Nd2) / 365
    : (-S * nd1 * sigma / (2 * sqrtT) + r * K * Math.exp(-r * T) * normalCDF(-d2)) / 365;
  
  const rho = optionType === "call"
    ? K * T * Math.exp(-r * T) * Nd2 / 100
    : -K * T * Math.exp(-r * T) * normalCDF(-d2) / 100;

  return {
    delta: Number(delta.toFixed(4)),
    gamma: Number(gamma.toFixed(6)),
    theta: Number(theta.toFixed(4)),
    vega: Number(vega.toFixed(4)),
    rho: Number(rho.toFixed(4)),
    price: Number(price.toFixed(2)),
  };
}

/**
 * Calculate implied volatility using Newton-Raphson method
 */
export function estimateIV(
  marketPrice: number,
  S: number,
  K: number,
  T: number,
  r: number,
  optionType: "call" | "put"
): number {
  let sigma = 0.3; // Starting guess
  let iterations = 0;
  const maxIterations = 100;
  const tolerance = 0.0001;

  while (iterations < maxIterations) {
    const greeks = calculateGreeks(S, K, T, r, sigma, optionType);
    const diff = greeks.price - marketPrice;

    if (Math.abs(diff) < tolerance) {
      return Number((sigma * 100).toFixed(2));
    }

    const vega = greeks.vega;
    if (Math.abs(vega) < 1e-7) break;

    sigma = sigma - diff / (vega * 100);
    sigma = Math.max(0.001, Math.min(sigma, 2)); // Bounds

    iterations++;
  }

  return Number((sigma * 100).toFixed(2));
}
