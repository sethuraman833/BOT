import { GoogleGenerativeAI } from "@google/generative-ai";

const MODELS = ["gemini-2.5-flash", "gemini-2.0-flash", "gemini-2.5-flash-lite", "gemini-1.5-flash"];

export async function getFrontendAiOpinion(analysis) {
  const apiKey = import.meta.env.VITE_GEMINI_API_KEY;
  if (!apiKey) {
    return null; // Skip if no key provided in frontend
  }

  const genAI = new GoogleGenerativeAI(apiKey);

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
    - Stop Loss: $${analysis.stopLoss ? analysis.stopLoss.value : 'N/A'}
    - Take Profit 1: $${analysis.tp1}
    - RRR (TP1): ${analysis.rrr ? analysis.rrr.tp1 : 'N/A'}
    - Session: ${analysis.session ? analysis.session.name : 'N/A'}
    - Key Risk: ${analysis.keyRisk}
    - Invalidation: ${analysis.invalidationLevel}

    STEPS TAKEN:
    ${analysis.analysisSteps ? analysis.analysisSteps.join('\n') : ''}

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
        return JSON.parse(jsonMatch[0]);
      }
    } catch (error) {
      console.warn(`[FRONTEND AI] ${modelName} failed:`, error.message);
    }
  }

  return { decision: 'ERROR', reasoning: "AI analysis failed after trying multiple models. Spikes in demand are usually temporary." };
}
