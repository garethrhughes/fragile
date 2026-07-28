import { IsIn, IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class UpdateRoleDto {
  @ApiProperty({ enum: ['user', 'admin'], description: 'New role for the user' })
  @IsString()
  @IsIn(['user', 'admin'])
  role!: string;
}
