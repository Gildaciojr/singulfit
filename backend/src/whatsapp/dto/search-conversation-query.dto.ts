import { IsString, MaxLength, MinLength } from 'class-validator';

export class SearchConversationQueryDto {
  @IsString()
  @MinLength(10)
  @MaxLength(20)
  phoneNumber!: string;
}
