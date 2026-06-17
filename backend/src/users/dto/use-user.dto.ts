import { IsUUID } from 'class-validator';

export class UseUserDto {
  @IsUUID()
  userId!: string;
}
