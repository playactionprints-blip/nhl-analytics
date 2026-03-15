import { mockBacktestGames, mockGameContext, mockMarketInputs } from "../data/mockData";
import { predictGame } from "../models/predictGame";
import { historicalBacktest } from "../utils/evaluation";

export async function runExamplePrediction() {
  const prediction = predictGame(mockGameContext, mockMarketInputs);

  const backtest = await historicalBacktest(mockBacktestGames, (game) =>
    predictGame(game.context, game.marketInputs)
  );

  return {
    prediction,
    backtest,
  };
}

runExamplePrediction()
  .then((output) => {
    console.log("Single-game prediction:");
    console.log(JSON.stringify(output.prediction, null, 2));
    console.log("\nBacktest summary:");
    console.log(JSON.stringify(output.backtest, null, 2));
  })
  .catch((error) => {
    console.error("Example prediction failed:", error);
    process.exitCode = 1;
  });
