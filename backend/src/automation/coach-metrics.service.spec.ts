import { ChurnRiskLevel } from '@prisma/client';
import { CoachMetricsService } from './coach-metrics.service';

describe('CoachMetricsService', () => {
  const service = new CoachMetricsService();
  const at = new Date('2026-06-13T18:00:00.000Z');

  it('tracks meal frequency, active days and consecutive days', () => {
    const habit = service.calculateHabits({
      at,
      mealDates: [
        new Date('2026-06-11T12:00:00.000Z'),
        new Date('2026-06-12T12:00:00.000Z'),
        new Date('2026-06-13T12:00:00.000Z'),
      ],
      messageDates: [
        new Date('2026-06-12T18:00:00.000Z'),
        new Date('2026-06-13T18:00:00.000Z'),
      ],
    });

    expect(habit.mealsRegistered).toBe(3);
    expect(habit.activeDays).toBe(3);
    expect(habit.consecutiveDays).toBe(3);
    expect(habit.daysSinceInteraction).toBe(0);
    expect(habit.regularityScore).toBeGreaterThan(0);
  });

  it('calculates consistency and engagement in the 0-100 range', () => {
    const habit = service.calculateHabits({
      at,
      mealDates: [new Date('2026-06-13T12:00:00.000Z')],
      messageDates: [new Date('2026-06-13T18:00:00.000Z')],
    });
    const consistency = service.calculateConsistency({
      habit,
      adherenceScore: 75,
    });
    const engagement = service.calculateEngagement({
      messagesLast7Days: 5,
      messagesLast30Days: 14,
      analysesLast7Days: 4,
      analysesLast30Days: 12,
      activeDaysLast7: 5,
      activeDaysLast30: 12,
    });

    expect(consistency.score).toBeGreaterThanOrEqual(0);
    expect(consistency.score).toBeLessThanOrEqual(100);
    expect(engagement.score).toBeGreaterThan(70);
    expect(engagement.monthlyUsageScore).toBe(80);
  });

  it('classifies progressive abandonment as high churn risk', () => {
    const churn = service.calculateChurn({
      daysInactive: 15,
      engagementScore: 22,
      consistencyScore: 28,
      interactionsLast7Days: 1,
      interactionsPrevious7Days: 8,
    });

    expect(churn.level).toBe(ChurnRiskLevel.HIGH);
    expect(churn.activityDrop).toBeGreaterThan(80);
    expect(churn.reasons).toContain('ABANDONO_PROGRESSIVO');
  });
});
