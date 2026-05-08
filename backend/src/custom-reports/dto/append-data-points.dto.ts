import {
  IsString,
  IsNumber,
  IsOptional,
  IsObject,
  MaxLength,
  ValidateNested,
  ArrayMaxSize,
  ArrayMinSize,
  ValidatorConstraint,
  ValidatorConstraintInterface,
  ValidationArguments,
  Validate,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

const DIMENSIONS_MAX_KEYS = 20;
const DIMENSIONS_MAX_KEY_LENGTH = 100;
const DIMENSIONS_MAX_VALUE_LENGTH = 200;

/**
 * Enforces that every key and value in the `dimensions` record is a string
 * within the allowed lengths, and that the number of entries is bounded.
 */
@ValidatorConstraint({ name: 'isDimensionsRecord', async: false })
class IsDimensionsRecord implements ValidatorConstraintInterface {
  validate(value: unknown, _args: ValidationArguments): boolean {
    if (value === null || value === undefined) return true;
    if (typeof value !== 'object' || Array.isArray(value)) return false;
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length > DIMENSIONS_MAX_KEYS) return false;
    for (const [k, v] of entries) {
      if (typeof k !== 'string' || k.length > DIMENSIONS_MAX_KEY_LENGTH) return false;
      if (typeof v !== 'string' || v.length > DIMENSIONS_MAX_VALUE_LENGTH) return false;
    }
    return true;
  }

  defaultMessage(_args: ValidationArguments): string {
    return (
      `dimensions must be a flat object with at most ${DIMENSIONS_MAX_KEYS} entries; ` +
      `keys ≤ ${DIMENSIONS_MAX_KEY_LENGTH} chars and string values ≤ ${DIMENSIONS_MAX_VALUE_LENGTH} chars`
    );
  }
}

export class DataPointDto {
  @ApiProperty({ description: 'X-axis value (ISO date string or bucket label)' })
  @IsString()
  @MaxLength(200)
  x!: string;

  @ApiProperty()
  @IsNumber()
  y!: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(200)
  series?: string;

  @ApiPropertyOptional({
    description:
      `Key-value pairs used for client-side filtering. ` +
      `At most ${DIMENSIONS_MAX_KEYS} string keys (≤ ${DIMENSIONS_MAX_KEY_LENGTH} chars) ` +
      `with string values (≤ ${DIMENSIONS_MAX_VALUE_LENGTH} chars).`,
  })
  @IsOptional()
  @IsObject()
  @Validate(IsDimensionsRecord)
  dimensions?: Record<string, string>;
}

export class AppendDataPointsDto {
  @ApiProperty({ type: [DataPointDto], maxItems: 1000 })
  @ValidateNested({ each: true })
  @Type(() => DataPointDto)
  @ArrayMinSize(1)
  @ArrayMaxSize(1000)
  points!: DataPointDto[];
}
