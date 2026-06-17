import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, UserRole } from '@prisma/client';
import { normalizeBrazilianPhone } from '../common/phone-number.util';
import { PrismaService } from '../prisma/prisma.service';
import { FindOrCreateUserDto } from './dto/find-or-create-user.dto';

const safeUserSelect = {
  id: true,
  phone: true,
  phoneE164: true,
  email: true,
  name: true,
  city: true,
  state: true,
  role: true,
  isActive: true,
  onboardingCompleted: true,
  lastLoginAt: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.UserSelect;

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  async findOrCreateUser(data: FindOrCreateUserDto) {
    const phoneE164 = normalizeBrazilianPhone(data.phone);
    const existingUser = await this.prisma.user.findFirst({
      where: {
        OR: [{ phone: data.phone }, ...(phoneE164 ? [{ phoneE164 }] : [])],
      },
      select: safeUserSelect,
    });

    if (existingUser) {
      return existingUser;
    }

    return this.prisma.user.create({
      data: {
        phone: data.phone,
        phoneE164,
        name: data.name,
      },
      select: safeUserSelect,
    });
  }

  async findById(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: safeUserSelect,
    });

    if (!user) {
      throw new NotFoundException('Usuário não encontrado');
    }

    return user;
  }

  async findByPhone(phone: string) {
    return this.prisma.user.findUnique({
      where: { phone },
      select: safeUserSelect,
    });
  }

  async findByWhatsAppPhone(phone: string) {
    const phoneE164 = normalizeBrazilianPhone(phone);

    if (!phoneE164) {
      return null;
    }

    return this.prisma.user.findUnique({
      where: { phoneE164 },
      select: safeUserSelect,
    });
  }

  async findByEmail(email: string) {
    return this.prisma.user.findUnique({
      where: { email },
      select: safeUserSelect,
    });
  }

  async findByEmailForAuth(email: string) {
    return this.prisma.user.findUnique({
      where: { email },
      select: {
        id: true,
        email: true,
        passwordHash: true,
        role: true,
        isActive: true,
      },
    });
  }

  async findAuthIdentityById(userId: string) {
    return this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        role: true,
        isActive: true,
      },
    });
  }

  async updateLastLoginAt(userId: string) {
    return this.prisma.user.update({
      where: { id: userId },
      data: {
        lastLoginAt: new Date(),
      },
      select: safeUserSelect,
    });
  }

  async createUser(data: {
    name: string;
    phone: string;
    email: string;
    passwordHash?: string;
    role?: UserRole;
    cpf?: string;
    address?: string;
    city?: string;
    state?: string;
    zipCode?: string;
  }) {
    const phoneE164 = normalizeBrazilianPhone(data.phone);
    const userWithPhone = await this.prisma.user.findFirst({
      where: {
        OR: [{ phone: data.phone }, ...(phoneE164 ? [{ phoneE164 }] : [])],
      },
    });

    if (userWithPhone) {
      throw new ConflictException('Já existe usuário com este telefone');
    }

    const userWithEmail = await this.prisma.user.findUnique({
      where: { email: data.email },
    });

    if (userWithEmail) {
      throw new ConflictException('Já existe usuário com este e-mail');
    }

    return this.prisma.user.create({
      data: {
        name: data.name,
        phone: data.phone,
        phoneE164,
        email: data.email,
        passwordHash: data.passwordHash,
        role: data.role,
        cpf: data.cpf,
        address: data.address,
        city: data.city,
        state: data.state,
        zipCode: data.zipCode,
        onboardingCompleted: false,
      },
      select: safeUserSelect,
    });
  }
}
