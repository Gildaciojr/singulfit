import { Transform, TransformFnParams, Type } from 'class-transformer';
import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsUUID,
  Max,
  Min,
} from 'class-validator';

export class ListNutritionAdminDto {
  @IsOptional()
  @IsUUID()
  userId?: string;

  @IsOptional()
  @IsBoolean()
  @Transform(({ value }: TransformFnParams): unknown => {
    const candidate: unknown = value;

    return candidate === 'true'
      ? true
      : candidate === 'false'
        ? false
        : candidate;
  })
  active?: boolean;

  @IsOptional()
  @IsUUID()
  cursor?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit = 50;
}
