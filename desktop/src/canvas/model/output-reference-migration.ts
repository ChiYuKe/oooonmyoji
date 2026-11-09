type JsonSchema = Record<string, any>;

function schemaType(schema: JsonSchema | undefined): string | undefined {
  if (!schema) return undefined;
  if (typeof schema.type === 'string') return schema.type;
  if (Array.isArray(schema.type)) return schema.type.find((item: unknown) => typeof item === 'string');
  return undefined;
}

function pathSchema(schema: JsonSchema | undefined, path: string[]): JsonSchema | undefined {
  let current = schema;
  for (const part of path) {
    if (!current) return undefined;
    if (current.type === 'object') {
      const properties = current.properties && typeof current.properties === 'object' ? current.properties : {};
      current = properties[part] || (current.additionalProperties && typeof current.additionalProperties === 'object' ? current.additionalProperties : undefined);
    } else if (current.type === 'array' && /^\d+$/.test(part)) {
      const index = Number(part);
      current = current.prefixItems?.[index] || current.items;
    } else return undefined;
  }
  return current;
}

function compatibleOutputChildren(oldValue: JsonSchema | undefined, newSchema: JsonSchema | undefined): string[] {
  if (!oldValue || !newSchema || newSchema.type !== 'object') return [];
  const properties = newSchema.properties && typeof newSchema.properties === 'object' ? newSchema.properties : {};
  const oldType = schemaType(oldValue);
  return Object.entries<JsonSchema>(properties)
    .filter(([, candidate]) => {
      const newType = schemaType(candidate);
      return !oldType || !newType || oldType === newType || (oldType === 'integer' && newType === 'number')
        || (oldType === 'number' && newType === 'integer');
    })
    .map(([name]) => name);
}

/** Migrate safe references to a task's output after changing its Action. */
export function migrateActionOutputReferences(raw: any, nodeId: string, oldSchema: JsonSchema | undefined, newSchema: JsonSchema | undefined): { migrated: number; unresolved: number } {
  let migrated = 0;
  let unresolved = 0;
  const prefix = `nodes.${nodeId}.output.`;

  const visit = (value: any): void => {
    if (!value || typeof value !== 'object') return;
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    if (typeof value.ref === 'string' && value.ref.startsWith(prefix)) {
      const tail = value.ref.slice(prefix.length).split('.');
      if (pathSchema(newSchema, tail)) {
        // The path remains valid, so it needs no migration.
      } else {
        const oldValue = pathSchema(oldSchema, tail.slice(0, 1));
        const oldRoot = schemaType(oldSchema);
        const first = tail[0];
        const canRebaseArrayItem = oldRoot === 'array' && /^\d+$/.test(first || '') && Number(first) === 0;
        const candidates = canRebaseArrayItem ? compatibleOutputChildren(oldValue, newSchema) : [];
        if (candidates.length === 1) {
          value.ref = `${prefix}${candidates[0]}${tail.length > 1 ? `.${tail.slice(1).join('.')}` : ''}`;
          migrated += 1;
        } else unresolved += 1;
      }
    }
    Object.values(value).forEach(visit);
  };

  visit(raw);
  return { migrated, unresolved };
}
