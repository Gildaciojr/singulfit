import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { ConversationsService } from './conversations.service';
import { CreateInternalMessageDto } from './dto/create-internal-message.dto';
import { ListMessagesQueryDto } from './dto/list-messages-query.dto';
import { SearchConversationQueryDto } from './dto/search-conversation-query.dto';
import { MessagesService } from './messages.service';

@Controller('api/v1/internal/whatsapp')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
export class WhatsAppController {
  constructor(
    private readonly conversationsService: ConversationsService,
    private readonly messagesService: MessagesService,
  ) {}

  @Get('conversations/users/:userId')
  getConversation(@Param('userId', ParseUUIDPipe) userId: string) {
    return this.conversationsService.getActiveByUserId(userId);
  }

  @Get('conversations/search')
  searchConversation(@Query() query: SearchConversationQueryDto) {
    return this.conversationsService.getByPhone(query.phoneNumber);
  }

  @Get('conversations/:conversationId/messages')
  getMessages(
    @Param('conversationId', ParseUUIDPipe) conversationId: string,
    @Query() query: ListMessagesQueryDto,
  ) {
    return this.messagesService.list(conversationId, query);
  }

  @Post('messages')
  createInternalMessage(@Body() body: CreateInternalMessageDto) {
    return this.messagesService.createInternal(body);
  }
}
