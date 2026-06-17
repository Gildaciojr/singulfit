import { IsString, Matches, MaxLength, MinLength } from 'class-validator';

export class FoodRestrictionDto {
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  @Matches(/\S/, {
    message: 'type não pode conter apenas espaços',
  })
  type!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(500)
  @Matches(/\S/, {
    message: 'description não pode conter apenas espaços',
  })
  description!: string;
}
