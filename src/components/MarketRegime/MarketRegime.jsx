import React from 'react';
import './MarketRegime.css';

export default function MarketRegime({ analysis }) {
  if (!analysis) return null;

  const weeklyBias = analysis.aiModules?.weeklyBias?.bias;
  const confluenceChecks = analysis.confluenceScore?.checks || [];
  
  // Logic:
  // If weeklyBias === 'long' AND 1H trend up -> BULL
  // If weeklyBias === 'short' AND 1H trend down -> BEAR
  // Otherwise -> SIDEWAYS
  const is1HUp = analysis.direction === 'LONG';
  const is1HDown = analysis.direction === 'SHORT';
  
  let regime = 'SIDEWAYS';
  if (weeklyBias === 'long' && is1HUp) regime = 'BULL MARKET';
  if (weeklyBias === 'short' && is1HDown) regime = 'BEAR MARKET';

  const getArrow = (bias, isUp, isDown) => {
    if (bias === 'long' || isUp) return '↑';
    if (bias === 'short' || isDown) return '↓';
    return '—';
  };
  
  const htfArrow = getArrow(weeklyBias);
  const m1HArrow = getArrow(null, is1HUp, is1HDown);
  const m4HArrow = htfArrow === m1HArrow ? htfArrow : '—';

  // Determine if above EMA200
  // Fallback to true if missing, or we can check exact price if available.
  const currentPrice = analysis.currentPrice || 0;
  const ema200 = analysis.indicators?.ema200 || 0;
  const aboveEma = currentPrice >= ema200;

  const rec = regime === 'BULL MARKET' ? 'PREFER LONGS' : regime === 'BEAR MARKET' ? 'PREFER SHORTS' : 'RANGE TRADE';
  const regimeClass = regime.split(' ')[0].toLowerCase();

  return (
    <div className={`market-regime glass-card animate-fade-in-up ${regimeClass}`}>
      <div className="regime-status">
        <h2 className={`regime-title glow-text-${regimeClass}`}>{regime}</h2>
        <span className="regime-rec">{rec}</span>
      </div>
      <div className="regime-details">
        <div className="tf-pills">
          <span className="tf-pill">HTF: {htfArrow}</span>
          <span className="tf-pill">4H: {m4HArrow}</span>
          <span className="tf-pill">1H: {m1HArrow}</span>
        </div>
        <div className={`ema-status ${aboveEma ? 'above' : 'below'}`}>
          <span className="ema-dot"></span>
          {aboveEma ? 'Above EMA200' : 'Below EMA200'}
        </div>
      </div>
    </div>
  );
}
