import { Injectable } from '@nestjs/common';
import { RecommendationConfidenceInput } from './interfaces/recommendation.interface';

@Injectable()
export class RecommendationScoringService {
  calculate(input: RecommendationConfidenceInput): number {
    const contextScore = Math.min(100, input.contextSources * 20);
    const historyScore = Math.min(100, input.historyDepth * 8);
    const recurrenceScore = Math.min(100, input.recurrence * 20);
    const signalScore = this.clamp(input.signalStrength);

    return this.clamp(
      Math.round(
        contextScore * 0.25 +
          historyScore * 0.25 +
          recurrenceScore * 0.2 +
          signalScore * 0.3,
      ),
    );
  }

  private clamp(value: number): number {
    return Math.max(0, Math.min(100, value));
  }
}
