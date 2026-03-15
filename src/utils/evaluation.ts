import type {
  BacktestSummary,
  CalibrationBucket,
  HistoricalGameRecord,
  HistoricalPredictionRecord,
} from "../types/types";
import { clampProbability } from "./odds";

export function logLoss(predictedHomeWinProbability: number, actualHomeWin: boolean): number {
  const p = clampProbability(predictedHomeWinProbability);
  return actualHomeWin ? -Math.log(p) : -Math.log(1 - p);
}

export function brierScore(predictedHomeWinProbability: number, actualHomeWin: boolean): number {
  const actual = actualHomeWin ? 1 : 0;
  return (predictedHomeWinProbability - actual) ** 2;
}

export function buildCalibrationBuckets(
  records: HistoricalPredictionRecord[],
  bucketCount = 10
): CalibrationBucket[] {
  const buckets = Array.from({ length: bucketCount }, (_, index) => {
    const bucketStart = index / bucketCount;
    const bucketEnd = (index + 1) / bucketCount;
    const inBucket = records.filter((record) => {
      if (index === bucketCount - 1) {
        return record.predictedHomeWinProbability >= bucketStart && record.predictedHomeWinProbability <= bucketEnd;
      }
      return record.predictedHomeWinProbability >= bucketStart && record.predictedHomeWinProbability < bucketEnd;
    });

    const sampleCount = inBucket.length;
    const averagePredicted =
      sampleCount === 0
        ? 0
        : inBucket.reduce((sum, record) => sum + record.predictedHomeWinProbability, 0) / sampleCount;
    const actualWinRate =
      sampleCount === 0
        ? 0
        : inBucket.reduce((sum, record) => sum + (record.actualHomeWin ? 1 : 0), 0) / sampleCount;

    return {
      bucketStart,
      bucketEnd,
      sampleCount,
      averagePredicted,
      actualWinRate,
    };
  });

  return buckets;
}

export async function historicalBacktest(
  games: HistoricalGameRecord[],
  predictor: (game: HistoricalGameRecord) => Promise<{ homeWinPct: number }> | { homeWinPct: number }
): Promise<BacktestSummary> {
  const predictionRecords: HistoricalPredictionRecord[] = [];

  for (const game of games) {
    const prediction = await predictor(game);
    predictionRecords.push({
      id: game.id,
      predictedHomeWinProbability: prediction.homeWinPct,
      actualHomeWin: game.actualHomeWin,
    });
  }

  const averageLogLoss =
    predictionRecords.reduce((sum, record) => sum + logLoss(record.predictedHomeWinProbability, record.actualHomeWin), 0) /
    Math.max(1, predictionRecords.length);

  const averageBrierScore =
    predictionRecords.reduce((sum, record) => sum + brierScore(record.predictedHomeWinProbability, record.actualHomeWin), 0) /
    Math.max(1, predictionRecords.length);

  return {
    sampleCount: predictionRecords.length,
    averageLogLoss,
    averageBrierScore,
    calibration: buildCalibrationBuckets(predictionRecords),
  };
}
