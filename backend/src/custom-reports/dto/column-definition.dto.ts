import { IsString, IsIn, IsOptional, IsBoolean, MaxLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import type { ColumnType } from '../../database/entities/index.js';

const COLUMN_TYPES: ColumnType[] = ['text', 'number', 'status', 'priority', 'issue', 'link', 'icon'];

export class ColumnDefinitionDto {
  @ApiProperty({ description: 'Dimension key, or reserved keys: x, y, series' })
  @IsString()
  @MaxLength(200)
  key!: string;

  @ApiProperty({ description: 'Column header text' })
  @IsString()
  @MaxLength(200)
  label!: string;

  @ApiProperty({ enum: COLUMN_TYPES })
  @IsString()
  @IsIn(COLUMN_TYPES)
  type!: ColumnType;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  sortable?: boolean;
}
