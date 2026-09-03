type PropertySchema = {
  type: string;
  minLength?: number;
  minimum?: number;
  maximum?: number;
};

type ObjectSchema = {
  required?: readonly string[];
  additionalProperties?: boolean;
  properties: Record<string, PropertySchema | undefined>;
};

function matchesType(value: unknown, type: string) {
  if (type === 'array') return Array.isArray(value);
  if (type === 'integer') return Number.isInteger(value);
  if (type === 'object') {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
  }
  return typeof value === type;
}

export function validateCapabilityInput(
  schema: ObjectSchema,
  input: Record<string, unknown>,
) {
  const errors: string[] = [];

  for (const field of schema.required ?? []) {
    if (!(field in input)) errors.push(`缺少必填字段：${field}`);
  }

  if (schema.additionalProperties === false) {
    for (const field of Object.keys(input)) {
      if (!(field in schema.properties)) errors.push(`未知字段：${field}`);
    }
  }

  for (const [field, value] of Object.entries(input)) {
    const property = schema.properties[field];
    if (!property) continue;
    if (!matchesType(value, property.type)) {
      errors.push(`${field} 类型应为 ${property.type}`);
      continue;
    }
    if (
      property.type === 'string' &&
      property.minLength &&
      (value as string).length < property.minLength
    ) {
      errors.push(`${field} 不能为空`);
    }
    if (
      property.type === 'integer' &&
      property.minimum !== undefined &&
      (value as number) < property.minimum
    ) {
      errors.push(`${field} 不能小于 ${property.minimum}`);
    }
    if (
      property.type === 'integer' &&
      property.maximum !== undefined &&
      (value as number) > property.maximum
    ) {
      errors.push(`${field} 不能大于 ${property.maximum}`);
    }
  }

  return errors;
}
