import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Query,
  UseGuards,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { ListResponsesQueryDto } from './dto/list-responses-query.dto';
import { ResponseBuilderService } from './response-builder.service';

@Controller('api/v1/internal/responses')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
export class ResponseController {
  constructor(
    private readonly responseBuilderService: ResponseBuilderService,
  ) {}

  @Get(':conversationId')
  listByConversation(
    @Param('conversationId', ParseUUIDPipe) conversationId: string,
    @Query() query: ListResponsesQueryDto,
  ) {
    return this.responseBuilderService.listByConversation(
      conversationId,
      query,
    );
  }
}
