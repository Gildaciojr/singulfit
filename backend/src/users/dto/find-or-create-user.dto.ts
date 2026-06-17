import { IsOptional, IsString, MinLength } from 'class-validator';

export class FindOrCreateUserDto {
  @IsString()
  @MinLength(8)
  phone!: string;

  @IsOptional()
  @IsString()
  @MinLength(2)
  name?: string;
}
