import {
  registerDecorator,
  ValidationOptions,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';
import { reportLayoutSchema } from '../layout-schema.js';

@ValidatorConstraint({ name: 'isValidLayout', async: false })
export class IsValidLayoutConstraint implements ValidatorConstraintInterface {
  validate(value: unknown): boolean {
    if (value === null || value === undefined) return true;
    const result = reportLayoutSchema.safeParse(value);
    return result.success;
  }

  defaultMessage(): string {
    return 'layout must be a valid ReportLayout object (defaultColumns: 1–6, widgets: Record<string, { colSpan?: 1–6 }>)';
  }
}

export function IsValidLayout(validationOptions?: ValidationOptions) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      target: object.constructor,
      propertyName,
      options: validationOptions,
      constraints: [],
      validator: IsValidLayoutConstraint,
    });
  };
}
