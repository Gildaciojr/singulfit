import { chunkWorkoutWhatsApp } from './workout-whatsapp.chunker';
import { WorkoutPlanV2Formatter } from './workout-plan-v2.formatter';
import { commercialWorkoutPlan } from './workout-commercial-quality.fixtures';

const stripContinuation = (text: string) =>
  text.replace(
    /^➡️ \*Continuação do seu treino — mensagem \d+ de \d+\*\n\n/u,
    '',
  );
describe('Workout semantic WhatsApp chunks', () => {
  it('rejects an individually oversized prescription instead of orphaning its safety guidance', () => {
    const exercise = `*1. Agachamento*\n• Séries: 4\n\n💡 ${'Controle a execução. '.repeat(200)}\n\n⚠️ Interrompa se sentir dor.`;
    expect(() => chunkWorkoutWhatsApp(exercise)).toThrow(
      'limite de entrega segura',
    );
  });
  it('opens a five-day plan once and retains whole days with bounded numbered continuations', () => {
    const messages = new WorkoutPlanV2Formatter().format(
      commercialWorkoutPlan(),
      {
        preferredName: 'Ana',
        weekdays: ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY'],
      },
    );
    const original = messages.join('\n\n');
    const chunks = chunkWorkoutWhatsApp(original);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks[0]).toContain(messages[0]);
    expect(chunks[0]).toContain('📅 *Segunda');
    chunks
      .slice(1)
      .forEach((chunk, index) =>
        expect(chunk).toMatch(
          new RegExp(
            `^➡️ \\*Continuação do seu treino — mensagem ${index + 2} de ${chunks.length}\\*\\n\\n`,
            'u',
          ),
        ),
      );
    expect(chunks.every((chunk) => chunk.length <= 3400)).toBe(true);
    for (const day of messages.slice(1))
      expect(chunks.some((chunk) => chunk.includes(day))).toBe(true);
    expect(chunks.map(stripContinuation).join('\n\n')).toBe(original);
    expect(original.match(/━━━━━━━━━━━━━━/gu)).toHaveLength(4);
    for (const chunk of chunks) {
      const body = stripContinuation(chunk);
      expect(body.trim()).not.toBe('━━━━━━━━━━━━━━');
      expect(body.trim()).not.toMatch(/━━━━━━━━━━━━━━$/u);
      expect(body).not.toMatch(/━━━━━━━━━━━━━━\n\n(?!📅)/u);
    }
    expect(chunks.join('').match(/Ana, preparei/gu)).toHaveLength(1);
    expect(chunkWorkoutWhatsApp(original)).toEqual(chunks);
  });
  it('splits an oversized session between complete exercises and keeps their guidance and alerts', () => {
    const exercises = Array.from(
      { length: 20 },
      (_, index) =>
        `*${index + 1}. Exercício ${index + 1}*\n• 4 séries × 8–10 repetições\n\n💡 ${'Controle o movimento. '.repeat(10).trim()}\n\n⚠️ Alerta específico ${index + 1}.`,
    );
    const original = [
      'Preparei seu treino.',
      '🏋️ *Seu plano*',
      '📅 *Segunda — Força*\n⏱️ *Duração estimada:* ~60 min',
      '💪 *Força principal*',
      ...exercises,
    ].join('\n\n');
    const chunks = chunkWorkoutWhatsApp(original);
    expect(chunks[0]).toContain('Preparei seu treino.');
    expect(chunks[0]).toContain('📅 *Segunda');
    for (const exercise of exercises)
      expect(chunks.some((chunk) => chunk.includes(exercise))).toBe(true);
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(3400);
      expect(chunk.split('*').length % 2).toBe(1);
      expect(stripContinuation(chunk)).not.toMatch(/^(?:•|💡|⚠️)/u);
    }
    expect(chunks.map(stripContinuation).join('\n\n')).toBe(original);
  });
});
