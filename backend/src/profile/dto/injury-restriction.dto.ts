import { IsString, Matches, MaxLength, MinLength } from 'class-validator';

export class InjuryRestrictionDto {
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  @Matches(/\S/, {
    message: 'description não pode conter apenas espaços',
  })
  description!: string;
}
