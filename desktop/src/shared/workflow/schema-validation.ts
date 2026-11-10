/** Interpret the schema keywords used by workflow parameters without eval/new Function.
 * Canvas validation runs under script-src 'self', where Ajv's runtime code generation
 * is unavailable. Keep the same validation on the canvas and in the main process.
 */
export interface SchemaError {
  instancePath: string;
  keyword: string;
  message: string;
  params: Record<string, unknown>;
}
export interface SchemaValidator {
  (value: unknown): boolean;
  errors: SchemaError[] | null;
}

function equal(a: any, b: any): boolean {
  if (a === b) return true;
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every(key => Object.hasOwn(b, key) && equal(a[key], b[key]));
}

const escapePath = (key: string | number): string => String(key).replace(/~/g, '~0').replace(/\//g, '~1');
function check(schema: any, value: any, path: string, errors: SchemaError[]): void {
  const fail = (keyword: string, message: string, params: Record<string, unknown> = {}): void => {
    errors.push({ instancePath: path, keyword, message, params });
  };
  if (schema === true) return;
  if (schema === false) { fail('false schema', 'boolean schema is false'); return; }
  if (!schema || typeof schema !== 'object' || Array.isArray(schema)) throw new Error('schema must be an object or boolean');
  const matches = (child: any): boolean => { const found: SchemaError[] = []; check(child, value, path, found); return !found.length; };
  for (const child of schema.allOf ?? []) check(child, value, path, errors);
  if (schema.anyOf && !schema.anyOf.some(matches)) fail('anyOf', 'must match a schema in anyOf');
  if (schema.oneOf && schema.oneOf.filter(matches).length !== 1) fail('oneOf', 'must match exactly one schema in oneOf');
  if (schema.not !== undefined && matches(schema.not)) fail('not', 'must NOT be valid');
  if (schema.const !== undefined && !equal(value, schema.const)) fail('const', 'must be equal to constant');
  if (schema.enum && !schema.enum.some((item: unknown) => equal(item, value))) fail('enum', 'must be equal to one of the allowed values');
  if (schema.type !== undefined) {
    const types = Array.isArray(schema.type) ? schema.type : [schema.type];
    const valid = types.some((type: string) => {
      switch (type) {
        case 'null': return value === null;
        case 'array': return Array.isArray(value);
        case 'object': return value !== null && typeof value === 'object' && !Array.isArray(value);
        case 'integer': return typeof value === 'number' && Number.isFinite(value) && Number.isInteger(value);
        case 'number': return typeof value === 'number' && Number.isFinite(value);
        case 'boolean': case 'string': return typeof value === type;
        default: throw new Error(`unsupported schema type: ${type}`);
      }
    });
    if (!valid) { fail('type', `must be ${types.join(',')}`); return; }
  }
  if (typeof value === 'number') {
    if (schema.minimum !== undefined && value < schema.minimum) fail('minimum', `must be >= ${schema.minimum}`);
    if (schema.maximum !== undefined && value > schema.maximum) fail('maximum', `must be <= ${schema.maximum}`);
    if (schema.exclusiveMinimum !== undefined && value <= schema.exclusiveMinimum) fail('exclusiveMinimum', `must be > ${schema.exclusiveMinimum}`);
    if (schema.exclusiveMaximum !== undefined && value >= schema.exclusiveMaximum) fail('exclusiveMaximum', `must be < ${schema.exclusiveMaximum}`);
  }
  if (typeof value === 'string') {
    const length = [...value].length;
    if (schema.minLength !== undefined && length < schema.minLength) fail('minLength', `must NOT have fewer than ${schema.minLength} characters`);
    if (schema.maxLength !== undefined && length > schema.maxLength) fail('maxLength', `must NOT have more than ${schema.maxLength} characters`);
    if (schema.pattern !== undefined && !new RegExp(schema.pattern, 'u').test(value)) fail('pattern', `must match pattern "${schema.pattern}"`);
  }
  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) fail('minItems', `must NOT have fewer than ${schema.minItems} items`);
    if (schema.maxItems !== undefined && value.length > schema.maxItems) fail('maxItems', `must NOT have more than ${schema.maxItems} items`);
    if (schema.uniqueItems && value.some((item, i) => value.slice(0, i).some(other => equal(item, other)))) fail('uniqueItems', 'must NOT have duplicate items');
    value.forEach((item, i) => {
      const child = schema.prefixItems?.[i] ?? schema.items;
      if (child !== undefined) check(child, item, `${path}/${i}`, errors);
    });
  } else if (value !== null && typeof value === 'object') {
    const properties = schema.properties ?? {};
    for (const key of schema.required ?? []) {
      if (!Object.hasOwn(value, key)) fail('required', `must have required property '${key}'`, { missingProperty: key });
    }
    for (const [key, item] of Object.entries(value)) {
      if (Object.hasOwn(properties, key)) check(properties[key], item, `${path}/${escapePath(key)}`, errors);
      else if (schema.additionalProperties === false) fail('additionalProperties', 'must NOT have additional properties', { additionalProperty: key });
      else if (schema.additionalProperties && typeof schema.additionalProperties === 'object') check(schema.additionalProperties, item, `${path}/${escapePath(key)}`, errors);
    }
  }
}

function checkSchema(schema: any): void {
  if (typeof schema === 'boolean') return;
  if (!schema || typeof schema !== 'object' || Array.isArray(schema)) throw new Error('schema must be an object or boolean');
  const supported = new Set(['type', 'enum', 'const', 'minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum',
    'minLength', 'maxLength', 'pattern', 'minItems', 'maxItems', 'uniqueItems', 'prefixItems', 'items',
    'properties', 'required', 'additionalProperties', 'allOf', 'anyOf', 'oneOf', 'not',
    '$schema', '$id', '$comment', 'title', 'description', 'default', 'examples', 'deprecated', 'readOnly', 'writeOnly']);
  for (const key of Object.keys(schema)) if (!supported.has(key)) throw new Error(`unsupported schema keyword: ${key}`);
  if (schema.pattern !== undefined) new RegExp(schema.pattern, 'u');
  for (const child of Object.values(schema.properties ?? {})) checkSchema(child);
  for (const key of ['items', 'additionalProperties', 'not']) if (schema[key] !== undefined) checkSchema(schema[key]);
  for (const key of ['prefixItems', 'allOf', 'anyOf', 'oneOf']) for (const child of schema[key] ?? []) checkSchema(child);
}

export function compileSchema(schema: unknown): SchemaValidator {
  checkSchema(schema);
  const validate: SchemaValidator = Object.assign((value: unknown): boolean => {
    const errors: SchemaError[] = [];
    check(schema, value, '', errors);
    validate.errors = errors.length ? errors : null;
    return !errors.length;
  }, { errors: null as SchemaError[] | null });
  return validate;
}
