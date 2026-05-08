import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { CreateCustomReportDto } from './create-custom-report.dto.js';

describe('CreateCustomReportDto — layout validation', () => {
  const base = { slug: 'my-report', title: 'My Report' };

  it('accepts layout: null (absent)', async () => {
    const dto = plainToInstance(CreateCustomReportDto, { ...base });
    const errors = await validate(dto);
    expect(errors.filter((e) => e.property === 'layout')).toHaveLength(0);
  });

  it('accepts a valid layout with defaultColumns only', async () => {
    const dto = plainToInstance(CreateCustomReportDto, {
      ...base,
      layout: { defaultColumns: 3 },
    });
    const errors = await validate(dto);
    expect(errors.filter((e) => e.property === 'layout')).toHaveLength(0);
  });

  it('accepts a valid layout with widget overrides', async () => {
    const dto = plainToInstance(CreateCustomReportDto, {
      ...base,
      layout: { defaultColumns: 2, widgets: { 'uuid-abc': { colSpan: 2 } } },
    });
    const errors = await validate(dto);
    expect(errors.filter((e) => e.property === 'layout')).toHaveLength(0);
  });

  it('accepts an empty layout object', async () => {
    const dto = plainToInstance(CreateCustomReportDto, {
      ...base,
      layout: {},
    });
    const errors = await validate(dto);
    expect(errors.filter((e) => e.property === 'layout')).toHaveLength(0);
  });

  it('rejects layout when defaultColumns is a string', async () => {
    const dto = plainToInstance(CreateCustomReportDto, {
      ...base,
      layout: { defaultColumns: 'three' },
    });
    const errors = await validate(dto);
    expect(errors.filter((e) => e.property === 'layout').length).toBeGreaterThan(0);
  });

  it('rejects layout when defaultColumns is 0', async () => {
    const dto = plainToInstance(CreateCustomReportDto, {
      ...base,
      layout: { defaultColumns: 0 },
    });
    const errors = await validate(dto);
    expect(errors.filter((e) => e.property === 'layout').length).toBeGreaterThan(0);
  });

  it('rejects layout when defaultColumns exceeds 6', async () => {
    const dto = plainToInstance(CreateCustomReportDto, {
      ...base,
      layout: { defaultColumns: 7 },
    });
    const errors = await validate(dto);
    expect(errors.filter((e) => e.property === 'layout').length).toBeGreaterThan(0);
  });

  it('rejects layout when widgets value has a non-integer colSpan', async () => {
    const dto = plainToInstance(CreateCustomReportDto, {
      ...base,
      layout: { widgets: { 'uuid-abc': { colSpan: 'wide' } } },
    });
    const errors = await validate(dto);
    expect(errors.filter((e) => e.property === 'layout').length).toBeGreaterThan(0);
  });

  it('rejects layout when widgets is not a plain object', async () => {
    const dto = plainToInstance(CreateCustomReportDto, {
      ...base,
      layout: { widgets: 'all' },
    });
    const errors = await validate(dto);
    expect(errors.filter((e) => e.property === 'layout').length).toBeGreaterThan(0);
  });
});
