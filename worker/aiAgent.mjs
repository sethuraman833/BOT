// ─────────────────────────────────────────────────────────
//  AI Agent — Gemini "Second Opinion" Integration
// ─────────────────────────────────────────────────────────

import { GoogleGenerativeAI } from "@google/generative-ai";

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

const MODELS = ["gemini-2.5-flash", "gemini-2.0-flash", "gemini-2.5-flash-lite"];

/**
 * Sends analysis results to Gemini for a "thinking" second opinion.
 */
export async function getAiSecondOpinion(analysis) {
  if (!process.env.GEMINI_API_KEY) {
    return { decision: 'SKIP', reasoning: "Gemini API Key missing" };
  }

  const prompt = `
    You are an Institutional SMC (Smart Money Concepts) Trading Expert.
    I will provide you with a technical analysis report from my algorithmic engine.
    Your job is to provide a "Second Opinion" on whether this trade should be executed.

    ANALYSIS REPORT:
    - Symbol: ${analysis.symbol}
    - Direction: ${analysis.direction}
    - Confluence Score: ${analysis.confluenceScore.total}/${analysis.confluenceScore.max}
    - Decision: ${analysis.decision}
    - Entry: $${analysis.entry}
    - Stop Loss: $${analysis.stopLoss.value}
    - Take Profit 1: $${analysis.tp1}
    - RRR (TP1): ${analysis.rrr.tp1}
    - Session: ${analysis.session.name}
    - Key Risk: ${analysis.keyRisk}
    - Invalidation: ${analysis.invalidationLevel}

    STEPS TAKEN:
    ${analysis.analysisSteps.join('\n')}

    INSTRUCTIONS:
    1. Evaluate the SMC logic (Order Blocks, FVG, Liquidity, OTE).
    2. Consider the session timing and RRR.
    3. Look for any subtle red flags the algorithm might have missed.
    4. Return your response in JSON format:
       {
         "decision": "AGREE" | "DISAGREE" | "CAUTION",
         "reasoning": "A concise 2-sentence explanation of your thinking."
       }
  `;

  for (const modelName of MODELS) {
    try {
      const model = genAI.getGenerativeModel({ model: modelName });
      const result = await model.generateContent(prompt);
      const response = await result.response;
      const text = response.text();
      
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        console.log(`[AI AGENT] Successfully used ${modelName}`);
        return parsed;
      }
    } catch (error) {
      console.warn(`[AI AGENT] ${modelName} failed:`, error.message);
      // Continue to next model
    }
  }

  return { decision: 'ERROR', reasoning: "AI analysis failed after trying multiple models. Spikes in demand are usually temporary." };
}

