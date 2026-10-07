import type {
  EnduranceActivity,
  MobilityActivity,
  StrengthActivity,
  TimedActivity,
  WorkoutActivityV2,
  WorkoutActivityBase,
  WorkoutPlanV2,
  WorkoutSessionV2,
  WorkoutPublicExerciseIdentity,
} from './workout-plan-v2.contract';
import type { WorkoutEquipment } from './workout-planning-context.contract';
import { qualityPlan, strength } from './workout-quality.fixtures';

// Authored provider fixture semantics; production never derives identity from a name.
const liftIdentities: Readonly<Record<string, WorkoutPublicExerciseIdentity>> =
  {
    'Supino reto com barra': {
      plane: 'HORIZONTAL',
      targetRegion: 'CHEST',
      bodyPosition: 'LYING',
      jointAction: null,
    },
    'Remada baixa na polia': {
      plane: 'HORIZONTAL',
      targetRegion: 'BACK',
      bodyPosition: 'SEATED',
      jointAction: null,
    },
    'Desenvolvimento sentado com halteres': {
      plane: 'VERTICAL',
      targetRegion: 'SHOULDERS',
      bodyPosition: 'SEATED',
      jointAction: null,
    },
    'Puxada frontal na polia': {
      plane: 'VERTICAL',
      targetRegion: 'BACK',
      bodyPosition: 'SEATED',
      jointAction: null,
    },
    'Rosca alternada com halteres': {
      plane: 'SAGITTAL',
      targetRegion: 'ELBOWS',
      bodyPosition: 'STANDING',
      jointAction: 'FLEXION',
    },
    'Agachamento com barra': {
      plane: 'SAGITTAL',
      targetRegion: 'HIPS',
      bodyPosition: 'STANDING',
      jointAction: null,
    },
    'Levantamento romeno com halteres': {
      plane: 'SAGITTAL',
      targetRegion: 'HIPS',
      bodyPosition: 'STANDING',
      jointAction: null,
    },
    'Leg press': {
      plane: 'SAGITTAL',
      targetRegion: 'KNEES',
      bodyPosition: 'SEATED',
      jointAction: null,
    },
    'Flexão de joelhos na máquina': {
      plane: 'SAGITTAL',
      targetRegion: 'KNEES',
      bodyPosition: 'PRONE',
      jointAction: 'FLEXION',
    },
    'Elevação de panturrilhas em pé': {
      plane: 'SAGITTAL',
      targetRegion: 'ANKLES',
      bodyPosition: 'STANDING',
      jointAction: 'EXTENSION',
    },
    'Agachamento ao banco sem carga': {
      plane: 'SAGITTAL',
      targetRegion: 'HIPS',
      bodyPosition: 'STANDING',
      jointAction: null,
    },
    'Remada leve com elástico': {
      plane: 'HORIZONTAL',
      targetRegion: 'BACK',
      bodyPosition: 'STANDING',
      jointAction: null,
    },
    'Flexão de braços na parede': {
      plane: 'HORIZONTAL',
      targetRegion: 'CHEST',
      bodyPosition: 'STANDING',
      jointAction: null,
    },
    'Supino inclinado com halteres': {
      plane: 'HORIZONTAL',
      targetRegion: 'CHEST',
      bodyPosition: 'INCLINED',
      jointAction: null,
    },
    'Remada apoiada no banco': {
      plane: 'HORIZONTAL',
      targetRegion: 'BACK',
      bodyPosition: 'PRONE',
      jointAction: null,
    },
    'Elevação lateral com halteres': {
      plane: 'FRONTAL',
      targetRegion: 'SHOULDERS',
      bodyPosition: 'STANDING',
      jointAction: 'ABDUCTION',
    },
    'Puxada neutra na polia': {
      plane: 'VERTICAL',
      targetRegion: 'BACK',
      bodyPosition: 'SEATED',
      jointAction: null,
    },
    'Extensão de tríceps na polia': {
      plane: 'SAGITTAL',
      targetRegion: 'ELBOWS',
      bodyPosition: 'STANDING',
      jointAction: 'EXTENSION',
    },
    'Agachamento com halter ao banco': {
      plane: 'SAGITTAL',
      targetRegion: 'HIPS',
      bodyPosition: 'STANDING',
      jointAction: null,
    },
    'Levantamento romeno com barra': {
      plane: 'SAGITTAL',
      targetRegion: 'HIPS',
      bodyPosition: 'STANDING',
      jointAction: null,
    },
    'Extensão de joelhos na máquina': {
      plane: 'SAGITTAL',
      targetRegion: 'KNEES',
      bodyPosition: 'SEATED',
      jointAction: 'EXTENSION',
    },
    'Flexão de joelhos sentada': {
      plane: 'SAGITTAL',
      targetRegion: 'KNEES',
      bodyPosition: 'SEATED',
      jointAction: 'FLEXION',
    },
  };

function activityBase(name: string): WorkoutActivityBase {
  return {
    activityKey: name,
    name,
    source: 'MODEL_GENERATED',
    movementPattern: 'OTHER',
    equipment: [],
    instruction: '',
    alerts: [],
    appliedConstraintCodes: [],
  };
}

function lift(
  name: string,
  movementPattern: StrengthActivity['movementPattern'],
  equipment: readonly WorkoutEquipment[],
  sets: number,
  repetitions: string,
  restSeconds: number,
  instruction: string,
  intensity: StrengthActivity['intensity'] = 'MODERATE',
): StrengthActivity {
  return {
    ...strength(name),
    name,
    movementPattern,
    publicIdentity: liftIdentities[name],
    equipment,
    sets,
    repetitions,
    restSeconds,
    instruction,
    intensity,
  };
}
function cardio(
  name: string,
  durationMinutes: number,
  instruction: string,
  mode: EnduranceActivity['mode'] = 'WALK',
): EnduranceActivity {
  return {
    ...activityBase(name),
    kind: 'ENDURANCE',
    name,
    movementPattern: 'LOCOMOTION',
    equipment: mode === 'CYCLE' ? ['BIKE'] : ['TREADMILL'],
    mode,
    durationMinutes,
    distanceKm: null,
    intensity: 'LIGHT',
    instruction,
  };
}
export function commercialWorkoutPlan(): WorkoutPlanV2 {
  const plan = qualityPlan();
  const farmer: TimedActivity = {
    ...activityBase('farmer'),
    kind: 'TIMED',
    name: 'Farmer walk com halteres',
    movementPattern: 'CARRY',
    publicIdentity: {
      plane: 'SAGITTAL',
      targetRegion: 'WHOLE_BODY',
      bodyPosition: 'STANDING',
      jointAction: null,
    },
    equipment: ['DUMBBELL'],
    durationSeconds: 340,
    workSeconds: 40,
    recoverySeconds: 60,
    rounds: 4,
    intensity: 'MODERATE',
    instruction:
      'Caminhe com tronco ereto, abdômen firme e passos controlados.',
  };
  const mobility: MobilityActivity = {
    ...activityBase('mobility'),
    kind: 'MOBILITY',
    name: 'Mobilidade de quadril e coluna torácica',
    movementPattern: 'MOBILITY',
    publicIdentity: {
      plane: 'TRANSVERSE',
      targetRegion: 'HIPS',
      bodyPosition: 'STANDING',
      jointAction: 'ROTATION',
    },
    equipment: ['BODYWEIGHT'],
    durationSeconds: 300,
    holdSeconds: null,
    repetitions: null,
    instruction:
      'Alterne rotações suaves do tronco e movimentos do quadril sem forçar o fim da amplitude.',
  };
  const days: readonly {
    label: string;
    activities: readonly WorkoutActivityV2[];
    mobility?: MobilityActivity;
  }[] = [
    {
      label: 'Superiores A',
      activities: [
        lift(
          'Supino reto com barra',
          'PUSH',
          ['BARBELL', 'BENCH'],
          4,
          '8–10',
          90,
          'Mantenha as escápulas apoiadas e controle a barra na descida.',
        ),
        lift(
          'Remada baixa na polia',
          'PULL',
          ['CABLE'],
          3,
          '10–12',
          75,
          'Conduza os cotovelos para trás sem balançar o tronco.',
        ),
        lift(
          'Desenvolvimento sentado com halteres',
          'PUSH',
          ['DUMBBELL', 'BENCH'],
          3,
          '8–10',
          90,
          'Eleve os halteres sem arquear a lombar e mantenha os punhos alinhados.',
        ),
        lift(
          'Puxada frontal na polia',
          'PULL',
          ['CABLE'],
          3,
          '10–12',
          75,
          'Traga a barra à frente do peito sem puxar com impulso.',
        ),
        lift(
          'Rosca alternada com halteres',
          'OTHER',
          ['DUMBBELL'],
          3,
          '12–15',
          60,
          'Mantenha os cotovelos próximos ao corpo e evite embalar os halteres.',
        ),
      ],
    },
    {
      label: 'Inferiores A',
      activities: [
        lift(
          'Agachamento com barra',
          'SQUAT',
          ['BARBELL'],
          4,
          '6–8',
          120,
          'Mantenha os pés firmes e controle a descida sem perder o alinhamento dos joelhos.',
        ),
        lift(
          'Levantamento romeno com halteres',
          'HINGE',
          ['DUMBBELL'],
          3,
          '8–10',
          90,
          'Leve o quadril para trás, mantendo os halteres próximos às pernas.',
        ),
        lift(
          'Leg press',
          'SQUAT',
          ['MACHINE'],
          3,
          '10–12',
          90,
          'Desça sem tirar o quadril do apoio e estenda os joelhos sem travá-los.',
        ),
        lift(
          'Flexão de joelhos na máquina',
          'OTHER',
          ['MACHINE'],
          3,
          '12–15',
          60,
          'Flexione os joelhos sem levantar o quadril do apoio.',
        ),
        lift(
          'Elevação de panturrilhas em pé',
          'OTHER',
          ['DUMBBELL'],
          3,
          '12–15',
          60,
          'Suba os calcanhares com controle e faça uma pausa breve no alto.',
        ),
      ],
    },
    {
      label: 'Recuperação ativa',
      activities: [
        cardio(
          'Bicicleta ergométrica leve',
          20,
          'Pedale com resistência baixa, em ritmo que permita conversar.',
          'CYCLE',
        ),
        lift(
          'Agachamento ao banco sem carga',
          'SQUAT',
          ['BODYWEIGHT', 'BENCH'],
          2,
          '10–12',
          60,
          'Toque o banco suavemente e levante mantendo os joelhos alinhados.',
          'LIGHT',
        ),
        lift(
          'Remada leve com elástico',
          'PULL',
          ['RESISTANCE_BAND'],
          2,
          '12–15',
          60,
          'Aproxime as escápulas sem elevar os ombros nem tensionar o pescoço.',
          'LIGHT',
        ),
        lift(
          'Flexão de braços na parede',
          'PUSH',
          ['BODYWEIGHT'],
          2,
          '10–12',
          60,
          'Mantenha o corpo alinhado e aproxime o peito da parede com controle.',
          'LIGHT',
        ),
      ],
      mobility,
    },
    {
      label: 'Superiores B',
      activities: [
        lift(
          'Supino inclinado com halteres',
          'PUSH',
          ['DUMBBELL', 'BENCH'],
          4,
          '8–10',
          90,
          'Apoie as escápulas no banco e desça os halteres com os punhos estáveis.',
        ),
        lift(
          'Remada apoiada no banco',
          'PULL',
          ['DUMBBELL', 'BENCH'],
          4,
          '10–12',
          90,
          'Mantenha o peito apoiado e puxe os halteres sem levantar o tronco.',
        ),
        lift(
          'Elevação lateral com halteres',
          'OTHER',
          ['DUMBBELL'],
          3,
          '12–15',
          60,
          'Eleve os braços até uma altura confortável sem encolher os ombros.',
        ),
        lift(
          'Puxada neutra na polia',
          'PULL',
          ['CABLE'],
          3,
          '10–12',
          75,
          'Desça os cotovelos junto ao corpo e evite inclinar o tronco para trás.',
        ),
        lift(
          'Extensão de tríceps na polia',
          'OTHER',
          ['CABLE'],
          3,
          '12–15',
          60,
          'Estenda os cotovelos mantendo os braços próximos ao tronco.',
        ),
      ],
    },
    {
      label: 'Inferiores B',
      activities: [
        lift(
          'Agachamento com halter ao banco',
          'SQUAT',
          ['DUMBBELL', 'BENCH'],
          4,
          '8–10',
          90,
          'Segure o halter junto ao peito e encoste no banco sem relaxar o tronco.',
        ),
        lift(
          'Levantamento romeno com barra',
          'HINGE',
          ['BARBELL'],
          4,
          '8–10',
          120,
          'Desloque o quadril para trás com a barra próxima ao corpo e a coluna estável.',
        ),
        lift(
          'Extensão de joelhos na máquina',
          'OTHER',
          ['MACHINE'],
          3,
          '12–15',
          60,
          'Estenda os joelhos com controle e evite bater os pesos na volta.',
        ),
        lift(
          'Flexão de joelhos sentada',
          'OTHER',
          ['MACHINE'],
          3,
          '10–12',
          75,
          'Mantenha o quadril apoiado enquanto leva os calcanhares para baixo.',
        ),
        farmer,
      ],
    },
  ];
  const sessions: WorkoutSessionV2[] = days.map((day, index) => {
    const source = plan.sessions[index];
    const key = (
      activity: WorkoutActivityV2,
      position: string,
    ): WorkoutActivityV2 => ({
      ...activity,
      activityKey: `day-${index}-${position}`,
    });
    const blocks: WorkoutSessionV2['blocks'] = [
      {
        ...source.blocks[0],
        estimatedDurationMinutes: 7,
        activities: [
          key(
            cardio(
              'Caminhada na esteira',
              7,
              'Comece confortável e aumente o ritmo gradualmente.',
            ),
            'warmup',
          ),
        ],
      },
      ...(day.mobility
        ? [
            {
              ...source.blocks[0],
              blockKey: `day-${index}-mobility-block`,
              type: 'MOBILITY' as const,
              title: 'Mobilidade',
              estimatedDurationMinutes: 5,
              activities: [key(day.mobility, 'mobility')],
            },
          ]
        : []),
      ...(day.mobility
        ? [
            {
              ...source.blocks[1],
              blockKey: `day-${index}-endurance-block`,
              type: 'ENDURANCE' as const,
              title: 'Condicionamento leve',
              estimatedDurationMinutes: 20,
              activities: day.activities
                .filter((activity) => activity.kind === 'ENDURANCE')
                .map((activity) => key(activity, 'endurance')),
            },
          ]
        : []),
      {
        ...source.blocks[1],
        estimatedDurationMinutes: day.mobility ? 23 : 48,
        activities: day.activities
          .filter((activity) => activity.kind !== 'ENDURANCE')
          .map((activity, position) => key(activity, String(position))),
      },
      {
        ...source.blocks[2],
        estimatedDurationMinutes: 5,
        activities: [
          key(
            cardio(
              'Caminhada leve na esteira',
              5,
              'Reduza o ritmo gradualmente até normalizar a respiração.',
            ),
            'cooldown',
          ),
        ],
      },
    ];
    return { ...source, label: day.label, blocks };
  });
  return {
    ...plan,
    title: 'Sua semana na academia',
    sessions,
    strategy: {
      ...plan.strategy,
      environment: { status: 'CONFIRMED', value: 'FULL_GYM' },
      authorizedEquipment: [
        'BODYWEIGHT',
        'BARBELL',
        'DUMBBELL',
        'BENCH',
        'CABLE',
        'MACHINE',
        'TREADMILL',
        'BIKE',
        'RESISTANCE_BAND',
      ],
    },
  };
}
