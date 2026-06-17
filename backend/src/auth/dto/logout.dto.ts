import { IsJWT } from 'class-validator';

export class LogoutDto {
  @IsJWT()
  refreshToken!: string;
}
