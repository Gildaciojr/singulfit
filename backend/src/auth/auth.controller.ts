import { Body, Controller, Get, Post, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { AuthService } from './auth.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { LogoutDto } from './dto/logout.dto';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { CurrentUser } from './decorators/current-user.decorator';
import type { AuthenticatedUser } from './interfaces/jwt-auth-payload.interface';
import type { AuthRequestMetadata } from './interfaces/auth-request-metadata.interface';
import { Throttle } from '@nestjs/throttler';

@Controller(['auth', 'api/v1/auth'])
@Throttle({ default: { limit: 10, ttl: 60_000 } })
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('register')
  async register(@Body() body: RegisterDto, @Req() request: Request) {
    return this.authService.register(body, this.getRequestMetadata(request));
  }

  @Post('login')
  async login(@Body() body: LoginDto, @Req() request: Request) {
    return this.authService.login(body, this.getRequestMetadata(request));
  }

  @Post('refresh')
  async refresh(@Body() body: RefreshTokenDto, @Req() request: Request) {
    return this.authService.refresh(body, this.getRequestMetadata(request));
  }

  @Post('logout')
  async logout(@Body() body: LogoutDto) {
    return this.authService.logout(body);
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  async me(@CurrentUser() authenticatedUser: AuthenticatedUser) {
    return this.authService.me(authenticatedUser);
  }

  private getRequestMetadata(request: Request): AuthRequestMetadata {
    return {
      ipAddress: request.ip,
      userAgent: request.get('user-agent'),
    };
  }
}
